# Seamless Word Cuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make word-level cuts sound continuous by (A) snapping cut boundaries into silence midpoints and (B) applying a 30ms audio micro-fade at every cut point.

**Architecture:** Technique A is a pure function `computeSeamlessBoundaries()` called in `CutRegionService.cut()` that writes `startTime`/`endTime` onto the region — the existing player already reads these. Technique B is a private `applyMicroFadeIn()` method added to `EffectPlayerService` and called in the `clear-cut` and `fade-in` branches of `playResolvedEffect()`.

**Tech Stack:** Angular 21 (signals, standalone, OnPush), RxJS 7, Web Audio API, Vitest 4, jsdom 28. Tests run with `ng test` (or `ng test --include="**/filename.spec.ts"` for a single file).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut.constants.ts` | Add 3 new constants |
| Create | `client/src/app/features/studio/txt-media-player/seamless-boundaries.ts` | Pure fn `computeSeamlessBoundaries` |
| Create | `client/src/app/features/studio/txt-media-player/seamless-boundaries.spec.ts` | Unit tests for the pure fn |
| Modify | `client/src/app/features/studio/txt-media-player/cut-region.service.ts` | Call `computeSeamlessBoundaries` in `cut()` |
| Modify | `client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts` | Tests verifying silence-snap sets `startTime`/`endTime` |
| Modify | `client/src/app/features/studio/txt-media-player/effect-player.service.ts` | Add `applyMicroFadeIn()`; update `clear-cut` and `fade-in` branches |
| Modify | `client/src/app/features/studio/txt-media-player/effect-player.service.spec.ts` | Verify `clear-cut` and `fade-in` observable timing unchanged |

---

## Task 1 — Add constants

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/smart-cut.constants.ts`

- [ ] **Step 1: Append the three new constants at the end of the file**

Open `smart-cut.constants.ts`. After the last existing export line, add:

```typescript
export const SILENCE_SNAP_MIN_MS   = 40;
export const SILENCE_SNAP_FRACTION = 0.5;
export const CUT_MICRO_FADE_MS     = 30;
```

- [ ] **Step 2: Run tests to verify nothing broke**

```
cd client && ng test --include="**/smart-cut.constants.ts" 2>&1 | head -5
```

No test file for constants — just confirm the build compiles:

```
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/smart-cut.constants.ts
git commit -m "feat(seamless-cuts): add SILENCE_SNAP_MIN_MS, SILENCE_SNAP_FRACTION, CUT_MICRO_FADE_MS constants"
```

---

## Task 2 — `computeSeamlessBoundaries` pure function (TDD)

**Files:**
- Create: `client/src/app/features/studio/txt-media-player/seamless-boundaries.ts`
- Create: `client/src/app/features/studio/txt-media-player/seamless-boundaries.spec.ts`

- [ ] **Step 1: Write the spec file first**

