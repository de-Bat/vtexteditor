import { Injectable } from '@angular/core';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { CutRegion, EffectType } from '../../../core/models/cut-region.model';

export type CutHistoryEntry =
  | { kind: 'cut';         regionAfter: CutRegion; regionsBefore: CutRegion[] }
  | { kind: 'restore';     regionsBefore: CutRegion[]; regionsAfter: CutRegion[] }
  | { kind: 'edit-effect'; regionId: string; before: Partial<CutRegion>; after: Partial<CutRegion> }
  | { kind: 'apply-batch'; clipBefore: Clip; clipAfter: Clip };

@Injectable({ providedIn: 'root' })
export class CutRegionService {

  /** Mark wordIds as removed. Merges with adjacent existing regions. */
  cut(clip: Clip, wordIds: string[], defaultEffectType: EffectType, pending = false): { clip: Clip; entry: CutHistoryEntry } {
    const allWords = this.allWords(clip);
    const allIds = allWords.map((w) => w.id);

    // In pending mode: only merge adjacent pending-add regions.
    // In live mode: merge all adjacent committed regions (existing behavior).
    const candidateRegions = pending
      ? (clip.cutRegions ?? []).filter(r => r.pending && r.pendingKind === 'add')
      : (clip.cutRegions ?? []).filter(r => !r.pending);

    // Find existing regions adjacent to or overlapping the selection
    const touched = candidateRegions.filter((r) => {
      const rMin = Math.min(...r.wordIds.map((id) => allIds.indexOf(id)));
      const rMax = Math.max(...r.wordIds.map((id) => allIds.indexOf(id)));
      const sMin = Math.min(...wordIds.map((id) => allIds.indexOf(id)));
      const sMax = Math.max(...wordIds.map((id) => allIds.indexOf(id)));
      return rMax + 1 >= sMin && rMin - 1 <= sMax;
    });

    const mergedIdSet = new Set<string>([...touched.flatMap((r) => r.wordIds), ...wordIds]);
    const mergedWordIds = allIds.filter((id) => mergedIdSet.has(id));
    const removedMs = this.removedDurationMs(allWords, mergedWordIds);

    // Effect type: first override wins; else earliest region's type; else default
    const firstOverride = touched.find((r) => r.effectTypeOverridden);
    const mergedEffectType = firstOverride?.effectType ?? touched[0]?.effectType ?? defaultEffectType;
    const isOverridden = !!firstOverride || (touched[0]?.effectTypeOverridden ?? false);

    const regionAfter: CutRegion = {
      id: touched[0]?.id ?? crypto.randomUUID(),
      wordIds: mergedWordIds,
      effectType: mergedEffectType,
      effectTypeOverridden: isOverridden,
      effectDuration: this.autoEffectDuration(removedMs),
      durationFixed: false,
      ...(pending ? { pending: true as const, pendingKind: 'add' as const } : {}),
    };

    const remaining = (clip.cutRegions ?? []).filter((r) => !touched.includes(r));
    const newClip = this.syncIsRemoved({ ...clip, cutRegions: [...remaining, regionAfter] });

    return { clip: newClip, entry: { kind: 'cut', regionAfter, regionsBefore: touched } };
  }

  /** Restore wordIds back to active. Shrinks or removes affected regions. */
  restore(clip: Clip, wordIds: string[], pending = false): { clip: Clip; entry: CutHistoryEntry } {
    if (pending) return this.pendingRestore(clip, wordIds);

    const wordIdSet = new Set(wordIds);
    const allWords = this.allWords(clip);
    const allIds = allWords.map((w) => w.id);

    const regionsBefore: CutRegion[] = [];
    const regionsAfter: CutRegion[] = [];

    for (const region of (clip.cutRegions ?? [])) {
      if (!region.wordIds.some((id) => wordIdSet.has(id))) {
        regionsAfter.push(region); // untouched
        continue;
      }
      regionsBefore.push(region);
      const remaining = region.wordIds.filter((id) => !wordIdSet.has(id));
      if (!remaining.length) continue; // fully removed — don't add to regionsAfter

      // Remaining words may no longer be contiguous — split into groups
      const groups = this.groupContiguous(remaining.map((id) => allIds.indexOf(id)));
      for (let i = 0; i < groups.length; i++) {
        const groupWordIds = groups[i].map((idx) => allIds[idx]);
        regionsAfter.push({
          id: i === 0 ? region.id : crypto.randomUUID(),
          wordIds: groupWordIds,
          effectType: region.effectType,
          effectTypeOverridden: region.effectTypeOverridden,
          effectDuration: this.autoEffectDuration(this.removedDurationMs(allWords, groupWordIds)),
          durationFixed: false,
        });
      }
    }

    const newClip = this.syncIsRemoved({ ...clip, cutRegions: regionsAfter });
    return { clip: newClip, entry: { kind: 'restore', regionsBefore, regionsAfter } };
  }

