import { describe, it, expect, vi } from 'vitest';
import type { SmartCutRoi } from './smart-cut.constants';

let lastDrawArgs: unknown[] = [];

class MockOffscreenCanvas {
  width: number;
  height: number;

  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  getContext(_type: string) {
    return {
      drawImage: (...args: unknown[]) => { lastDrawArgs = args; },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128),
      }),
    };
  }

  convertToBlob(_opts?: unknown): Promise<Blob> { return Promise.resolve(new Blob()); }
}

(globalThis as any).OffscreenCanvas = MockOffscreenCanvas;

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
    lastDrawArgs = [];
    const bitmap = makeBitmap();
    const result = toGrayscale9x8(bitmap);
    expect(result).toHaveLength(72);
    expect(result[0]).toBe(128);
    expect(lastDrawArgs).toEqual([bitmap, 0, 0, 9, 8]);
  });

  it('with roi — drawImage called with source rect derived from roi + bitmap size', () => {
    lastDrawArgs = [];
    const bitmap = makeBitmap(64, 64);
    const roi: SmartCutRoi = { x: 0.10, y: 0.00, w: 0.80, h: 0.60 };
    const result = toGrayscale9x8(bitmap, roi);
    expect(result).toHaveLength(72);
    // sx = 0.10*64=6.4, sy = 0.00*64=0, sw = 0.80*64=51.2, sh = 0.60*64=38.4
    expect(lastDrawArgs).toEqual([bitmap, 6.4, 0, 51.2, 38.4, 0, 0, 9, 8]);
  });

  it('null roi — behaves same as undefined roi (full frame)', () => {
    lastDrawArgs = [];
    const bitmap = makeBitmap();
    toGrayscale9x8(bitmap, null as unknown as SmartCutRoi);
    expect(lastDrawArgs).toEqual([bitmap, 0, 0, 9, 8]);
    lastDrawArgs = [];
    toGrayscale9x8(bitmap, undefined);
    expect(lastDrawArgs).toEqual([bitmap, 0, 0, 9, 8]);
  });
});
