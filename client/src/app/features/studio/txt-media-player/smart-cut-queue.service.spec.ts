import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SmartCutQueueService } from './smart-cut-queue.service';
import { SmartCutCacheService } from './smart-cut-cache.service';
import { SmartCutExtractor } from './smart-cut-extractor';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeClip(id = 'clip1'): Clip {
  return {
    id, projectId: 'p1', name: 'test', startTime: 0, endTime: 10, cutRegions: [],
    segments: [{
      id: 's1', clipId: id, text: '', tags: [], startTime: 0, endTime: 10,
      words: [
        { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false },
        { id: 'w1', segmentId: 's1', text: 'world', startTime: 2.0, endTime: 2.5, isRemoved: true },
        { id: 'w2', segmentId: 's1', text: 'there', startTime: 3.0, endTime: 3.5, isRemoved: false },
      ]
    }]
  };
}

function makeRegion(id = 'r1'): CutRegion {
  return { id, wordIds: ['w1'], effectType: 'smart-cut', effectTypeOverridden: false, effectDuration: 300, durationFixed: false };
}

describe('SmartCutQueueService', () => {
  let svc: SmartCutQueueService;
  let mockCache: Partial<SmartCutCacheService>;
  let extractSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    extractSpy = vi.fn().mockResolvedValue({ resumeOffsetMs: 10, score: 5, preThumb: new Blob(), postThumb: new Blob() });
    const mockExtractor = { extract: extractSpy, destroy: vi.fn() } as unknown as SmartCutExtractor;
    mockCache = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      warmIndex: vi.fn().mockResolvedValue([]),
    };
    // Pass extractor factory override so all clips share the same mock extractor
    svc = new SmartCutQueueService(
      mockCache as SmartCutCacheService,
      (_clipId) => mockExtractor,
    );
  });

  afterEach(() => { vi.useRealTimers(); });

  it('enqueue() debounces — multiple rapid enqueues for same region produce one extraction', async () => {
    const clip = makeClip();
    const region = makeRegion();
    svc.enqueue(region, clip);
    svc.enqueue(region, clip);
    svc.enqueue(region, clip);

    await vi.runAllTimersAsync();

    expect(extractSpy).toHaveBeenCalledTimes(1);
  });

  it('status() is "queued" immediately after enqueue, "done" after extraction', async () => {
    const clip = makeClip();
    const region = makeRegion();
    svc.enqueue(region, clip);
    expect(svc.getStatus('r1')).toBe('queued');

    await vi.runAllTimersAsync();
    expect(svc.getStatus('r1')).toBe('done');
  });

  it('invalidate() cancels pending extraction', async () => {
    const clip = makeClip();
    const region = makeRegion();
    svc.enqueue(region, clip);
    svc.invalidate('r1');

    await vi.runAllTimersAsync();
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it('status() is "error" when extractor throws', async () => {
    extractSpy.mockRejectedValue(new Error('CORS'));
    const clip = makeClip();
    svc.enqueue(makeRegion(), clip);

    await vi.runAllTimersAsync();
    expect(svc.getStatus('r1')).toBe('error');
  });

  it('passes roi=undefined (full frame) when clip.sceneType is "two-shot"', async () => {
    const clip: Clip = { ...makeClip(), sceneType: 'two-shot' };
    const region = makeRegion();
    svc.enqueue(region, clip);
    await vi.runAllTimersAsync();

    expect(extractSpy).toHaveBeenCalledWith(
      expect.objectContaining({ roi: undefined })
    );
  });

  it('passes roi={x:0.10,y:0.00,w:0.80,h:0.60} when clip.sceneType is "talking-head"', async () => {
    const clip: Clip = { ...makeClip(), sceneType: 'talking-head' };
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
});
