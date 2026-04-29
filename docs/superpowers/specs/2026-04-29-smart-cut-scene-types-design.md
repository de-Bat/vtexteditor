# Smart Cut — Multi-Scene Support

**Date:** 2026-04-29  
**Status:** Approved  
**Scope:** VTextStudio — `client/src/app/features/studio/`  
**Extends:** `2026-04-29-smart-cut-design.md`

---

## Problem

Smart cut frame matching uses the full 64×64 frame for dHash regardless of content type. For talking-head footage this wastes hash bits on background/lower-body noise. For two-shot / multi-camera interview, camera switches between cuts are intentional — the fallback to cross-cut is correct, but users need a way to declare content type so the system behaves accordingly.

---

## Goals

1. Let users label a clip's scene type (talking head / two-shot).
2. For talking head: focus dHash on upper-center ROI (head + upper body).
3. For two-shot: full-frame hash — camera-switch cuts fall back to cross-cut naturally.
4. Changing scene type invalidates and re-queues all cut regions for that clip.

---

## Non-Goals

- Auto-detecting scene type from video content.
- More than two scene types in this iteration.
- Per-region scene type override.
- Changing search window size or score thresholds per scene type.

---

## Architecture

No new services or files. Changes touch:

| File | Change |
|------|--------|
| `clip.model.ts` | Add `SceneType` union + optional `sceneType` field on `Clip` |
| `smart-cut.constants.ts` | Add `SmartCutRoi` interface + `SMART_CUT_ROI` map |
| `smart-cut.worker.ts` | `WorkerRequest` gets `roi?`; `toGrayscale9x8` uses source rect when roi present |
| `smart-cut-extractor.ts` | `ExtractionRequest` gets `roi?`; passed through to `WorkerRequest` |
| `smart-cut-queue.service.ts` | Derives ROI from `clip.sceneType`; new `invalidateClip(clipId)` method |
| Clip metadata panel component | Scene type `<select>`; on change calls `invalidateClip` + re-enqueue |

---

## Data Model

```typescript
// clip.model.ts
export type SceneType = 'talking-head' | 'two-shot';

export interface Clip {
  // ... existing fields ...
  sceneType?: SceneType;  // absent → treated as 'talking-head'
}
```

---

## Constants

```typescript
// smart-cut.constants.ts
export interface SmartCutRoi {
  x: number;  // normalized 0–1 from left
  y: number;  // normalized 0–1 from top
  w: number;  // normalized width
  h: number;  // normalized height
}

export const SMART_CUT_ROI: Record<SceneType, SmartCutRoi | null> = {
  'talking-head': { x: 0.10, y: 0.00, w: 0.80, h: 0.60 },
  'two-shot':     null,   // full frame
};
```

`talking-head` ROI: upper-center 80% width × 60% height. Excludes lower body, desk, and background edges — the parts that vary when a speaker shifts weight but their head stays still.

---

## Worker Change

```typescript
export interface WorkerRequest {
  id: string;
  anchor: ImageBitmap;
  candidates: ImageBitmap[];
  candidateTimestamps: number[];
  centerTimestamp: number;
  roi?: SmartCutRoi;        // absent = full frame
}

function toGrayscale9x8(bitmap: ImageBitmap, roi?: SmartCutRoi): Uint8Array {
  const canvas = new OffscreenCanvas(9, 8);
  const ctx = canvas.getContext('2d')!;
  if (roi) {
    ctx.drawImage(
      bitmap,
      roi.x * bitmap.width, roi.y * bitmap.height,
      roi.w * bitmap.width, roi.h * bitmap.height,
      0, 0, 9, 8,
    );
  } else {
    ctx.drawImage(bitmap, 0, 0, 9, 8);
  }
  // grayscale loop unchanged
}
```

`bitmapToBlob` (thumbnails) is unchanged — thumbnails always show the full frame.

---

## Extractor Change

```typescript
export interface ExtractionRequest {
  id: string;
  tBefore: number;
  tAfterCenter: number;
  windowMs: number;
  clipId: string;
  roi?: SmartCutRoi;   // passed through to WorkerRequest
}
```

No other extractor change. The `roi` flows into `WorkerRequest` in `extract()`.

---

## Queue Service Change

In `processNext()`:

```typescript
const sceneType = item.clip.sceneType ?? 'talking-head';
const roi = SMART_CUT_ROI[sceneType] ?? undefined;

const result = await extractor.extract({
  id: item.region.id,
  tBefore,
  tAfterCenter,
  windowMs: SMART_CUT_DEBOUNCE_MS,
  clipId: item.clip.id,
  roi,
});
```

New method:

```typescript
invalidateClip(clipId: string): void {
  // Remove all queued/debounced items for this clip
  for (const [regionId, timer] of this.debounceTimers) {
    const item = this.pendingQueue.find(i => i.region.id === regionId && i.clip.id === clipId);
    if (item || /* check debounce belongs to clip */ true) {
      clearTimeout(timer);
      this.debounceTimers.delete(regionId);
    }
  }
  this.pendingQueue = this.pendingQueue.filter(i => i.clip.id !== clipId);
  // Clear status for all regions of this clip — caller re-enqueues
  this.statusMap.update(s => {
    const next = { ...s };
    // caller passes regionIds to clear, or service tracks clip→regions mapping
    return next;
  });
}
```

> **Note:** `invalidateClip` needs to know which region IDs belong to a clip to clear their status. Simplest solution: caller passes the region list. Signature becomes `invalidateClip(clipId: string, regionIds: string[]): void`.

Cache key is unchanged. Scene type change → new ROI → different hash result → different match quality. The existing cache entry (keyed by region hash) becomes stale but harmless — it will be evicted by LRU over time, and the re-queued job overwrites it with the correct ROI-based result.

---

## UI

Scene type selector in clip metadata panel:

```
Scene type:  [ Talking head ▾ ]
             [ Two-shot / Interview ]
```

- Bound to `clip.sceneType` (signal)
- On change: `queue.invalidateClip(clip.id, clip.regions.map(r => r.id))` then re-enqueue all cut regions
- Tooltip "Talking head": "Focuses frame matching on the speaker's head and upper body"
- Tooltip "Two-shot": "Uses full frame — smart cut falls back to cross-cut on camera switches"

---

## Cache Behaviour on Scene Type Change

Scene type change does not invalidate IDB entries (cache key is unchanged). Stale full-frame results remain until LRU eviction. This is acceptable: the re-queued job writes a new entry with the same key, overwriting immediately via `put`.

---

## Edge Cases

| Case | Handling |
|------|----------|
| `clip.sceneType` absent | Treated as `'talking-head'` — safe default for existing projects |
| User changes scene type mid-compute | `invalidateClip` cancels in-flight item; re-enqueue starts fresh |
| ROI crop smaller than 9×8 source pixels | Impossible at 64×64 source — talking-head ROI = 51×38 px minimum |
| Two-shot clip with mostly single-speaker cuts | Full-frame hash still works; score may be higher but thresholds unchanged |

---

## Testing

| Test | Coverage |
|------|----------|
| `smart-cut.worker.spec.ts` | `toGrayscale9x8` with roi: crops correct region; without roi: full frame |
| `smart-cut-queue.service.spec.ts` | `invalidateClip` clears all regions for clip; ROI derived from sceneType |
| Manual | Change scene type mid-project → all dots reset → recompute → correct ROI applied |
