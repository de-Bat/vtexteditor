import { Injectable } from '@angular/core';

export interface PlayerShortcutHandlers {
  togglePlay: () => void;
  seekRelative: (seconds: number) => void;
  removeSelection: () => void;
  undo: () => void;
  redo: () => void;
  toggleMetadata: () => void;
}

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  createPlayerHandler(handlers: PlayerShortcutHandlers): (event: KeyboardEvent) => void {
    return (event: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement || (activeEl as HTMLElement).isContentEditable;

      if (isInput) {
        if (event.key === 'Escape') {
          (activeEl as HTMLElement).blur();
        }
        return;
      }

      const isCtrlOrMeta = event.ctrlKey || event.metaKey;

      if (isCtrlOrMeta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handlers.redo();
        } else {
          handlers.undo();
        }
        return;
      }

      if (event.key.toLowerCase() === 'k' || event.key === ' ') {
        event.preventDefault();
        handlers.togglePlay();
        return;
      }

      if (event.key === 'ArrowLeft') {
        handlers.seekRelative(-5);
        return;
      }
      if (event.key === 'ArrowRight') {
        handlers.seekRelative(5);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !isCtrlOrMeta) {
        event.preventDefault();
        handlers.removeSelection();
        return;
      }

      if (event.key.toLowerCase() === 'm' && !isCtrlOrMeta) {
        event.preventDefault();
        handlers.toggleMetadata();
        return;
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
