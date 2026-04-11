# Word Removal Editing with Smart Effects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-word `isRemoved` editing with first-class `CutRegion` entities that carry transition effect metadata (hard-cut / fade / cross-cut), simulated in browser preview and applied via ffmpeg on export.

**Architecture:** `CutRegion` objects (stored on `Clip`) are the source of truth for removal state; `Word.isRemoved` becomes a derived mirror synced after every edit. A pure `CutRegionService` handles all CRUD + merging logic. `EffectPlayerService` manages Web Audio gain ramps and CSS opacity for in-browser fade/crosscut simulation. The server gains a `PUT /api/clips/:id/cut-regions` route that persists regions and re-syncs `isRemoved`, letting the existing export pipeline (`word.isRemoved`) keep working while also reading region effect metadata for fade/xfade ffmpeg filters.

**Tech Stack:** Angular 20 signals, Web Audio API (`AudioContext`, `GainNode`, `createMediaElementSource`), fluent-ffmpeg (`afade`, `xfade`, `acrossfade` filters), TypeScript strict mode.

---

## File Map

| Action | Path |
|--------|------|
| Create | `client/src/app/core/models/cut-region.model.ts` |
| Modify | `client/src/app/core/models/clip.model.ts` |
| Modify | `server/src/models/clip.model.ts` |
| Modify | `server/src/models/word.model.ts` |
| Create | `client/src/app/features/studio/txt-media-player/cut-region.service.ts` |
| Create | `client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts` |
| Modify | `client/src/app/features/studio/txt-media-player/edit-history.service.ts` |
| Modify | `client/src/app/features/studio/txt-media-player/edit-history.service.spec.ts` |
| Create | `client/src/app/features/studio/txt-media-player/effect-player.service.ts` |
| Modify | `client/src/app/core/services/clip.service.ts` |
| Modify | `client/src/app/features/studio/studio.component.ts` |
| Modify | `server/src/services/clip.service.ts` |
| Modify | `server/src/routes/clip.routes.ts` |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss` |
| Modify | `server/src/services/export.service.ts` |

---

## Task 1: Data Models — CutRegion type + Clip extension + Studio reactive fix

**Files:**
- Create: `client/src/app/core/models/cut-region.model.ts`
- Modify: `client/src/app/core/models/clip.model.ts`
- Modify: `server/src/models/clip.model.ts`
- Modify: `client/src/app/features/studio/studio.component.ts`

- [ ] **Step 1: Create client CutRegion model**

Create `client/src/app/core/models/cut-region.model.ts`:

```ts
export type EffectType = 'hard-cut' | 'fade' | 'cross-cut';

export interface CutRegion {
  id: string;                   // crypto.randomUUID()
  wordIds: string[];            // ordered IDs of removed words (contiguous span within clip)
  effectType: EffectType;
  effectTypeOverridden: boolean; // true = user explicitly set; false = inherits global default
  effectDuration: number;       // ms; auto-calculated unless durationFixed
  durationFixed: boolean;       // true = user pinned, skip auto-recalc
}
```

- [ ] **Step 2: Extend client Clip model**

Replace `client/src/app/core/models/clip.model.ts` contents:

```ts
import { Segment } from './segment.model';
import { CutRegion } from './cut-region.model';

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  cutRegions: CutRegion[];
  showSilenceMarkers?: boolean;
}
```

- [ ] **Step 3: Extend server Clip model**

Replace `server/src/models/clip.model.ts` contents:

```ts
import { Segment } from './segment.model';

export type EffectType = 'hard-cut' | 'fade' | 'cross-cut';

export interface CutRegion {
  id: string;
  wordIds: string[];
  effectType: EffectType;
  effectTypeOverridden: boolean;
  effectDuration: number;
  durationFixed: boolean;
}

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  cutRegions: CutRegion[];
  showSilenceMarkers?: boolean;
}
```

- [ ] **Step 4: Fix Studio to derive activeClip reactively**

The studio currently holds `activeClip = signal<Clip | null>(null)` separately from `clipService.clips`. When we apply local clip updates via the service, `activeClip` won't reflect them unless it's derived. Refactor `studio.component.ts` — replace:

```ts
readonly activeClip = signal<Clip | null>(null);
```

with:

```ts
readonly activeClipId = signal<string | null>(null);
readonly activeClip = computed(() =>
  this.clipService.clips().find((c) => c.id === this.activeClipId()) ?? null
);
```

Then replace every `this.activeClip.set(clip)` with `this.activeClipId.set(clip?.id ?? null)` and every `this.activeClip.set(clips[0])` with `this.activeClipId.set(clips[0]?.id ?? null)`. There are three call sites — in `ngOnInit` (after `loadAll`), `onCommit` (after `loadAll` in the commit handler), and `selectClip`.

- [ ] **Step 5: Build to confirm no type errors**

```bash
cd client && npx tsc --noEmit 2>&1 | head -40
```

Expected: only errors about `cutRegions` not yet existing on old server clips (these will be fixed in Task 5). Zero errors about the new model files themselves.

- [ ] **Step 6: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/core/models/cut-region.model.ts \
        client/src/app/core/models/clip.model.ts \
        server/src/models/clip.model.ts \
        client/src/app/features/studio/studio.component.ts
git commit -m "feat: add CutRegion model, extend Clip, make studio activeClip reactive"
```

---

## Task 2: CutRegionService — pure functions for cut/restore/effect/undo

**Files:**
- Create: `client/src/app/features/studio/txt-media-player/cut-region.service.ts`
- Create: `client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts`

- [ ] **Step 1: Write failing tests first**

Create `client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts`:

