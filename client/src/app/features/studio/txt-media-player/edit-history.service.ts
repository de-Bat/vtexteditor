import { Injectable } from '@angular/core';

export interface WordEditChange {
  id: string;
  previousIsRemoved: boolean;
  nextIsRemoved: boolean;
}

@Injectable({ providedIn: 'root' })
export class EditHistoryService {
  private readonly undoStack: WordEditChange[][] = [];
  private readonly redoStack: WordEditChange[][] = [];

  record(changes: WordEditChange[]): void {
    if (!changes.length) return;
    this.undoStack.push(changes);
    this.redoStack.length = 0;
  }

  undo(apply: (updates: Array<{ id: string; isRemoved: boolean }>) => void): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;
    this.redoStack.push(action);
    apply(action.map((change) => ({ id: change.id, isRemoved: change.previousIsRemoved })));
    return true;
  }

  redo(apply: (updates: Array<{ id: string; isRemoved: boolean }>) => void): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;
    this.undoStack.push(action);
    apply(action.map((change) => ({ id: change.id, isRemoved: change.nextIsRemoved })));
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
