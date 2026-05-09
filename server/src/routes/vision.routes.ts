import { Router, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import fs from 'fs';
import { VisionService } from '../services/vision.service';
import { sseService } from '../services/sse.service';

const router = Router();

const STORAGE_ROOT = path.resolve(process.cwd(), '..', 'storage');
const SAFE_ID = /^[a-zA-Z0-9_\-]{1,64}$/;

// Download endpoint — must be before proxy catch-all
router.get('/download/:projectId/:exportId', (req: Request, res: Response) => {
  const projectId = req.params['projectId'] as string;
  const exportId = req.params['exportId'] as string;
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(exportId)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const filePath = path.join(STORAGE_ROOT, 'projects', projectId, 'exports', `${exportId}-masked.mp4`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'Export not found' });
    return;
  }
  res.download(resolved, `${exportId}-masked.mp4`);
});

function startSseResponse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/** Pipe a Python SSE response to the Express client, broadcasting each event via sseService. */
async function pipeSseWithBroadcast(
  pythonUrl: string,
  body: unknown,
  expressRes: Response,
  eventTypeMap: (event: Record<string, unknown>) => string,
): Promise<void> {
  let upstream: globalThis.Response | undefined;
  try {
    upstream = await globalThis.fetch(pythonUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    expressRes.write(`data: ${JSON.stringify({ type: 'error', message: 'Vision service unavailable' })}\n\n`);
    expressRes.end();
    return;
  }

  if (!upstream.ok || !upstream.body) {
    expressRes.write(`data: ${JSON.stringify({ type: 'error', message: 'Vision service error' })}\n\n`);
    expressRes.end();
    return;
  }

  const nodeBody = upstream.body as unknown as AsyncIterable<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for await (const chunk of nodeBody) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          expressRes.write(line + '\n\n');
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            const sseType = eventTypeMap(event);
            sseService.broadcast({ type: sseType as Parameters<typeof sseService.broadcast>[0]['type'], data: event });
          } catch { /* malformed — skip broadcast */ }
        }
      }
    }
  } catch { /* client disconnected */ }

  expressRes.end();
}

function trackEventType(event: Record<string, unknown>): string {
  if (event['type'] === 'complete') return 'vision:complete';
  if (event['type'] === 'error') return 'vision:error';
  if (event['type'] === 'warning') return 'vision:warning';
  return 'vision:tracking';
}

function exportEventType(event: Record<string, unknown>): string {
  if (event['type'] === 'complete') return 'vision:complete';
  if (event['type'] === 'error') return 'vision:error';
  return 'vision:export-progress';
}

router.post('/detect', async (req: Request, res: Response) => {
  sseService.broadcast({ type: 'vision:detecting', data: {} });
  try {
    const upstream = await globalThis.fetch(`${VisionService.getBaseUrl()}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: 'Vision service unavailable' });
  }
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const upstream = await globalThis.fetch(`${VisionService.getBaseUrl()}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
    if (upstream.ok) {
      sseService.broadcast({ type: 'vision:preview-ready', data: {} });
    }
  } catch {
    res.status(502).json({ error: 'Vision service unavailable' });
  }
});

router.post('/track', async (req: Request, res: Response) => {
  startSseResponse(res);
  await pipeSseWithBroadcast(
    `${VisionService.getBaseUrl()}/track`,
    req.body,
    res,
    trackEventType,
  );
});

router.post('/export-masked', async (req: Request, res: Response) => {
  startSseResponse(res);
  await pipeSseWithBroadcast(
    `${VisionService.getBaseUrl()}/export-masked`,
    req.body,
    res,
    exportEventType,
  );
});

// Proxy everything else to Python (detect, preview, health)
router.use(
  '/',
  createProxyMiddleware({
    target: VisionService.getBaseUrl(),
    changeOrigin: true,
    on: {
      error: (_err, _req, res) => {
        (res as Response).status(502).json({ error: 'Vision service unavailable' });
      },
    },
  })
);

export default router;
