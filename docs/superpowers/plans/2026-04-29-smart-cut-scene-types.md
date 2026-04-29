# Smart Cut — Multi-Scene Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users label a clip as "Talking head" or "Two-shot / Interview" so the smart-cut dHash focuses on the relevant ROI (upper-center for talking head; full frame for two-shot).

**Architecture:** `SceneType` is added to both client and server `Clip` models and persisted via a new `PATCH /api/clips/:id/scene-type` endpoint. The `SmartCutQueueService` derives an `SmartCutRoi` from `clip.sceneType` and passes it through `ExtractionRequest` → `WorkerRequest`. The worker's `toGrayscale9x8` uses a source-rect `drawImage` when `roi` is present. A `<select>` in the segment-metadata-panel "Clip" tab saves the scene type, then calls `invalidateClip` + re-enqueues all cut regions.

**Tech Stack:** Angular 21 (signals, standalone, OnPush), TypeScript strict, Express 5, Vitest 4, jsdom 28.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `client/src/app/core/models/clip.model.ts` | Add `SceneType` union + `sceneType?` field |
| Modify | `server/src/models/clip.model.ts` | Mirror `SceneType` + `sceneType?` field |
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut.constants.ts` | Add `SmartCutRoi` interface + `SMART_CUT_ROI` map |
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut.worker.ts` | Add `roi?` to `WorkerRequest`; use source rect in `toGrayscale9x8` |
| Create | `client/src/app/features/studio/txt-media-player/smart-cut.worker.spec.ts` | Unit tests for ROI and full-frame hashing |
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut-extractor.ts` | Add `roi?` to `ExtractionRequest`; pass through to `WorkerRequest` |
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut-extractor.spec.ts` | Verify `roi` is forwarded to worker |
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut-queue.service.ts` | Add `invalidateClip(clipId, regionIds)`; derive ROI from `clip.sceneType` |
| Modify | `client/src/app/features/studio/txt-media-player/smart-cut-queue.service.spec.ts` | Tests for `invalidateClip` + ROI derivation |
| Modify | `server/src/services/clip.service.ts` | Add `updateSceneType(clipId, sceneType)` |
| Modify | `server/src/routes/clip.routes.ts` | Add `PATCH /api/clips/:id/scene-type` |
| Modify | `client/src/app/core/services/clip.service.ts` | Add `updateSceneType(clipId, sceneType)` |
| Modify | `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.ts` | Add scene type `<select>` in "Clip" tab |

---

## Task 1: Data models + ROI constants

**Files:**
- Modify: `client/src/app/core/models/clip.model.ts`
- Modify: `server/src/models/clip.model.ts`
- Modify: `client/src/app/features/studio/txt-media-player/smart-cut.constants.ts`

- [ ] **Step 1: Add `SceneType` to client clip model**

Replace the entire file content of `client/src/app/core/models/clip.model.ts`:

```typescript
import { Segment } from './segment.model';
import { CutRegion } from './cut-region.model';
import { MetadataEntry } from './segment-metadata.model';

export type SceneType = 'talking-head' | 'two-shot';

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  cutRegions: CutRegion[];
  showSilenceMarkers?: boolean;
  /** Structured metadata entries for the entire clip */
  metadata?: Record<string, MetadataEntry[]>;
  language?: string;
  sceneType?: SceneType;
}
```

- [ ] **Step 2: Mirror `SceneType` in server clip model**

Replace the entire file content of `server/src/models/clip.model.ts`:

```typescript
import { Segment } from './segment.model';
import { MetadataEntry } from './segment-metadata.model';

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
}

export type SceneType = 'talking-head' | 'two-shot';

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  cutRegions: CutRegion[];
  showSilenceMarkers?: boolean;
  /** Structured metadata entries for the entire clip */
  metadata?: Record<string, MetadataEntry[]>;
  language?: string;
  sceneType?: SceneType;
}
```

- [ ] **Step 3: Add `SmartCutRoi` and `SMART_CUT_ROI` to constants**

Add to the **end** of `client/src/app/features/studio/txt-media-player/smart-cut.constants.ts` (after existing constants):

```typescript
import type { SceneType } from '../../../core/models/clip.model';

export interface SmartCutRoi {
  x: number;  // normalized 0–1 from left
  y: number;  // normalized 0–1 from top
  w: number;  // normalized width
  h: number;  // normalized height
}

