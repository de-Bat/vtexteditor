/// <reference lib="webworker" />

import { dHash, hammingDistance } from './smart-cut-hash';
import {
  SMART_CUT_THUMB_WIDTH, SMART_CUT_THUMB_HEIGHT, SMART_CUT_THUMB_QUALITY
} from './smart-cut.constants';

export interface WorkerRequest {
  id: string;
  anchor: ImageBitmap;
  candidates: ImageBitmap[];
  candidateTimestamps: number[];  // seconds, matching candidates[] by index
  centerTimestamp: number;        // tAfterCenter in seconds
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

function toGrayscale9x8(bitmap: ImageBitmap): Uint8Array {
  const canvas = new OffscreenCanvas(9, 8);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, 9, 8);
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
  const { id, anchor, candidates, candidateTimestamps, centerTimestamp } = event.data;

  try {
    if (!candidates.length) {
      throw new Error('no candidates');
    }

    const anchorHash = dHash(toGrayscale9x8(anchor));

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const dist = hammingDistance(anchorHash, dHash(toGrayscale9x8(candidates[i])));
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
