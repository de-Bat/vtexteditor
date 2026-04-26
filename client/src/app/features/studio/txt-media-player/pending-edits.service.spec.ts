import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PendingEditsService } from './pending-edits.service';
import { ClipService } from '../../../core/services/clip.service';
import { CutRegionService } from './cut-region.service';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'c1', projectId: 'p1', name: 'test', startTime: 0, endTime: 10,
    segments: [{
      id: 's1', clipId: 'c1', text: '', tags: [], startTime: 0, endTime: 10,
      words: [
        { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false },
        { id: 'w1', segmentId: 's1', text: 'world', startTime: 1, endTime: 1.5, isRemoved: true },
        { id: 'w2', segmentId: 's1', text: 'foo', startTime: 2, endTime: 2.5, isRemoved: false },
      ],
    }],
    cutRegions: [],
    ...overrides,
  };
}

describe('PendingEditsService', () => {
  let svc: PendingEditsService;
  let updateCutRegionsSpy: ReturnType<typeof vi.fn>;
  let updateWordStatesSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateCutRegionsSpy = vi.fn().mockReturnValue(of({} as Clip));
    updateWordStatesSpy = vi.fn().mockReturnValue(of({} as Clip));

    TestBed.configureTestingModule({
      providers: [
        PendingEditsService,
        CutRegionService,
        {
          provide: ClipService,
          useValue: {
            updateCutRegions: updateCutRegionsSpy,
            updateWordStates: updateWordStatesSpy,
            applyLocalUpdate: vi.fn(),
          },
        },
      ],
    });
    svc = TestBed.inject(PendingEditsService);
  });

  it('hasPending returns false with no pending regions or text', () => {
    const clip = makeClip({ cutRegions: [
      { id: 'r1', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false, effectDuration: 0, durationFixed: false }
    ]});
    expect(svc.hasPending(clip)).toBe(false);
  });

  it('hasPending returns true with pending-add region', () => {
    const clip = makeClip({ cutRegions: [
      { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
        effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' }
    ]});
    expect(svc.hasPending(clip)).toBe(true);
  });

  it('pendingCount counts cuts, restores, text edits', () => {
    const clip = makeClip({
      cutRegions: [
        { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' },
        { id: 'r2', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'remove', pendingTargetId: 'committed' },
      ],
      segments: [{
        id: 's1', clipId: 'c1', text: '', tags: [], startTime: 0, endTime: 10,
        words: [
          { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false, pendingText: 'hi' },
          { id: 'w1', segmentId: 's1', text: 'world', startTime: 1, endTime: 1.5, isRemoved: true },
          { id: 'w2', segmentId: 's1', text: 'foo', startTime: 2, endTime: 2.5, isRemoved: false },
        ],
      }],
    });
    const counts = svc.pendingCount(clip);
    expect(counts.cuts).toBe(1);
    expect(counts.restores).toBe(1);
    expect(counts.texts).toBe(1);
    expect(counts.total).toBe(3);
  });

  it('discardAll removes pending regions and clears pendingText', () => {
    const clip = makeClip({
      cutRegions: [
        { id: 'committed', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false, effectDuration: 0, durationFixed: false },
        { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' },
      ],
      segments: [{
        id: 's1', clipId: 'c1', text: '', tags: [], startTime: 0, endTime: 10,
        words: [
          { id: 'w0', segmentId: 's1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false, pendingText: 'hi' },
          { id: 'w1', segmentId: 's1', text: 'world', startTime: 1, endTime: 1.5, isRemoved: true },
        ],
      }],
    });
    const result = svc.discardAll(clip);
    expect(result.cutRegions.every(r => !r.pending)).toBe(true);
    expect(result.segments[0].words[0].pendingText).toBeUndefined();
  });

  it('applyAll strips pending fields, commits regions, saves', () => new Promise<void>((resolve) => {
    const clip = makeClip({
      cutRegions: [
        { id: 'r1', wordIds: ['w0'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'add' },
      ],
    });
    svc.applyAll(clip).subscribe(() => {
      const saved = updateCutRegionsSpy.mock.calls[0][1] as CutRegion[];
      expect(saved.every((r: CutRegion) => !r.pending)).toBe(true);
      resolve();
    });
  }));

  it('applyAll removes committed region when pending-remove targets it', () => new Promise<void>((resolve) => {
    const clip = makeClip({
      cutRegions: [
        { id: 'committed', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false, effectDuration: 0, durationFixed: false },
        { id: 'pr1', wordIds: ['w1'], effectType: 'clear-cut', effectTypeOverridden: false,
          effectDuration: 0, durationFixed: false, pending: true, pendingKind: 'remove', pendingTargetId: 'committed' },
      ],
    });
    svc.applyAll(clip).subscribe(() => {
      const saved = updateCutRegionsSpy.mock.calls[0][1] as CutRegion[];
      expect(saved.find((r: CutRegion) => r.id === 'committed')).toBeUndefined();
      resolve();
    });
  }));
});