  private pendingRestore(clip: Clip, wordIds: string[]): { clip: Clip; entry: CutHistoryEntry } {
    const wordIdSet = new Set(wordIds);
    const allWords = this.allWords(clip);
    const allIds = allWords.map(w => w.id);
    const regionsBefore: CutRegion[] = [];
    const newRegions: CutRegion[] = [];

    for (const region of (clip.cutRegions ?? [])) {
      if (!region.wordIds.some(id => wordIdSet.has(id))) {
        newRegions.push(region);
        continue;
      }
      regionsBefore.push(region);

      if (region.pending && region.pendingKind === 'add') {
        const remaining = region.wordIds.filter(id => !wordIdSet.has(id));
        if (!remaining.length) continue;
        const groups = this.groupContiguous(remaining.map(id => allIds.indexOf(id)));
        for (let i = 0; i < groups.length; i++) {
          const groupWordIds = groups[i].map(idx => allIds[idx]);
          newRegions.push({
            ...region,
            id: i === 0 ? region.id : crypto.randomUUID(),
            wordIds: groupWordIds,
            effectDuration: this.autoEffectDuration(this.removedDurationMs(allWords, groupWordIds)),
            durationFixed: false,
          });
        }
      } else if (!region.pending) {
        // Keep committed region; add pending-remove for intersecting words
        newRegions.push(region);
        const intersection = region.wordIds.filter(id => wordIdSet.has(id));
        newRegions.push({
          id: crypto.randomUUID(),
          wordIds: intersection,
          effectType: region.effectType,
          effectTypeOverridden: false,
          effectDuration: 0,
          durationFixed: false,
          pending: true,
          pendingKind: 'remove',
          pendingTargetId: region.id,
        });
      } else {
        newRegions.push(region);
      }
    }

    const newClip = this.syncIsRemoved({ ...clip, cutRegions: newRegions });
    return { clip: newClip, entry: { kind: 'restore', regionsBefore, regionsAfter: newRegions } };
  }

  updateRegionEffect(clip: Clip, regionId: string, effectType: EffectType): { clip: Clip; entry: CutHistoryEntry } {
    const region = clip.cutRegions.find((r) => r.id === regionId);
    if (!region) return { clip, entry: { kind: 'edit-effect', regionId, before: {}, after: {} } };
    const before: Partial<CutRegion> = { effectType: region.effectType, effectTypeOverridden: region.effectTypeOverridden };
    const after: Partial<CutRegion> = { effectType, effectTypeOverridden: true };
    const newClip = this.patchRegion(clip, regionId, after);
    return { clip: newClip, entry: { kind: 'edit-effect', regionId, before, after } };
  }

  updateRegionDuration(clip: Clip, regionId: string, ms: number): { clip: Clip; entry: CutHistoryEntry } {
    const region = clip.cutRegions.find((r) => r.id === regionId);
    if (!region) return { clip, entry: { kind: 'edit-effect', regionId, before: {}, after: {} } };
    const clamped = Math.max(150, Math.min(500, ms));
    const before: Partial<CutRegion> = { effectDuration: region.effectDuration, durationFixed: region.durationFixed };
    const after: Partial<CutRegion> = { effectDuration: clamped, durationFixed: true };
    return { clip: this.patchRegion(clip, regionId, after), entry: { kind: 'edit-effect', regionId, before, after } };
  }

