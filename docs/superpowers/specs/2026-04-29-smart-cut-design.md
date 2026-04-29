# Smart Cut — Frame-Matching Seamless Transition

**Date:** 2026-04-29  
**Status:** Approved  
**Scope:** VTextStudio — `client/src/app/features/studio/`

---

## Problem

When playback hits a cut region, the video seeks forward. Even with existing cross-cut / fade-in effects, the visible head/body position at the resume frame differs from the last visible frame before the cut, causing a perceptible jump. Smart Cut minimises this by finding the best-matching resume frame within a ±150 ms window around the original resume point, then masking the seek with a canvas overlay crossfade.

---

## Goals

1. Find resume frame closest in visual appearance to last frame before cut.
2. Mask the seek with a canvas overlay (freeze-frame → crossfade).
3. Compute in background; never block editing or playback.
4. Fall back to existing effects gracefully when match quality is poor.
5. Persist results in IndexedDB; survive page reloads.
6. Expose per-region status + preview in the transcript/timeline UI.

---

## Non-Goals

- Server-side ML frame matching.
- Audio waveform alignment.
- WebCodecs-based decoding (deferred to v2).
- Automatic trim of spoken words (only adjusts within silence windows).

---

## Architecture

```
CutRegionService  ──enqueue──▶  SmartCutQueueService  ──frames──▶  smart-cut.worker.ts
     (existing)                   (debounce 250ms,                    (dHash + Hamming)
                                   concurrency = 1,                         │
                                   requestIdleCallback)                      │ result
                                         ▲                                   ▼
                                         │                       SmartCutCacheService
                                regionInvalidated$                  (IndexedDB, LRU)
                                                                             │
                                                                             ▼
                                                               SmartEffectService.resolve()
                                                               EffectPlayerService.playEffect()
```

### New Services / Files

| File | Responsibility |
|------|----------------|
| `smart-cut-queue.service.ts` | Debounce + FIFO scheduler; enqueue on cut/restore/edge-change |
| `smart-cut-extractor.ts` | Main-thread frame grabber; hidden `<video>`, seek, `drawImage`, post `ImageBitmap` to worker |
| `smart-cut.worker.ts` | dHash compute, Hamming compare, thumbnail encode, return result |
| `smart-cut-cache.service.ts` | IndexedDB wrapper; keyed by `sourceHash`; LRU eviction (500 entries / 50 MB) |

### Modified Files

| File | Change |
|------|--------|
| `cut-region.model.ts` | Add `'smart-cut'` to `EffectType`; no new model fields (cache lives in IDB) |
| `cut-region.service.ts` | Emit `regionInvalidated$(regionId)` on cut/restore/duration/edge change |
| `smart-effect.service.ts` | Inject cache; auto-promote `'smart'` → `'smart-cut'` when score < 12 |
| `effect-player.service.ts` | New `playSmartCut()` method; overlay canvas interaction |
| `txt-media-player-v2.component.ts` | Host overlay `<canvas>`; status dots + preview button in pills; `Shift+P` shortcut |
| `settings.service.ts` | Add `smartCutAutoUpgrade: boolean`, `smartCutWindowMs: number` |

---

## Data Flow

### Source Hash

```
sourceHash = SHA-1(
  clip.mediaUrl + '|' + region.id + '|' +
  firstWordId(region) + '|' + lastWordId(region) + '|' +
  region.startTime + '|' + region.endTime
)
```

Region edge change → new hash → cache miss → recompute.

### Frame Extraction (Main Thread)

1. Compute `tBefore` = `endTime` of last kept word before region.
2. Compute `tAfterCenter` = `startTime` of first kept word after region.
3. Window = `[tAfterCenter − 150ms, tAfterCenter + 150ms]`, sampled every ~16 ms (~18 frames).
4. Clamp window to avoid neighbouring kept-word speech (min 50 ms buffer from adjacent word boundary).
5. If clamped window < 60 ms total → skip; mark unsupported.
6. For each timestamp: hidden video `currentTime = t`, await `seeked`, `ctx.drawImage` to 64×64 OffscreenCanvas, transfer `ImageBitmap` to worker via `postMessage`.
7. Also capture single anchor frame at `tBefore`.

### Worker (smart-cut.worker.ts)

