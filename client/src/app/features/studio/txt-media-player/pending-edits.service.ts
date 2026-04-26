import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of } from 'rxjs';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion } from '../../../core/models/cut-region.model';
import { ClipService } from '../../../core/services/clip.service';
import { CutRegionService } from './cut-region.service';

@Injectable({ providedIn: 'root' })
export class PendingEditsService {
  private readonly clipService = inject(ClipService);
  private readonly cutRegionService = inject(CutRegionService);

  hasPending(clip: Clip): boolean {
    return this.pendingCount(clip).total > 0;
  }

  pendingCount(clip: Clip): { cuts: number; restores: number; texts: number; total: number } {
    const regions = clip.cutRegions ?? [];
    const cuts = regions.filter(r => r.pending && r.pendingKind === 'add').length;
    const restores = regions.filter(r => r.pending && r.pendingKind === 'remove').length;
    const texts = clip.segments.flatMap(s => s.words).filter(w => w.pendingText !== undefined).length;
    return { cuts, restores, texts, total: cuts + restores + texts };
  }

  applyAll(clip: Clip): Observable<Clip> {
    const { finalRegions, wordUpdates, appliedClip } = this.buildApplied(clip);
    return this.persist(clip.id, finalRegions, wordUpdates, appliedClip);
  }

  applySelection(clip: Clip, wordIds: string[]): Observable<Clip> {
    const wordIdSet = new Set(wordIds);
    const { finalRegions, wordUpdates, appliedClip } = this.buildApplied(clip, wordIdSet);
    return this.persist(clip.id, finalRegions, wordUpdates, appliedClip);
  }

  discardAll(clip: Clip): Clip {
    return this.buildDiscarded(clip);
  }

  discardSelection(clip: Clip, wordIds: string[]): Clip {
    return this.buildDiscarded(clip, new Set(wordIds));
  }

  private buildApplied(clip: Clip, selection?: Set<string>): {
    finalRegions: CutRegion[];
    wordUpdates: { id: string; text: string; isEdited: boolean }[];
    appliedClip: Clip;
  } {
    const regions = clip.cutRegions ?? [];
    const regionIdsToRemove = new Set<string>();
    const finalRegions: CutRegion[] = [];

    for (const r of regions) {
      const inScope = !selection || r.wordIds.some(id => selection.has(id));
      if (!r.pending) {
        finalRegions.push(r);
      } else if (r.pendingKind === 'add' && inScope) {
        finalRegions.push(this.stripClientFields(r));
      } else if (r.pendingKind === 'remove' && inScope) {
        regionIdsToRemove.add(r.pendingTargetId!);
        // don't include pending-remove itself
      } else {
        // not in scope — keep as-is
        finalRegions.push(r);
      }
    }

    const committed = finalRegions.filter(r => !r.pending && !regionIdsToRemove.has(r.id));
    const stillPending = finalRegions.filter(r => r.pending);
    const cleanRegions = [...committed, ...stillPending];

    const wordUpdates: { id: string; text: string; isEdited: boolean }[] = [];
    const updatedSegments = clip.segments.map(seg => ({
      ...seg,
      words: seg.words.map(w => {
        const inScope = !selection || selection.has(w.id);
        if (w.pendingText !== undefined && inScope) {
          wordUpdates.push({ id: w.id, text: w.pendingText, isEdited: true });
          const { pendingText, ...rest } = w;
          return { ...rest, text: w.pendingText, isEdited: true };
        }
        return w;
      }),
    }));

    const appliedClip = this.cutRegionService.syncIsRemoved({
      ...clip,
      cutRegions: cleanRegions,
      segments: updatedSegments,
    });

    return {
      finalRegions: cleanRegions.filter(r => !r.pending).map(r => this.stripClientFields(r)),
      wordUpdates,
      appliedClip,
    };
  }

  private buildDiscarded(clip: Clip, selection?: Set<string>): Clip {
    const regions = (clip.cutRegions ?? []).filter(r => {
      if (!r.pending) return true;
      if (!selection) return false; // discard all pending
      return !r.wordIds.some(id => selection.has(id)); // keep if no overlap with selection
    });

    const segments = clip.segments.map(seg => ({
      ...seg,
      words: seg.words.map(w => {
        const inScope = !selection || selection.has(w.id);
        if (w.pendingText !== undefined && inScope) {
          const { pendingText, ...rest } = w;
          return rest;
        }
        return w;
      }),
    }));

    return this.cutRegionService.syncIsRemoved({ ...clip, cutRegions: regions, segments });
  }

  private persist(
    clipId: string,
    finalRegions: CutRegion[],
    wordUpdates: { id: string; text: string; isEdited: boolean }[],
    appliedClip: Clip
  ): Observable<Clip> {
    const saves: Observable<unknown>[] = [
      this.clipService.updateCutRegions(clipId, finalRegions),
    ];
    if (wordUpdates.length) {
      saves.push(this.clipService.updateWordStates(clipId, wordUpdates));
    }
    return forkJoin(saves).pipe(map(() => appliedClip));
  }

  private stripClientFields(r: CutRegion): CutRegion {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pending, pendingKind, pendingTargetId, resolvedEffectType, ...clean } = r;
    return clean;
  }
}
