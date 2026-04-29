import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SmartCutExtractor, ExtractionRequest } from './smart-cut-extractor';
import type { WorkerResult } from './smart-cut.worker';

// jsdom does not provide OffscreenCanvas or createImageBitmap — mock them so
// captureFrame doesn't throw before reaching the worker round-trip.
(globalThis as any).OffscreenCanvas = class {
  constructor() {}
  getContext() { return { drawImage: () => {} }; }
};
(globalThis as any).createImageBitmap = async () => ({} as ImageBitmap);

function makeMockVideo() {
  let onSeeked: (() => void) | null = null;
  const video = {
    src: '',
    muted: false,
    preload: '',
    currentTime: 0,
    width: 320,
    height: 240,
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'seeked') onSeeked = handler;
    }),
    removeEventListener: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLVideoElement;

  // Trigger seeked asynchronously whenever currentTime is set
  const proxy = new Proxy(video, {
    set(target: any, prop, value) {
      target[prop] = value;
      if (prop === 'currentTime') {
        // Fire seeked on next microtask
        Promise.resolve().then(() => onSeeked?.());
      }
      return true;
    }
  });

  return proxy;
}

function makeMockWorker(result: WorkerResult) {
  let onMessage: ((e: MessageEvent) => void) | null = null;
  const worker = {
    postMessage: vi.fn(() => {
      Promise.resolve().then(() => {
        onMessage?.({ data: result } as MessageEvent);
      });
    }),
    terminate: vi.fn(),
  } as unknown as Worker;

  // Intercept onmessage assignment via Object.defineProperty so the extractor
  // can register its handler and receive the mocked response.
  Object.defineProperty(worker, 'onmessage', {
    set(handler: (e: MessageEvent) => void) { onMessage = handler; },
    get() { return onMessage; },
    configurable: true,
  });

  return worker;
}

describe('SmartCutExtractor', () => {
  let extractor: SmartCutExtractor;

  beforeEach(() => {
    extractor = new SmartCutExtractor(makeMockVideo(), makeMockWorker({
      id: 'req1',
      resumeOffsetMs: 20,
      score: 5,
      preThumb: new Blob(),
      postThumb: new Blob(),
    }));
  });

  it('returns result with correct score and resumeOffsetMs', async () => {
    const req: ExtractionRequest = {
      id: 'req1',
      tBefore: 10.0,
      tAfterCenter: 12.0,
      windowMs: 150,
      clipId: 'clip1',
    };
    const result = await extractor.extract(req);
    expect(result.score).toBe(5);
    expect(result.resumeOffsetMs).toBe(20);
  });

  it('destroy() calls worker.terminate()', () => {
    const worker = makeMockWorker({ id: 'x', resumeOffsetMs: 0, score: 0, preThumb: new Blob(), postThumb: new Blob() });
    const e = new SmartCutExtractor(makeMockVideo(), worker);
    e.destroy();
    expect((worker as any).terminate).toHaveBeenCalled();
  });

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
});
