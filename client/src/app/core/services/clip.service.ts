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
    const oldClip = this.clips().find(c => c.id === clipId);
    return this.api.put<Clip>(`/clips/${clipId}/cut-regions`, { cutRegions }).pipe(
      tap((updated) => {
        if (oldClip) this.mergeIsEdited(oldClip, updated);
        this.clips.update((list) => list.map((c) => (c.id === clipId ? updated : c)));
      })
    );
  }

  updateWordStates(clipId: string, states: { id: string; isRemoved?: boolean; text?: string; isEdited?: boolean }[]): Observable<Clip> {
    const oldClip = this.clips().find(c => c.id === clipId);
    return this.api.put<Clip>(`/clips/${clipId}/words`, { updates: states }).pipe(
      tap((updated) => {
        if (oldClip) this.mergeIsEdited(oldClip, updated);
        this.clips.update((list) => list.map((c) => (c.id === clipId ? updated : c)));
      })
    );
  }

  /**
   * Preserves local 'isEdited' flag when merging a fresh Clip object from the server.
   * This prevents UI highlights from "blinking" off after a save operation.
   */
  private mergeIsEdited(oldClip: Clip, newClip: Clip): void {
    const editedSet = new Set<string>();
    for (const seg of oldClip.segments) {
      for (const w of seg.words) if (w.isEdited) editedSet.add(w.id);
    }
    for (const seg of newClip.segments) {
      for (const w of seg.words) if (editedSet.has(w.id)) w.isEdited = true;
    }
  }
}
