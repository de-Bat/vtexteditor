import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Clip, SceneType } from '../models/clip.model';
import { CutRegion } from '../models/cut-region.model';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { MetadataEntry } from '../models/segment-metadata.model';
import { Segment } from '../models/segment.model';

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

  updateSegmentMetadata(
    projectId: string, clipId: string, segmentId: string, 
    sourcePluginId: string, entries: MetadataEntry[]
  ): void {
    this.api.patch<Segment>(
      `/projects/${projectId}/clips/${clipId}/segments/${segmentId}/metadata/${sourcePluginId}`, 
      entries
    ).subscribe({
      next: (updatedSegment) => {
        this.clips.update(clips => clips.map(clip => {
          if (clip.id === clipId) {
            const updatedSegments = clip.segments.map(s => 
              s.id === segmentId ? updatedSegment : s
            );
            return { ...clip, segments: updatedSegments };
          }
          return clip;
        }));
      },
      error: (err) => console.error('Failed to update segment metadata:', err)
    });
  }

  updateClipMetadata(
    projectId: string, clipId: string, 
    sourcePluginId: string, entries: MetadataEntry[]
  ): void {
    this.api.patch<Clip>(
      `/projects/${projectId}/clips/${clipId}/metadata/${sourcePluginId}`, 
      entries
    ).subscribe({
      next: (updatedClip) => {
        this.clips.update(clips => clips.map(clip => 
          clip.id === clipId ? updatedClip : clip
        ));
      },
      error: (err) => console.error('Failed to update clip metadata:', err)
    });
  }

  updateSceneType(clipId: string, sceneType: SceneType): void {
    const previous = this.clips().find(c => c.id === clipId)?.sceneType;
    this.clips.update(list =>
      list.map(c => c.id === clipId ? { ...c, sceneType } : c)
    );
    this.api.patch<Clip>(
      `/clips/${clipId}/scene-type`, { sceneType }
    ).subscribe({
      next: (updated) => this.clips.update(list => list.map(c => c.id === clipId ? updated : c)),
      error: () => {
        this.clips.update(list => list.map(c => c.id === clipId ? { ...c, sceneType: previous } : c));
      },
    });
  }
}
