import { Injectable } from '@angular/core';
import { CutHistoryEntry } from './cut-region.service';

@Injectable({ providedIn: 'root' })
export class EditHistoryService {
  private readonly undoStack: CutHistoryEntry[] = [];
  private readonly redoStack: CutHistoryEntry[] = [];

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  record(entry: CutHistoryEntry): void {
    this.undoStack.push(entry);
    this.redoStack.length = 0;
  }

  undo(): CutHistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return entry;
  }

  redo(): CutHistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

// Keep old type exported so any remaining references compile
export type WordEditChange = never;
