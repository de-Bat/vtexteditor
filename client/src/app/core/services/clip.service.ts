import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Clip } from '../models/clip.model';
import { CutRegion } from '../models/cut-region.model';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ClipService {
  readonly clips = signal<Clip[]>([]);

  constructor(private api: ApiService) {}

  loadAll(): Observable<Clip[]> {
    return this.api.get<Clip[]>('/clips').pipe(tap((c) => this.clips.set(c)));
  }

  getById(id: string): Observable<Clip> {
    return this.api.get<Clip>(`/clips/${id}`);
  }

  /** Optimistic in-memory update — replaces the clip in the signal without an API call. */
  applyLocalUpdate(updatedClip: Clip): void {
    this.clips.update((list) => list.map((c) => (c.id === updatedClip.id ? updatedClip : c)));
  }

  /** Persist cut regions to server (also syncs isRemoved server-side). */
  updateCutRegions(clipId: string, cutRegions: CutRegion[]): Observable<Clip> {
    return this.api.put<Clip>(`/clips/${clipId}/cut-regions`, { cutRegions }).pipe(
      tap((updated) => this.clips.update((list) => list.map((c) => (c.id === clipId ? updated : c))))
    );
  }

  updateWordStates(clipId: string, states: { id: string; isRemoved?: boolean; text?: string }[]): Observable<Clip> {
    return this.api.put<Clip>(`/clips/${clipId}/words`, { updates: states }).pipe(
      tap((updated) => {
        this.clips.update((list) => list.map((c) => (c.id === clipId ? updated : c)));
      })
    );
  }
}