Create `client/src/app/features/studio/txt-media-player/seamless-boundaries.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeSeamlessBoundaries } from './seamless-boundaries';
import { Word } from '../../../core/models/word.model';

function w(id: string, start: number, end: number, removed = false): Word {
  return { id, segmentId: 's1', text: id, startTime: start, endTime: end, isRemoved: removed };
}

describe('computeSeamlessBoundaries', () => {
  it('snaps both edges when silence >= 40ms on each side', () => {
    // pre-silence: 1.15 - 1.0 = 150ms → snap to 1.075
    // post-silence: 3.1 - 3.0 = 100ms → snap to 3.05
    const words = [w('a', 0, 1.0), w('b', 1.15, 2.0), w('c', 2.1, 3.0), w('d', 3.1, 4.0)];
    const result = computeSeamlessBoundaries(words, ['b', 'c']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(1.075, 4); // 1.0 + (1.15-1.0)*0.5
    expect(result!.endTime).toBeCloseTo(3.05, 4);    // 3.0 + (3.1-3.0)*0.5
  });

  it('returns null when both silences < 40ms (no snap useful)', () => {
    const words = [w('a', 0, 1.0), w('b', 1.01, 2.0), w('c', 2.01, 3.0), w('d', 3.01, 4.0)];
    expect(computeSeamlessBoundaries(words, ['b', 'c'])).toBeNull();
  });

  it('snaps only the pre-cut edge when only that silence >= 40ms', () => {
    // pre: 1.1 - 1.0 = 100ms → snap; post: 3.005 - 3.0 = 5ms → no snap
    const words = [w('a', 0, 1.0), w('b', 1.1, 2.0), w('c', 2.1, 3.0), w('d', 3.005, 4.0)];
    const result = computeSeamlessBoundaries(words, ['b', 'c']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(1.05, 4);  // snapped
    expect(result!.endTime).toBeCloseTo(3.0, 4);     // = regionEnd, no snap
  });

  it('snaps only the post-cut edge when only that silence >= 40ms', () => {
    // pre: 1.005 - 1.0 = 5ms → no snap; post: 3.1 - 3.0 = 100ms → snap
    const words = [w('a', 0, 1.0), w('b', 1.005, 2.0), w('c', 2.1, 3.0), w('d', 3.1, 4.0)];
    const result = computeSeamlessBoundaries(words, ['b', 'c']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(1.005, 4); // = regionStart, no snap
    expect(result!.endTime).toBeCloseTo(3.05, 4);    // snapped
  });

  it('ignores isRemoved words when finding adjacent words', () => {
    // w_a is removed; wordBefore should be w_b (active)
    // pre: 2.2 - 2.0 = 200ms → snap to 2.1
    const words = [w('wa', 0, 0.5, true), w('wb', 1.0, 2.0), w('wc', 2.2, 3.0), w('wd', 3.1, 4.0)];
    const result = computeSeamlessBoundaries(words, ['wc']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(2.1, 4);   // 2.0 + (2.2-2.0)*0.5
    expect(result!.endTime).toBeCloseTo(3.05, 4);    // 3.0 + (3.1-3.0)*0.5
  });

  it('handles cut at start of clip (no wordBefore) — only snaps endTime', () => {
    // no wordBefore → startTime unchanged (= regionStart = 0)
    // post: 1.2 - 1.0 = 200ms → snap to 1.1
    const words = [w('wa', 0, 1.0), w('wb', 1.2, 2.0)];
    const result = computeSeamlessBoundaries(words, ['wa']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(0, 4);    // no change
    expect(result!.endTime).toBeCloseTo(1.1, 4);    // 1.0 + 0.2*0.5
  });

  it('handles cut at end of clip (no wordAfter) — only snaps startTime', () => {
    // pre: 2.2 - 2.0 = 200ms → snap to 2.1; no wordAfter
    const words = [w('wa', 0, 2.0), w('wb', 2.2, 3.0)];
    const result = computeSeamlessBoundaries(words, ['wb']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(2.1, 4);  // snapped
    expect(result!.endTime).toBeCloseTo(3.0, 4);    // no wordAfter → = regionEnd
  });

  it('returns null for empty regionWordIds', () => {
    expect(computeSeamlessBoundaries([w('a', 0, 1)], [])).toBeNull();
  });

  it('returns null when regionWordIds not found in allWords', () => {
    expect(computeSeamlessBoundaries([w('a', 0, 1)], ['nonexistent'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the spec — verify it fails (file does not exist yet)**

```
cd client && ng test --include="**/seamless-boundaries.spec.ts" 2>&1 | tail -20
```

Expected: error like `Cannot find module './seamless-boundaries'`.

- [ ] **Step 3: Create the implementation**

Create `client/src/app/features/studio/txt-media-player/seamless-boundaries.ts`:

```typescript
import { Word } from '../../../core/models/word.model';
import { SILENCE_SNAP_MIN_MS, SILENCE_SNAP_FRACTION } from './smart-cut.constants';

export interface SeamlessBoundaries {
  startTime: number;
  endTime: number;
}