1. Receive `ImageBitmap` array (candidates) + anchor.
2. For each bitmap: grayscale → 9×8 resize → dHash (compare adjacent pixels → 64-bit signature).
3. `anchorHash` = dHash(anchor frame).
4. For each candidate: `dist = Hamming(anchorHash XOR candidateHash)`.
5. Pick min-distance candidate; tiebreak = closest to `tAfterCenter`.
6. Encode anchor + winner to `image/webp` at 160×90, quality 0.6.
7. Return `{ resumeOffsetMs, score, preThumb: Blob, postThumb: Blob }`.

### Cache Storage

```typescript
interface SmartCutResult {
  resumeOffsetMs: number;   // delta from original tAfterCenter
  score: number;             // Hamming distance 0–64
  preThumb: Blob;            // anchor frame webp
  postThumb: Blob;           // matched resume frame webp
  computedAt: number;        // timestamp
}
```

IDB store: `smart-cut-cache`. Key = `sourceHash`. LRU: max 500 entries, max 50 MB; eviction on `put`.

### Effect Resolution

> **Migration note:** `SmartEffectService.resolve()` is currently synchronous. Smart-cut resolution requires an async IDB lookup. Solution: `resolve()` becomes `async resolve()` returning `Promise<{...}>`. `EffectPlayerService.playEffect()` is already returning an `Observable`; the async call wraps inside `from(this.smartEffect.resolve(...)).pipe(switchMap(...))`. No other callers exist.

```typescript
// SmartEffectService.resolve() extension — now async
const cached = await cache.get(sourceHash);

if (effectType === 'smart-cut') {
  if (!cached || cached.score > SMART_CUT_MAX_USABLE) {
    return { effectType: 'cross-cut', durationMs: 300 };    // fallback
  }
  return { effectType: 'smart-cut', resumeOffsetMs: cached.resumeOffsetMs, durationMs: 300 };
}

if (effectType === 'smart' && cached && cached.score < SMART_CUT_AUTO_THRESHOLD) {
  return { effectType: 'smart-cut', resumeOffsetMs: cached.resumeOffsetMs, durationMs: 300 };
}
// else: existing smart rules unchanged (synchronous path, no await needed)
```

> **`regionInvalidated$` source:** `CutRegionService` is stateless (pure functions). The `regionInvalidated$` Subject lives in `SmartCutQueueService` itself. `SmartCutQueueService` exposes `invalidate(regionId)`. Callers: `txt-media-player-v2.component.ts` calls `queue.invalidate(regionId)` inside its `cut()`, `restore()`, and `updateRegionEffect()` wrappers — same places it already mutates clip signal state.

Constants:
- `SMART_CUT_AUTO_THRESHOLD = 12` (auto-promote score threshold)
- `SMART_CUT_MAX_USABLE = 24` (above this, explicit smart-cut still falls back)

### Playback Transition (`EffectPlayerService.playSmartCut`)

1. `ctx.drawImage(videoEl, ...)` → overlay canvas (full resolution). Set overlay `opacity = 1`.
2. Audio: `gainNode.gain` ramp 1→0 over 60 ms.
3. `videoEl.currentTime = regionEndTime + resumeOffsetMs`.
4. Await `seeked` event (race: timeout 200 ms).
5. Audio: `gainNode.gain` ramp 0→1 over 200 ms.
6. Overlay: CSS transition `opacity 1→0` over 200 ms.
7. Total perceived gap: ~260 ms.

---

## Edge Cases

| Case | Handling |
|------|----------|
| Region at clip start (no pre-frame) | Skip smart-cut; fallback `clear-cut` |
| Region at clip end | No transition needed; end of playback |
| `wordIds = []` (silence-only region) | Use `startTime`/`endTime` directly; same algorithm |
| Region < 100 ms | Skip; no job enqueued |
| Window clamp < 60 ms | Skip; mark unsupported |
| Window overlaps neighbouring cut region | Clamp at region boundary |
| Worker error / timeout (10 s) | Cache `{ score: Infinity, error: true }`; pill → red dot; no retry on same hash |
| Canvas CORS-tainted video | Catch `SecurityError`; mark `unsupported`; log once |
| Region invalidated mid-flight | Cancel in-flight job; requeue |
| Play while computing | Miss → fallback to current rules; next play uses cache |
| Project reload | `warmIndex()` loads hashes only; thumbs lazy-loaded on hover |
| Source media changed | All hashes mismatch → all regions requeue |

---

## UI

### Region Pill

```
┌─────────────────────────────────┐
│ [●] um, you know,  [▶ preview]  │
└─────────────────────────────────┘
```

**Status dot states:**