```ts
import { CutRegionService } from './cut-region.service';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeClip(words: Partial<Word>[]): Clip {
  const fullWords: Word[] = words.map((w, i) => ({
    id: w.id ?? `w${i}`,
    segmentId: 's1',
    text: w.text ?? `word${i}`,
    startTime: w.startTime ?? i,
    endTime: w.endTime ?? (i + 0.8),
    isRemoved: w.isRemoved ?? false,
  }));
  return {
    id: 'clip1',
    projectId: 'p1',
    name: 'test',
    startTime: 0,
    endTime: 10,
    cutRegions: [],
    segments: [{ id: 's1', clipId: 'clip1', text: '', tags: [], startTime: 0, endTime: 10, words: fullWords }],
  };
}

describe('CutRegionService', () => {
  let svc: CutRegionService;

  beforeEach(() => { svc = new CutRegionService(); });

  describe('cut()', () => {
    it('creates a new CutRegion for selected words', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: result, entry } = svc.cut(clip, ['w1'], 'hard-cut');
      expect(result.cutRegions.length).toBe(1);
      expect(result.cutRegions[0].wordIds).toEqual(['w1']);
      expect(result.cutRegions[0].effectType).toBe('hard-cut');
      expect(result.cutRegions[0].effectTypeOverridden).toBe(false);
      expect(result.segments[0].words[1].isRemoved).toBe(true);
      expect(result.segments[0].words[0].isRemoved).toBe(false);
      expect(entry.kind).toBe('cut');
    });

    it('merges with an adjacent existing region', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: after1 } = svc.cut(clip, ['w1'], 'hard-cut');
      const { clip: after2, entry } = svc.cut(after1, ['w2'], 'fade');
      expect(after2.cutRegions.length).toBe(1);
      expect(after2.cutRegions[0].wordIds).toEqual(['w1', 'w2']);
      expect(entry.kind).toBe('cut');
      if (entry.kind === 'cut') {
        expect(entry.regionsBefore.length).toBe(1); // the w1 region
      }
    });

    it('auto-calculates effectDuration from removed content duration', () => {
      const clip = makeClip([
        { id: 'w0', startTime: 0, endTime: 0.8 },
        { id: 'w1', startTime: 1, endTime: 3 }, // 2 seconds removed
      ]);
      const { clip: result } = svc.cut(clip, ['w1'], 'fade');
      // clamp(2000 * 0.1, 150, 500) = clamp(200, 150, 500) = 200
      expect(result.cutRegions[0].effectDuration).toBe(200);
    });
  });

  describe('restore()', () => {
    it('removes words from their region (full restore)', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: cut } = svc.cut(clip, ['w1'], 'hard-cut');
      const { clip: restored, entry } = svc.restore(cut, ['w1']);
      expect(restored.cutRegions.length).toBe(0);
      expect(restored.segments[0].words[1].isRemoved).toBe(false);
      expect(entry.kind).toBe('restore');
    });

    it('shrinks region when restoring a subset of words', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: cut } = svc.cut(clip, ['w1', 'w2'], 'hard-cut');
      const { clip: restored } = svc.restore(cut, ['w1']);
      expect(restored.cutRegions.length).toBe(1);
      expect(restored.cutRegions[0].wordIds).toEqual(['w2']);
    });
  });

  describe('setEffectType()', () => {
    it('updates effectType and marks as overridden', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut } = svc.cut(clip, ['w1'], 'hard-cut');
      const regionId = cut.cutRegions[0].id;
      const { clip: result, entry } = svc.setEffectType(cut, regionId, 'fade');
      expect(result.cutRegions[0].effectType).toBe('fade');
      expect(result.cutRegions[0].effectTypeOverridden).toBe(true);
      expect(entry.kind).toBe('edit-effect');
    });
  });

  describe('applyDefaultEffectType()', () => {
    it('updates non-overridden regions only', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: c1 } = svc.cut(clip, ['w0'], 'hard-cut');   // not overridden
      const { clip: c2 } = svc.cut(c1, ['w1'], 'hard-cut');     // not overridden
      const r2id = c2.cutRegions[1].id;
      const { clip: c3 } = svc.setEffectType(c2, r2id, 'cross-cut'); // overridden
      const result = svc.applyDefaultEffectType(c3, 'fade');
      const r1 = result.cutRegions.find(r => r.wordIds.includes('w0'))!;
      const r2 = result.cutRegions.find(r => r.wordIds.includes('w1'))!;
      expect(r1.effectType).toBe('fade');       // updated
      expect(r2.effectType).toBe('cross-cut');  // kept (overridden)
    });
  });

  describe('applyUndo() / applyRedo()', () => {
    it('undo a cut removes the region', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut, entry } = svc.cut(clip, ['w1'], 'hard-cut');
      const undone = svc.applyUndo(cut, entry);
      expect(undone.cutRegions.length).toBe(0);
      expect(undone.segments[0].words[1].isRemoved).toBe(false);
    });

    it('redo after undo re-applies the cut', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut, entry } = svc.cut(clip, ['w1'], 'hard-cut');
      const undone = svc.applyUndo(cut, entry);
      const redone = svc.applyRedo(undone, entry);
      expect(redone.cutRegions.length).toBe(1);
      expect(redone.segments[0].words[1].isRemoved).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests, confirm they all fail**

```bash
cd C:\web.projects\VTextStudio\client
npx jest cut-region.service.spec --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module './cut-region.service'`

- [ ] **Step 3: Implement CutRegionService**

Create `client/src/app/features/studio/txt-media-player/cut-region.service.ts`:

```ts
import { Injectable } from '@angular/core';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { CutRegion, EffectType } from '../../../core/models/cut-region.model';

export type CutHistoryEntry =
  | { kind: 'cut';       regionAfter: CutRegion; regionsBefore: CutRegion[] }
  | { kind: 'restore';   regionsBefore: CutRegion[]; regionsAfter: CutRegion[] }
  | { kind: 'edit-effect'; regionId: string; before: Partial<CutRegion>; after: Partial<CutRegion> };

@Injectable({ providedIn: 'root' })
export class CutRegionService {