export function computeSeamlessBoundaries(
  allWords: Word[],
  regionWordIds: string[],
): SeamlessBoundaries | null {
  if (!regionWordIds.length) return null;

  const regionSet = new Set(regionWordIds);
  const regionWords = allWords.filter(w => regionSet.has(w.id));
  if (!regionWords.length) return null;

  const regionStart = Math.min(...regionWords.map(w => w.startTime));
  const regionEnd   = Math.max(...regionWords.map(w => w.endTime));

  const outsideActive = allWords.filter(w => !regionSet.has(w.id) && !w.isRemoved);

  const wordBefore = outsideActive
    .filter(w => w.endTime <= regionStart)
    .sort((a, b) => b.endTime - a.endTime)[0];

  const wordAfter = outsideActive
    .filter(w => w.startTime >= regionEnd)
    .sort((a, b) => a.startTime - b.startTime)[0];

  const preSilenceMs  = wordBefore ? (regionStart - wordBefore.endTime) * 1000 : 0;
  const postSilenceMs = wordAfter  ? (wordAfter.startTime - regionEnd)  * 1000 : 0;

  const snapStart = (preSilenceMs >= SILENCE_SNAP_MIN_MS && wordBefore)
    ? wordBefore.endTime + (regionStart - wordBefore.endTime) * SILENCE_SNAP_FRACTION
    : regionStart;

  const snapEnd = (postSilenceMs >= SILENCE_SNAP_MIN_MS && wordAfter)
    ? regionEnd + (wordAfter.startTime - regionEnd) * SILENCE_SNAP_FRACTION
    : regionEnd;

  if (snapStart === regionStart && snapEnd === regionEnd) return null;

  return { startTime: snapStart, endTime: snapEnd };
}
```

- [ ] **Step 4: Run spec — verify all tests pass**

```
cd client && ng test --include="**/seamless-boundaries.spec.ts" 2>&1 | tail -20
```

Expected: all 8 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/seamless-boundaries.ts \
        client/src/app/features/studio/txt-media-player/seamless-boundaries.spec.ts
git commit -m "feat(seamless-cuts): add computeSeamlessBoundaries pure function with tests"
```

---

## Task 3 — Wire silence-snap into `CutRegionService.cut()`

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/cut-region.service.ts`
- Modify: `client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts`

- [ ] **Step 1: Write failing tests first**

Open `cut-region.service.spec.ts`. Add a new `describe` block after the existing `cut()` describe:

```typescript
import { computeSeamlessBoundaries } from './seamless-boundaries'; // add to existing imports

// ... (existing tests unchanged) ...

describe('cut() — silence-snap', () => {
  it('sets startTime/endTime to silence midpoints when gap >= 40ms', () => {
    // gap before cut: 1.15 - 1.0 = 150ms; gap after cut: 3.1 - 3.0 = 100ms
    const clip = makeClip([
      { id: 'w0', startTime: 0,    endTime: 1.0  },
      { id: 'w1', startTime: 1.15, endTime: 2.0  },
      { id: 'w2', startTime: 2.1,  endTime: 3.0  },
      { id: 'w3', startTime: 3.1,  endTime: 4.0  },
    ]);
    const { clip: result } = svc.cut(clip, ['w1', 'w2'], 'clear-cut');
    const region = result.cutRegions[0];
    expect(region.startTime).toBeCloseTo(1.075, 4); // 1.0 + 0.15*0.5
    expect(region.endTime).toBeCloseTo(3.05, 4);    // 3.0 + 0.1*0.5
  });

  it('leaves startTime/endTime undefined when silence < 40ms', () => {
    // gaps of 10ms — too small to snap
    const clip = makeClip([
      { id: 'w0', startTime: 0,    endTime: 1.0   },
      { id: 'w1', startTime: 1.01, endTime: 2.0   },
      { id: 'w2', startTime: 2.01, endTime: 3.0   },
      { id: 'w3', startTime: 3.01, endTime: 4.0   },
    ]);
    const { clip: result } = svc.cut(clip, ['w1', 'w2'], 'clear-cut');
    const region = result.cutRegions[0];
    expect(region.startTime).toBeUndefined();
    expect(region.endTime).toBeUndefined();
  });

  it('preserves existing startTime/endTime on time-based (silence) regions already set', () => {
    // Time-based regions have no wordIds but explicit startTime/endTime
    // They never go through cut(), so this test verifies the guard in computeSeamlessBoundaries:
    // passing empty regionWordIds → returns null → no override.
    const clip = makeClip([
      { id: 'w0', startTime: 0, endTime: 1.0 },
      { id: 'w1', startTime: 2.0, endTime: 3.0 },
    ]);
    // Manually add a time-based region (as autoClean would)
    const silenceRegion = {
      id: 'sr1', wordIds: [] as string[], startTime: 1.0, endTime: 2.0,
      effectType: 'clear-cut' as const, effectTypeOverridden: false, effectDuration: 100, durationFixed: false,
    };
    const clipWithSilence = { ...clip, cutRegions: [silenceRegion] };
    // cut() a word region — the silence region should be unaffected
    const { clip: result } = svc.cut(clipWithSilence, ['w1'], 'fade-in');
    const silenceR = result.cutRegions.find(r => r.id === 'sr1')!;
    expect(silenceR.startTime).toBe(1.0); // unchanged
    expect(silenceR.endTime).toBe(2.0);   // unchanged
  });
});
```

- [ ] **Step 2: Run the new tests — verify they fail**

```
cd client && ng test --include="**/cut-region.service.spec.ts" 2>&1 | tail -25
```

Expected: "silence-snap" tests fail (region has no startTime/endTime yet), existing tests pass.

- [ ] **Step 3: Update `cut-region.service.ts` to wire in silence-snap**

Add the import at the top of `cut-region.service.ts` (after existing imports):

```typescript
import { computeSeamlessBoundaries } from './seamless-boundaries';
```

Then in the `cut()` method, immediately after the `regionAfter` object is built (before `const remaining = ...`), add:

```typescript
    // Silence-snap: set startTime/endTime to silence midpoints when gap is sufficient
    if (!pending) {
      const snapped = computeSeamlessBoundaries(allWords, mergedWordIds);
      if (snapped) {
        regionAfter.startTime = snapped.startTime;
        regionAfter.endTime   = snapped.endTime;
      }
    }
