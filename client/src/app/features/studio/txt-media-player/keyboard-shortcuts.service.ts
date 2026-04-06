import { Injectable } from '@angular/core';

export interface PlayerShortcutHandlers {
  togglePlay: () => void;
  seekRelative: (seconds: number) => void;
  removeSelection: () => void;
  undo: () => void;
  redo: () => void;
}

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  createPlayerHandler(handlers: PlayerShortcutHandlers): (event: KeyboardEvent) => void {
    return (event: KeyboardEvent) => {
      if (this.isEditableTarget(event.target)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        handlers.togglePlay();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handlers.seekRelative(-5);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handlers.seekRelative(5);
        return;
      }

      if (event.key === 'Delete') {
        event.preventDefault();
        handlers.removeSelection();
        return;
      }

      const isCtrlOrMeta = event.ctrlKey || event.metaKey;
      if (!isCtrlOrMeta || event.key.toLowerCase() !== 'z') return;

      event.preventDefault();
      if (event.shiftKey) {
        handlers.redo();
      } else {
        handlers.undo();
      }
    };
  }

  bindWindowKeydown(handler: (event: KeyboardEvent) => void): () => void {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return !!element && (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.isContentEditable
    );
  }
}