  resetDuration(clip: Clip, regionId: string): { clip: Clip; entry: CutHistoryEntry } {
    const region = clip.cutRegions.find((r) => r.id === regionId);
    if (!region) return { clip, entry: { kind: 'edit-effect', regionId, before: {}, after: {} } };
    const allWords = this.allWords(clip);
    const autoMs = this.autoEffectDuration(this.removedDurationMs(allWords, region.wordIds));
    const before: Partial<CutRegion> = { effectDuration: region.effectDuration, durationFixed: region.durationFixed };
    const after: Partial<CutRegion> = { effectDuration: autoMs, durationFixed: false };
    return { clip: this.patchRegion(clip, regionId, after), entry: { kind: 'edit-effect', regionId, before, after } };
  }

  resetRegionEffect(clip: Clip, regionId: string, defaultEffectType: EffectType): { clip: Clip; entry: CutHistoryEntry } {
    const region = clip.cutRegions.find((r) => r.id === regionId);
    if (!region) return { clip, entry: { kind: 'edit-effect', regionId, before: {}, after: {} } };
    const before: Partial<CutRegion> = { effectType: region.effectType, effectTypeOverridden: region.effectTypeOverridden };
    const after: Partial<CutRegion> = { effectType: defaultEffectType, effectTypeOverridden: false };
    return { clip: this.patchRegion(clip, regionId, after), entry: { kind: 'edit-effect', regionId, before, after } };
  }

  /**
   * Automatically detect and cut filler words and/or long silence gaps.
   * Silence gaps become time-based cut regions (wordIds: [], startTime/endTime set).
   */
  autoClean(clip: Clip, fillers: string[], minSilenceSec: number, defaultEffect: EffectType): { clip: Clip; entry: CutHistoryEntry } {
    const clipBefore = clip;
    const fillerSet = new Set(fillers.map(f => f.toLowerCase()));
    const wordIdsToCut = new Set<string>();

    // Track existing time-based regions to avoid duplicates
    const existingTimeKeys = new Set(
      (clip.cutRegions ?? [])
        .filter(r => r.startTime !== undefined && r.endTime !== undefined)
        .map(r => `${r.startTime}-${r.endTime}`)
    );

    const silenceRegions: CutRegion[] = [];

    const collectSilences = (words: Word[]) => {
      const visible = words.filter(w => !w.isRemoved);
      for (let i = 1; i < visible.length; i++) {
        const gapStart = visible[i - 1].endTime;
        const gapEnd = visible[i].startTime;
        if (gapEnd - gapStart >= minSilenceSec && !existingTimeKeys.has(`${gapStart}-${gapEnd}`)) {
          silenceRegions.push({
            id: crypto.randomUUID(),
            wordIds: [],
            startTime: gapStart,
            endTime: gapEnd,
            effectType: defaultEffect,
            effectTypeOverridden: false,
            effectDuration: this.autoEffectDuration((gapEnd - gapStart) * 1000),
            durationFixed: false,
          });
          existingTimeKeys.add(`${gapStart}-${gapEnd}`);
        }
      }
    };

    for (const seg of clip.segments) {
      // 1. Fillers
      for (const w of seg.words) {
        if (w.isRemoved) continue;
        const text = w.text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
        if (fillerSet.has(text)) wordIdsToCut.add(w.id);
      }
      // 2. Intra-segment silences
      collectSilences(seg.words);
    }

    // 3. Inter-segment silences
    for (let i = 1; i < clip.segments.length; i++) {
      const prevWords = clip.segments[i - 1].words.filter(w => !w.isRemoved);
      const nextWords = clip.segments[i].words.filter(w => !w.isRemoved);
      if (prevWords.length && nextWords.length) {
        collectSilences([prevWords[prevWords.length - 1], nextWords[0]]);
      }
    }

    if (wordIdsToCut.size === 0 && silenceRegions.length === 0) {
      return { clip, entry: { kind: 'restore', regionsBefore: [], regionsAfter: [] } };
    }

    let workingClip = clip;
    if (wordIdsToCut.size > 0) {
      workingClip = this.cut(workingClip, Array.from(wordIdsToCut), defaultEffect).clip;
    }
    if (silenceRegions.length > 0) {
      workingClip = this.syncIsRemoved({ ...workingClip, cutRegions: [...(workingClip.cutRegions ?? []), ...silenceRegions] });
    }

    return { clip: workingClip, entry: { kind: 'apply-batch', clipBefore, clipAfter: workingClip } };
  }