| Dot | Meaning |
|-----|---------|
| `⟳` grey pulsing | Queued / computing |
| `●` green | Score < 12 — auto-applies in Smart mode |
| `●` yellow | Score 12–24 — usable only if `smart-cut` chosen explicitly |
| `↓` red | Score > 24 or unsupported — falls back; tooltip explains |

**Hover popover:**
- Two thumbnails 160×90 (pre / post matched frame).
- Score text: e.g. "Match: 6 / 64 (excellent)".
- "Preview transition" button.

**Click ▶ / Shift+P on focused region:**
- Seek to ~500 ms before region start.
- Play through transition.
- Pause ~500 ms after region end.
- Second click restores prior playhead.

### Effect Dropdown (Segment Metadata Panel)

New option: **Smart cut (frame-match)**
- Tooltip: "Find best matching resume frame. Falls back to cross-cut if no good match."

### Settings

```typescript
interface SettingsExtension {
  smartCutAutoUpgrade: boolean;   // default true
  smartCutWindowMs: number;       // default 150, range 50–500 (advanced)
}
```

### Overlay Canvas

- Single `<canvas>` absolutely-positioned over video element.
- `z-index` above video, below controls.
- `opacity: 0` at rest; animated during transition only.
- Resizes with video element via `ResizeObserver`.

---

## Testing

### Unit Tests

| Test file | Coverage |
|-----------|----------|
| `smart-cut.worker.spec.ts` | dHash determinism; Hamming correctness; min-distance pick; tiebreak; 1-frame window; all-identical input |
| `smart-cut-cache.service.spec.ts` | Put/get; LRU eviction; `warmIndex` (hashes only); stale-hash invalidation |
| `smart-cut-queue.service.spec.ts` | Debounce; concurrency = 1; cancellation on `regionInvalidated$`; 10 s timeout → error cache entry |
| `smart-effect.service.spec.ts` | Auto-promote `smart` → `smart-cut` at score < 12; scores 12–24 → existing rules; `smart-cut` cache miss → `cross-cut`; score > 24 → `cross-cut` |
| `cut-region.service.spec.ts` | Edge change → `regionInvalidated$` emits |
| `effect-player.service.spec.ts` | `playSmartCut` sequence; audio ramp order; seek timeout handling; `resetAll` mid-transition |

### Integration Tests

| Test file | Coverage |
|-----------|----------|
| `smart-cut-extractor.spec.ts` | End-to-end: enqueue → extract → worker → cache populated; CORS error → unsupported (no throw) |

### Manual Smoke Tests

1. Cut filler word in talking-head footage → wait for green dot → play → verify no head jump.
2. Cut across two different camera angles → verify red dot → verify cross-cut fallback.
3. Edit region edges → verify re-queues and recomputes.
4. Reload project → verify dots populate from cache without recompute.
5. Two adjacent cuts < 200 ms apart → verify no cache crosstalk.

### Performance Budgets

| Metric | Budget |
|--------|--------|
| Per-region extraction | < 3 s (Chrome, Fast 4G, 4× CPU throttle, 1080p 10-min source) |
| Cache warm (100 regions) | < 100 ms |
| Smart-cut transition end-to-end | < 350 ms |

---

## Constants Summary

```typescript
export const SMART_CUT_WINDOW_MS = 150;          // default search half-window
export const SMART_CUT_FRAME_INTERVAL_MS = 16;   // ~60fps sampling
export const SMART_CUT_MIN_WINDOW_MS = 60;        // below this: skip
export const SMART_CUT_AUTO_THRESHOLD = 12;       // auto-promote in 'smart' mode
export const SMART_CUT_MAX_USABLE = 24;           // above this: fallback always
export const SMART_CUT_THUMB_WIDTH = 160;
export const SMART_CUT_THUMB_HEIGHT = 90;
export const SMART_CUT_THUMB_QUALITY = 0.6;
export const SMART_CUT_WORKER_TIMEOUT_MS = 10_000;
export const SMART_CUT_IDB_MAX_ENTRIES = 500;
export const SMART_CUT_IDB_MAX_BYTES = 50 * 1024 * 1024;
export const SMART_CUT_OVERLAY_FADE_MS = 200;
export const SMART_CUT_AUDIO_FADEOUT_MS = 60;
export const SMART_CUT_AUDIO_FADEIN_MS = 200;
export const SMART_CUT_SEEK_TIMEOUT_MS = 200;
export const SMART_CUT_DEBOUNCE_MS = 250;
export const SMART_CUT_PREVIEW_PREROLL_MS = 500;
export const SMART_CUT_PREVIEW_POSTROLL_MS = 500;
```
