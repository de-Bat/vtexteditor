import { EditHistoryService } from './edit-history.service';

describe('EditHistoryService', () => {
  it('records changes and applies undo then redo', () => {
    const service = new EditHistoryService();
    const applied: Array<Array<{ id: string; isRemoved: boolean }>> = [];

    service.record([{ id: 'w1', previousIsRemoved: false, nextIsRemoved: true }]);

    const didUndo = service.undo((updates) => applied.push(updates));
    const didRedo = service.redo((updates) => applied.push(updates));

    expect(didUndo).toBe(true);
    expect(didRedo).toBe(true);
    expect(applied[0]).toEqual([{ id: 'w1', isRemoved: false }]);
    expect(applied[1]).toEqual([{ id: 'w1', isRemoved: true }]);
  });

  it('clears redo history when a new record is added', () => {
    const service = new EditHistoryService();
    service.record([{ id: 'w1', previousIsRemoved: false, nextIsRemoved: true }]);
    service.undo(() => undefined);

    service.record([{ id: 'w2', previousIsRemoved: true, nextIsRemoved: false }]);

    const didRedo = service.redo(() => undefined);
    expect(didRedo).toBe(false);
  });
});