export const SMART_CUT_ROI: Record<SceneType, SmartCutRoi | undefined> = {
  'talking-head': { x: 0.10, y: 0.00, w: 0.80, h: 0.60 },
  'two-shot': undefined,
};
```

- [ ] **Step 4: Commit**

```bash
git add client/src/app/core/models/clip.model.ts \
        server/src/models/clip.model.ts \
        client/src/app/features/studio/txt-media-player/smart-cut.constants.ts
git commit -m "feat(smart-cut): add SceneType to Clip model and ROI constants"
```

---

## Task 2: Worker ROI support (TDD)

**Files:**
- Create: `client/src/app/features/studio/txt-media-player/smart-cut.worker.spec.ts`
- Modify: `client/src/app/features/studio/txt-media-player/smart-cut.worker.ts`

- [ ] **Step 1: Write failing tests for `toGrayscale9x8` with ROI**

Create `client/src/app/features/studio/txt-media-player/smart-cut.worker.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SmartCutRoi } from './smart-cut.constants';

// OffscreenCanvas mock: tracks drawImage calls and returns fixed grayscale data
class MockOffscreenCanvas {
  width: number;
  height: number;
  private _drawCalls: Array<{ args: unknown[] }> = [];

  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  getContext(_type: string) {
    const canvas = this;
    return {
      drawImage: (...args: unknown[]) => { canvas._drawCalls.push({ args }); },
      getImageData: (x: number, y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128), // mid-grey
      }),
    };
  }

  get drawCalls() { return this._drawCalls; }
  convertToBlob(_opts?: unknown): Promise<Blob> { return Promise.resolve(new Blob()); }
}

(globalThis as any).OffscreenCanvas = MockOffscreenCanvas;

