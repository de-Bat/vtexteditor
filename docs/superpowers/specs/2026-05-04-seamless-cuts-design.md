# Seamless Word Cuts — Design Spec

**Date:** 2026-05-04
**Goal:** Make word-level cuts feel continuous: no phoneme-edge audio artifacts, no clicks/pops. Visual continuity already handled by smart-cut (frame-matching).

---

## Problem

When playback jumps at a cut boundary, two audio artifacts can occur:

1. **Phoneme clipping** — cut lands exactly on `word.endTime` / `word.startTime`. Transcript timestamps include coarticulation tails; cutting at the precise boundary can include trailing phoneme energy that sounds clipped.
2. **Click/pop** — an instantaneous gain change on a non-zero waveform sample causes an audible transient.

Neither is addressed by existing effects (`clear-cut`, `fade-in`, `cross-cut`, `smart-cut`).

---

## Scope

Two techniques, implemented in parallel:

| ID | Name | Layer | Addresses |
|----|------|-------|-----------|
| A | Silence-snap | Data (CutRegion) | Phoneme clipping |
| B | Micro-fade | Playback (EffectPlayerService) | Click/pop |

J-cut (audio pre-roll) is **out of scope** for this iteration.

---

## Technique A — Silence-Snap

### What it does

When creating a cut region, examine the silence gaps at both boundary edges:

- **Pre-cut edge**: silence between last kept word (`wordBefore.endTime`) and first cut word (`firstCutWord.startTime`)
- **Post-cut edge**: silence between last cut word (`lastCutWord.endTime`) and first kept word after cut (`wordAfter.startTime`)

Snap the region's effective play boundaries to the **midpoint** of each silence gap (clamped by `SILENCE_SNAP_FRACTION = 0.5`). Store as `CutRegion.startTime` / `CutRegion.endTime`.

### Example

```
kept_word ends  ─────── 5.200
                         silence (150ms)
cut_word starts ─────── 5.350
                    ↑ snap: 5.275  →  CutRegion.startTime = 5.275
```

Playback then seeks FROM 5.275 (middle of silence) instead of from 5.200 (end of phoneme). The 75ms of silence buffer on each side absorbs coarticulation tails.

### Minimum silence threshold

Only snap if silence gap ≥ `SILENCE_SNAP_MIN_MS = 40ms`. Below that, fall back to exact word boundary. Prevents bizarre snapping when words are very close together.

### New file: `seamless-boundaries.ts`

Pure function, no Angular dependencies:

```typescript
export interface SeamlessBoundaries {
  startTime: number;  // effective resume-after-cut time (seconds)
  endTime: number;    // effective jump-to-on-cut time (seconds)
}

export function computeSeamlessBoundaries(
  allWords: Word[],
  region: CutRegion,
): SeamlessBoundaries
```

Called in `CutRegionService.cut()` after building `regionAfter`. Result merged into the region.

### What changes in `CutRegionService`

`cut()` calls `computeSeamlessBoundaries()` on every new region. If existing `startTime`/`endTime` already set (silence-based region), skip.

---

## Technique B — Micro-Fade

### What it does

Apply a 30ms audio ramp-in after **every** seek, for all effect types including `clear-cut`. Currently `clear-cut` emits instantly — gain stays at 1 through the seek, which can cause a pop if the waveform is non-zero.

```
Before: [gain=1] ──seek── [gain=1]  ← click if waveform non-zero at seek point
After:  [gain=1] ──seek── [gain=0→1 over 30ms]  ← smooth
```

### What changes in `EffectPlayerService`

- New private method `applyMicroFadeIn(ms: number)` — ramps gain 0→1.
- All branches in `playResolvedEffect` call `applyMicroFadeIn(CUT_MICRO_FADE_MS)` after seek.
- `clear-cut` branch changes: gain set to 0 immediately before seek, then ramped to 1 after.
- `fade-in` / `cross-cut` / `smart-cut` already do audio work — micro-fade merged with their existing ramp-in (take the max duration, not additive).

### No visual change

Micro-fade is audio-only. `videoOpacity` unchanged for `clear-cut`. For `smart-cut`, existing `SMART_CUT_AUDIO_FADEIN_MS = 200` already subsumes the 30ms — no change needed there.

---

## New Constants

Added to `smart-cut.constants.ts`:

```typescript
export const SILENCE_SNAP_MIN_MS   = 40;
export const SILENCE_SNAP_FRACTION = 0.5;
export const CUT_MICRO_FADE_MS     = 30;
```

---

## Files Changed

| Action | File | Change |
|--------|------|--------|
| Create | `client/src/app/features/studio/txt-media-player/seamless-boundaries.ts` | `computeSeamlessBoundaries()` pure fn |
| Create | `client/src/app/features/studio/txt-media-player/seamless-boundaries.spec.ts` | Unit tests |
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut.constants.ts` | Add 3 new constants |
| Modify | `client/src/app/features/studio/txt-media-player/cut-region.service.ts` | Call `computeSeamlessBoundaries` in `cut()` |
| Modify | `client/src/app/features/studio/txt-media-player/cut-region.service.spec.ts` | Tests for silence-snap |
| Modify | `client/src/app/features/studio/txt-media-player/effect-player.service.ts` | `applyMicroFadeIn`, update all branches |
| Modify | `client/src/app/features/studio/txt-media-player/effect-player.service.spec.ts` | Micro-fade tests |

---

## Error Handling

- `computeSeamlessBoundaries` returns exact word boundaries if no adjacent words found (graceful degradation).
- Micro-fade skips silently if `audioCtx` / `gainNode` not initialized.
- Both techniques are non-destructive: silence-snap only sets `startTime`/`endTime` on the region, never alters `word.startTime`/`word.endTime`.

---

## Testing

- `seamless-boundaries.spec.ts`: pure fn, no mocks needed. Cover: normal silence, sub-threshold silence, no adjacent words, already-set boundaries.
- `cut-region.service.spec.ts`: add cases verifying `startTime`/`endTime` set after `cut()`.
- `effect-player.service.spec.ts`: verify gain ramp called on `clear-cut`, verify merged (not doubled) on `fade-in`.

---

## Non-Goals

- J-cut (audio pre-roll)
- Loudness normalization across cut boundaries
- Waveform zero-crossing detection (micro-fade is sufficient)
