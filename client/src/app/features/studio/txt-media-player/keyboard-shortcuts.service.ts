import { Injectable } from '@angular/core';

export interface PlayerShortcutHandlers {
  togglePlay: () => void;
  seekRelative: (seconds: number) => void;
  removeSelection: () => void;
  undo: () => void;
  redo: () => void;
  toggleMetadata: () => void;
  toggleEditMode?: () => void;
  toggleAutoFollow?: () => void;
  jumpToStart?: () => void;
  restoreAll?: () => void;
  'shift.p'?: () => void;
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

      // J / L: fine-step seek (1s), complementing Arrow keys (5s)
      if (event.key.toLowerCase() === 'j' && !isCtrlOrMeta && !event.shiftKey) {
        event.preventDefault();
        handlers.seekRelative(-1);
        return;
      }
      if (event.key.toLowerCase() === 'l' && !isCtrlOrMeta && !event.shiftKey) {
        event.preventDefault();
        handlers.seekRelative(1);
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

      // 0 — jump to clip start
      if (event.key === '0' && !isCtrlOrMeta) {
        event.preventDefault();
        handlers.jumpToStart?.();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !isCtrlOrMeta) {
        event.preventDefault();
        handlers.removeSelection();
        return;
      }

      if (event.key.toLowerCase() === 'e' && !isCtrlOrMeta && !event.shiftKey) {
        event.preventDefault();
        handlers.toggleEditMode?.();
        return;
      }

      if (event.key.toLowerCase() === 'f' && !isCtrlOrMeta && !event.shiftKey) {
        event.preventDefault();
        handlers.toggleAutoFollow?.();
        return;
      }

      // Shift+R — restore all removed words
      if (event.key.toLowerCase() === 'r' && event.shiftKey && !isCtrlOrMeta) {
        event.preventDefault();
        handlers.restoreAll?.();
        return;
      }

      if (event.key.toLowerCase() === 'm' && !isCtrlOrMeta) {
        event.preventDefault();
        handlers.toggleMetadata();
        return;
      }

      if (event.key.toLowerCase() === 'p' && event.shiftKey && !isCtrlOrMeta) {
        if (handlers['shift.p']) {
          event.preventDefault();
          handlers['shift.p']();
          return;
        }
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