```

The complete `cut()` method body from `const regionAfter` to `return` should now look like:

```typescript
    const regionAfter: CutRegion = {
      id: touched[0]?.id ?? crypto.randomUUID(),
      wordIds: mergedWordIds,
      effectType: mergedEffectType,
      effectTypeOverridden: isOverridden,
      effectDuration: this.autoEffectDuration(removedMs),
      durationFixed: false,
      ...(pending ? { pending: true as const, pendingKind: 'add' as const } : {}),
    };

    // Silence-snap: set startTime/endTime to silence midpoints when gap is sufficient
    if (!pending) {
      const snapped = computeSeamlessBoundaries(allWords, mergedWordIds);
      if (snapped) {
        regionAfter.startTime = snapped.startTime;
        regionAfter.endTime   = snapped.endTime;
      }
    }

    const remaining = (clip.cutRegions ?? []).filter((r) => !touched.includes(r));
    const newClip = this.syncIsRemoved({ ...clip, cutRegions: [...remaining, regionAfter] });

    return { clip: newClip, entry: { kind: 'cut', regionAfter, regionsBefore: touched } };
```

- [ ] **Step 4: Run all cut-region service tests — verify all pass**

```
cd client && ng test --include="**/cut-region.service.spec.ts" 2>&1 | tail -25
```

Expected: all tests pass, including the new silence-snap tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/cut-region.service.ts \
        client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts
git commit -m "feat(seamless-cuts): wire silence-snap into CutRegionService.cut()"
```

---