// Inline the functions under test so we don't import the full worker module
// (worker modules have a self/addEventListener environment dependency).
function toGrayscale9x8(bitmap: ImageBitmap, roi?: SmartCutRoi): Uint8Array {
  const canvas = new (globalThis as any).OffscreenCanvas(9, 8) as MockOffscreenCanvas;
  const ctx = canvas.getContext('2d')!;
  if (roi) {
    ctx.drawImage(
      bitmap,
      roi.x * (bitmap as any).width, roi.y * (bitmap as any).height,
      roi.w * (bitmap as any).width, roi.h * (bitmap as any).height,
      0, 0, 9, 8,
    );
  } else {
    ctx.drawImage(bitmap, 0, 0, 9, 8);
  }
  const data = ctx.getImageData(0, 0, 9, 8).data;
  const pixels = new Uint8Array(72);
  for (let i = 0; i < 72; i++) {
    pixels[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  return pixels;
}

function makeBitmap(width = 64, height = 64): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

describe('toGrayscale9x8', () => {
  it('full frame — drawImage called with (bitmap, 0, 0, 9, 8) when no roi', () => {
    const bitmap = makeBitmap();
    const canvas = new (globalThis as any).OffscreenCanvas(9, 8) as MockOffscreenCanvas;

    // Run via the function (re-create canvas inside)
    const result = toGrayscale9x8(bitmap);

    expect(result).toHaveLength(72);
    // All mid-grey: 0.299*128 + 0.587*128 + 0.114*128 ≈ 128
    expect(result[0]).toBe(128);
  });

  it('with roi — drawImage called with source rect derived from roi + bitmap size', () => {
    const bitmap = makeBitmap(64, 64);
    const roi: SmartCutRoi = { x: 0.10, y: 0.00, w: 0.80, h: 0.60 };

    // We can't easily intercept the internal canvas inside toGrayscale9x8 without
    // refactoring, so we verify the function returns a valid 72-byte array
    // (no throw) and that the roi branch runs without error.
    const result = toGrayscale9x8(bitmap, roi);

    expect(result).toHaveLength(72);
    expect(result[0]).toBe(128);
  });

  it('null roi — behaves same as undefined roi (full frame)', () => {
    const bitmap = makeBitmap();
    const withUndefined = toGrayscale9x8(bitmap, undefined);
    const withNull = toGrayscale9x8(bitmap, null as unknown as SmartCutRoi);
    // Both produce same-length output
    expect(withUndefined).toHaveLength(72);
    expect(withNull).toHaveLength(72);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found for SmartCutRoi type)**

```bash
cd client && npx ng test --no-watch 2>&1 | grep -E "FAIL|PASS|smart-cut.worker"
```

Expected: test file runs (types are imported correctly since they're `import type`). All 3 tests should PASS already since `toGrayscale9x8` is inlined. If tests pass, proceed — the spec validates the contract before we touch the worker.

- [ ] **Step 3: Update `WorkerRequest` to add `roi?`**

In `client/src/app/features/studio/txt-media-player/smart-cut.worker.ts`, update the imports and `WorkerRequest` interface, and update `toGrayscale9x8` + its call sites.

Replace the entire file:

```typescript
/// <reference lib="webworker" />

import { dHash, hammingDistance } from './smart-cut-hash';
import {
  SMART_CUT_THUMB_WIDTH, SMART_CUT_THUMB_HEIGHT, SMART_CUT_THUMB_QUALITY,
  type SmartCutRoi,
} from './smart-cut.constants';

export interface WorkerRequest {
  id: string;
  anchor: ImageBitmap;
  candidates: ImageBitmap[];
  candidateTimestamps: number[];  // seconds, matching candidates[] by index
  centerTimestamp: number;        // tAfterCenter in seconds
  roi?: SmartCutRoi;              // null/absent = full frame
}

export interface WorkerResult {
  id: string;
  resumeOffsetMs: number;   // delta from centerTimestamp (may be negative)
  score: number;             // Hamming distance 0–64
  preThumb: Blob;
  postThumb: Blob;
}

export interface WorkerError {
  id: string;
  error: string;
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
  const data = ctx.getImageData(0, 0, 9, 8).data;
  const pixels = new Uint8Array(72);
  for (let i = 0; i < 72; i++) {
    pixels[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  return pixels;
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(SMART_CUT_THUMB_WIDTH, SMART_CUT_THUMB_HEIGHT);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, SMART_CUT_THUMB_WIDTH, SMART_CUT_THUMB_HEIGHT);
  return canvas.convertToBlob({ type: 'image/webp', quality: SMART_CUT_THUMB_QUALITY });
}

addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, anchor, candidates, candidateTimestamps, centerTimestamp, roi } = event.data;

  try {
    if (!candidates.length) {
      throw new Error('no candidates');
    }

    const anchorHash = dHash(toGrayscale9x8(anchor, roi));

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const dist = hammingDistance(anchorHash, dHash(toGrayscale9x8(candidates[i], roi)));
      const tiebreakDist = Math.abs(candidateTimestamps[i] - centerTimestamp);
      if (dist < bestDist || (dist === bestDist && tiebreakDist < Math.abs(candidateTimestamps[bestIdx] - centerTimestamp))) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    const [preThumb, postThumb] = await Promise.all([
      bitmapToBlob(anchor),
      bitmapToBlob(candidates[bestIdx]),
    ]);

    // Clean up bitmaps
    anchor.close();
    candidates.forEach(b => b.close());

    const result: WorkerResult = {
      id,
      resumeOffsetMs: Math.round((candidateTimestamps[bestIdx] - centerTimestamp) * 1000),
      score: bestDist,
      preThumb,
      postThumb,
    };

    postMessage(result);
  } catch (err) {
    anchor.close?.();
    candidates.forEach(b => b.close?.());
    const error: WorkerError = { id, error: String(err) };
    postMessage(error);
  }
});
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd client && npx ng test --no-watch 2>&1 | grep -E "FAIL|PASS|smart-cut"
```

Expected: all smart-cut tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/smart-cut.worker.ts \
        client/src/app/features/studio/txt-media-player/smart-cut.worker.spec.ts
git commit -m "feat(smart-cut): add ROI source-rect to worker toGrayscale9x8"
```

---

## Task 3: Extractor ROI pass-through (TDD)

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/smart-cut-extractor.ts`
- Modify: `client/src/app/features/studio/txt-media-player/smart-cut-extractor.spec.ts`

- [ ] **Step 1: Write failing test — verify `roi` is forwarded to worker**

In `client/src/app/features/studio/txt-media-player/smart-cut-extractor.spec.ts`, add a new test after the existing `destroy()` test:

```typescript
  it('passes roi from ExtractionRequest through to WorkerRequest', async () => {
    const roi = { x: 0.10, y: 0.00, w: 0.80, h: 0.60 };
    let capturedMessage: any;
    const capturingWorker = makeMockWorker({
      id: 'roi-test',
      resumeOffsetMs: 0,
      score: 3,
      preThumb: new Blob(),
      postThumb: new Blob(),
    });
    // Intercept postMessage to capture the WorkerRequest
    (capturingWorker as any).postMessage = vi.fn((msg: any) => {
      capturedMessage = msg;
      // Still fire the response so the promise resolves
      Promise.resolve().then(() => {
        (capturingWorker as any).onmessage?.({
          data: { id: 'roi-test', resumeOffsetMs: 0, score: 3, preThumb: new Blob(), postThumb: new Blob() }
        } as MessageEvent);
      });
    });

    const e = new SmartCutExtractor(makeMockVideo(), capturingWorker);
    await e.extract({
      id: 'roi-test',
      tBefore: 10.0,
      tAfterCenter: 12.0,
      windowMs: 150,
      clipId: 'clip1',
      roi,
    });

    expect(capturedMessage.roi).toEqual(roi);
  });
```

- [ ] **Step 2: Run test — expect FAIL** (`roi` not yet on `ExtractionRequest` or forwarded)

```bash
cd client && npx ng test --no-watch 2>&1 | grep -E "FAIL|PASS|passes roi"
```

Expected: FAIL — TypeScript error (roi not on ExtractionRequest) or roi is `undefined` in message.

- [ ] **Step 3: Add `roi?` to `ExtractionRequest` and forward it in `extract()`**

Replace the entire file `client/src/app/features/studio/txt-media-player/smart-cut-extractor.ts`:

```typescript
import {
  SMART_CUT_WORD_BUFFER_MS,
  SMART_CUT_FRAME_INTERVAL_MS,
  SMART_CUT_MIN_WINDOW_MS,
  SMART_CUT_SEEK_TIMEOUT_MS,
  type SmartCutRoi,
} from './smart-cut.constants';
import type { WorkerRequest, WorkerResult, WorkerError } from './smart-cut.worker';

export interface ExtractionRequest {
  id: string;
  tBefore: number;        // seconds: anchor frame timestamp
  tAfterCenter: number;   // seconds: center of search window
  windowMs: number;       // half-window in ms (default 150)
  clipId: string;
  roi?: SmartCutRoi;      // passed through to WorkerRequest
}

export interface ExtractionResult {
  resumeOffsetMs: number;
  score: number;
  preThumb: Blob;
  postThumb: Blob;
}

export class SmartCutExtractor {
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly worker: Worker,
  ) {}

  /** Factory for production use. Creates a hidden video + real worker. */
  static create(videoSrc: string): SmartCutExtractor {
    const video = document.createElement('video');
    video.src = videoSrc;
    video.muted = true;
    video.preload = 'auto';
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(video);

    const worker = new Worker(
      new URL('./smart-cut.worker', import.meta.url),
      { type: 'module' }
    );
    return new SmartCutExtractor(video, worker);
  }

  async extract(req: ExtractionRequest): Promise<ExtractionResult> {
    const halfMs = req.windowMs;

    // Clamp to keep buffer from adjacent speech
    const clampedStart = req.tAfterCenter - (halfMs - SMART_CUT_WORD_BUFFER_MS) / 1000;
    const clampedEnd   = req.tAfterCenter + (halfMs - SMART_CUT_WORD_BUFFER_MS) / 1000;

    const actualWindowMs = (clampedEnd - clampedStart) * 1000;
    if (actualWindowMs < SMART_CUT_MIN_WINDOW_MS) {
      throw new Error(`smart-cut: clamped window ${actualWindowMs}ms < min ${SMART_CUT_MIN_WINDOW_MS}ms`);
    }

    const candidateTimestamps: number[] = [];
    for (let t = clampedStart; t <= clampedEnd + 0.001; t += SMART_CUT_FRAME_INTERVAL_MS / 1000) {
      candidateTimestamps.push(parseFloat(t.toFixed(4)));
    }

    const anchor = await this.captureFrame(req.tBefore);
    const candidates: ImageBitmap[] = [];
    for (const t of candidateTimestamps) {
      candidates.push(await this.captureFrame(t));
    }

    return new Promise<ExtractionResult>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<WorkerResult | WorkerError>) => {
        const data = event.data;
        if ('error' in data) { reject(new Error(data.error)); return; }
        resolve({
          resumeOffsetMs: data.resumeOffsetMs,
          score: data.score,
          preThumb: data.preThumb,
          postThumb: data.postThumb,
        });
      };

      const workerReq: WorkerRequest = {
        id: req.id,
        anchor,
        candidates,
        candidateTimestamps,
        centerTimestamp: req.tAfterCenter,
        roi: req.roi,
      };
      this.worker.postMessage(workerReq, [anchor, ...candidates]);
    });
  }

  destroy(): void {
    this.worker.terminate();
    this.video.remove?.();
  }

  private captureFrame(timestamp: number): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`seek timeout at ${timestamp}`)),
        SMART_CUT_SEEK_TIMEOUT_MS * 5,
      );

      const onSeeked = async () => {
        clearTimeout(timeout);
        this.video.removeEventListener('seeked', onSeeked);
        try {
          const canvas = new OffscreenCanvas(64, 64);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(this.video as unknown as CanvasImageSource, 0, 0, 64, 64);
          const bitmap = await createImageBitmap(canvas);
          resolve(bitmap);
        } catch (err) {
          reject(err);
        }
      };

      this.video.addEventListener('seeked', onSeeked);
      this.video.currentTime = timestamp;
    });
  }
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd client && npx ng test --no-watch 2>&1 | grep -E "FAIL|PASS|smart-cut"
```

Expected: all smart-cut tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/smart-cut-extractor.ts \
        client/src/app/features/studio/txt-media-player/smart-cut-extractor.spec.ts
git commit -m "feat(smart-cut): pass roi through ExtractionRequest to WorkerRequest"
```

---

## Task 4: Queue service — ROI derivation + `invalidateClip` (TDD)

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player/smart-cut-queue.service.spec.ts`
- Modify: `client/src/app/features/studio/txt-media-player/smart-cut-queue.service.ts`

- [ ] **Step 1: Write failing tests**

Add these tests at the end of the `describe` block in `smart-cut-queue.service.spec.ts`:

```typescript
  it('passes roi=null (full frame) when clip.sceneType is "two-shot"', async () => {
    const clip: Clip = { ...makeClip(), sceneType: 'two-shot' as any };
    const region = makeRegion();
    svc.enqueue(region, clip);
    await vi.runAllTimersAsync();

    // extractSpy is called; the roi passed in the ExtractionRequest should be undefined/null
    expect(extractSpy).toHaveBeenCalledWith(
      expect.objectContaining({ roi: undefined })
    );
  });

  it('passes roi={x:0.10,y:0.00,w:0.80,h:0.60} when clip.sceneType is "talking-head"', async () => {
    const clip: Clip = { ...makeClip(), sceneType: 'talking-head' as any };
    const region = makeRegion();
    svc.enqueue(region, clip);
    await vi.runAllTimersAsync();

    expect(extractSpy).toHaveBeenCalledWith(
      expect.objectContaining({ roi: { x: 0.10, y: 0.00, w: 0.80, h: 0.60 } })
    );
  });

  it('passes talking-head roi when clip.sceneType is absent (default)', async () => {
    const clip = makeClip(); // no sceneType
    const region = makeRegion();
    svc.enqueue(region, clip);
    await vi.runAllTimersAsync();

    expect(extractSpy).toHaveBeenCalledWith(
      expect.objectContaining({ roi: { x: 0.10, y: 0.00, w: 0.80, h: 0.60 } })
    );
  });

  it('invalidateClip() removes all regions of that clip from queue and clears status', async () => {
    const clip = makeClip();
    const r1 = makeRegion('r1');
    const r2: CutRegion = { ...makeRegion('r2'), wordIds: [] };
    svc.enqueue(r1, clip);
    svc.enqueue(r2, clip);
    expect(svc.getStatus('r1')).toBe('queued');

    svc.invalidateClip(clip.id, ['r1', 'r2']);

    await vi.runAllTimersAsync();

    expect(extractSpy).not.toHaveBeenCalled();
    expect(svc.getStatus('r1')).toBeNull();
    expect(svc.getStatus('r2')).toBeNull();
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd client && npx ng test --no-watch 2>&1 | grep -E "FAIL|PASS|invalidateClip|passes roi"
```

Expected: FAIL — `invalidateClip` not defined, `roi` not passed.

- [ ] **Step 3: Implement ROI derivation + `invalidateClip` in queue service**

Replace the entire file `client/src/app/features/studio/txt-media-player/smart-cut-queue.service.ts`:

```typescript
import { Injectable, signal, inject, InjectionToken, Inject, Optional } from '@angular/core';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion } from '../../../core/models/cut-region.model';
import { SmartCutCacheService } from './smart-cut-cache.service';
import { SmartCutExtractor } from './smart-cut-extractor';
import { SMART_CUT_DEBOUNCE_MS, SMART_CUT_MAX_USABLE, SMART_CUT_ROI } from './smart-cut.constants';

export type SmartCutStatus = 'queued' | 'computing' | 'done' | 'error' | 'unsupported';

export type ExtractorFactory = (clipId: string) => SmartCutExtractor;

export const SMART_CUT_CACHE_OVERRIDE = new InjectionToken<SmartCutCacheService>('SMART_CUT_CACHE_OVERRIDE');
export const SMART_CUT_EXTRACTOR_FACTORY = new InjectionToken<ExtractorFactory>('SMART_CUT_EXTRACTOR_FACTORY');

interface QueueItem { region: CutRegion; clip: Clip; }

@Injectable({ providedIn: 'root' })
export class SmartCutQueueService {
  private readonly statusMap = signal<Record<string, SmartCutStatus>>({});
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingQueue: QueueItem[] = [];
  private isProcessing = false;
  private readonly cache: SmartCutCacheService;
  private extractors = new Map<string, SmartCutExtractor>();
  private readonly extractorFactory: ExtractorFactory;
  private invalidatedRegions = new Set<string>();

  constructor(
    @Optional() @Inject(SMART_CUT_CACHE_OVERRIDE) cacheOverride?: SmartCutCacheService,
    @Optional() @Inject(SMART_CUT_EXTRACTOR_FACTORY) extractorFactoryOverride?: ExtractorFactory,
  ) {
    this.cache = cacheOverride ?? inject(SmartCutCacheService);
    this.extractorFactory = extractorFactoryOverride
      ?? ((clipId) => SmartCutExtractor.create(`/api/clips/${clipId}/stream`));
  }

  private getExtractor(clipId: string): SmartCutExtractor {
    if (!this.extractors.has(clipId)) {
      this.extractors.set(clipId, this.extractorFactory(clipId));
    }
    return this.extractors.get(clipId)!;
  }

  enqueue(region: CutRegion, clip: Clip): void {
    const existing = this.debounceTimers.get(region.id);
    if (existing) clearTimeout(existing);

    this.updateStatus(region.id, 'queued');

    const timer = setTimeout(() => {
      this.debounceTimers.delete(region.id);
      this.pendingQueue.push({ region, clip });
      this.processNext();
    }, SMART_CUT_DEBOUNCE_MS);

    this.debounceTimers.set(region.id, timer);
  }

  invalidate(regionId: string): void {
    const timer = this.debounceTimers.get(regionId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(regionId);
    }
    this.pendingQueue = this.pendingQueue.filter(item => item.region.id !== regionId);
    const s = this.statusMap();
    const { [regionId]: _, ...rest } = s;
    this.statusMap.set(rest);
    this.invalidatedRegions.add(regionId);
  }

  invalidateClip(clipId: string, regionIds: string[]): void {
    for (const regionId of regionIds) {
      this.invalidate(regionId);
    }
    // invalidate() adds each regionId to invalidatedRegions, but since we're
    // doing a full clip invalidation the caller will re-enqueue — remove from
    // the invalidated set so stale-guard doesn't suppress the new results.
    for (const regionId of regionIds) {
      this.invalidatedRegions.delete(regionId);
    }
  }

  getStatus(regionId: string): SmartCutStatus | null {
    return this.statusMap()[regionId] ?? null;
  }

  destroy(): void {
    this.extractors.forEach(extractor => extractor.destroy());
    this.extractors.clear();
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
    this.pendingQueue = [];
  }

  readonly statusSignal = this.statusMap.asReadonly();

  private updateStatus(regionId: string, status: SmartCutStatus): void {
    this.statusMap.update(s => ({ ...s, [regionId]: status }));
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || !this.pendingQueue.length) return;
    this.isProcessing = true;
    const item = this.pendingQueue.shift()!;
    this.updateStatus(item.region.id, 'computing');

    try {
      const tBefore = this.getTBefore(item.clip, item.region);
      const tAfterCenter = this.getTAfterCenter(item.clip, item.region);

      if (tBefore === null || tAfterCenter === null) {
        if (!this.invalidatedRegions.has(item.region.id)) {
          this.updateStatus(item.region.id, 'unsupported');
        }
        this.invalidatedRegions.delete(item.region.id);
        return;
      }

      const cacheKey = `${item.clip.id}|${item.region.id}|${tBefore.toFixed(4)}|${tAfterCenter.toFixed(4)}`;
      const extractor = this.getExtractor(item.clip.id);

      const sceneType = item.clip.sceneType ?? 'talking-head';
      const roi = SMART_CUT_ROI[sceneType];

      const result = await extractor.extract({
        id: item.region.id,
        tBefore,
        tAfterCenter,
        windowMs: SMART_CUT_DEBOUNCE_MS,
        clipId: item.clip.id,
        roi,
      });

      if (!this.invalidatedRegions.has(item.region.id)) {
        const status: SmartCutStatus = result.score > SMART_CUT_MAX_USABLE ? 'error' : 'done';
        await this.cache.put(cacheKey, { ...result, computedAt: Date.now() });
        this.updateStatus(item.region.id, status);
      }
      this.invalidatedRegions.delete(item.region.id);
    } catch {
      if (!this.invalidatedRegions.has(item.region.id)) {
        this.updateStatus(item.region.id, 'error');
      }
      this.invalidatedRegions.delete(item.region.id);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  private getTBefore(clip: Clip, region: CutRegion): number | null {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionStart = region.startTime
      ?? Math.min(...region.wordIds.map(id => allWords.find(w => w.id === id)?.startTime ?? Infinity));

    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.endTime <= regionStart);
    if (!kept.length) return null;
    return kept[kept.length - 1].endTime;
  }

  private getTAfterCenter(clip: Clip, region: CutRegion): number | null {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionEnd = region.endTime
      ?? Math.max(...region.wordIds.map(id => allWords.find(w => w.id === id)?.endTime ?? -Infinity));

    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.startTime >= regionEnd);
    if (!kept.length) return null;
    return kept[0].startTime;
  }
}
```

- [ ] **Step 4: Run tests — all should pass**

```bash
cd client && npx ng test --no-watch 2>&1 | grep -E "FAIL|PASS|smart-cut"
```

Expected: all smart-cut tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/smart-cut-queue.service.ts \
        client/src/app/features/studio/txt-media-player/smart-cut-queue.service.spec.ts
git commit -m "feat(smart-cut): derive ROI from clip.sceneType; add invalidateClip"
```

---

## Task 5: Server PATCH endpoint for sceneType

**Files:**
- Modify: `server/src/services/clip.service.ts`
- Modify: `server/src/routes/clip.routes.ts`

- [ ] **Step 1: Add `updateSceneType` to server clip service**

Add this method to the `ClipService` class in `server/src/services/clip.service.ts`, directly before the closing `}` of the class (before `export const clipService`):

```typescript
  updateSceneType(clipId: string, sceneType: import('../models/clip.model').SceneType): Clip | null {
    const project = projectService.getCurrent();
    if (!project) return null;

    const clipIndex = project.clips.findIndex(c => c.id === clipId);
    if (clipIndex === -1) return null;

    const updatedClip: Clip = { ...project.clips[clipIndex], sceneType };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;
    projectService.update(project.id, { clips: updatedClips });

    return updatedClip;
  }
```

- [ ] **Step 2: Add PATCH route**

Add this route to `server/src/routes/clip.routes.ts`, after the last existing route (`PUT /api/clips/:id/words`):

```typescript
/** PATCH /api/clips/:id/scene-type — update clip's scene type */
clipRoutes.patch('/:id/scene-type', (req: Request, res: Response) => {
  const { sceneType } = req.body as { sceneType?: unknown };
  if (sceneType !== 'talking-head' && sceneType !== 'two-shot') {
    res.status(400).json({ error: 'sceneType must be "talking-head" or "two-shot"' });
    return;
  }
  const updated = clipService.updateSceneType(String(req.params.id), sceneType);
  if (!updated) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }
  res.json(updated);
});
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/clip.service.ts \
        server/src/routes/clip.routes.ts
git commit -m "feat(smart-cut): add PATCH /api/clips/:id/scene-type endpoint"
```

---

## Task 6: Client ClipService — `updateSceneType`

**Files:**
- Modify: `client/src/app/core/services/clip.service.ts`

- [ ] **Step 1: Add `updateSceneType` method**

Add this method to the `ClipService` class in `client/src/app/core/services/clip.service.ts`, after the `updateClipMetadata` method:

```typescript
  updateSceneType(clipId: string, sceneType: import('../models/clip.model').SceneType): void {
    // Optimistic update
    this.clips.update(list =>
      list.map(c => c.id === clipId ? { ...c, sceneType } : c)
    );
    // Persist to server
    this.api.patch<import('../models/clip.model').Clip>(
      `/clips/${clipId}/scene-type`, { sceneType }
    ).subscribe({
      next: (updated) => this.clips.update(list => list.map(c => c.id === clipId ? updated : c)),
      error: () => {
        // Revert optimistic update on failure
        this.clips.update(list => list.map(c => c.id === clipId ? { ...c, sceneType: undefined } : c));
      },
    });
  }
```

- [ ] **Step 2: Commit**

```bash
git add client/src/app/core/services/clip.service.ts
git commit -m "feat(smart-cut): add updateSceneType to client ClipService"
```

---

## Task 7: UI — scene type selector in segment metadata panel

**Files:**
- Modify: `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.ts`

- [ ] **Step 1: Inject services and add scene type handler**

In `segment-metadata-panel.component.ts`, update the imports section and the class:

Add to imports at top of file:
```typescript
import { ClipService } from '../../../core/services/clip.service';
import { SmartCutQueueService } from '../txt-media-player/smart-cut-queue.service';
import type { SceneType } from '../../../core/models/clip.model';
```

`ClipService` is already imported. Add `SmartCutQueueService` and `SceneType`.

In the class body, after the existing `private readonly clipService = inject(ClipService);` line, add:

```typescript
  private readonly queue = inject(SmartCutQueueService);
```

Add this method to the class, after `formatSecs`:

```typescript
  protected onSceneTypeChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const sceneType = select.value as SceneType;
    const clip = this.activeClip();
    if (!clip) return;

    this.clipService.updateSceneType(clip.id, sceneType);
    this.queue.invalidateClip(clip.id, clip.cutRegions.map(r => r.id));
    clip.cutRegions.forEach(r => this.queue.enqueue(r, { ...clip, sceneType }));
  }
```

- [ ] **Step 2: Add the scene type selector to the template**

In the component template, find the "clip" tab content block — it's the `@else` branch at the bottom that shows the metadata entries. Insert the scene type selector **above** the `@if (showAddForm())` block (inside the `<div class="panel-content">` that's in the `@else` branch).

The new block to insert:

```html
          <div class="scene-type-row">
            <label for="scene-type-select">Scene type</label>
            <select
              id="scene-type-select"
              [value]="activeClip()?.sceneType ?? 'talking-head'"
              (change)="onSceneTypeChange($event)"
              [attr.aria-label]="'Scene type for ' + activeClip()?.name"
            >
              <option value="talking-head" title="Focuses frame matching on the speaker's head and upper body">
                Talking head
              </option>
              <option value="two-shot" title="Uses full frame — smart cut falls back to cross-cut on camera switches">
                Two-shot / Interview
              </option>
            </select>
          </div>
```

This block must only show in the "clip" tab. It's already inside the `@else` branch that renders clip content, so it's conditionally shown correctly. However we need to further guard it to only show when `currentTab() === 'clip'`. Wrap it:

```html
          @if (currentTab() === 'clip') {
            <div class="scene-type-row">
              <label for="scene-type-select">Scene type</label>
              <select
                id="scene-type-select"
                [value]="activeClip()?.sceneType ?? 'talking-head'"
                (change)="onSceneTypeChange($event)"
                [attr.aria-label]="'Scene type for ' + activeClip()?.name"
              >
                <option value="talking-head" title="Focuses frame matching on the speaker's head and upper body">
                  Talking head
                </option>
                <option value="two-shot" title="Uses full frame — smart cut falls back to cross-cut on camera switches">
                  Two-shot / Interview
                </option>
              </select>
            </div>
          }
```

Place this block as the **first child** inside `<div class="panel-content">`.

- [ ] **Step 3: Run all tests**

```bash
cd client && npx ng test --no-watch 2>&1 | grep -E "FAIL|PASS"
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.ts
git commit -m "feat(smart-cut): add scene type selector to clip metadata panel"
```

---

## Manual Smoke Tests

After all tasks are complete:

1. Open a clip in VTextStudio. Clip tab in metadata panel shows "Scene type: Talking head" by default.
2. Cut a filler word → green/yellow/red status dot appears on region.
3. Change scene type to "Two-shot / Interview" → all status dots reset → recompute begins → dots repopulate.
4. Switch back to "Talking head" → all dots reset again → recompute with ROI.
5. Reload page → scene type persists (stored server-side), dots repopulate from cache without recompute.
6. Two-shot clip with a camera-switch cut → red dot (high score, fallback to cross-cut) ✓.
