import { CutRegionService } from './cut-region.service';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeClip(words: Partial<Word>[]): Clip {
  const fullWords: Word[] = words.map((w, i) => ({
    id: w.id ?? `w${i}`,
    segmentId: 's1',
    text: w.text ?? `word${i}`,
    startTime: w.startTime ?? i,
    endTime: w.endTime ?? (i + 0.8),
    isRemoved: w.isRemoved ?? false,
  }));
  return {
    id: 'clip1',
    projectId: 'p1',
    name: 'test',
    startTime: 0,
    endTime: 10,
    cutRegions: [],
    segments: [{ id: 's1', clipId: 'clip1', text: '', tags: [], startTime: 0, endTime: 10, words: fullWords }],
  };
}

describe('CutRegionService', () => {
  let svc: CutRegionService;

  beforeEach(() => { svc = new CutRegionService(); });

  describe('cut()', () => {
    it('creates a new CutRegion for selected words', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: result, entry } = svc.cut(clip, ['w1'], 'hard-cut');
      expect(result.cutRegions.length).toBe(1);
      expect(result.cutRegions[0].wordIds).toEqual(['w1']);
      expect(result.cutRegions[0].effectType).toBe('hard-cut');
      expect(result.cutRegions[0].effectTypeOverridden).toBe(false);
      expect(result.segments[0].words[1].isRemoved).toBe(true);
      expect(result.segments[0].words[0].isRemoved).toBe(false);
      expect(entry.kind).toBe('cut');
    });

    it('merges with an adjacent existing region', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: after1 } = svc.cut(clip, ['w1'], 'hard-cut');
      const { clip: after2, entry } = svc.cut(after1, ['w2'], 'fade');
      expect(after2.cutRegions.length).toBe(1);
      expect(after2.cutRegions[0].wordIds).toEqual(['w1', 'w2']);
      expect(entry.kind).toBe('cut');
      if (entry.kind === 'cut') {
        expect(entry.regionsBefore.length).toBe(1); // the w1 region
      }
    });

    it('auto-calculates effectDuration from removed content duration', () => {
      const clip = makeClip([
        { id: 'w0', startTime: 0, endTime: 0.8 },
        { id: 'w1', startTime: 1, endTime: 3 }, // 2 seconds removed
      ]);
      const { clip: result } = svc.cut(clip, ['w1'], 'fade');
      // clamp(2000 * 0.1, 150, 500) = clamp(200, 150, 500) = 200
      expect(result.cutRegions[0].effectDuration).toBe(200);
    });
  });

  describe('restore()', () => {
    it('removes words from their region (full restore)', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: cut } = svc.cut(clip, ['w1'], 'hard-cut');
      const { clip: restored, entry } = svc.restore(cut, ['w1']);
      expect(restored.cutRegions.length).toBe(0);
      expect(restored.segments[0].words[1].isRemoved).toBe(false);
      expect(entry.kind).toBe('restore');
    });

    it('shrinks region when restoring a subset of words', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: cut } = svc.cut(clip, ['w1', 'w2'], 'hard-cut');
      const { clip: restored } = svc.restore(cut, ['w1']);
      expect(restored.cutRegions.length).toBe(1);
      expect(restored.cutRegions[0].wordIds).toEqual(['w2']);
    });
  });

  describe('setEffectType()', () => {
    it('updates effectType and marks as overridden', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut } = svc.cut(clip, ['w1'], 'hard-cut');
      const regionId = cut.cutRegions[0].id;
      const { clip: result, entry } = svc.setEffectType(cut, regionId, 'fade');
      expect(result.cutRegions[0].effectType).toBe('fade');
      expect(result.cutRegions[0].effectTypeOverridden).toBe(true);
      expect(entry.kind).toBe('edit-effect');
    });
  });

  describe('applyDefaultEffectType()', () => {
    it('updates non-overridden regions only', () => {
      // w0 and w2 are non-adjacent (w1 active between them) so they stay as separate regions
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: c1 } = svc.cut(clip, ['w0'], 'hard-cut');   // not overridden
      const { clip: c2 } = svc.cut(c1, ['w2'], 'hard-cut');     // not overridden
      const r2id = c2.cutRegions.find(r => r.wordIds.includes('w2'))!.id;
      const { clip: c3 } = svc.setEffectType(c2, r2id, 'cross-cut'); // overridden
      const result = svc.applyDefaultEffectType(c3, 'fade');
      const r1 = result.cutRegions.find(r => r.wordIds.includes('w0'))!;
      const r2 = result.cutRegions.find(r => r.wordIds.includes('w2'))!;
      expect(r1.effectType).toBe('fade');       // updated
      expect(r2.effectType).toBe('cross-cut');  // kept (overridden)
    });
  });

  describe('applyUndo() / applyRedo()', () => {
    it('undo a cut removes the region', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut, entry } = svc.cut(clip, ['w1'], 'hard-cut');
      const undone = svc.applyUndo(cut, entry);
      expect(undone.cutRegions.length).toBe(0);
      expect(undone.segments[0].words[1].isRemoved).toBe(false);
    });

    it('redo after undo re-applies the cut', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut, entry } = svc.cut(clip, ['w1'], 'hard-cut');
      const undone = svc.applyUndo(cut, entry);
      const redone = svc.applyRedo(undone, entry);
      expect(redone.cutRegions.length).toBe(1);
      expect(redone.segments[0].words[1].isRemoved).toBe(true);
    });
  });
});