## Task 4 — Micro-fade in `EffectPlayerService`

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/effect-player.service.ts`
- Modify: `client/src/app/features/studio/txt-media-player/effect-player.service.spec.ts`

**Background:** Web Audio `gainNode` is null in jsdom tests, so we can't assert on gain values. The tests verify observable *timing* is unchanged. Audio behaviour must be verified manually in browser.

- [ ] **Step 1: Write the new/updated tests first**

In `effect-player.service.spec.ts`, add a new describe block (existing tests remain unchanged):

```typescript
describe('micro-fade — observable timing unchanged', () => {
  it('clear-cut still emits regionEnd synchronously', async () => {
    svc = new EffectPlayerService(mockSmartEffect({ effectType: 'clear-cut', durationMs: 0 }));
    const region = makeRegion('clear-cut');
    let seekTo = -1;
    svc.playEffect(region, undefined, 7.25).subscribe(v => { seekTo = v; });
    await vi.runAllTimersAsync();
    expect(seekTo).toBe(7.25);
  });

  it('fade-in still emits regionEnd after durationMs', async () => {
    svc = new EffectPlayerService(mockSmartEffect({ effectType: 'fade-in', durationMs: 300 }));
    const region = makeRegion('smart'); // mock resolves to fade-in
    let seekTo = -1;
    svc.playEffect(region, {} as any, 4.0).subscribe(v => { seekTo = v; });
    // should NOT emit before 300ms
    await vi.advanceTimersByTimeAsync(299);
    expect(seekTo).toBe(-1);
    await vi.advanceTimersByTimeAsync(1);
    expect(seekTo).toBe(4.0);
  });
});
```

- [ ] **Step 2: Run the tests — verify they pass already (no implementation change yet)**

```
cd client && ng test --include="**/effect-player.service.spec.ts" 2>&1 | tail -25
```

Expected: all tests pass. These tests just confirm baseline timing — they should pass before and after the implementation change.

- [ ] **Step 3: Add the import and `applyMicroFadeIn` private method**

In `effect-player.service.ts`, add to the existing imports from `./smart-cut.constants`:

```typescript
import {
  SMART_CUT_AUDIO_FADEOUT_MS,
  SMART_CUT_AUDIO_FADEIN_MS,
  SMART_CUT_OVERLAY_FADE_MS,
  SMART_CUT_SEEK_TIMEOUT_MS,
  CUT_MICRO_FADE_MS,
} from './smart-cut.constants';
```

Then add this private method inside the class, after `clearOverlay()`:

```typescript
  private applyMicroFadeIn(): void {
    if (!this.gainNode || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(1, now + CUT_MICRO_FADE_MS / 1000);
  }
```

- [ ] **Step 4: Update `clear-cut` branch in `playResolvedEffect()`**

Find this block in `playResolvedEffect()`:

```typescript
    if (resolved.effectType === 'clear-cut') {
      return of(regionEnd);
    }
```

Replace with:

```typescript
    if (resolved.effectType === 'clear-cut') {
      this.applyMicroFadeIn();
      return of(regionEnd);
    }
```

- [ ] **Step 5: Update `fade-in` branch in `playResolvedEffect()`**

Find this block:

```typescript
    if (resolved.effectType === 'fade-in') {
      this.startFadeOut(resolved.durationMs);
      return timer(resolved.durationMs).pipe(
        tap(() => this.resetAll()),
        map(() => regionEnd)
      );
    }
```

Replace with:

```typescript
    if (resolved.effectType === 'fade-in') {
      this.startFadeOut(resolved.durationMs);
      return timer(resolved.durationMs).pipe(
        tap(() => {
          this.videoOpacity.set(1);
          this.videoFilter.set('none');
          this.applyMicroFadeIn();
        }),
        map(() => regionEnd)
      );
    }
```

(Previously `resetAll()` snapped gain to 1 before the component seek. Now `applyMicroFadeIn()` schedules a 30ms ramp from 0 to 1, which plays out as the component seeks.)

- [ ] **Step 6: Run all effect-player tests — verify all pass**

```
cd client && ng test --include="**/effect-player.service.spec.ts" 2>&1 | tail -25
```

Expected: all tests pass.

- [ ] **Step 7: Run the full test suite**

```
cd client && ng test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/effect-player.service.ts \
        client/src/app/features/studio/txt-media-player/effect-player.service.spec.ts
git commit -m "feat(seamless-cuts): add micro-fade to clear-cut and fade-in for click-free audio transitions"
```

---

## Manual Verification Checklist

After all tasks complete, test in browser:

1. Load a clip with several cuts
2. Play through a `clear-cut` region — should hear no click/pop at the cut point
3. Play through a `fade-in` region — audio should fade in smoothly without any loud transient
4. Inspect a newly created cut region in devtools (or add a debug log): region should have `startTime`/`endTime` set when surrounding silence ≥ 40ms
5. Play through a cut where silence-snap applied — pause between words should feel natural (neither too short nor too long)
