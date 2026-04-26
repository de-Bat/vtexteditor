import { SmartEffectService } from './smart-effect.service';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { CutRegion } from '../../../core/models/cut-region.model';

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
  beforeEach(() => { svc = new SmartEffectService(); });

  it('rule 1: cross-segment cut → cross-cut 350ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.8 },
      { id: 'w1', segmentId: 's2', startTime: 1, endTime: 1.8 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('cross-cut');
    expect(result.durationMs).toBe(350);
  });

  it('rule 2: sentence boundary (period) → cross-cut 300ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', text: 'Hello.', startTime: 0, endTime: 0.8 },
      { id: 'w1', segmentId: 's1', text: 'um', startTime: 1, endTime: 1.3 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('cross-cut');
    expect(result.durationMs).toBe(300);
  });

  it('rule 3: removed audio >= 1500ms → fade-in 400ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 2.5 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0']));
    expect(result.effectType).toBe('fade-in');
    expect(result.durationMs).toBe(400);
  });

  it('rule 4: internal gap >= 0.6s → fade-in 250ms', () => {
    // Total removed: 0.8s (< 1500ms, so rule 3 doesn't fire)
    // Internal gap: 0.7s (>= 0.6s, so rule 4 fires)
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.3 },
      { id: 'w1', segmentId: 's1', startTime: 1.0, endTime: 1.1 }, // 0.7s gap, but total only 1.1s
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1']));
    expect(result.effectType).toBe('fade-in');
    expect(result.durationMs).toBe(250);
  });

  it('rule 5: short filler (<=2 words, <=600ms) → clear-cut 0ms', () => {
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', startTime: 0, endTime: 0.3 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0']));
    expect(result.effectType).toBe('clear-cut');
    expect(result.durationMs).toBe(0);
  });

  it('rule 6 (default): medium cut → clear-cut with auto duration', () => {
    // 3 words, no sentence boundary, total removed ~0.6s (< 1500ms), gaps < 0.6s
    const clip = makeClip([
      { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.15 },
      { id: 'w1', segmentId: 's1', text: 'world', startTime: 0.2, endTime: 0.35 },
      { id: 'w2', segmentId: 's1', text: 'there', startTime: 0.4, endTime: 0.6 },
    ]);
    const result = svc.resolve(clip, makeRegion(['w0', 'w1', 'w2']));
    expect(result.effectType).toBe('clear-cut');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(500);
  });
});
