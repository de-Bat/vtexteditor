import { Injectable, signal, OnDestroy } from '@angular/core';

export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class SseService implements OnDestroy {
  readonly lastEvent = signal<SseEvent | null>(null);
  private es: EventSource | null = null;

  reset(): void {
    this.lastEvent.set(null);
  }

  connect(): void {
    if (this.es) return;
    this.es = new EventSource('/api/events');

    const forward = (type: string) => {
      this.es!.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.lastEvent.set({ type, data });
        } catch {
          // ignore malformed events
        }
      });
    };

    ['pipeline:progress', 'pipeline:complete', 'pipeline:error',
      'export:progress', 'export:complete', 'export:error',
      'plugin:input-requested', 'plugin:input-received'].forEach(forward);
  }

  disconnect(): void {
    this.es?.close();
    this.es = null;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
