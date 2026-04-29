import { SmartEffectService } from './smart-effect.service';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { CutRegion } from '../../../core/models/cut-region.model';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { SmartCutCacheService } from './smart-cut-cache.service';

function makeClip(words: Partial<Word>[]): Clip {
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
  beforeEach(() => { svc = new SmartEffectService(new SmartCutCacheService(new IDBFactory())); });

  it('rule 1: cross-segment cut → cross-cut 350ms', async () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.8 },
      { id: 'w1', segmentId: 's2', startTime: 1, endTime: 1.8 },
    ]);
    const result = await svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('cross-cut');
    expect(result.durationMs).toBe(350);
  });

  it('rule 2: sentence boundary (period) → cross-cut 300ms', async () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', text: 'Hello.', startTime: 0, endTime: 0.8 },
      { id: 'w1', segmentId: 's1', text: 'um', startTime: 1, endTime: 1.3 },
    ]);
    const result = await svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('cross-cut');
    expect(result.durationMs).toBe(300);
  });

  it('rule 3: removed audio >= 1500ms → fade-in 400ms', async () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 2.5 },
    ]);
    const result = await svc.resolve(clip, makeRegion(['w0']));
    expect(result.effectType).toBe('fade-in');
    expect(result.durationMs).toBe(400);
  });

  it('rule 4: internal gap >= 0.6s → fade-in 250ms', async () => {
    // Total removed: 0.8s (< 1500ms, so rule 3 doesn't fire)
    // Internal gap: 0.7s (>= 0.6s, so rule 4 fires)
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.3 },
      { id: 'w1', segmentId: 's1', startTime: 1.0, endTime: 1.1 }, // 0.7s gap, but total only 1.1s
    ]);
    const result = await svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('fade-in');
    expect(result.durationMs).toBe(250);
  });

  it('rule 5: short filler (<=2 words, <=600ms) → clear-cut 0ms', async () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.3 },
    ]);
    const result = await svc.resolve(clip, makeRegion(['w0']));
    expect(result.effectType).toBe('clear-cut');
    expect(result.durationMs).toBe(0);
  });

  it('rule 6 (default): medium cut → clear-cut with auto duration', async () => {
    // 3 words, no sentence boundary, total removed ~0.6s (< 1500ms), gaps < 0.6s
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.15 },
      { id: 'w1', segmentId: 's1', text: 'world', startTime: 0.2, endTime: 0.35 },
      { id: 'w2', segmentId: 's1', text: 'there', startTime: 0.4, endTime: 0.6 },
    ]);
    const result = await svc.resolve(clip, makeRegion(['w0', 'w1', 'w2']));
    expect(result.effectType).toBe('clear-cut');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(500);
  });
});

describe('SmartEffectService — smart-cut resolution', () => {
  let svc: SmartEffectService;
  let cache: SmartCutCacheService;

  beforeEach(() => {
    cache = new SmartCutCacheService(new IDBFactory());
    svc = new SmartEffectService(cache);
  });

  it('smart + cache hit with score < 12 → resolves to smart-cut', async () => {
    const preThumb = new Blob();
    const postThumb = new Blob();
    // Seed cache: key = clip1|r1|0.5000|3.0000
    await cache.put('clip1|r1|0.5000|3.0000', {
      resumeOffsetMs: 20, score: 5, preThumb, postThumb, computedAt: Date.now()
    });
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.5, isRemoved: false },
      { id: 'w1', segmentId: 's1', startTime: 1.0, endTime: 2.5, isRemoved: true },
      { id: 'w2', segmentId: 's1', startTime: 3.0, endTime: 3.5, isRemoved: false },
    ]);
    const region = { ...makeRegion(['w1']), id: 'r1', effectType: 'smart' as const };
    const result = await svc.resolve(clip, region);
    expect(result.effectType).toBe('smart-cut');
    expect(result.resumeOffsetMs).toBeCloseTo(0.02, 3);
  });

  it('smart + cache hit with score >= 12 → falls through to existing rules', async () => {
    await cache.put('clip1|r1|0.5000|3.0000', {
      resumeOffsetMs: 0, score: 15, preThumb: new Blob(), postThumb: new Blob(), computedAt: Date.now()
    });
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.5, isRemoved: false },
      { id: 'w1', segmentId: 's1', startTime: 1.0, endTime: 2.5, isRemoved: true },
      { id: 'w2', segmentId: 's1', startTime: 3.0, endTime: 3.5, isRemoved: false },
    ]);
    const region = { ...makeRegion(['w1']), id: 'r1', effectType: 'smart' as const };
    const result = await svc.resolve(clip, region);
    // removedMs ≈ 1500ms → rule 3 (fade-in 400ms)
    expect(result.effectType).toBe('fade-in');
  });

  it('smart-cut + cache miss → fallback to cross-cut', async () => {
    const clip = makeClip([{ id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.5 }]);
    const region = { ...makeRegion(['w0']), id: 'r1', effectType: 'smart-cut' as const };
    const result = await svc.resolve(clip, region);
    expect(result.effectType).toBe('cross-cut');
  });

  it('smart-cut + cache hit score > 24 → fallback to cross-cut', async () => {
    await cache.put('clip1|r1|0.5000|3.0000', {
      resumeOffsetMs: 0, score: 30, preThumb: new Blob(), postThumb: new Blob(), computedAt: Date.now()
    });
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.5, isRemoved: false },
      { id: 'w1', segmentId: 's1', startTime: 1.0, endTime: 2.5, isRemoved: true },
      { id: 'w2', segmentId: 's1', startTime: 3.0, endTime: 3.5, isRemoved: false },
    ]);
    const region = { ...makeRegion(['w1']), id: 'r1', effectType: 'smart-cut' as const };
    const result = await svc.resolve(clip, region);
    expect(result.effectType).toBe('cross-cut');
  });
});
