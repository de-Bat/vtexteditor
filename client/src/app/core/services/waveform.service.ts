import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface WaveformData {
  peaks: number[];     // normalized [0,1]
  durationMs: number;
  chunkMs: number;
}

@Injectable({ providedIn: 'root' })
export class WaveformService {
  private readonly api = inject(ApiService);
  private readonly cache = new Map<string, WaveformData>();

  fetch(clipId: string): Observable<WaveformData> {
    const cached = this.cache.get(clipId);
    if (cached) return of(cached);
    return this.api.get<WaveformData>(`/clips/${clipId}/waveform`).pipe(
      tap(data => this.cache.set(clipId, data))
    );
  }
}
