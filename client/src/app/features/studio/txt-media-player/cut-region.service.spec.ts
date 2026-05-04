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
      const { clip: result, entry } = svc.cut(clip, ['w1'], 'clear-cut');
      expect(result.cutRegions.length).toBe(1);
      expect(result.cutRegions[0].wordIds).toEqual(['w1']);
      expect(result.cutRegions[0].effectType).toBe('clear-cut');
      expect(result.cutRegions[0].effectTypeOverridden).toBe(false);
      expect(result.segments[0].words[1].isRemoved).toBe(true);
      expect(result.segments[0].words[0].isRemoved).toBe(false);
      expect(entry.kind).toBe('cut');
    });

    it('merges with an adjacent existing region', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: after1 } = svc.cut(clip, ['w1'], 'clear-cut');
      const { clip: after2, entry } = svc.cut(after1, ['w2'], 'fade-in');
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
      const { clip: result } = svc.cut(clip, ['w1'], 'fade-in');
      // clamp(2000 * 0.1, 150, 500) = clamp(200, 150, 500) = 200
      expect(result.cutRegions[0].effectDuration).toBe(200);
    });
  });

  describe('restore()', () => {
    it('removes words from their region (full restore)', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: cut } = svc.cut(clip, ['w1'], 'clear-cut');
      const { clip: restored, entry } = svc.restore(cut, ['w1']);
      expect(restored.cutRegions.length).toBe(0);
      expect(restored.segments[0].words[1].isRemoved).toBe(false);
      expect(entry.kind).toBe('restore');
    });

    it('shrinks region when restoring a subset of words', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: cut } = svc.cut(clip, ['w1', 'w2'], 'clear-cut');
      const { clip: restored } = svc.restore(cut, ['w1']);
      expect(restored.cutRegions.length).toBe(1);
      expect(restored.cutRegions[0].wordIds).toEqual(['w2']);
    });
  });

  describe('updateRegionEffect()', () => {
    it('updates effectType and marks as overridden', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut } = svc.cut(clip, ['w1'], 'clear-cut');
      const regionId = cut.cutRegions[0].id;
      const { clip: result, entry } = svc.updateRegionEffect(cut, regionId, 'fade-in');
      expect(result.cutRegions[0].effectType).toBe('fade-in');
      expect(result.cutRegions[0].effectTypeOverridden).toBe(true);
      expect(entry.kind).toBe('edit-effect');
    });
  });

  describe('applyDefaultEffectType()', () => {
    it('updates non-overridden regions only', () => {
      // w0 and w2 are non-adjacent (w1 active between them) so they stay as separate regions
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: c1 } = svc.cut(clip, ['w0'], 'clear-cut');   // not overridden
      const { clip: c2 } = svc.cut(c1, ['w2'], 'clear-cut');     // not overridden
      const r2id = c2.cutRegions.find(r => r.wordIds.includes('w2'))!.id;
      const { clip: c3 } = svc.updateRegionEffect(c2, r2id, 'cross-cut'); // overridden
      const result = svc.applyDefaultEffectType(c3, 'fade-in');
      const r1 = result.cutRegions.find(r => r.wordIds.includes('w0'))!;
      const r2 = result.cutRegions.find(r => r.wordIds.includes('w2'))!;
      expect(r1.effectType).toBe('fade-in');       // updated
      expect(r2.effectType).toBe('cross-cut');  // kept (overridden)
    });
  });

  describe('applyUndo() / applyRedo()', () => {
    it('undo a cut removes the region', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut, entry } = svc.cut(clip, ['w1'], 'clear-cut');
      const undone = svc.applyUndo(cut, entry);
      expect(undone.cutRegions.length).toBe(0);
      expect(undone.segments[0].words[1].isRemoved).toBe(false);
    });

    it('redo after undo re-applies the cut', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }]);
      const { clip: cut, entry } = svc.cut(clip, ['w1'], 'clear-cut');
      const undone = svc.applyUndo(cut, entry);
      const redone = svc.applyRedo(undone, entry);
      expect(redone.cutRegions.length).toBe(1);
      expect(redone.segments[0].words[1].isRemoved).toBe(true);
    });
  });

  describe('cut() — silence-snap', () => {
    it('sets startTime/endTime to silence midpoints when gap >= 40ms', () => {
      // gap before cut: 1.15 - 1.0 = 150ms; gap after cut: 3.1 - 3.0 = 100ms
      const clip = makeClip([
        { id: 'w0', startTime: 0,    endTime: 1.0  },
        { id: 'w1', startTime: 1.15, endTime: 2.0  },
        { id: 'w2', startTime: 2.1,  endTime: 3.0  },
        { id: 'w3', startTime: 3.1,  endTime: 4.0  },
      ]);
      const { clip: result } = svc.cut(clip, ['w1', 'w2'], 'clear-cut');
      const region = result.cutRegions[0];
      expect(region.startTime).toBeCloseTo(1.075, 4); // 1.0 + 0.15*0.5
      expect(region.endTime).toBeCloseTo(3.05, 4);    // 3.0 + 0.1*0.5
    });

    it('leaves startTime/endTime undefined when silence < 40ms', () => {
      const clip = makeClip([
        { id: 'w0', startTime: 0,    endTime: 1.0   },
        { id: 'w1', startTime: 1.01, endTime: 2.0   },
        { id: 'w2', startTime: 2.01, endTime: 3.0   },
        { id: 'w3', startTime: 3.01, endTime: 4.0   },
      ]);
      const { clip: result } = svc.cut(clip, ['w1', 'w2'], 'clear-cut');
      const region = result.cutRegions[0];
      expect(region.startTime).toBeUndefined();
      expect(region.endTime).toBeUndefined();
    });

    it('preserves existing startTime/endTime on time-based silence regions', () => {
      const clip = makeClip([
        { id: 'w0', startTime: 0, endTime: 1.0 },
        { id: 'w1', startTime: 2.0, endTime: 3.0 },
      ]);
      const silenceRegion = {
        id: 'sr1', wordIds: [] as string[], startTime: 1.0, endTime: 2.0,
        effectType: 'clear-cut' as const, effectTypeOverridden: false, effectDuration: 100, durationFixed: false,
      };
      const clipWithSilence = { ...clip, cutRegions: [silenceRegion] };
      const { clip: result } = svc.cut(clipWithSilence, ['w1'], 'fade-in');
      const silenceR = result.cutRegions.find(r => r.id === 'sr1')!;
      expect(silenceR.startTime).toBe(1.0);
      expect(silenceR.endTime).toBe(2.0);
    });
  });

  describe('pending cut / restore', () => {
    it('cut with pending=true creates a pending-add region, not committed', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: result } = svc.cut(clip, ['w1'], 'clear-cut', true);
      expect(result.cutRegions.length).toBe(1);
      expect(result.cutRegions[0].pending).toBe(true);
      expect(result.cutRegions[0].pendingKind).toBe('add');
      expect(result.segments[0].words[1].isRemoved).toBe(true);
    });

    it('pending-add does not merge with committed region', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: c1 } = svc.cut(clip, ['w1'], 'clear-cut', false);     // committed
      const { clip: c2 } = svc.cut(c1, ['w2'], 'clear-cut', true);        // pending
      expect(c2.cutRegions.length).toBe(2);
      const committed = c2.cutRegions.find(r => !r.pending);
      const pending = c2.cutRegions.find(r => r.pending);
      expect(committed!.wordIds).toEqual(['w1']);
      expect(pending!.wordIds).toEqual(['w2']);
    });

    it('pending restore of committed region creates pending-remove', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }]);
      const { clip: cut } = svc.cut(clip, ['w1'], 'clear-cut', false);
      const committedId = cut.cutRegions[0].id;
      const { clip: restored } = svc.restore(cut, ['w1'], true);
      // committed region still present
      expect(restored.cutRegions.find(r => r.id === committedId)).toBeTruthy();
      // pending-remove entry created
      const pendingRemove = restored.cutRegions.find(r => r.pending && r.pendingKind === 'remove');
      expect(pendingRemove).toBeTruthy();
      expect(pendingRemove!.pendingTargetId).toBe(committedId);
      // word appears restored in effective view
      expect(restored.segments[0].words[1].isRemoved).toBe(false);
    });

    it('pending restore of pending-add region shrinks it', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: c1 } = svc.cut(clip, ['w1', 'w2'], 'clear-cut', true);
      const { clip: c2 } = svc.restore(c1, ['w1'], true);
      const pendingAdd = c2.cutRegions.find(r => r.pending && r.pendingKind === 'add');
      expect(pendingAdd!.wordIds).toEqual(['w2']);
      expect(c2.cutRegions.length).toBe(1); // no pending-remove created
    });

    it('syncIsRemoved: (committed ∪ pendingAdds) \\ pendingRemoves', () => {
      const clip = makeClip([{ id: 'w0' }, { id: 'w1' }, { id: 'w2' }, { id: 'w3' }]);
      const { clip: c1 } = svc.cut(clip, ['w0', 'w1'], 'clear-cut', false); // committed: w0, w1
      const committedId = c1.cutRegions[0].id;
      // pending-add w3
      const { clip: c2 } = svc.cut(c1, ['w3'], 'clear-cut', true);
      // pending-remove w0 from committed
      const c3 = svc.syncIsRemoved({
        ...c2,
        cutRegions: [
          ...c2.cutRegions,
          { id: 'pr1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
            effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'remove', pendingTargetId: committedId },
        ],
      });
      expect(c3.segments[0].words[0].isRemoved).toBe(false); // w0 restored by pending-remove
      expect(c3.segments[0].words[1].isRemoved).toBe(true);  // w1 still committed
      expect(c3.segments[0].words[2].isRemoved).toBe(false); // w2 never cut
      expect(c3.segments[0].words[3].isRemoved).toBe(true);  // w3 pending-add
    });
  });
});
