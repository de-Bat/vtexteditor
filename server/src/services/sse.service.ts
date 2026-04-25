import { Request, Response } from 'express';
import { EventEmitter } from 'events';

export type SseEventType =
  | 'pipeline:progress'
  | 'pipeline:complete'
  | 'pipeline:error'
  | 'export:progress'
  | 'export:complete'
  | 'export:error'
  | 'plugin:input-requested'
  | 'plugin:input-received';

export interface SseEvent {
  type: SseEventType;
  data: Record<string, unknown>;
}

type ConnectCallback = (sendToClient: (event: SseEvent) => void) => void;

class SseService extends EventEmitter {
  private clients = new Set<Response>();
  private connectCallbacks: ConnectCallback[] = [];

  /** Register a callback invoked for each new SSE client connection. */
  onClientConnect(cb: ConnectCallback): void {
    this.connectCallbacks.push(cb);
  }

  addClient(res: Response): void {
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  broadcast(event: SseEvent): void {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  handleConnection(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send a heartbeat comment every 30s to keep connection alive
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);
    res.on('close', () => clearInterval(heartbeat));

    this.addClient(res);

    const sendToClient = (event: SseEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    for (const cb of this.connectCallbacks) {
      cb(sendToClient);
    }
  }
}

export const sseService = new SseService();
