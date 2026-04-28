import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  output,
} from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { NotebookService } from '../../../core/services/notebook.service';
import { MediaPlayerService } from '../txt-media-player/media-player.service';
import { Note } from '../../../core/models/notebook.model';

@Component({
  selector: 'app-notes-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TitleCasePipe],
  template: `
    <div class="notes-panel" role="complementary" aria-label="Notes">


      <div class="notes-add">
        <textarea
          class="note-input"
          placeholder="Add a note..."
          rows="2"
          [value]="draftText()"
          (input)="draftText.set($any($event.target).value)"
          (keydown.ctrl.enter)="submitNote()"
          aria-label="New note text"
        ></textarea>
        <button
          class="add-btn"
          [disabled]="!draftText().trim()"
          (click)="submitNote()"
        >Add Note</button>
      </div>

      @if (notebookService.notes().length === 0) {
        <p class="empty-msg">No notes yet. Select a word, segment, or clip and add a note above.</p>
      } @else {
        <div class="notes-list">
          @for (group of groupedNotes(); track group.type) {
            <div class="note-group">
              <div class="group-label">{{ group.type | titlecase }}</div>
              @for (note of group.notes; track note.id) {
                <div class="note-item" [attr.data-note-id]="note.id"
                     [class.highlighted]="notebookService.highlightedNoteId() === note.id"
                     (click)="notebookService.clickNote(note)">
                  <div class="note-meta">
                    <span class="note-timecode">{{ formatTimecode(note.timecode) }}</span>
                    <span class="note-type-indicator" [title]="'Attached to ' + note.attachedToType">
                      @if (note.attachedToType === 'word') {
                        <span class="material-symbols-outlined icon-small">title</span> Word
                      } @else if (note.attachedToType === 'segment') {
                        <span class="material-symbols-outlined icon-small">segment</span> Segment
                      } @else {
                        <span class="material-symbols-outlined icon-small">movie</span> Clip
                      }
                    </span>
                  </div>
                  <p class="note-text">{{ note.text }}</p>
                  <button
                    class="delete-note"
                    aria-label="Delete note"
                    (click)="deleteNote(note.id)"
                  >✕</button>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .notes-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .notes-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .notes-title {
      font-weight: 700;
      font-size: 0.85rem;
      color: var(--color-text);
    }

    .notes-notebook {
      font-size: 0.75rem;
      color: var(--color-muted);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      padding: 2px;
      display: flex;
      align-items: center;
      border-radius: 4px;

      &:hover { color: var(--color-text); background: var(--color-border); }
    }

    .notes-add {
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .note-input {
      width: 100%;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      color: var(--color-text);
      font-size: 0.8rem;
      font-family: inherit;
      padding: 6px 8px;
      resize: none;
      box-sizing: border-box;
      outline: none;

      &:focus { border-color: var(--color-accent); }
    }

    .add-btn {
      align-self: flex-end;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 4px 12px;
      font-size: 0.75rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;

      &:disabled { opacity: 0.4; cursor: default; }
      &:not(:disabled):hover { opacity: 0.85; }
    }

    .empty-msg {
      padding: 1rem;
      color: var(--color-muted);
      font-size: 0.8rem;
      text-align: center;
      line-height: 1.5;
    }

    .notes-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .note-group { margin-bottom: 8px; }

    .group-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-muted);
      padding: 4px 12px;
    }

    .note-item {
      position: relative;
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-border);
      cursor: pointer;
      border-left: 3px solid transparent;

      &:hover .delete-note { opacity: 1; }
      &.highlighted {
        background: var(--color-surface-alt);
        border-left-color: var(--color-accent);
      }
    }

    .note-meta {
      display: flex;
      gap: 6px;
      margin-bottom: 4px;
    }

    .note-timecode {
      font-size: 0.7rem;
      color: var(--color-accent);
      font-variant-numeric: tabular-nums;
    }

    .note-type-indicator {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 0.65rem;
      color: var(--color-muted);
      background: var(--color-surface);
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--color-border);
      text-transform: capitalize;

      .icon-small {
        font-size: 14px;
      }
    }

    .note-text {
      margin: 0;
      font-size: 0.8rem;
      color: var(--color-text-secondary);
      line-height: 1.4;
      padding-right: 20px;
    }

    .delete-note {
      position: absolute;
      top: 6px;
      right: 8px;
      background: none;
      border: none;
      color: var(--color-muted);
      font-size: 0.65rem;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
      padding: 2px;

      &:hover { color: var(--color-error, #e05c5c); }
    }
  `],
})
export class NotesPanelComponent {
  readonly notebookService = inject(NotebookService);
  private readonly mediaPlayer = inject(MediaPlayerService);
  readonly closed = output<void>();

  readonly draftText = signal('');

  readonly groupedNotes = computed(() => {
    const notes = this.notebookService.notes();
    const types: Array<'word' | 'segment' | 'clip'> = ['word', 'segment', 'clip'];
    return types
      .map((type) => ({ type, notes: notes.filter((n) => n.attachedToType === type) }))
      .filter((g) => g.notes.length > 0);
  });

  submitNote(): void {
    const text = this.draftText().trim();
    if (!text) return;
    
    const selection = this.notebookService.currentSelection();
    // Default to 'clip' and a generic placeholder if no selection is available
    const attachedToType = selection ? selection.type : 'clip';
    const attachedToId = selection ? selection.id : 'unknown';
    
    this.notebookService.addNote({
      text,
      attachedToType,
      attachedToId,
      timecode: this.mediaPlayer.currentTime() || 0,
    }).subscribe();
    this.draftText.set('');
  }

  deleteNote(noteId: string): void {
    this.notebookService.deleteNote(noteId).subscribe();
  }

  formatTimecode(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
