# Edit Modes & Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Live/Apply editing modes with staged pending cuts, rename effect types (clear-cut/fade-in/cross-cut/smart), and wire a Smart heuristic service into V2 player.

**Architecture:** Pending cuts co-exist in `clip.cutRegions` tagged with `pending: true`; `syncIsRemoved` computes the effective removed set as `(committed ∪ pendingAdds) \ pendingRemoves`. A new `PendingEditsService` handles apply/discard. `SmartEffectService` picks effect type per region using gap/segment/punctuation heuristics.

**Tech Stack:** Angular 20+ standalone signals, RxJS forkJoin, Karma/Jasmine for tests. Run tests from `client/` directory.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `client/src/app/core/models/cut-region.model.ts` | Modify | Rename EffectType + add pending fields |
| `client/src/app/core/models/word.model.ts` | Modify | Add `pendingText` |
| `server/src/models/clip.model.ts` | Modify | Rename server EffectType + accept new names |
| `server/src/services/clip.service.ts` | Modify | Normalize legacy effect names on read |
| `client/src/app/core/services/settings.service.ts` | Modify | Add DEFAULT_EDIT_MODE key + reactive signal |
| `client/src/app/features/studio/txt-media-player/cut-region.service.ts` | Modify | `pending` param, new syncIsRemoved, apply-batch undo/redo |
| `client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts` | Modify | Fix method name, add pending tests |
| `client/src/app/features/studio/txt-media-player/edit-history.service.ts` | Modify | Add `apply-batch` entry kind |
| `client/src/app/features/studio/txt-media-player/smart-effect.service.ts` | Create | Heuristic resolver |
| `client/src/app/features/studio/txt-media-player/smart-effect.service.spec.ts` | Create | Heuristic unit tests |
| `client/src/app/features/studio/txt-media-player/effect-player.service.ts` | Modify | Handle clear-cut/fade-in/smart |
| `client/src/app/features/studio/txt-media-player/pending-edits.service.ts` | Create | applyAll/discardAll/selection |
| `client/src/app/features/studio/txt-media-player/pending-edits.service.spec.ts` | Create | Pending service unit tests |
| `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` | Modify | New signals, pending wiring, mode switch, apply pill logic |
| `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss` | Modify | Pending styles, floating Apply pill |
| `client/src/app/features/onboarding/settings-panel/settings-panel.component.ts` | Modify | Add DEFAULT_EDIT_MODE UI row |
| `client/src/app/features/onboarding/settings-panel/settings-panel.component.html` | Modify | Segmented toggle for edit mode |

---

### Task 1: Update EffectType and data models

**Files:**
- Modify: `client/src/app/core/models/cut-region.model.ts`
- Modify: `client/src/app/core/models/word.model.ts`
- Modify: `server/src/models/clip.model.ts`

- [ ] **Step 1: Update client cut-region model**

Replace the entire file `client/src/app/core/models/cut-region.model.ts`:

```typescript
export type EffectType = 'clear-cut' | 'fade-in' | 'cross-cut' | 'smart';

export interface CutRegion {
  id: string;
  wordIds: string[];
  startTime?: number;
  endTime?: number;
  effectType: EffectType;
  effectTypeOverridden: boolean;
  effectDuration: number;
  durationFixed: boolean;
  pending?: boolean;
  pendingKind?: 'add' | 'remove';
  pendingTargetId?: string;
  resolvedEffectType?: Exclude<EffectType, 'smart'>;
}
```

- [ ] **Step 2: Add pendingText to Word model**

Replace `client/src/app/core/models/word.model.ts`:

```typescript
export interface Word {
  id: string;
  segmentId: string;
  text: string;
  startTime: number;
  endTime: number;
  isRemoved: boolean;
  isEdited?: boolean;
  pendingText?: string;
}
```

- [ ] **Step 3: Update server EffectType**

Replace lines 4 in `server/src/models/clip.model.ts`:

```typescript
export type EffectType = 'clear-cut' | 'fade-in' | 'cross-cut' | 'smart';
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd client && npx ng build --configuration=development 2>&1 | head -60
```

Expected: compilation errors about `'hard-cut'` and `'fade'` references in existing files. List them — they will be fixed in the next step.

- [ ] **Step 5: Fix effect name references in existing service + spec**

In `cut-region.service.ts` — no literal effect names used (defaults come from callers). No change needed.

In `cut-region.service.spec.ts` — replace all occurrences of `'hard-cut'` with `'clear-cut'` and `'fade'` with `'fade-in'`. Also fix `setEffectType` method call (wrong name — should be `updateRegionEffect`):

Line 91: change `svc.setEffectType(cut, regionId, 'fade')` → `svc.updateRegionEffect(cut, regionId, 'fade-in')`
Line 94: change `expect(result.cutRegions[0].effectType).toBe('fade')` → `.toBe('fade-in')`
All `'hard-cut'` → `'clear-cut'`.

In `txt-media-player-v2.component.ts`:
- Line 767: `signal<EffectType>('hard-cut')` → `signal<EffectType>('clear-cut')`
- Line 301-313 (effect pills): `'hard-cut'` → `'clear-cut'`, `'fade'` → `'fade-in'`

In `effect-player.service.ts`:
- Line 125: `if (region.effectType === 'hard-cut')` → `'clear-cut'`
- Line 129: `if (region.effectType === 'fade')` → `'fade-in'`
- Line 137: `if (region.effectType === 'cross-cut')` — unchanged

In `smart-cut` within V2: `defaultEffect: EffectType` param call in `applySmartCut()` — no literal, passes `this.defaultEffectType()` signal.

- [ ] **Step 6: Verify build passes**

```bash
cd client && npx ng build --configuration=development 2>&1 | grep -E "ERROR|error" | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/app/core/models/ server/src/models/clip.model.ts \
  client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts \
  client/src/app/features/studio/txt-media-player/effect-player.service.ts \
  client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "refactor: rename effect types clear-cut/fade-in + add pending fields to CutRegion/Word"
```

---

### Task 2: Server EffectType normalization

**Files:**
- Modify: `server/src/services/clip.service.ts`

- [ ] **Step 1: Add normalizeEffectType helper + call in updateCutRegions**

In `server/src/services/clip.service.ts`, add after the imports:

```typescript
type LegacyEffectType = 'hard-cut' | 'fade' | 'clear-cut' | 'fade-in' | 'cross-cut' | 'smart';

function normalizeEffectType(t: string): string {
  if (t === 'hard-cut') return 'clear-cut';
  if (t === 'fade') return 'fade-in';
  return t;
}

function normalizeCutRegion(r: Record<string, unknown>): Record<string, unknown> {
  return { ...r, effectType: normalizeEffectType(String(r['effectType'] ?? '')) };
}
```

In `updateCutRegions` method, normalize incoming regions before storing:

```typescript
updateCutRegions(clipId: string, cutRegions: import('../models/clip.model').CutRegion[]): Clip | null {
  const project = projectService.getCurrent();
  if (!project) return null;
  const clipIndex = project.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) return null;
  const clip = project.clips[clipIndex];

  // Normalize legacy effect names + strip client-only pending fields
  const normalized = (cutRegions as unknown as Record<string, unknown>[]).map(r => {
    const { pending, pendingKind, pendingTargetId, resolvedEffectType, ...clean } = normalizeCutRegion(r) as Record<string, unknown>;
    return clean;
  }) as import('../models/clip.model').CutRegion[];

  const removedIds = new Set(normalized.flatMap((r) => r.wordIds));
  const updatedSegments = clip.segments.map((seg) => ({
    ...seg,
    words: seg.words.map((w) => ({ ...w, isRemoved: removedIds.has(w.id) })),
  }));
  const updatedClip: Clip = { ...clip, cutRegions: normalized, segments: updatedSegments };
  const updatedClips = [...project.clips];
  updatedClips[clipIndex] = updatedClip;
  projectService.update(project.id, { clips: updatedClips });
  return updatedClip;
}
```

- [ ] **Step 2: Normalize on getAll / getById (read path)**

Add a helper that normalizes an entire clip on read. In `ClipService.getAll()`:

```typescript
getAll(projectId?: string): Clip[] {
  const project = projectId ? projectService.get(projectId) : projectService.getCurrent();
  return (project?.clips ?? []).map(this.normalizeClip);
}

getById(id: string): Clip | undefined {
  return this.getAll().find((c) => c.id === id);
}

private normalizeClip = (clip: Clip): Clip => ({
  ...clip,
  cutRegions: clip.cutRegions.map(r => ({ ...r, effectType: normalizeEffectType(r.effectType as string) as import('../models/clip.model').EffectType })),
});
```

- [ ] **Step 3: Build server**

```bash
cd server && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/clip.service.ts
git commit -m "feat(server): normalize legacy hard-cut/fade effect names on read and write"
```

---

### Task 3: SettingsService reactive signal extension

**Files:**
- Modify: `client/src/app/core/services/settings.service.ts`

- [ ] **Step 1: Add DEFAULT_EDIT_MODE to SettingKey and SETTING_META**

Replace `settings.service.ts` entirely:

```typescript
import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';

export type SettingKey =
  | 'OPENAI_API_KEY'
  | 'WHISPER_BASE_URL'
  | 'WHISPER_MODEL'
  | 'WHISPER_LANGUAGE'
  | 'SHOW_SILENCE_MARKERS'
  | 'GROQ_API_KEY'
  | 'DEFAULT_EDIT_MODE';

export type AppSettings = Partial<Record<SettingKey, string>>;

export const SETTING_META: Record<SettingKey, { label: string; description: string; placeholder: string; secret?: boolean }> = {
  OPENAI_API_KEY: {
    label: 'OpenAI API Key',
    description: 'Used by the Whisper (OpenAI-compatible) transcription plugin.',
    placeholder: 'sk-…',
    secret: true,
  },
  WHISPER_BASE_URL: {
    label: 'Whisper Base URL',
    description: 'Override the OpenAI endpoint for a self-hosted Whisper server.',
    placeholder: 'http://localhost:8000/v1',
  },
  WHISPER_MODEL: {
    label: 'Whisper Model',
    description: 'Default model for transcription.',
    placeholder: 'ivrit-ai/whisper-large-v3-turbo-ct2',
  },
  WHISPER_LANGUAGE: {
    label: 'Whisper Language',
    description: 'ISO 639-1 language code. Leave blank for auto-detect.',
    placeholder: 'he',
  },
  SHOW_SILENCE_MARKERS: {
    label: 'Show Silence Markers',
    description: 'Show gap markers between transcript segments.',
    placeholder: 'false',
  },
  GROQ_API_KEY: {
    label: 'Groq API Key',
    description: 'Used by the Groq Whisper transcription plugin.',
    placeholder: 'gsk_…',
    secret: true,
  },
  DEFAULT_EDIT_MODE: {
    label: 'Default Edit Mode',
    description: 'Live: changes apply immediately. Apply: changes are staged until you click Apply.',
    placeholder: 'live',
  },
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly defaultEditMode = signal<'live' | 'apply'>('live');

  constructor(private api: ApiService) {}

  load(): Observable<AppSettings> {
    return this.api.get<AppSettings>('/settings').pipe(
      tap((s) => {
        const val = s['DEFAULT_EDIT_MODE'];
        if (val === 'live' || val === 'apply') this.defaultEditMode.set(val);
      })
    );
  }

  save(settings: AppSettings): Observable<{ ok: boolean; settings: AppSettings }> {
    return this.api.put<{ ok: boolean; settings: AppSettings }>('/settings', settings);
  }

  saveDefaultEditMode(mode: 'live' | 'apply'): void {
    this.defaultEditMode.set(mode);
    this.save({ DEFAULT_EDIT_MODE: mode }).subscribe({ error: console.error });
  }
}
```

- [ ] **Step 2: Build check**

```bash
cd client && npx ng build --configuration=development 2>&1 | grep -E "ERROR|error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/core/services/settings.service.ts
git commit -m "feat: add DEFAULT_EDIT_MODE setting key with reactive signal in SettingsService"
```

---