  /** Mark wordIds as removed. Merges with adjacent existing regions. */
  cut(clip: Clip, wordIds: string[], defaultEffectType: EffectType): { clip: Clip; entry: CutHistoryEntry } {
    const allWords = this.allWords(clip);
    const allIds = allWords.map((w) => w.id);
    const wordIdSet = new Set(wordIds);

    // Find existing regions adjacent to or overlapping the selection
    const touched = (clip.cutRegions ?? []).filter((r) => {
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
    };

    const remaining = (clip.cutRegions ?? []).filter((r) => !touched.includes(r));
    const newClip = this.syncIsRemoved({ ...clip, cutRegions: [...remaining, regionAfter] });

    return { clip: newClip, entry: { kind: 'cut', regionAfter, regionsBefore: touched } };
  }

  /** Restore wordIds back to active. Shrinks or removes affected regions. */
  restore(clip: Clip, wordIds: string[]): { clip: Clip; entry: CutHistoryEntry } {
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

  setEffectType(clip: Clip, regionId: string, effectType: EffectType): { clip: Clip; entry: CutHistoryEntry } {
    const region = clip.cutRegions.find((r) => r.id === regionId);
    if (!region) return { clip, entry: { kind: 'edit-effect', regionId, before: {}, after: {} } };
    const before: Partial<CutRegion> = { effectType: region.effectType, effectTypeOverridden: region.effectTypeOverridden };
    const after: Partial<CutRegion> = { effectType, effectTypeOverridden: true };
    const newClip = this.patchRegion(clip, regionId, after);
    return { clip: newClip, entry: { kind: 'edit-effect', regionId, before, after } };
  }

  setDuration(clip: Clip, regionId: string, ms: number): { clip: Clip; entry: CutHistoryEntry } {
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

  resetEffectType(clip: Clip, regionId: string, defaultEffectType: EffectType): { clip: Clip; entry: CutHistoryEntry } {
    const region = clip.cutRegions.find((r) => r.id === regionId);
    if (!region) return { clip, entry: { kind: 'edit-effect', regionId, before: {}, after: {} } };
    const before: Partial<CutRegion> = { effectType: region.effectType, effectTypeOverridden: region.effectTypeOverridden };
    const after: Partial<CutRegion> = { effectType: defaultEffectType, effectTypeOverridden: false };
    return { clip: this.patchRegion(clip, regionId, after), entry: { kind: 'edit-effect', regionId, before, after } };
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
    }
  }

  getRegionForWord(clip: Clip, wordId: string): CutRegion | undefined {
    return clip.cutRegions.find((r) => r.wordIds.includes(wordId));
  }

  syncIsRemoved(clip: Clip): Clip {
    const removedIds = new Set((clip.cutRegions ?? []).flatMap((r) => r.wordIds));
    return {
      ...clip,
      segments: clip.segments.map((seg) => ({
        ...seg,
        words: seg.words.map((w) => ({ ...w, isRemoved: removedIds.has(w.id) })),
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
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
cd C:\web.projects\VTextStudio\client
npx jest cut-region.service.spec --no-coverage 2>&1 | tail -20
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 5: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/features/studio/txt-media-player/cut-region.service.ts \
        client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts
git commit -m "feat: add CutRegionService with cut/restore/effect/undo/redo pure functions"
```

---

## Task 3: Update EditHistoryService for CutHistoryEntry

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/edit-history.service.ts`
- Modify: `client/src/app/features/studio/txt-media-player/edit-history.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Replace `edit-history.service.spec.ts`:

```ts
import { EditHistoryService } from './edit-history.service';
import { CutHistoryEntry } from './cut-region.service';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeRegion(id: string, wordIds: string[]): CutRegion {
  return { id, wordIds, effectType: 'hard-cut', effectTypeOverridden: false, effectDuration: 200, durationFixed: false };
}

describe('EditHistoryService', () => {
  let svc: EditHistoryService;

  beforeEach(() => { svc = new EditHistoryService(); });

  it('canUndo is false initially', () => {
    expect(svc.canUndo).toBe(false);
    expect(svc.canRedo).toBe(false);
  });

  it('records a cut entry and undo returns it', () => {
    const entry: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r1', ['w1']), regionsBefore: [] };
    svc.record(entry);
    expect(svc.canUndo).toBe(true);
    const result = svc.undo();
    expect(result).toEqual(entry);
    expect(svc.canUndo).toBe(false);
    expect(svc.canRedo).toBe(true);
  });

  it('redo returns the entry after undo', () => {
    const entry: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r1', ['w1']), regionsBefore: [] };
    svc.record(entry);
    svc.undo();
    const result = svc.redo();
    expect(result).toEqual(entry);
    expect(svc.canRedo).toBe(false);
  });

  it('recording clears redo stack', () => {
    const e1: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r1', ['w1']), regionsBefore: [] };
    const e2: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r2', ['w2']), regionsBefore: [] };
    svc.record(e1);
    svc.undo();
    svc.record(e2);
    expect(svc.redo()).toBeNull();
  });

  it('undo returns null when stack is empty', () => {
    expect(svc.undo()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
cd C:\web.projects\VTextStudio\client
npx jest edit-history.service.spec --no-coverage 2>&1 | tail -10
```

Expected: failures about wrong method signatures.

- [ ] **Step 3: Replace EditHistoryService**

Replace `client/src/app/features/studio/txt-media-player/edit-history.service.ts`:

```ts
import { Injectable } from '@angular/core';
import { CutHistoryEntry } from './cut-region.service';

@Injectable({ providedIn: 'root' })
export class EditHistoryService {
  private readonly undoStack: CutHistoryEntry[] = [];
  private readonly redoStack: CutHistoryEntry[] = [];

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  record(entry: CutHistoryEntry): void {
    this.undoStack.push(entry);
    this.redoStack.length = 0;
  }

  undo(): CutHistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  redo(): CutHistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

// Keep old type exported so any remaining references compile
export type WordEditChange = never;
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
cd C:\web.projects\VTextStudio\client
npx jest edit-history.service.spec --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 5: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/features/studio/txt-media-player/edit-history.service.ts \
        client/src/app/features/studio/txt-media-player/edit-history.service.spec.ts
git commit -m "feat: rewrite EditHistoryService for CutHistoryEntry union type"
```

---

## Task 4: EffectPlayerService — Web Audio + CSS effects

**Files:**
- Create: `client/src/app/features/studio/txt-media-player/effect-player.service.ts`

- [ ] **Step 1: Create the service**

Create `client/src/app/features/studio/txt-media-player/effect-player.service.ts`:

```ts
import { Injectable, OnDestroy, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class EffectPlayerService implements OnDestroy {
  /** 0–1; drives video/audio element opacity via template binding */
  readonly videoOpacity = signal(1);
  /** CSS filter string; drives brightness flash on cross-cut */
  readonly videoFilter = signal('none');

  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Call once in ngAfterViewInit, after the media element is ready.
   * Safe to call multiple times — idempotent when same element.
   */
  attachElement(el: HTMLMediaElement): void {
    if (this.mediaSource) return;
    try {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.mediaSource = this.audioCtx.createMediaElementSource(el);
      this.mediaSource.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    } catch (err) {
      // CORS or browser restriction — effects degrade gracefully (visual only)
      console.warn('[EffectPlayerService] Web Audio init failed, continuing without audio effects:', err);
    }
  }

  /**
   * Must be called from a user-gesture handler (play button click) to satisfy
   * browser autoplay policy. Safe to call when already running.
   */
  resumeAudioContext(): void {
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /** Ramp gain to 0 + start opacity CSS transition to 0. */
  startFadeOut(durationMs: number): void {
    const dur = Math.max(50, durationMs) / 1000;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + dur);
    }
    this.videoOpacity.set(0);
  }

  /** Ramp gain from 0 to 1 + start opacity CSS transition to 1. */
  startFadeIn(durationMs: number): void {
    const dur = Math.max(50, durationMs) / 1000;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(1, now + dur);
    }
    this.videoOpacity.set(1);
  }

  /** For cross-cut: brief brightness spike (80 ms). */
  triggerCrossCutFlash(): void {
    this.videoFilter.set('brightness(1.4)');
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.videoFilter.set('none');
      this.flashTimer = null;
    }, 80);
  }

  /** For cross-cut: audio crossfade (gain 0→1 over durationMs). Seek first, then call this. */
  startAudioCrossfade(durationMs: number): void {
    const dur = Math.max(50, durationMs) / 1000;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(1, now + dur);
    }
  }

  /** Reset all effects immediately (called on pause, seek by user, clip change). */
  resetAll(): void {
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(1, now);
    }
    this.videoOpacity.set(1);
    this.videoFilter.set('none');
    if (this.flashTimer) { clearTimeout(this.flashTimer); this.flashTimer = null; }
  }

  detach(): void {
    this.resetAll();
    this.mediaSource?.disconnect();
    this.gainNode?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.mediaSource = null;
    this.gainNode = null;
    this.audioCtx = null;
  }

  ngOnDestroy(): void {
    this.detach();
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }
}
```

- [ ] **Step 2: Build check**

```bash
cd C:\web.projects\VTextStudio\client && npx tsc --noEmit 2>&1 | grep -i "effect-player" | head -10
```

Expected: no errors about the new file.

- [ ] **Step 3: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/features/studio/txt-media-player/effect-player.service.ts
git commit -m "feat: add EffectPlayerService for Web Audio fade and cross-cut simulation"
```

---

## Task 5: Server — cut-regions persistence

**Files:**
- Modify: `server/src/services/clip.service.ts`
- Modify: `server/src/routes/clip.routes.ts`

- [ ] **Step 1: Add `updateCutRegions` to server ClipService**

In `server/src/services/clip.service.ts`, add after the `updateWordStates` method:

```ts
updateCutRegions(clipId: string, cutRegions: import('../models/clip.model').CutRegion[]): Clip | null {
  const project = projectService.getCurrent();
  if (!project) return null;

  const clipIndex = project.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) return null;

  const clip = project.clips[clipIndex];

  // Sync isRemoved on all words from the new cutRegions
  const removedIds = new Set(cutRegions.flatMap((r) => r.wordIds));
  const updatedSegments = clip.segments.map((seg) => ({
    ...seg,
    words: seg.words.map((w) => ({ ...w, isRemoved: removedIds.has(w.id) })),
  }));

  const updatedClip: Clip = { ...clip, cutRegions, segments: updatedSegments };
  const updatedClips = [...project.clips];
  updatedClips[clipIndex] = updatedClip;
  projectService.update(project.id, { clips: updatedClips });

  return updatedClip;
}
```

Also ensure `Clip` is imported at the top of `server/src/services/clip.service.ts` — it already imports from `'../models/clip.model'`, so just add `CutRegion` to the destructured import if needed (or use the inline import as shown above).

- [ ] **Step 2: Add `PUT /api/clips/:id/cut-regions` route**

In `server/src/routes/clip.routes.ts`, add before the final export:

```ts
/** PUT /api/clips/:id/cut-regions — replace clip's cut regions and sync isRemoved */
clipRoutes.put('/:id/cut-regions', (req: Request, res: Response) => {
  const { cutRegions } = req.body as { cutRegions?: unknown };
  if (!Array.isArray(cutRegions)) {
    res.status(400).json({ error: 'Body must be { cutRegions: CutRegion[] }' });
    return;
  }
  const updated = clipService.updateCutRegions(String(req.params.id), cutRegions as any);
  if (!updated) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }
  res.json(updated);
});
```

- [ ] **Step 3: Build check**

```bash
cd C:\web.projects\VTextStudio\server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Start the server (`npm run dev` in /server) and run:

```bash
curl -s -X PUT http://localhost:3000/api/clips/SOME_CLIP_ID/cut-regions \
  -H "Content-Type: application/json" \
  -d '{"cutRegions":[]}' | jq '.cutRegions'
```

Expected: `[]`

- [ ] **Step 5: Commit**

```bash
cd C:\web.projects\VTextStudio
git add server/src/services/clip.service.ts server/src/routes/clip.routes.ts
git commit -m "feat: add PUT /api/clips/:id/cut-regions route with isRemoved sync"
```

---

## Task 6: Client ClipService — applyLocalUpdate + updateCutRegions API

**Files:**
- Modify: `client/src/app/core/services/clip.service.ts`

- [ ] **Step 1: Add two methods to ClipService**

Replace `client/src/app/core/services/clip.service.ts`:

```ts
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
```

- [ ] **Step 2: Build check**

```bash
cd C:\web.projects\VTextStudio\client && npx tsc --noEmit 2>&1 | grep "clip.service" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/core/services/clip.service.ts
git commit -m "feat: add ClipService.applyLocalUpdate and updateCutRegions API method"
```

---

## Task 7: Wire TxtMediaPlayerV2 — removal logic, undo/redo, save

This task replaces the removal wiring in the component. It does NOT yet touch the template HTML or add UI for effects — that's Task 8.

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

- [ ] **Step 1: Add imports and inject new services**

At the top of the component file, add to the existing imports:

```ts
import { CutRegionService, CutHistoryEntry } from '../txt-media-player/cut-region.service';
import { EffectPlayerService } from '../txt-media-player/effect-player.service';
import { CutRegion, EffectType } from '../../../core/models/cut-region.model';
```

In the constructor, add the two new services:

```ts
constructor(
  private clipService: ClipService,
  readonly projectService: ProjectService,
  private mediaPlayer: MediaPlayerService,
  private editHistory: EditHistoryService,
  private keyboardShortcuts: KeyboardShortcutsService,
  private cutRegionService: CutRegionService,
  readonly effectPlayer: EffectPlayerService,
) { ... }
```

- [ ] **Step 2: Add new signals and computed**

Inside the component class, after the existing local signals, add:

```ts
/** Global default effect type — new regions inherit this. */
readonly defaultEffectType = signal<EffectType>('hard-cut');

/** Map wordId → CutRegion for O(1) lookup in template. */
readonly wordIdToRegion = computed(() => {
  this.editVersion(); // reactive dependency
  const map = new Map<string, CutRegion>();
  for (const region of this.clip().cutRegions ?? []) {
    for (const wid of region.wordIds) map.set(wid, region);
  }
  return map;
});

/** Pending cut-region save timer (mirrors existing saveTimer pattern). */
private cutRegionSaveTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 3: Replace `removeSelected`, `restoreSelected`, `toggleRemove`, `applySmartCut`**

Remove the old `removeSelected`, `restoreSelected`, and `toggleRemove` methods entirely and replace with:

```ts
removeSelected(): void {
  if (!this.selectedWordIds().length) return;
  this.applyCutRegionChange(
    this.cutRegionService.cut(this.clip(), this.selectedWordIds(), this.defaultEffectType())
  );
  this.selectedWordIds.set([]);
}

restoreSelected(): void {
  if (!this.selectedWordIds().length) return;
  this.applyCutRegionChange(
    this.cutRegionService.restore(this.clip(), this.selectedWordIds())
  );
  this.selectedWordIds.set([]);
}

toggleRemove(word: Word): void {
  if (this.editMode()) return;
  if (word.isRemoved) {
    this.applyCutRegionChange(this.cutRegionService.restore(this.clip(), [word.id]));
  } else {
    this.applyCutRegionChange(this.cutRegionService.cut(this.clip(), [word.id], this.defaultEffectType()));
  }
}
```

Replace `applySmartCut`:

```ts
applySmartCut(): void {
  const fillers = this.selectedFillers();
  const interval = this.silenceIntervalSec();
  const wordIds: string[] = [];
  for (const seg of this.clip().segments) {
    for (let i = 0; i < seg.words.length; i++) {
      const w = seg.words[i];
      if (w.isRemoved) continue;
      if (fillers.size && fillers.has(w.text.toLowerCase())) { wordIds.push(w.id); continue; }
      if (i < seg.words.length - 1) {
        const gap = seg.words[i + 1].startTime - w.endTime;
        if (gap >= interval) wordIds.push(w.id);
      }
    }
  }
  if (wordIds.length) {
    this.applyCutRegionChange(this.cutRegionService.cut(this.clip(), wordIds, this.defaultEffectType()));
  }
  this.smartCutOpen.set(false);
}
```

Replace `restoreAll`:

```ts
restoreAll(): void {
  const allRemoved = this.clip().segments.flatMap(s => s.words).filter(w => w.isRemoved).map(w => w.id);
  if (!allRemoved.length) return;
  if (allRemoved.length > 10 && !confirm(`Restore all ${allRemoved.length} removed words?`)) return;
  this.applyCutRegionChange(this.cutRegionService.restore(this.clip(), allRemoved));
}
```

- [ ] **Step 4: Replace `undo` and `redo`**

Replace the existing `undo()` and `redo()` private methods:

```ts
private undo(): void {
  const entry = this.editHistory.undo();
  if (!entry) return;
  const newClip = this.cutRegionService.applyUndo(this.clip(), entry);
  this.clipService.applyLocalUpdate(newClip);
  this.editVersion.update((v) => v + 1);
  this.scheduleCutRegionSave();
}

private redo(): void {
  const entry = this.editHistory.redo();
  if (!entry) return;
  const newClip = this.cutRegionService.applyRedo(this.clip(), entry);
  this.clipService.applyLocalUpdate(newClip);
  this.editVersion.update((v) => v + 1);
  this.scheduleCutRegionSave();
}
```

- [ ] **Step 5: Add `applyCutRegionChange` and `scheduleCutRegionSave`**

```ts
private applyCutRegionChange({ clip, entry }: { clip: Clip; entry: CutHistoryEntry }): void {
  this.clipService.applyLocalUpdate(clip);
  this.editHistory.record(entry);
  this.editVersion.update((v) => v + 1);
  this.scheduleCutRegionSave();
}

private scheduleCutRegionSave(): void {
  if (this.cutRegionSaveTimer) clearTimeout(this.cutRegionSaveTimer);
  this.cutRegionSaveTimer = setTimeout(() => {
    const c = this.clip();
    this.clipService.updateCutRegions(c.id, c.cutRegions ?? []).subscribe({ error: console.error });
    this.cutRegionSaveTimer = null;
  }, 800);
}
```

- [ ] **Step 6: Attach EffectPlayerService in `ngAfterViewInit`, detach in `ngOnDestroy`**

In `ngAfterViewInit`, after `this.mediaPlayer.attachElement(...)`:

```ts
if (this.mediaElRef?.nativeElement) {
  this.effectPlayer.attachElement(this.mediaElRef.nativeElement);
}
```

In `ngOnDestroy`, after `this.mediaPlayer.detachElement()`:

```ts
this.effectPlayer.resetAll();
if (this.cutRegionSaveTimer) clearTimeout(this.cutRegionSaveTimer);
```

- [ ] **Step 7: Update `togglePlay` to call `resumeAudioContext`**

In `togglePlay()`:

```ts
togglePlay(): void {
  this.effectPlayer.resumeAudioContext();
  this.playing() ? this.mediaPlayer.pause() : this.mediaPlayer.play().catch(() => {});
}
```

- [ ] **Step 8: Build check**

```bash
cd C:\web.projects\VTextStudio\client && npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors before committing.

- [ ] **Step 9: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat: wire CutRegionService + EditHistoryService into player component"
```

---

## Task 8: Effect selector UI + filler-badge popover + effect dot indicator

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

- [ ] **Step 1: Add effect popover signals and handler methods**

In the component class, add signals after `smartCutOpen`:

```ts
/** wordId of the removed word whose effect popover is open; null = closed */
readonly effectPopoverWordId = signal<string | null>(null);
/** regionId being edited in the duration input */
readonly durationEditRegionId = signal<string | null>(null);
```

Add methods:

```ts
onRemovedWordClick(word: Word, event: MouseEvent): void {
  event.stopPropagation();
  if (this.editMode()) return;
  // Toggle popover for this word's region
  this.effectPopoverWordId.update((current) => (current === word.id ? null : word.id));
  this.durationEditRegionId.set(null);
}

closeEffectPopover(): void {
  this.effectPopoverWordId.set(null);
  this.durationEditRegionId.set(null);
}

setDefaultEffect(type: EffectType): void {
  this.defaultEffectType.set(type);
  const updated = this.cutRegionService.applyDefaultEffectType(this.clip(), type);
  this.clipService.applyLocalUpdate(updated);
  this.editVersion.update((v) => v + 1);
  this.scheduleCutRegionSave();
}

setRegionEffect(regionId: string, type: EffectType): void {
  this.applyCutRegionChange(this.cutRegionService.setEffectType(this.clip(), regionId, type));
}

setRegionDuration(regionId: string, ms: number): void {
  this.applyCutRegionChange(this.cutRegionService.setDuration(this.clip(), regionId, ms));
  this.durationEditRegionId.set(null);
}

resetRegionEffect(regionId: string): void {
  this.applyCutRegionChange(
    this.cutRegionService.resetEffectType(this.clip(), regionId, this.defaultEffectType())
  );
  const { clip: c2 } = this.cutRegionService.resetDuration(this.clip(), regionId);
  this.clipService.applyLocalUpdate(c2);
  this.editVersion.update((v) => v + 1);
  this.scheduleCutRegionSave();
  this.closeEffectPopover();
}
```

- [ ] **Step 2: Add effect selector pills to the header toolbar**

In the template, inside `<ng-template #actionTools>`, after the `smart-cut-wrap` div and before the closing `</div>` of `hdr-group hdr-divider flex-wrap`, add:

```html
<!-- Effect type selector for new cuts -->
<div class="effect-pills-wrap" role="group" aria-label="Default cut effect type">
  <button class="effect-pill" [class.active]="defaultEffectType() === 'hard-cut'"
    (click)="setDefaultEffect('hard-cut')" title="Hard Cut — instant remove">
    <span class="material-symbols-outlined" style="font-size:1rem">content_cut</span>
  </button>
  <button class="effect-pill" [class.active]="defaultEffectType() === 'fade'"
    (click)="setDefaultEffect('fade')" title="Fade — audio/video fade at cut boundary">
    <span class="material-symbols-outlined" style="font-size:1rem">blur_on</span>
  </button>
  <button class="effect-pill" [class.active]="defaultEffectType() === 'cross-cut'"
    (click)="setDefaultEffect('cross-cut')" title="Cross-Cut — audio crossfade (preview ≈ export)">
    <span class="material-symbols-outlined" style="font-size:1rem">shuffle</span>
  </button>
</div>
```

- [ ] **Step 3: Update the filler-badge template block**

Find the existing `@else if (fi.word.isRemoved)` block in the word-flow. Replace it with:

```html
} @else if (fi.word.isRemoved) {
  @let region = wordIdToRegion().get(fi.word.id);
  <span class="filler-badge"
    [class.selected]="selectedWordIdSet().has(fi.word.id)"
    [class.popover-open]="effectPopoverWordId() === fi.word.id"
    (click)="onRemovedWordClick(fi.word, $event)"
    (dblclick)="toggleRemove(fi.word)">

    @if (region?.effectTypeOverridden && region?.effectType !== 'hard-cut') {
      <span class="effect-dot effect-dot--{{ region!.effectType }}" aria-hidden="true"></span>
    }

    <span class="filler-text"
      [attr.contenteditable]="editMode() ? 'plaintext-only' : 'false'" spellcheck="false"
      (blur)="onWordEdit(fi.word, $event)"
      (keydown.enter)="$event.preventDefault(); onWordEdit(fi.word, $event)"
      (click)="$event.stopPropagation()"
    >{{ fi.word.text }}</span>
    <button class="filler-x" (click)="toggleRemove(fi.word); $event.stopPropagation()" aria-label="Restore word">
      <span class="material-symbols-outlined">close</span>
    </button>

    @if (effectPopoverWordId() === fi.word.id && region) {
      <div class="effect-popover" role="dialog" aria-label="Cut effect options" (click)="$event.stopPropagation()">
        <div class="ep-row">
          <div class="ep-pills" role="group" aria-label="Effect type">
            <button class="ep-pill" [class.active]="region.effectType === 'hard-cut'"
              (click)="setRegionEffect(region.id, 'hard-cut')">Hard Cut</button>
            <button class="ep-pill" [class.active]="region.effectType === 'fade'"
              (click)="setRegionEffect(region.id, 'fade')">Fade</button>
            <button class="ep-pill" [class.active]="region.effectType === 'cross-cut'"
              (click)="setRegionEffect(region.id, 'cross-cut')">Cross</button>
          </div>
        </div>
        @if (region.effectType !== 'hard-cut') {
          <div class="ep-row ep-dur-row">
            <span class="ep-dur-label">Duration</span>
            @if (durationEditRegionId() === region.id) {
              <input type="number" class="ep-dur-input" min="150" max="500"
                [value]="region.effectDuration"
                (change)="setRegionDuration(region.id, +$any($event.target).value)"
                (keydown.enter)="durationEditRegionId.set(null)"
                (blur)="durationEditRegionId.set(null)"
              />
            } @else {
              <button class="ep-dur-chip" [class.fixed]="region.durationFixed"
                (click)="durationEditRegionId.set(region.id)"
                [title]="region.durationFixed ? 'Pinned — click to edit' : 'Auto — click to pin'">
                {{ region.effectDuration }}ms {{ region.durationFixed ? '·pin' : '·auto' }}
              </button>
            }
          </div>
        }
        @if (region.effectTypeOverridden || region.durationFixed) {
          <button class="ep-reset" (click)="resetRegionEffect(region.id)">Reset to default</button>
        }
      </div>
    }
  </span>
```

Also add a global click handler to close the popover on clicks outside — in `clearSelection()`, add:

```ts
clearSelection(event: MouseEvent): void {
  if (this.editMode()) return;
  const target = event.target as HTMLElement;
  if (!target.closest('.filler-badge')) {
    this.closeEffectPopover();
  }
  if (target.classList.contains('transcript-body') ||
      target.classList.contains('word-flow') ||
      target.classList.contains('seg-content')) {
    this.selectedWordIds.set([]);
    this.selectionAnchorWordId.set(null);
  }
}
```

- [ ] **Step 4: Add SCSS for new elements**

In `txt-media-player-v2.component.scss`, add at the end of the file:

```scss
/* ── Effect type selector pills ─────────────────────── */
.effect-pills-wrap {
  display: flex;
  gap: 2px;
  background: rgba(44, 44, 47, 0.6);
  border-radius: 6px;
  padding: 2px;
}

.effect-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(246, 243, 245, 0.5);
  cursor: pointer;
  transition: background 150ms, color 150ms;

  &:hover { color: var(--primary, #ba9eff); }

  &.active {
    background: rgba(186, 158, 255, 0.2);
    color: var(--primary, #ba9eff);
  }
}

/* ── Effect dot on filler badge ──────────────────────── */
.effect-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  pointer-events: none;

  &--fade       { background: var(--primary, #ba9eff); }
  &--cross-cut  { background: var(--tertiary, #ff716a); }
}

.filler-badge {
  position: relative; // needed for effect-dot absolute positioning
}

/* ── Effect override popover ─────────────────────────── */
.effect-popover {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  min-width: 180px;
  background: rgba(36, 36, 39, 0.97);
  backdrop-filter: blur(12px);
  border-radius: 8px;
  padding: 10px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ep-row { display: flex; align-items: center; gap: 6px; }

.ep-pills {
  display: flex;
  gap: 2px;
  background: rgba(44, 44, 47, 0.6);
  border-radius: 6px;
  padding: 2px;
}

.ep-pill {
  font-size: 0.7rem;
  font-family: 'Space Grotesk', sans-serif;
  padding: 3px 7px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(246, 243, 245, 0.6);
  cursor: pointer;
  transition: background 150ms, color 150ms;
  white-space: nowrap;

  &:hover { color: var(--primary, #ba9eff); }
  &.active { background: rgba(186, 158, 255, 0.2); color: var(--primary, #ba9eff); }
}

.ep-dur-row { justify-content: space-between; }

.ep-dur-label {
  font-size: 0.68rem;
  color: rgba(246, 243, 245, 0.45);
  font-family: 'Space Grotesk', sans-serif;
}

.ep-dur-chip {
  font-size: 0.68rem;
  font-family: 'Space Grotesk', sans-serif;
  background: rgba(44, 44, 47, 0.8);
  color: rgba(246, 243, 245, 0.7);
  border: 1px dashed rgba(72, 71, 74, 0.5);
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  transition: border-color 150ms;

  &:hover { border-color: var(--primary, #ba9eff); }
  &.fixed { border-style: solid; color: var(--primary, #ba9eff); }
}

.ep-dur-input {
  width: 70px;
  font-size: 0.68rem;
  font-family: 'Space Grotesk', sans-serif;
  background: rgba(44, 44, 47, 0.9);
  color: var(--on-surface, #f6f3f5);
  border: 1px solid var(--primary, #ba9eff);
  border-radius: 4px;
  padding: 2px 5px;
  outline: none;
}

.ep-reset {
  font-size: 0.65rem;
  color: rgba(186, 158, 255, 0.7);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline dotted;
  align-self: flex-start;

  &:hover { color: var(--primary, #ba9eff); }
}

.filler-badge.popover-open {
  outline: 1px solid rgba(186, 158, 255, 0.4);
}
```

- [ ] **Step 5: Build and visually verify**

```bash
cd C:\web.projects\VTextStudio\client && npx tsc --noEmit 2>&1 | head -20
```

Then start the app and confirm:
- Effect type pills appear in the toolbar
- Clicking a removed filler-badge opens the popover
- Choosing Fade/Cross-cut in the popover changes the effect dot on the badge

- [ ] **Step 6: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts \
        client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss
git commit -m "feat: add effect selector UI, filler-badge popover, and effect dot indicator"
```

---

## Task 9: Playback — fade/cross-cut effects via EffectPlayerService

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

- [ ] **Step 1: Add videoOpacity and videoFilter bindings to the template**

In the template, find the `<video>` element:
```html
<video #mediaEl class="video-el" [src]="mediaUrl()" preload="metadata"></video>
```

Replace with:
```html
<video
  #mediaEl
  class="video-el"
  [src]="mediaUrl()"
  preload="metadata"
  [style.opacity]="effectPlayer.videoOpacity()"
  [style.filter]="effectPlayer.videoFilter()"
></video>
```

For the audio placeholder div, add matching styles:
```html
<div class="audio-placeholder"
  [style.opacity]="effectPlayer.videoOpacity()"
  [style.filter]="effectPlayer.videoFilter()">
```

- [ ] **Step 2: Add CSS transition for opacity**

In `txt-media-player-v2.component.scss`, add to the `.video-el` rule:

```scss
.video-el {
  // ... existing styles ...
  transition: opacity 200ms ease, filter 80ms ease;
}
.audio-placeholder {
  // ... existing styles ...
  transition: opacity 200ms ease;
}
```

- [ ] **Step 3: Add effectState signal and replace `applyJumpCut`**

Add a signal to track whether a fade effect is in progress (to prevent re-triggering):

```ts
private readonly effectInProgress = signal(false);
```

Replace the existing `applyJumpCut` method entirely:

```ts
private applyJumpCut(currentTime: number): void {
  if (this.effectInProgress()) return;

  const segments = this.clip().segments;
  let startIdx = Math.max(0, this.lastActiveSegmentIdx);
  if (startIdx < segments.length && currentTime < segments[startIdx].startTime) startIdx = 0;

  const EPSILON = 0.08;

  for (let i = startIdx; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.startTime > currentTime + 1) break;

    for (const word of seg.words) {
      if (!word.isRemoved) continue;
      if (currentTime < word.startTime - EPSILON || currentTime >= word.endTime - EPSILON) continue;

      const nextStart = this.findNextActiveWordStart(word.endTime);
      if (nextStart === null) { this.enforceSegmentBounds(currentTime); return; }
      if (Math.abs(nextStart - currentTime) <= EPSILON) return;

      const region = this.wordIdToRegion().get(word.id);
      const effectType = region?.effectType ?? 'hard-cut';
      const effectDuration = region?.effectDuration ?? 200;
      const halfMs = effectDuration / 2;

      if (effectType === 'hard-cut') {
        this.mediaPlayer.seek(nextStart);
      } else if (effectType === 'fade') {
        this.effectInProgress.set(true);
        this.effectPlayer.startFadeOut(halfMs);
        setTimeout(() => {
          this.mediaPlayer.seek(nextStart);
          this.effectPlayer.startFadeIn(halfMs);
          setTimeout(() => this.effectInProgress.set(false), halfMs + 50);
        }, halfMs);
      } else if (effectType === 'cross-cut') {
        this.effectInProgress.set(true);
        this.effectPlayer.triggerCrossCutFlash();
        this.mediaPlayer.seek(nextStart);
        this.effectPlayer.startAudioCrossfade(effectDuration);
        setTimeout(() => this.effectInProgress.set(false), effectDuration + 50);
      }
      return;
    }
  }
}
```

- [ ] **Step 4: Reset effects on user-initiated seeks and clip changes**

In the `seekToTime` method and `onTimelineClick`, add `this.effectPlayer.resetAll()` before seeking:

```ts
seekToTime(time: number): void {
  this.effectPlayer.resetAll();
  this.effectInProgress.set(false);
  this.mediaPlayer.seek(time);
}
```

In `ngOnDestroy`, ensure `effectPlayer.resetAll()` is called (already done in Task 7).

- [ ] **Step 5: Build check and manual test**

```bash
cd C:\web.projects\VTextStudio\client && npx tsc --noEmit 2>&1 | head -20
```

Then manually test:
1. Remove a word with Fade effect → play through the cut → audio/video should briefly dip to 0 and recover
2. Remove a word with Cross-cut → play through → brief brightness flash + audio crossfade
3. Seek manually → opacity snaps back to 1

- [ ] **Step 6: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts \
        client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss
git commit -m "feat: wire fade and cross-cut playback effects via EffectPlayerService"
```

---

## Task 10: Timeline cut-region overlay

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

- [ ] **Step 1: Add `cutRegionOverlays` computed**

In the component class, add after `trackItems`:

```ts
readonly cutRegionOverlays = computed(() => {
  this.editVersion();
  const clip = this.clip();
  const dur = this.displayDuration();
  if (!dur || !clip.cutRegions?.length) return [];

  const wordMap = new Map<string, Word>();
  for (const seg of clip.segments) {
    for (const w of seg.words) wordMap.set(w.id, w);
  }

  return clip.cutRegions
    .map((region) => {
      const words = region.wordIds.map((id) => wordMap.get(id)).filter((w): w is Word => !!w);
      if (!words.length) return null;
      const start = Math.min(...words.map((w) => w.startTime));
      const end = Math.max(...words.map((w) => w.endTime));
      return {
        regionId: region.id,
        leftPercent: (start / dur) * 100,
        widthPercent: ((end - start) / dur) * 100,
        effectType: region.effectType,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);
});
```

- [ ] **Step 2: Add overlay divs to the timeline template**

Find the `<div class="track-blocks">` section in the template. After the `@for (item of trackItems()...)` block and before the closing `</div>`, add:

```html
<!-- Cut region overlays -->
@for (overlay of cutRegionOverlays(); track overlay.regionId) {
  <div class="cut-region-overlay cut-region-overlay--{{ overlay.effectType }}"
    [style.left.%]="overlay.leftPercent"
    [style.width.%]="overlay.widthPercent"
    [title]="overlay.effectType"
    aria-hidden="true">
  </div>
}
```

- [ ] **Step 3: Add SCSS for cut-region overlay**

In `txt-media-player-v2.component.scss`, add:

```scss
/* ── Timeline cut-region overlay ─────────────────────── */
.track-blocks {
  position: relative; // ensure overlays are positioned relative to the track
}

.cut-region-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  border-radius: 2px;

  // Striped pattern at 40% opacity
  background: repeating-linear-gradient(
    45deg,
    rgba(255, 110, 132, 0.35) 0px,
    rgba(255, 110, 132, 0.35) 3px,
    transparent 3px,
    transparent 7px
  );

  &--fade {
    background: repeating-linear-gradient(
      45deg,
      rgba(186, 158, 255, 0.35) 0px,
      rgba(186, 158, 255, 0.35) 3px,
      transparent 3px,
      transparent 7px
    );
  }

  &--cross-cut {
    background: repeating-linear-gradient(
      45deg,
      rgba(255, 113, 106, 0.35) 0px,
      rgba(255, 113, 106, 0.35) 3px,
      transparent 3px,
      transparent 7px
    );
  }
}
```

- [ ] **Step 4: Build and visually verify**

Start the app, remove some words, and confirm striped overlays appear on the timeline at the correct positions. Each effect type should show a different stripe color.

- [ ] **Step 5: Commit**

```bash
cd C:\web.projects\VTextStudio
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts \
        client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss
git commit -m "feat: add cut-region striped overlay to segment timeline"
```

---

## Task 11: Server export — fade and cross-cut ffmpeg filters

**Files:**
- Modify: `server/src/services/export.service.ts`

- [ ] **Step 1: Update `exportVideo` to read cut regions and build effect filters**

Replace the entire `exportVideo` method and `buildKeptSegments` helper in `server/src/services/export.service.ts`:

```ts
private exportVideo(
  job: ExportJob,
  inputPath: string,
  activeWords: Word[],
  _allWords: Word[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!activeWords.length) return reject(new Error('No active words to export'));

    const clips = job.clipIds?.length
      ? (projectService.get(job.projectId)?.clips ?? []).filter((c) => job.clipIds!.includes(c.id))
      : (projectService.get(job.projectId)?.clips ?? []);

    // Build kept segments paired with their CutRegion effect metadata
    const kept = this.buildKeptSegmentsWithEffects(activeWords, clips);
    const outPath = path.join(this.exportsDir, `${job.id}.mp4`);

    const vFilters: string[] = [];
    const aFilters: string[] = [];
    const concatInputs: string[] = [];

    kept.forEach(({ start, end, effectAfter }, i) => {
      vFilters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
      aFilters.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);

      if (effectAfter && i < kept.length - 1) {
        const halfDur = (effectAfter.effectDuration / 2 / 1000).toFixed(4);
        const fullDur = (effectAfter.effectDuration / 1000).toFixed(4);
        const segDur = end - start;

        if (effectAfter.effectType === 'fade') {
          const fadeOutStart = Math.max(0, segDur - Number(halfDur));
          vFilters[i] = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fade=t=out:st=${fadeOutStart}:d=${halfDur}[v${i}]`;
          aFilters[i] = `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeOutStart}:d=${halfDur}[a${i}]`;
          // The NEXT segment gets fade-in applied below
          const nextIdx = i + 1;
          if (nextIdx < kept.length) {
            const n = kept[nextIdx];
            vFilters[nextIdx] = `[0:v]trim=start=${n.start}:end=${n.end},setpts=PTS-STARTPTS,fade=t=in:st=0:d=${halfDur}[v${nextIdx}]`;
            aFilters[nextIdx] = `[0:a]atrim=start=${n.start}:end=${n.end},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${halfDur}[a${nextIdx}]`;
          }
        } else if (effectAfter.effectType === 'cross-cut') {
          // xfade requires segments to overlap; we handle it as acrossfade for audio
          // and xfade for video inserted as a separate filter between segments i and i+1
          // Simpler: rewrite segments i and i+1 as an xfade pair
          const nextIdx = i + 1;
          if (nextIdx < kept.length) {
            const n = kept[nextIdx];
            // Override the concat approach for this pair with xfade
            vFilters[i] = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}_raw]`;
            aFilters[i] = `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}_raw]`;
            vFilters[nextIdx] = `[0:v]trim=start=${n.start}:end=${n.end},setpts=PTS-STARTPTS[v${nextIdx}_raw]`;
            aFilters[nextIdx] = `[0:a]atrim=start=${n.start}:end=${n.end},asetpts=PTS-STARTPTS[a${nextIdx}_raw]`;
            // xfade video
            const xfadeOffset = Math.max(0, (end - start) - Number(fullDur));
            vFilters.push(`[v${i}_raw][v${nextIdx}_raw]xfade=transition=fade:duration=${fullDur}:offset=${xfadeOffset.toFixed(4)}[v_xf${i}]`);
            // acrossfade audio
            aFilters.push(`[a${i}_raw][a${nextIdx}_raw]acrossfade=d=${fullDur}:c1=tri:c2=tri[a_xf${i}]`);
            // Replace concat inputs for these two indices with the xfade output
            concatInputs.push(`[v_xf${i}][a_xf${i}]`);
            // skip the next index in the main forEach by marking it
            kept[nextIdx]._skipConcat = true;
            return; // don't push the normal concatInput for i
          }
        }
      }
      if (!kept[i]._skipConcat) {
        concatInputs.push(`[v${i}][a${i}]`);
      }
    });

    const n = concatInputs.length;
    const filterComplex = [
      ...vFilters,
      ...aFilters,
      `${concatInputs.join('')}concat=n=${n}:v=1:a=1[vout][aout]`,
    ].join(';');

    let lastProgress = 0;
    ffmpeg(inputPath)
      .complexFilter(filterComplex)
      .outputOptions(['-map [vout]', '-map [aout]', '-c:v libx264', '-c:a aac', '-movflags +faststart'])
      .output(outPath)
      .on('progress', (p) => {
        if (p.percent && p.percent - lastProgress >= 1) {
          lastProgress = p.percent;
          const now = Date.now();
          const elapsed = now - (job.startTime || now);
          const total = Math.round(elapsed / (p.percent / 100));
          job.elapsedTime = elapsed;
          job.estimatedTotalTime = total;
          sseService.broadcast({
            type: 'export:progress',
            data: { jobId: job.id, progress: Math.round(p.percent), elapsedTime: elapsed, estimatedTotalTime: total },
          });
        }
      })
      .on('end', () => { job.outputPath = outPath; resolve(); })
      .on('error', reject)
      .run();
  });
}

private buildKeptSegmentsWithEffects(
  words: Word[],
  clips: import('../models/clip.model').Clip[],
): Array<{ start: number; end: number; effectAfter?: { effectType: string; effectDuration: number }; _skipConcat?: boolean }> {
  if (!words.length) return [];

  // Build wordId → CutRegion map from all clips
  const regionByWordId = new Map<string, import('../models/clip.model').CutRegion>();
  for (const clip of clips) {
    for (const region of clip.cutRegions ?? []) {
      for (const wid of region.wordIds) regionByWordId.set(wid, region);
    }
  }

  // Build kept segments (contiguous runs of active words)
  const sorted = [...words].sort((a, b) => a.startTime - b.startTime);
  const segments: Array<{ start: number; end: number; lastWordId: string }> = [];
  let cur = { start: sorted[0].startTime, end: sorted[0].endTime, lastWordId: sorted[0].id };

  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.startTime <= cur.end + 0.05) {
      cur.end = Math.max(cur.end, w.endTime);
      cur.lastWordId = w.id;
    } else {
      segments.push(cur);
      cur = { start: w.startTime, end: w.endTime, lastWordId: w.id };
    }
  }
  segments.push(cur);

  // For each kept segment, find the CutRegion that immediately follows it
  // (the region whose words start right after this segment ends)
  return segments.map((seg, idx) => {
    if (idx === segments.length - 1) return { start: seg.start, end: seg.end };
    const nextSegStart = segments[idx + 1].start;
    // Find any removed word whose startTime is between seg.end and nextSegStart
    const bridgeWord = words.find((w) => w.startTime >= seg.end && w.startTime < nextSegStart);
    // Actually look for a removed word that is part of a CutRegion at this gap
    // We look in clips for words with isRemoved=true in this time range
    let effectAfter: { effectType: string; effectDuration: number } | undefined;
    for (const clip of clips) {
      for (const region of clip.cutRegions ?? []) {
        const regionWords = region.wordIds
          .map((id) => clip.segments.flatMap((s) => s.words).find((w) => w.id === id))
          .filter((w): w is Word => !!w);
        if (!regionWords.length) continue;
        const rStart = Math.min(...regionWords.map((w) => w.startTime));
        const rEnd = Math.max(...regionWords.map((w) => w.endTime));
        // This region sits between the current and next kept segment
        if (rStart >= seg.end - 0.1 && rEnd <= nextSegStart + 0.1) {
          effectAfter = { effectType: region.effectType, effectDuration: region.effectDuration };
          break;
        }
      }
      if (effectAfter) break;
    }
    return { start: seg.start, end: seg.end, effectAfter };
  });
}
```

Note: the `_skipConcat` flag on the segment objects is an implementation detail to avoid double-concatenating xfade-merged segments. This is set and checked in the `forEach` above.

- [ ] **Step 2: Build check**

```bash
cd C:\web.projects\VTextStudio\server && npx tsc --noEmit 2>&1 | head -20
```

Fix any type errors.

- [ ] **Step 3: Integration test — hard cut export still works**

Remove a word (hard cut), export as Video (MP4), confirm the download plays correctly with the word removed and no artifacts.

- [ ] **Step 4: Integration test — fade export**

Change the cut effect to Fade, export as Video (MP4). Open the exported file and confirm audible fade-out and fade-in at the cut boundary.

- [ ] **Step 5: Commit**

```bash
cd C:\web.projects\VTextStudio
git add server/src/services/export.service.ts
git commit -m "feat: apply fade (afade) and cross-cut (xfade/acrossfade) ffmpeg filters on video export"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| `CutRegion` data model | Task 1 |
| `isRemoved` stays as derived mirror | Tasks 1, 2 |
| `effectTypeOverridden` flag | Task 2 |
| Auto-duration formula `clamp(removedMs*0.1, 150, 500)` | Task 2 |
| Global default effect signal | Tasks 7, 8 |
| `wordIdToRegion` map | Task 7 |
| Cut commits immediately | Task 7 |
| Merge with adjacent regions (earliest-override-wins) | Task 2 |
| Left-click on filler badge opens popover | Task 8 |
| Effect type pills (Hard/Fade/Cross) in popover | Task 8 |
| Duration chip with pin/reset | Task 8 |
| Effect dot on badge for overrides | Task 8 |
| Global default updates non-overridden regions | Tasks 7, 8 |
| Undo/redo for cut/restore/edit-effect | Tasks 3, 7 |
| Web Audio GainNode routing | Task 4 |
| Fade preview (opacity + gain ramp) | Tasks 4, 9 |
| Cross-cut preview (flash + audio crossfade) | Tasks 4, 9 |
| `resumeAudioContext` on user gesture | Task 7 |
| Reset effects on manual seek | Task 9 |
| Timeline cut-region striped overlay | Task 10 |
| Server `PUT /api/clips/:id/cut-regions` | Task 5 |
| Server syncs `isRemoved` from cut regions | Task 5 |
| Export: fade via `afade`/`fade` ffmpeg | Task 11 |
| Export: cross-cut via `xfade`/`acrossfade` | Task 11 |
| Export button blocked while pending cuts (N/A — stage mode removed) | — |

### No placeholders: verified — all steps contain actual code.

### Type consistency: `CutHistoryEntry` defined in `cut-region.service.ts` and imported in `edit-history.service.ts` and the player component. `CutRegion`/`EffectType` from `cut-region.model.ts` (client) and inline in `clip.model.ts` (server). `wordIdToRegion` returns `Map<string, CutRegion>` matching the `CutRegion` import in the component.
