import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  DetectedObject,
  TrackSseEvent,
  ExportSseEvent,
} from '../models/vision.model';

@Injectable({ providedIn: 'root' })
export class VisionService {
  private http = inject(HttpClient);

  async checkHealth(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ status: string }>('/api/vision/health')
      );
      return res.status === 'ok';
    } catch {
      return false;
    }
  }

  async detect(mediaPath: string, frameTime: number): Promise<DetectedObject[]> {
    const raw = await firstValueFrom(
      this.http.post<Array<{ id: string; label: string; confidence: number; bbox: [number, number, number, number] }>>(
        '/api/vision/detect',
        { mediaPath, frameTime }
      )
    );
    return raw.map((obj) => ({
      ...obj,
      maskEnabled: true,
      effect: 'blur' as const,
      fillColor: '#000000',
    }));
  }

  /** Calls /api/vision/track and yields SSE progress events. */
  async *track(
    mediaPath: string,
    frameTime: number,
    objects: Array<{ id: string; bbox: [number, number, number, number] }>,
    maskSessionId: string,
    projectId: string
  ): AsyncGenerator<TrackSseEvent> {
    const response = await fetch('/api/vision/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaPath, frameTime, objects, projectId, maskSessionId }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Track request failed: ${response.status}`);
    }

    yield* this._readSseStream<TrackSseEvent>(response.body);
  }

  async preview(
    mediaPath: string,
    frameTime: number,
    maskSessionId: string,
    projectId: string,
    objects: DetectedObject[]
  ): Promise<{ url: string; usedInpaintFallback: boolean }> {
    const res = await firstValueFrom(
      this.http.post<{ previewPng: string; usedInpaintFallback: boolean }>('/api/vision/preview', {
        mediaPath,
        frameTime,
        projectId,
        maskSessionId,
        objects: objects.map((o) => ({
          id: o.id,
          effect: o.effect,
          fillColor: o.effect === 'fill' ? o.fillColor : null,
        })),
      })
    );
    return { url: `data:image/png;base64,${res.previewPng}`, usedInpaintFallback: res.usedInpaintFallback ?? false };
  }

  /** Calls /api/vision/export-masked and yields SSE progress events. */
  async *exportMasked(
    mediaPath: string,
    maskSessionId: string,
    projectId: string,
    exportId: string,
    objects: DetectedObject[]
  ): AsyncGenerator<ExportSseEvent> {
    const response = await fetch('/api/vision/export-masked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaPath,
        projectId,
        exportId,
        maskSessionId,
        objects: objects
          .filter((o) => o.maskEnabled)
          .map((o) => ({
            id: o.id,
            effect: o.effect,
            fillColor: o.effect === 'fill' ? o.fillColor : null,
          })),
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Export request failed: ${response.status}`);
    }

    yield* this._readSseStream<ExportSseEvent>(response.body);
  }

  getDownloadUrl(projectId: string, exportId: string): string {
    return `/api/vision/download/${projectId}/${exportId}`;
  }

  private async *_readSseStream<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              yield JSON.parse(line.slice(6)) as T;
            } catch {
              // malformed SSE line — skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