  /** Update all non-overridden regions to the new default effect type. No history — this is a preference. */
  applyDefaultEffectType(clip: Clip, defaultEffectType: EffectType): Clip {
    return {
      ...clip,
      cutRegions: clip.cutRegions.map((r) =>
        r.effectTypeOverridden ? r : { ...r, effectType: defaultEffectType }
      ),
    };
  }

  applyUndo(clip: Clip, entry: CutHistoryEntry): Clip {
    switch (entry.kind) {
      case 'cut': {
        // Remove regionAfter, restore regionsBefore
        const without = clip.cutRegions.filter((r) => r.id !== entry.regionAfter.id);
        return this.syncIsRemoved({ ...clip, cutRegions: [...without, ...entry.regionsBefore] });
      }
      case 'restore': {
        // Remove regionsAfter, restore regionsBefore
        const afterIds = new Set(entry.regionsAfter.map((r) => r.id));
        const without = clip.cutRegions.filter((r) => !afterIds.has(r.id));
        return this.syncIsRemoved({ ...clip, cutRegions: [...without, ...entry.regionsBefore] });
      }
      case 'edit-effect':
        return this.patchRegion(clip, entry.regionId, entry.before);
      case 'apply-batch':
        return entry.clipBefore;
    }
  }

  applyRedo(clip: Clip, entry: CutHistoryEntry): Clip {
    switch (entry.kind) {
      case 'cut': {
        const beforeIds = new Set(entry.regionsBefore.map((r) => r.id));
        const without = clip.cutRegions.filter((r) => !beforeIds.has(r.id));
        return this.syncIsRemoved({ ...clip, cutRegions: [...without, entry.regionAfter] });
      }
      case 'restore': {
        const beforeIds = new Set(entry.regionsBefore.map((r) => r.id));
        const without = clip.cutRegions.filter((r) => !beforeIds.has(r.id));
        return this.syncIsRemoved({ ...clip, cutRegions: [...without, ...entry.regionsAfter] });
      }
      case 'edit-effect':
        return this.patchRegion(clip, entry.regionId, entry.after);
      case 'apply-batch':
        return entry.clipAfter;
    }
  }

  getRegionForWord(clip: Clip, wordId: string): CutRegion | undefined {
    return clip.cutRegions.find((r) => r.wordIds.includes(wordId));
  }

  syncIsRemoved(clip: Clip): Clip {
    const committed = new Set<string>();
    const pendingAdded = new Set<string>();
    const pendingRemoved = new Set<string>();

    for (const r of (clip.cutRegions ?? [])) {
      if (!r.pending) {
        r.wordIds.forEach(id => committed.add(id));
      } else if (r.pendingKind === 'add') {
        r.wordIds.forEach(id => pendingAdded.add(id));
      } else if (r.pendingKind === 'remove') {
        r.wordIds.forEach(id => pendingRemoved.add(id));
      }
    }

    const isRemoved = (id: string) =>
      (committed.has(id) || pendingAdded.has(id)) && !pendingRemoved.has(id);

    return {
      ...clip,
      segments: clip.segments.map(seg => ({
        ...seg,
        words: seg.words.map(w => ({ ...w, isRemoved: isRemoved(w.id) })),
      })),
    };
  }

  autoEffectDuration(removedMs: number): number {
    return Math.max(150, Math.min(500, Math.round(removedMs * 0.1)));
  }

  private patchRegion(clip: Clip, regionId: string, patch: Partial<CutRegion>): Clip {
    return {
      ...clip,
      cutRegions: clip.cutRegions.map((r) => (r.id === regionId ? { ...r, ...patch } : r)),
    };
  }

  private allWords(clip: Clip): Word[] {
    return clip.segments.flatMap((s) => s.words);
  }

  private removedDurationMs(allWords: Word[], wordIds: string[]): number {
    const set = new Set(wordIds);
    const words = allWords.filter((w) => set.has(w.id));
    if (!words.length) return 0;
    return (Math.max(...words.map((w) => w.endTime)) - Math.min(...words.map((w) => w.startTime))) * 1000;
  }

  private groupContiguous(indices: number[]): number[][] {
    if (!indices.length) return [];
    const sorted = [...indices].sort((a, b) => a - b);
    const groups: number[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) {
        groups[groups.length - 1].push(sorted[i]);
      } else {
        groups.push([sorted[i]]);
      }
    }
    return groups;
  }
}
