import { EditHistoryService } from './edit-history.service';
import { CutHistoryEntry } from './cut-region.service';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeRegion(id: string, wordIds: string[]): CutRegion {
  return { id, wordIds, effectType: 'hard-cut', effectTypeOverridden: false, effectDuration: 200, durationFixed: false };
}

describe('EditHistoryService', () => {
  let svc: EditHistoryService;

  beforeEach(() => { svc = new EditHistoryService(); });

  it('canUndo is false initially', () => {
    expect(svc.canUndo).toBe(false);
    expect(svc.canRedo).toBe(false);
  });

  it('records a cut entry and undo returns it', () => {
    const entry: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r1', ['w1']), regionsBefore: [] };
    svc.record(entry);
    expect(svc.canUndo).toBe(true);
    const result = svc.undo();
    expect(result).toEqual(entry);
    expect(svc.canUndo).toBe(false);
    expect(svc.canRedo).toBe(true);
  });

  it('redo returns the entry after undo', () => {
    const entry: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r1', ['w1']), regionsBefore: [] };
    svc.record(entry);
    svc.undo();
    const result = svc.redo();
    expect(result).toEqual(entry);
    expect(svc.canRedo).toBe(false);
  });

  it('recording clears redo stack', () => {
    const e1: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r1', ['w1']), regionsBefore: [] };
    const e2: CutHistoryEntry = { kind: 'cut', regionAfter: makeRegion('r2', ['w2']), regionsBefore: [] };
    svc.record(e1);
    svc.undo();
    svc.record(e2);
    expect(svc.redo()).toBeNull();
  });

  it('undo returns null when stack is empty', () => {
    expect(svc.undo()).toBeNull();
  });
});