### Task 4: CutRegionService — pending support + syncIsRemoved rewrite

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/cut-region.service.ts`

- [ ] **Step 1: Write failing tests first**

Add the following test blocks to `cut-region.service.spec.ts` (after the existing `applyUndo/applyRedo` describe block):

```typescript
describe('pending cut / restore', () => {
  it('cut with pending=true creates a pending-add region, not committed', () => {
    const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
    const { clip: result } = svc.cut(clip, ['w1'], 'clear-cut', true);
    expect(result.cutRegions.length).toBe(1);
    expect(result.cutRegions[0].pending).toBe(true);
    expect(result.cutRegions[0].pendingKind).toBe('add');
    expect(result.segments[0].words[1].isRemoved).toBe(true);
  });

  it('pending-add does not merge with committed region', () => {
    const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
    const { clip: c1 } = svc.cut(clip, ['w1'], 'clear-cut', false);     // committed
    const { clip: c2 } = svc.cut(c1, ['w2'], 'clear-cut', true);        // pending
    expect(c2.cutRegions.length).toBe(2);
    const committed = c2.cutRegions.find(r => !r.pending);
    const pending = c2.cutRegions.find(r => r.pending);
    expect(committed!.wordIds).toEqual(['w1']);
    expect(pending!.wordIds).toEqual(['w2']);
  });

  it('pending restore of committed region creates pending-remove', () => {
    const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
    const { clip: cut } = svc.cut(clip, ['w1'], 'clear-cut', false);
    const committedId = cut.cutRegions[0].id;
    const { clip: restored } = svc.restore(cut, ['w1'], true);
    // committed region still present
    expect(restored.cutRegions.find(r => r.id === committedId)).toBeTruthy();
    // pending-remove entry created
    const pendingRemove = restored.cutRegions.find(r => r.pending && r.pendingKind === 'remove');
    expect(pendingRemove).toBeTruthy();
    expect(pendingRemove!.pendingTargetId).toBe(committedId);
    // word appears restored in effective view
    expect(restored.segments[0].words[1].isRemoved).toBe(false);
  });

  it('pending restore of pending-add region shrinks it', () => {
    const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
    const { clip: c1 } = svc.cut(clip, ['w1', 'w2'], 'clear-cut', true);
    const { clip: c2 } = svc.restore(c1, ['w1'], true);
    const pendingAdd = c2.cutRegions.find(r => r.pending && r.pendingKind === 'add');
    expect(pendingAdd!.wordIds).toEqual(['w2']);
    expect(c2.cutRegions.length).toBe(1); // no pending-remove created
  });

  it('syncIsRemoved: (committed ∪ pendingAdds) \\ pendingRemoves', () => {
    const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
    const { clip: c1 } = svc.cut(clip, ['w0', 'w1'], 'clear-cut', false); // committed: w0, w1
    const committedId = c1.cutRegions[0].id;
    // pending-add w3
    const { clip: c2 } = svc.cut(c1, ['w3'], 'clear-cut', true);
    // pending-remove w0 from committed
    const c3 = svc.syncIsRemoved({
      ...c2,
      cutRegions: [
        ...c2.cutRegions,
        { id: 'pr1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'remove', pendingTargetId: committedId },
      ],
    });
    expect(c3.segments[0].words[0].isRemoved).toBe(false); // w0 restored by pending-remove
    expect(c3.segments[0].words[1].isRemoved).toBe(true);  // w1 still committed
    expect(c3.segments[0].words[2].isRemoved).toBe(false); // w2 never cut
    expect(c3.segments[0].words[3].isRemoved).toBe(true);  // w3 pending-add
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npx ng test --include='**/cut-region.service.spec.ts' --watch=false 2>&1 | tail -20
```

Expected: FAILED — methods don't have pending param yet.

- [ ] **Step 3: Rewrite syncIsRemoved**

In `cut-region.service.ts`, replace the `syncIsRemoved` method:

```typescript
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
```

- [ ] **Step 4: Update cut() for pending support**

Replace the `cut` method signature and logic:

```typescript
cut(clip: Clip, wordIds: string[], defaultEffectType: EffectType, pending = false): { clip: Clip; entry: CutHistoryEntry } {
  const allWords = this.allWords(clip);
  const allIds = allWords.map(w => w.id);

  // In pending mode: only merge adjacent pending-add regions.
  // In live mode: merge all adjacent committed regions (existing behavior).
  const candidateRegions = pending
    ? (clip.cutRegions ?? []).filter(r => r.pending && r.pendingKind === 'add')
    : (clip.cutRegions ?? []).filter(r => !r.pending);

  const touched = candidateRegions.filter(r => {
    const rMin = Math.min(...r.wordIds.map(id => allIds.indexOf(id)));
    const rMax = Math.max(...r.wordIds.map(id => allIds.indexOf(id)));
    const sMin = Math.min(...wordIds.map(id => allIds.indexOf(id)));
    const sMax = Math.max(...wordIds.map(id => allIds.indexOf(id)));
    return rMax + 1 >= sMin && rMin - 1 <= sMax;
  });

  const mergedIdSet = new Set<string>([...touched.flatMap(r => r.wordIds), ...wordIds]);
  const mergedWordIds = allIds.filter(id => mergedIdSet.has(id));
  const removedMs = this.removedDurationMs(allWords, mergedWordIds);

  const firstOverride = touched.find(r => r.effectTypeOverridden);
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

  const remaining = (clip.cutRegions ?? []).filter(r => !touched.includes(r));
  const newClip = this.syncIsRemoved({ ...clip, cutRegions: [...remaining, regionAfter] });
  return { clip: newClip, entry: { kind: 'cut', regionAfter, regionsBefore: touched } };
}
```

- [ ] **Step 5: Update restore() for pending support**

Replace the `restore` method:

```typescript
restore(clip: Clip, wordIds: string[], pending = false): { clip: Clip; entry: CutHistoryEntry } {
  if (pending) return this.pendingRestore(clip, wordIds);

  const wordIdSet = new Set(wordIds);
  const allWords = this.allWords(clip);
  const allIds = allWords.map(w => w.id);
  const regionsBefore: CutRegion[] = [];
  const regionsAfter: CutRegion[] = [];

  for (const region of (clip.cutRegions ?? [])) {
    if (!region.wordIds.some(id => wordIdSet.has(id))) {
      regionsAfter.push(region);
      continue;
    }
    regionsBefore.push(region);
    const remaining = region.wordIds.filter(id => !wordIdSet.has(id));
    if (!remaining.length) continue;
    const groups = this.groupContiguous(remaining.map(id => allIds.indexOf(id)));
    for (let i = 0; i < groups.length; i++) {
      const groupWordIds = groups[i].map(idx => allIds[idx]);
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
```

- [ ] **Step 6: Add pending param to effect update methods**

Add `pending = false` to `updateRegionEffect`, `updateRegionDuration`, `resetDuration`, `resetRegionEffect`. These methods target specific regionIds so pending is less relevant (you're modifying an existing region), but the param keeps the API consistent and guards against accidentally saving. For now they just pass through unchanged — no behavior change needed.

- [ ] **Step 7: Update applyUndo/applyRedo for apply-batch (add stub for new entry kind)**

The `apply-batch` type is defined in Task 5. For now, add the case to prevent TypeScript exhaustiveness errors after Task 5:

This will be done in Task 5.

- [ ] **Step 8: Run pending tests**

```bash
cd client && npx ng test --include='**/cut-region.service.spec.ts' --watch=false 2>&1 | tail -30
```

Expected: all tests pass including new pending tests.

- [ ] **Step 9: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/cut-region.service.ts \
        client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts
git commit -m "feat: add pending support to CutRegionService + rewrite syncIsRemoved"
```

---

### Task 5: EditHistoryService — apply-batch entry

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/edit-history.service.ts`
- Modify: `client/src/app/features/studio/txt-media-player/cut-region.service.ts`

- [ ] **Step 1: Add apply-batch to CutHistoryEntry union**

In `cut-region.service.ts`, update the `CutHistoryEntry` type export:

```typescript
export type CutHistoryEntry =
  | { kind: 'cut';         regionAfter: CutRegion; regionsBefore: CutRegion[] }
  | { kind: 'restore';     regionsBefore: CutRegion[]; regionsAfter: CutRegion[] }
  | { kind: 'edit-effect'; regionId: string; before: Partial<CutRegion>; after: Partial<CutRegion> }
  | { kind: 'apply-batch'; clipBefore: import('../../../core/models/clip.model').Clip; clipAfter: import('../../../core/models/clip.model').Clip };
```

- [ ] **Step 2: Handle apply-batch in applyUndo and applyRedo**

In `cut-region.service.ts`, update the switch cases in `applyUndo` and `applyRedo`:

```typescript
applyUndo(clip: Clip, entry: CutHistoryEntry): Clip {
  switch (entry.kind) {
    case 'cut': {
      const without = clip.cutRegions.filter(r => r.id !== entry.regionAfter.id);
      return this.syncIsRemoved({ ...clip, cutRegions: [...without, ...entry.regionsBefore] });
    }
    case 'restore': {
      const afterIds = new Set(entry.regionsAfter.map(r => r.id));
      const without = clip.cutRegions.filter(r => !afterIds.has(r.id));
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
      const beforeIds = new Set(entry.regionsBefore.map(r => r.id));
      const without = clip.cutRegions.filter(r => !beforeIds.has(r.id));
      return this.syncIsRemoved({ ...clip, cutRegions: [...without, entry.regionAfter] });
    }
    case 'restore': {
      const beforeIds = new Set(entry.regionsBefore.map(r => r.id));
      const without = clip.cutRegions.filter(r => !beforeIds.has(r.id));
      return this.syncIsRemoved({ ...clip, cutRegions: [...without, ...entry.regionsAfter] });
    }
    case 'edit-effect':
      return this.patchRegion(clip, entry.regionId, entry.after);
    case 'apply-batch':
      return entry.clipAfter;
  }
}
```

- [ ] **Step 3: Build check**

```bash
cd client && npx ng build --configuration=development 2>&1 | grep -E "ERROR|error" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/cut-region.service.ts \
        client/src/app/features/studio/txt-media-player/edit-history.service.ts
git commit -m "feat: add apply-batch CutHistoryEntry for atomic undo of pending apply"
```

---

### Task 6: SmartEffectService

**Files:**
- Create: `client/src/app/features/studio/txt-media-player/smart-effect.service.ts`
- Create: `client/src/app/features/studio/txt-media-player/smart-effect.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `client/src/app/features/studio/txt-media-player/smart-effect.service.spec.ts`:

```typescript
import { SmartEffectService } from './smart-effect.service';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeClip(words: Partial<Word>[], segments?: { segmentId: string; words: string[] }[]): Clip {
  const fullWords: Word[] = words.map((w, i) => ({
    id: w.id ?? `w${i}`,
    segmentId: w.segmentId ?? 's1',
    text: w.text ?? `word${i}`,
    startTime: w.startTime ?? i,
    endTime: w.endTime ?? i + 0.8,
    isRemoved: w.isRemoved ?? false,
  }));

  const segmentIds = [...new Set(fullWords.map(w => w.segmentId))];
  const clipSegments = segmentIds.map(sid => {
    const segWords = fullWords.filter(w => w.segmentId === sid);
    return {
      id: sid,
      clipId: 'clip1',
      text: '',
      tags: [],
      startTime: segWords[0].startTime,
      endTime: segWords[segWords.length - 1].endTime,
      words: segWords,
    };
  });

  return {
    id: 'clip1',
    projectId: 'p1',
    name: 'test',
    startTime: 0,
    endTime: fullWords[fullWords.length - 1]?.endTime ?? 10,
    cutRegions: [],
    segments: clipSegments,
  };
}

function makeRegion(wordIds: string[]): CutRegion {
  return { id: 'r1', wordIds, effectType: 'smart', effectTypeOverridden: false, effectDuration: 300, durationFixed: false };
}

describe('SmartEffectService', () => {
  let svc: SmartEffectService;
  beforeEach(() => { svc = new SmartEffectService(); });

  it('rule 1: cross-segment cut → cross-cut 350ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.8 },
      { id: 'w1', segmentId: 's2', startTime: 1, endTime: 1.8 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('cross-cut');
    expect(result.durationMs).toBe(350);
  });

  it('rule 2: sentence boundary (period) → cross-cut 300ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', text: 'Hello.', startTime: 0, endTime: 0.8 },
      { id: 'w1', segmentId: 's1', text: 'um', startTime: 1, endTime: 1.3 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('cross-cut');
    expect(result.durationMs).toBe(300);
  });

  it('rule 3: removed audio >= 1500ms → fade-in 400ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 2.5 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0']));
    expect(result.effectType).toBe('fade-in');
    expect(result.durationMs).toBe(400);
  });

  it('rule 4: internal gap >= 0.6s → fade-in 250ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.5 },
      { id: 'w1', segmentId: 's1', startTime: 1.2, endTime: 1.8 }, // 0.7s gap
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('fade-in');
    expect(result.durationMs).toBe(250);
  });

  it('rule 5: short filler (<=2 words, <=600ms) → clear-cut 0ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.3 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0']));
    expect(result.effectType).toBe('clear-cut');
    expect(result.durationMs).toBe(0);
  });

  it('rule 6 (default): medium cut → clear-cut with auto duration', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.9 },
      { id: 'w1', segmentId: 's1', startTime: 1.0, endTime: 1.9 },
      { id: 'w2', segmentId: 's1', startTime: 2.0, endTime: 2.9 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1', 'w2']));
    expect(result.effectType).toBe('clear-cut');
    expect(result.durationMs).toBeGreaterThanOrEqual(150);
    expect(result.durationMs).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd client && npx ng test --include='**/smart-effect.service.spec.ts' --watch=false 2>&1 | tail -10
```

Expected: FAILED — module not found.

- [ ] **Step 3: Implement SmartEffectService**

Create `client/src/app/features/studio/txt-media-player/smart-effect.service.ts`:

```typescript
import { Injectable } from '@angular/core';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion, EffectType } from '../../../core/models/cut-region.model';

@Injectable({ providedIn: 'root' })
export class SmartEffectService {
  resolve(clip: Clip, region: CutRegion): { effectType: Exclude<EffectType, 'smart'>; durationMs: number } {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionWordSet = new Set(region.wordIds);
    const regionWords = allWords.filter(w => regionWordSet.has(w.id));

    if (!regionWords.length) return { effectType: 'clear-cut', durationMs: 0 };

    const regionStart = Math.min(...regionWords.map(w => w.startTime));
    const regionEnd = Math.max(...regionWords.map(w => w.endTime));
    const removedMs = (regionEnd - regionStart) * 1000;

    // Rule 1: cross-segment
    const segIds = new Set(regionWords.map(w => w.segmentId));
    if (segIds.size >= 2) return { effectType: 'cross-cut', durationMs: 350 };

    // Rule 2: sentence boundary
    if (regionWords.some(w => /[.!?]$/.test(w.text.trim()))) {
      return { effectType: 'cross-cut', durationMs: 300 };
    }

    // Rule 3: long pause
    if (removedMs >= 1500) return { effectType: 'fade-in', durationMs: 400 };

    // Rule 4: internal gap >= 0.6s
    for (let i = 1; i < regionWords.length; i++) {
      if ((regionWords[i].startTime - regionWords[i - 1].endTime) >= 0.6) {
        return { effectType: 'fade-in', durationMs: 250 };
      }
    }

    // Rule 5: short filler
    if (region.wordIds.length <= 2 && removedMs <= 600) {
      return { effectType: 'clear-cut', durationMs: 0 };
    }

    // Default
    return { effectType: 'clear-cut', durationMs: this.autoEffectDuration(removedMs) };
  }

  private autoEffectDuration(removedMs: number): number {
    return Math.max(150, Math.min(500, Math.round(removedMs * 0.1)));
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd client && npx ng test --include='**/smart-effect.service.spec.ts' --watch=false 2>&1 | tail -15
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/smart-effect.service.ts \
        client/src/app/features/studio/txt-media-player/smart-effect.service.spec.ts
git commit -m "feat: add SmartEffectService with heuristic effect resolution"
```

---

### Task 7: EffectPlayerService — handle renamed + smart types

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/effect-player.service.ts`

- [ ] **Step 1: Update playEffect() to handle new type names + smart**

Replace the `playEffect` method and update imports:

```typescript
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Observable, of, timer } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { CutRegion } from '../../../core/models/cut-region.model';
import { Clip } from '../../../core/models/clip.model';
import { SmartEffectService } from './smart-effect.service';
```

Add injection in the class body (replace constructor pattern — service uses `OnDestroy` so keep class, add field):

```typescript
private readonly smartEffect = inject(SmartEffectService);
```

Replace `playEffect`:

```typescript
playEffect(region: CutRegion, clip?: Clip): Observable<void> {
  let effectType = region.effectType;
  let dur = region.effectDuration ?? 300;

  if (effectType === 'smart' && clip) {
    const resolved = this.smartEffect.resolve(clip, region);
    effectType = resolved.effectType;
    dur = resolved.durationMs;
    region.resolvedEffectType = resolved.effectType;
  }

  if (effectType === 'clear-cut') {
    return of(undefined);
  }

  if (effectType === 'fade-in') {
    this.startFadeOut(dur);
    return timer(dur).pipe(
      tap(() => this.resetAll()),
      map(() => undefined)
    );
  }

  if (effectType === 'cross-cut') {
    this.triggerCrossCutFlash();
    this.startAudioCrossfade(dur);
    return timer(dur).pipe(map(() => undefined));
  }

  return of(undefined);
}
```

- [ ] **Step 2: Build check**

```bash
cd client && npx ng build --configuration=development 2>&1 | grep -E "ERROR|error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/effect-player.service.ts
git commit -m "feat: update EffectPlayerService for clear-cut/fade-in/smart effect types"
```

---

### Task 8: PendingEditsService

**Files:**
- Create: `client/src/app/features/studio/txt-media-player/pending-edits.service.ts`
- Create: `client/src/app/features/studio/txt-media-player/pending-edits.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `client/src/app/features/studio/txt-media-player/pending-edits.service.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PendingEditsService } from './pending-edits.service';
import { ClipService } from '../../../core/services/clip.service';
import { CutRegionService } from './cut-region.service';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1', projectId: 'p1', name: 'test', startTime: 0, endTime: 10,
    segments: [{
      id: 's1', clipId: 'c1', text: '', tags: [], startTime: 0, endTime: 10,
      words: [
        { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false },
        { id: 'w1', segmentId: 's1', text: 'world', startTime: 1, endTime: 1.5, isRemoved: true },
        { id: 'w2', segmentId: 's1', text: 'foo', startTime: 2, endTime: 2.5, isRemoved: false },
      ],
    }],
    cutRegions: [],
    ...overrides,
  };
}

describe('PendingEditsService', () => {
  let svc: PendingEditsService;
  let clipServiceSpy: jasmine.SpyObj<ClipService>;

  beforeEach(() => {
    clipServiceSpy = jasmine.createSpyObj('ClipService', ['updateCutRegions', 'updateWordStates', 'applyLocalUpdate'], {
      clips: { value: [] },
    });
    clipServiceSpy.updateCutRegions.and.returnValue(of({} as Clip));
    clipServiceSpy.updateWordStates.and.returnValue(of({} as Clip));

    TestBed.configureTestingModule({
      providers: [
        PendingEditsService,
        CutRegionService,
        { provide: ClipService, useValue: clipServiceSpy },
      ],
    });
    svc = TestBed.inject(PendingEditsService);
  });

  it('hasPending returns false with no pending regions or text', () => {
    const clip = makeClip({ cutRegions: [
      { id: 'r1', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false, effectDuration: 0, durationFixed: false }
    ]});
    expect(svc.hasPending(clip)).toBe(false);
  });

  it('hasPending returns true with pending-add region', () => {
    const clip = makeClip({ cutRegions: [
      { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
        effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' }
    ]});
    expect(svc.hasPending(clip)).toBe(true);
  });

  it('pendingCount counts cuts, restores, text edits', () => {
    const clip = makeClip({
      cutRegions: [
        { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' },
        { id: 'r2', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'remove', pendingTargetId: 'committed' },
      ],
      segments: [{
        id: 's1', clipId: 'c1', text: '', tags: [], startTime: 0, endTime: 10,
        words: [
          { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false, pendingText: 'hi' },
          { id: 'w1', segmentId: 's1', text: 'world', startTime: 1, endTime: 1.5, isRemoved: true },
          { id: 'w2', segmentId: 's1', text: 'foo', startTime: 2, endTime: 2.5, isRemoved: false },
        ],
      }],
    });
    const counts = svc.pendingCount(clip);
    expect(counts.cuts).toBe(1);
    expect(counts.restores).toBe(1);
    expect(counts.texts).toBe(1);
    expect(counts.total).toBe(3);
  });

  it('discardAll removes pending regions and clears pendingText', () => {
    const clip = makeClip({
      cutRegions: [
        { id: 'committed', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false, effectDuration: 0, durationFixed: false },
        { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' },
      ],
      segments: [{
        id: 's1', clipId: 'c1', text: '', tags: [], startTime: 0, endTime: 10,
        words: [
          { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false, pendingText: 'hi' },
          { id: 'w1', segmentId: 's1', text: 'world', startTime: 1, endTime: 1.5, isRemoved: true },
        ],
      }],
    });
    const result = svc.discardAll(clip);
    expect(result.cutRegions.every(r => !r.pending)).toBe(true);
    expect(result.segments[0].words[0].pendingText).toBeUndefined();
  });

  it('applyAll strips pending fields, commits regions, saves', (done) => {
    const clip = makeClip({
      cutRegions: [
        { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' },
      ],
    });
    svc.applyAll(clip).subscribe(() => {
      const saved = clipServiceSpy.updateCutRegions.calls.mostRecent().args[1] as CutRegion[];
      expect(saved.every((r: CutRegion) => !r.pending)).toBe(true);
      done();
    });
  });

  it('applyAll removes committed region when pending-remove targets it', (done) => {
    const clip = makeClip({
      cutRegions: [
        { id: 'committed', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false, effectDuration: 0, durationFixed: false },
        { id: 'pr1', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'remove', pendingTargetId: 'committed' },
      ],
    });
    svc.applyAll(clip).subscribe(() => {
      const saved = clipServiceSpy.updateCutRegions.calls.mostRecent().args[1] as CutRegion[];
      expect(saved.find((r: CutRegion) => r.id === 'committed')).toBeUndefined();
      done();
    });
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd client && npx ng test --include='**/pending-edits.service.spec.ts' --watch=false 2>&1 | tail -10
```

Expected: FAILED — module not found.

- [ ] **Step 3: Implement PendingEditsService**

Create `client/src/app/features/studio/txt-media-player/pending-edits.service.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests**

```bash
cd client && npx ng test --include='**/pending-edits.service.spec.ts' --watch=false 2>&1 | tail -20
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/pending-edits.service.ts \
        client/src/app/features/studio/txt-media-player/pending-edits.service.spec.ts
git commit -m "feat: add PendingEditsService with applyAll/discardAll/selection variants"
```

---

### Task 9: V2 Component — state, logic, mode wiring

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

This task modifies the TypeScript class only (not template). The component is large — only the listed locations change.

- [ ] **Step 1: Update imports**

At the top of the file, add new imports:

```typescript
import { SettingsService } from '../../../core/services/settings.service';
import { PendingEditsService } from '../txt-media-player/pending-edits.service';
import { SmartEffectService } from '../txt-media-player/smart-effect.service';
```

Remove `HostListener` from the Angular imports since CLAUDE.md says not to use it. The existing two `@HostListener` usages need to move to the `host` object in `@Component`. Update:

```typescript
@Component({
  selector: 'app-txt-media-player-v2',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, SegmentMetadataPanelComponent],
  host: {
    '(window:mousemove)': 'onMouseMove($event)',
    '(window:mouseup)': 'onMouseUp()',
  },
  template: `...`, // unchanged
  styleUrl: './txt-media-player-v2.component.scss'
})
```

Remove `HostListener` from the Angular core import line.

- [ ] **Step 2: Rename editMode → textEditMode throughout**

In the class body, rename `readonly editMode = signal(false)` → `readonly textEditMode = signal(false)`.

In the template, replace all `editMode()` → `textEditMode()` and `editMode.set(...)` → `textEditMode.set(...)`. (Approximately 15 occurrences — use find/replace.)

- [ ] **Step 3: Add new signals + computed**

After the existing `readonly moreMenuOpen` signal, add:

```typescript
readonly editModeOverride = signal<'live' | 'apply' | null>(null);
readonly editingMode = computed<'live' | 'apply'>(() =>
  this.editModeOverride() ?? this.settings.defaultEditMode()
);
readonly applyMenuOpen = signal(false);
```

- [ ] **Step 4: Inject new services in constructor**

Update the constructor:

```typescript
constructor(
  private clipService: ClipService,
  readonly projectService: ProjectService,
  private mediaPlayer: MediaPlayerService,
  private editHistory: EditHistoryService,
  private keyboardShortcuts: KeyboardShortcutsService,
  private cutRegionService: CutRegionService,
  readonly effectPlayer: EffectPlayerService,
  readonly settings: SettingsService,
  readonly pendingEdits: PendingEditsService,
) {
  // ... existing body unchanged
}
```

- [ ] **Step 5: Add applyPending, discardPending, applySelected, discardSelected methods**

Add after `resetRegionEffect`:

```typescript
applyPending(): void {
  const clip = this.clip();
  if (!this.pendingEdits.hasPending(clip)) return;
  const clipBefore = clip;
  this.pendingEdits.applyAll(clip).subscribe(appliedClip => {
    this.clipService.applyLocalUpdate(appliedClip);
    this.editHistory.record({ kind: 'apply-batch', clipBefore, clipAfter: appliedClip });
    this.editVersion.update(v => v + 1);
    this.applyMenuOpen.set(false);
  });
}

discardPending(): void {
  const clip = this.clip();
  const count = this.pendingEdits.pendingCount(clip).total;
  if (count > 5 && !confirm(`Discard all ${count} pending edits?`)) return;
  const discarded = this.pendingEdits.discardAll(clip);
  this.clipService.applyLocalUpdate(discarded);
  this.editVersion.update(v => v + 1);
  this.applyMenuOpen.set(false);
}

applySelected(): void {
  const ids = this.selectedWordIds();
  if (!ids.length) return;
  const clip = this.clip();
  const clipBefore = clip;
  this.pendingEdits.applySelection(clip, ids).subscribe(appliedClip => {
    this.clipService.applyLocalUpdate(appliedClip);
    this.editHistory.record({ kind: 'apply-batch', clipBefore, clipAfter: appliedClip });
    this.editVersion.update(v => v + 1);
    this.applyMenuOpen.set(false);
  });
}

discardSelected(): void {
  const ids = this.selectedWordIds();
  if (!ids.length) return;
  const discarded = this.pendingEdits.discardSelection(this.clip(), ids);
  this.clipService.applyLocalUpdate(discarded);
  this.editVersion.update(v => v + 1);
  this.applyMenuOpen.set(false);
}
```

- [ ] **Step 6: Add setEditingMode method (handles auto-apply on switch)**

```typescript
setEditingMode(mode: 'live' | 'apply'): void {
  const current = this.editingMode();
  if (current === mode) return;
  if (current === 'apply' && this.pendingEdits.hasPending(this.clip())) {
    this.applyPending(); // auto-apply then switch
  }
  this.editModeOverride.set(mode);
}
```

- [ ] **Step 7: Modify removeSelected, restoreSelected, toggleRemove to pass pending flag**

```typescript
removeSelected(): void {
  if (!this.selectedWordIds().length) return;
  const pending = this.editingMode() === 'apply';
  this.applyCutRegionChange(
    this.cutRegionService.cut(this.clip(), this.selectedWordIds(), this.defaultEffectType(), pending)
  );
  this.selectedWordIds.set([]);
}

restoreSelected(): void {
  if (!this.selectedWordIds().length) return;
  const pending = this.editingMode() === 'apply';
  this.applyCutRegionChange(
    this.cutRegionService.restore(this.clip(), this.selectedWordIds(), pending)
  );
  this.selectedWordIds.set([]);
}

toggleRemove(word: Word): void {
  if (this.textEditMode()) return;
  const pending = this.editingMode() === 'apply';
  if (word.isRemoved) {
    this.applyCutRegionChange(this.cutRegionService.restore(this.clip(), [word.id], pending));
  } else {
    this.applyCutRegionChange(this.cutRegionService.cut(this.clip(), [word.id], this.defaultEffectType(), pending));
  }
}
```

- [ ] **Step 8: Modify applyCutRegionChange — skip save when pending**

```typescript
private applyCutRegionChange(result: { clip: Clip; entry: CutHistoryEntry }): void {
  this.clipService.applyLocalUpdate(result.clip);
  this.editHistory.record(result.entry);
  this.editVersion.update(v => v + 1);
  if (this.editingMode() === 'live') {
    this.saveCutRegions();
  }
}
```

- [ ] **Step 9: Modify onWordTextBlur for pending text**

Replace `onWordTextBlur`:

```typescript
onWordTextBlur(word: Word, event: FocusEvent): void {
  if (!this.textEditMode()) return;
  const el = event.target as HTMLElement;
  const newText = el.innerText.trim();

  if (this.editingMode() === 'apply') {
    if (newText === word.text || newText === word.pendingText) return;
    const newClip = { ...this.clip() };
    const target = newClip.segments.flatMap(s => s.words).find(w => w.id === word.id);
    if (target) {
      target.pendingText = newText;
      this.clipService.applyLocalUpdate(newClip);
      this.editVersion.update(v => v + 1);
    }
    return;
  }

  // Live mode
  if (newText === word.text) return;
  const newClip = { ...this.clip() };
  const words = newClip.segments.flatMap(s => s.words);
  const target = words.find(w => w.id === word.id);
  if (target) {
    target.text = newText;
    target.isEdited = true;
    this.clipService.applyLocalUpdate(newClip);
    this.editVersion.update(v => v + 1);
    this.clipService.updateWordStates(newClip.id, [{ id: target.id, text: target.text, isEdited: true }]).subscribe();
  }
}
```

- [ ] **Step 10: Auto-apply on clip change (add clipSyncWatch update)**

The existing `clipSyncWatch` effect already fires on clip change. Add a separate effect for auto-apply:

```typescript
private readonly editModeClipWatch = effect(() => {
  const clip = this.clip();
  // when clip changes, reset override and the old clip's pending is handled by destroy
  this.editModeOverride.set(null);
}, { allowSignalWrites: true });
```

For in-flight pending, add to `ngOnDestroy`:

```typescript
ngOnDestroy(): void {
  // auto-apply any pending edits before leaving
  if (this.pendingEdits.hasPending(this.clip())) {
    this.pendingEdits.applyAll(this.clip()).subscribe();
  }
  // ... rest of existing cleanup unchanged
}
```

- [ ] **Step 11: Update applyJumpCut to pass clip to playEffect**

In `applyJumpCut`:

```typescript
this.effectPlayer.playEffect(r, this.clip()).subscribe({
```

- [ ] **Step 12: Build check**

```bash
cd client && npx ng build --configuration=development 2>&1 | grep -E "ERROR|error" | head -20
```

Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat: wire Live/Apply editing mode, pending cut/restore/text into V2 component"
```

---

### Task 10: V2 Component — template + SCSS

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` (template section)
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

- [ ] **Step 1: Add Live/Apply segmented pill to header**

In the template, inside `.header-row1 > .hdr-group` (the group containing the edit/smart-cut buttons), add before the edit button:

```html
<!-- Live / Apply mode toggle -->
<div class="edit-mode-toggle" role="group" aria-label="Editing mode">
  <button class="mode-pill"
    [class.active]="editingMode() === 'live'"
    (click)="setEditingMode('live')"
    title="Live: changes apply immediately">Live</button>
  <button class="mode-pill"
    [class.active]="editingMode() === 'apply'"
    (click)="setEditingMode('apply')"
    title="Apply: changes are staged until you click Apply">Apply</button>
</div>
```

- [ ] **Step 2: Update effect pills to new names + add Smart**

Replace the effect-pills-wrap block in the selection toolbar:

```html
<div class="effect-pills-wrap">
  <button class="effect-pill" [class.active]="defaultEffectType() === 'clear-cut'"
    (click)="setDefaultEffect('clear-cut')" title="Clear Cut">
    <span class="material-symbols-outlined" style="font-size:1rem">content_cut</span>
  </button>
  <button class="effect-pill" [class.active]="defaultEffectType() === 'fade-in'"
    (click)="setDefaultEffect('fade-in')" title="Fade In">
    <span class="material-symbols-outlined" style="font-size:1rem">blur_on</span>
  </button>
  <button class="effect-pill" [class.active]="defaultEffectType() === 'cross-cut'"
    (click)="setDefaultEffect('cross-cut')" title="Cross Cut">
    <span class="material-symbols-outlined" style="font-size:1rem">shuffle</span>
  </button>
  <button class="effect-pill" [class.active]="defaultEffectType() === 'smart'"
    (click)="setDefaultEffect('smart')" title="Smart (auto)">
    <span class="material-symbols-outlined" style="font-size:1rem">auto_awesome</span>
  </button>
</div>
```

Update the per-region popover (effect-popover ep-pills):

```html
<div class="ep-pills" role="group" aria-label="Effect type">
  <button class="ep-pill" [class.active]="region.effectType === 'clear-cut'"
    (click)="setRegionEffect(region.id, 'clear-cut')">Clear Cut</button>
  <button class="ep-pill" [class.active]="region.effectType === 'fade-in'"
    (click)="setRegionEffect(region.id, 'fade-in')">Fade In</button>
  <button class="ep-pill" [class.active]="region.effectType === 'cross-cut'"
    (click)="setRegionEffect(region.id, 'cross-cut')">Cross</button>
  <button class="ep-pill" [class.active]="region.effectType === 'smart'"
    (click)="setRegionEffect(region.id, 'smart')">Smart</button>
</div>
```

Update the `ep-dur-row` guard — `smart` can have duration too (it may resolve to fade-in):

```html
@if (region.effectType !== 'clear-cut') {
```

- [ ] **Step 3: Add pending styling class bindings to words**

For active words (`.word` span), add class bindings:

```html
<span class="word"
  [class.pending-text]="!!fi.word.pendingText"
  [title]="fi.word.pendingText ? 'Original: ' + fi.word.text : (editMode() ? 'Click to edit' : 'Double-click to remove')"
  ...
>{{ fi.word.pendingText ?? fi.word.text }}</span>
```

For removed words (`.filler-badge`), add class binding:

```html
<span class="filler-badge"
  [class.pending-add]="wordIdToRegion().get(fi.word.id)?.pending && wordIdToRegion().get(fi.word.id)?.pendingKind === 'add'"
  ...
>
```

- [ ] **Step 4: Add floating Apply pill to preview-area**

In the `.preview-area` div, add after the `video-frame` div:

```html
@if (pendingEdits.hasPending(clip())) {
  <div class="apply-pill-wrap">
    <button class="apply-pill-btn" (click)="applyPending()" (contextmenu)="applyMenuOpen.set(true); $event.preventDefault()">
      Apply ({{ pendingEdits.pendingCount(clip()).total }})
    </button>
    <button class="apply-pill-chevron" (click)="applyMenuOpen.set(!applyMenuOpen())" aria-label="Pending actions menu">
      <span class="material-symbols-outlined">expand_more</span>
    </button>
    @if (applyMenuOpen()) {
      <div class="apply-menu popover" (click)="$event.stopPropagation()">
        <button class="apply-menu-item" (click)="discardPending()">
          <span class="material-symbols-outlined">delete_sweep</span>
          Discard all
        </button>
        @if (selectedCount() > 0) {
          <button class="apply-menu-item" (click)="applySelected()">
            <span class="material-symbols-outlined">check</span>
            Apply selected
          </button>
          <button class="apply-menu-item" (click)="discardSelected()">
            <span class="material-symbols-outlined">close</span>
            Discard selected
          </button>
        }
      </div>
    }
  </div>
}
```

- [ ] **Step 5: Add SCSS for new UI elements**

In `txt-media-player-v2.component.scss`, append:

```scss
/* ── Edit Mode Toggle ─────────────────────────────── */
.edit-mode-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}
.mode-pill {
  padding: .25rem .6rem;
  font-size: .72rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-muted);
  transition: all .15s;
  &.active {
    background: var(--color-accent);
    color: #fff;
  }
  &:hover:not(.active) { background: var(--color-border); }
}

/* ── Pending Word Styles ──────────────────────────── */
.word.pending-text {
  text-decoration: underline dashed #f59e0b 1.5px;
  text-underline-offset: 3px;
}
.word.pending-text::before {
  content: '*';
  color: #f59e0b;
  font-size: .7em;
  margin-right: 1px;
}
.filler-badge.pending-add {
  border: 1px dashed #f59e0b;
  background: rgba(245, 158, 11, .12);
  color: var(--color-text);
  .filler-text { text-decoration: line-through dashed #f59e0b; }
}

/* ── Floating Apply Pill ──────────────────────────── */
.preview-area { position: relative; }
.apply-pill-wrap {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  border-radius: 999px;
  overflow: visible;
  z-index: 10;
  animation: applyPulse 1.8s ease-in-out infinite;
}
@keyframes applyPulse {
  0%   { box-shadow: 0 0 0 0 rgba(245, 158, 11, .45); }
  70%  { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
  100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}
.apply-pill-btn {
  padding: .35rem .9rem;
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: 999px 0 0 999px;
  font-size: .8rem;
  font-weight: 600;
  cursor: pointer;
  &:hover { filter: brightness(1.1); }
}
.apply-pill-chevron {
  padding: .35rem .45rem;
  background: color-mix(in srgb, var(--color-accent) 85%, #000);
  color: #fff;
  border: none;
  border-radius: 0 999px 999px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  &:hover { filter: brightness(1.15); }
  .material-symbols-outlined { font-size: 1rem; }
}
.apply-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: .35rem 0;
  box-shadow: 0 4px 16px rgba(0,0,0,.25);
  z-index: 20;
}
.apply-menu-item {
  display: flex;
  align-items: center;
  gap: .5rem;
  width: 100%;
  padding: .45rem .85rem;
  background: none;
  border: none;
  font-size: .82rem;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
  .material-symbols-outlined { font-size: 1rem; color: var(--color-muted); }
  &:hover { background: var(--color-surface-alt); }
}

/* ── Smart effect dot update ──────────────────────── */
.effect-dot--smart {
  background: linear-gradient(135deg, var(--color-accent), #a78bfa);
}
```

- [ ] **Step 6: Build and smoke-test**

```bash
cd client && npx ng build --configuration=development 2>&1 | grep -E "ERROR|error" | head -10
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/
git commit -m "feat: update V2 template + SCSS for Live/Apply toggle, pending styles, Apply pill, Smart effect"
```

---

### Task 11: Settings Panel — Default Edit Mode row

**Files:**
- Modify: `client/src/app/features/onboarding/settings-panel/settings-panel.component.ts`
- Read first: `client/src/app/features/onboarding/settings-panel/settings-panel.component.html`

- [ ] **Step 1: Read the settings panel HTML template**

```bash
cat "client/src/app/features/onboarding/settings-panel/settings-panel.component.html"
```

Identify where setting rows are rendered (likely an `@for` over keys).

- [ ] **Step 2: Add a custom row for DEFAULT_EDIT_MODE**

In `settings-panel.component.ts`, inject `SettingsService`:

```typescript
import { SettingsService } from '../../../core/services/settings.service';

// inject in constructor (already has settingsService — just add:)
constructor(
  private settingsService: SettingsService,
) {}
```

`SettingsService` is already injected. Expose the signal:

```typescript
readonly defaultEditMode = this.settingsService.defaultEditMode;
```

- [ ] **Step 3: Add segmented toggle row in HTML**

In the template, before or after the `@for` loop of generic settings rows, add:

```html
<!-- Default Edit Mode — custom segmented toggle -->
<div class="setting-row">
  <div class="setting-label">
    <span>Default Edit Mode</span>
    <span class="setting-desc">Live: changes apply immediately. Apply: changes are staged.</span>
  </div>
  <div class="edit-mode-toggle" role="group" aria-label="Default editing mode">
    <button class="mode-pill" [class.active]="defaultEditMode() === 'live'"
      (click)="settingsService.saveDefaultEditMode('live')">Live</button>
    <button class="mode-pill" [class.active]="defaultEditMode() === 'apply'"
      (click)="settingsService.saveDefaultEditMode('apply')">Apply</button>
  </div>
</div>
```

Add minimal CSS to the settings panel stylesheet (or inline) for `.edit-mode-toggle` and `.mode-pill` — reuse the same styles as the player component (copy the small block from Task 10 Step 5).

Also, exclude `DEFAULT_EDIT_MODE` from the generic `@for` loop so it doesn't render as a text input:

```typescript
readonly keys = (Object.keys(SETTING_META) as SettingKey[]).filter(k => k !== 'DEFAULT_EDIT_MODE');
```

- [ ] **Step 4: Build check**

```bash
cd client && npx ng build --configuration=development 2>&1 | grep -E "ERROR|error" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/onboarding/settings-panel/
git commit -m "feat: add Default Edit Mode segmented toggle in settings panel"
```

---

## Self-Review

### Spec coverage check

| Spec section | Covered by task |
|---|---|
| EffectType rename | Task 1, 7 |
| Smart effect heuristic | Task 6 |
| CutRegion pending fields | Task 1, 4 |
| Word.pendingText | Task 1, 9 |
| SettingsService defaultEditMode | Task 3 |
| Live/Apply mode toggle (header) | Task 10 |
| Settings panel global toggle | Task 11 |
| Per-clip override signal | Task 9 |
| syncIsRemoved three-set formula | Task 4 |
| pending-add merge logic | Task 4 |
| pending-remove of committed regions | Task 4 |
| PendingEditsService applyAll/discard | Task 8 |
| applyAll strips client fields | Task 8 |
| apply-batch history entry + undo/redo | Task 5 |
| Floating Apply pill | Task 10 |
| Apply/Discard/ApplySelected/DiscardSelected | Task 9, 10 |
| Auto-apply on mode switch | Task 9 |
| Auto-apply on clip change | Task 9 |
| Auto-apply on destroy | Task 9 |
| Playback uses pending state | Task 4 (syncIsRemoved) |
| Pending amber dashed styles | Task 10 |
| Timeline overlay pending style | Task 10 (effect-dot--smart; overlay CSS left as future follow-up — dashed pending timeline border can be added to `.cut-region-overlay.pending` in the SCSS block) |
| Server EffectType normalization | Task 2 |

**Gap found:** Timeline overlay pending style (dashed amber border on `.cut-region-overlay` for pending regions). Add to Task 10 SCSS:

```scss
.cut-region-overlay.pending {
  border: 1px dashed #f59e0b !important;
  background: rgba(245, 158, 11, .08) !important;
}
```

Add `[class.pending]="overlay.isPending"` to the overlay div in the template, and expose `isPending` in `cutRegionOverlays` computed by checking `region.pending === true`.

This is a small addition — do it in Task 10 Step 5.

**Gap found:** `changeDetection: ChangeDetectionStrategy.OnPush` is required by CLAUDE.md but V2 component doesn't have it. Add when modifying the `@Component` decorator in Task 9 Step 1.

### Placeholder scan

No TBDs, no TODOs in plan. All code blocks are complete.

### Type consistency

- `EffectType` values used: `'clear-cut'`, `'fade-in'`, `'cross-cut'`, `'smart'` — consistent throughout all tasks.
- `CutRegion.pending?: boolean`, `pendingKind?: 'add' | 'remove'`, `pendingTargetId?: string` — defined Task 1, used Tasks 4, 8, 9.
- `Word.pendingText?: string` — defined Task 1, used Tasks 9, 8.
- `CutHistoryEntry` union extended Task 5, consumed in V2 component Task 9 via `editHistory.record(...)`.
- `PendingEditsService.hasPending/pendingCount/applyAll/discardAll/applySelection/discardSelection` — defined Task 8, used Task 9.
- `SmartEffectService.resolve(clip, region)` — defined Task 6, used Task 7.
- `EffectPlayerService.playEffect(region, clip?)` — updated Task 7, called Task 9 with `this.clip()`.
- `SettingsService.defaultEditMode`, `saveDefaultEditMode` — defined Task 3, used Tasks 9, 11.
