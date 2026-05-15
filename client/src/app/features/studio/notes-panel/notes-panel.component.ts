import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  computed,
  output,
} from '@angular/core';
import { TitleCasePipe, SlicePipe } from '@angular/common';
import { NotebookService } from '../../../core/services/notebook.service';
import { MediaPlayerService } from '../txt-media-player/media-player.service';
import { Note } from '../../../core/models/notebook.model';

@Component({
  selector: 'app-notes-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TitleCasePipe, SlicePipe],
  template: `
    <div class="notes-panel" role="complementary" aria-label="Notes">

      <!-- Creation form -->
      <div class="notes-add">

        <!-- Selection chip -->
        @if (notebookService.currentSelection(); as sel) {
          <div class="selection-chip selection-chip--active" aria-live="polite">
            <span class="material-symbols-outlined chip-icon">push_pin</span>
            <span>{{ sel.type | titlecase }}<span class="chip-id">: {{ sel.id | slice:0:12 }}</span></span>
          </div>
        } @else {
          <div class="selection-chip selection-chip--empty" aria-live="polite">
            <span class="material-symbols-outlined chip-icon">push_pin</span>
            <span>Nothing selected — will attach to clip</span>
          </div>
        }

        <textarea
          class="note-input"
          placeholder="Add a note…"
          rows="2"
          [value]="draftText()"
          (input)="draftText.set($any($event.target).value)"
          (keydown.ctrl.enter)="submitNote()"
          aria-label="New note text"
        ></textarea>

        <!-- Tag pill input -->
        <div class="tag-input-row" role="group" aria-label="Note tags">
          <span class="tag-row-label">Tags</span>
          <div class="tag-pills">
            @for (tag of draftTags(); track tag) {
              <span class="tag-pill">
                {{ tag }}
                <button
                  type="button"
                  class="tag-remove"
                  [attr.aria-label]="'Remove tag ' + tag"
                  (click)="removeDraftTag(tag)"
                >✕</button>
              </span>
            }
            <input
              class="tag-text-input"
              placeholder="add tag…"
              [value]="tagInput()"
              (input)="tagInput.set($any($event.target).value)"
              (keydown.enter)="$event.preventDefault(); addDraftTag()"
              (keydown.backspace)="onTagBackspace($any($event.target).value)"
              aria-label="Type a tag and press Enter"
            />
          </div>
        </div>

        <button
          type="button"
          class="add-btn"
          [disabled]="!draftText().trim()"
          (click)="submitNote()"
        >Add Note</button>
      </div>

      <!-- Tag filter bar (only when tags exist) -->
      @if (allTags().length > 0) {
        <div class="tag-filter-bar" role="group" aria-label="Filter notes by tag">
          <span class="tag-row-label">Filter</span>
          @for (tag of allTags(); track tag) {
            <button
              type="button"
              class="filter-tag"
              [class.filter-tag--active]="activeTagFilters().has(tag)"
              [attr.aria-pressed]="activeTagFilters().has(tag)"
              (click)="toggleFilter(tag)"
            >{{ tag }}</button>
          }
        </div>
      }

      <!-- Notes list -->
      @if (filteredGroupedNotes().length === 0) {
        <p class="empty-msg">
          @if (activeTagFilters().size > 0) {
            No notes match the active filter.
          } @else {
            No notes yet. Select a word, segment, or clip and add a note above.
          }
        </p>
      } @else {
        <div class="notes-list">
          @for (group of filteredGroupedNotes(); track group.type) {
            <div class="note-group">
              <div class="group-label">{{ group.type | titlecase }}</div>
              @for (note of group.notes; track note.id) {
                <div
                  class="note-item"
                  [attr.data-note-id]="note.id"
                  [class.highlighted]="notebookService.highlightedNoteId() === note.id"
                  [class.editing]="editingNoteId() === note.id"
                  (click)="onNoteClick(note)"
                >
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

                  <!-- Tags display (read mode) -->
                  @if (note.tags.length && editingNoteId() !== note.id) {
                    <div class="note-tags">
                      @for (tag of note.tags; track tag) {
                        <span class="note-tag">{{ tag }}</span>
                      }
                    </div>
                  }

                  <!-- Read mode body -->
                  @if (editingNoteId() !== note.id) {
                    <p class="note-text">{{ note.text }}</p>
                  }

                  <!-- Inline edit mode -->
                  @if (editingNoteId() === note.id) {
                    <div class="inline-edit" (click)="$event.stopPropagation()">
                      <textarea
                        class="note-input edit-textarea"
                        rows="3"
                        [value]="editText()"
                        (input)="editText.set($any($event.target).value)"
                        (keydown.ctrl.enter)="saveEdit(note)"
                        (keydown.escape)="cancelEdit()"
                        aria-label="Edit note text"
                      ></textarea>
                      <!-- Edit tag pills -->
                      <div class="tag-input-row" role="group" aria-label="Edit note tags">
                        <span class="tag-row-label">Tags</span>
                        <div class="tag-pills">
                          @for (tag of editTags(); track tag) {
                            <span class="tag-pill">
                              {{ tag }}
                              <button
                                type="button"
                                class="tag-remove"
                                [attr.aria-label]="'Remove tag ' + tag"
                                (click)="removeEditTag(tag)"
                              >✕</button>
                            </span>
                          }
                          <input
                            class="tag-text-input"
                            placeholder="add tag…"
                            [value]="editTagInput()"
                            (input)="editTagInput.set($any($event.target).value)"
                            (keydown.enter)="$event.preventDefault(); addEditTag()"
                            (keydown.backspace)="onEditTagBackspace($any($event.target).value)"
                            aria-label="Type a tag and press Enter"
                          />
                        </div>
                      </div>
                      <div class="edit-actions">
                        <button class="edit-cancel-btn" type="button" (click)="cancelEdit()">Cancel</button>
                        <button class="edit-save-btn" type="button" [disabled]="!editText().trim()" (click)="saveEdit(note)">Save</button>
                      </div>
                    </div>
                  }

                  <!-- Action buttons (hover) -->
                  @if (editingNoteId() !== note.id) {
                    <div class="note-actions">
                      <button
                        class="action-btn"
                        aria-label="Edit note"
                        title="Edit"
                        (click)="$event.stopPropagation(); startEdit(note)"
                      >
                        <span class="material-symbols-outlined icon-small">edit</span>
                      </button>
                      <button
                        class="action-btn action-btn--delete"
                        aria-label="Delete note"
                        title="Delete"
                        (click)="$event.stopPropagation(); deleteNote(note.id)"
                      >✕</button>
                    </div>
                  }
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

    /* ── Creation form ─────────────────────────────── */
    .notes-add {
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .selection-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.7rem;
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid;
      width: fit-content;

      .chip-icon { font-size: 13px; }
      .chip-id { opacity: 0.7; font-family: monospace; }
    }

    .selection-chip--active {
      color: var(--color-accent);
      background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    .selection-chip--empty {
      color: var(--color-muted);
      background: color-mix(in srgb, var(--color-muted) 5%, transparent);
      border-color: var(--color-border);
      border-style: dashed;
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

    .edit-textarea { margin-bottom: 4px; }

    /* ── Tag pill input ────────────────────────────── */
    .tag-input-row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tag-row-label {
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-muted);
      padding-top: 4px;
      flex-shrink: 0;
    }

    .tag-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
      flex: 1;
    }

    .tag-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--color-accent) 15%, transparent);
      color: var(--color-accent);
      border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .tag-remove {
      background: none;
      border: none;
      color: inherit;
      font-size: 0.55rem;
      cursor: pointer;
      padding: 0;
      opacity: 0.7;
      line-height: 1;
      &:hover { opacity: 1; }
    }

    .tag-text-input {
      background: none;
      border: none;
      outline: none;
      font-size: 0.7rem;
      color: var(--color-text);
      width: 70px;
      font-family: inherit;

      &::placeholder { color: var(--color-muted); }
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

    /* ── Tag filter bar ────────────────────────────── */
    .tag-filter-bar {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }

    .filter-tag {
      font-size: 0.65rem;
      padding: 2px 8px;
      border-radius: 10px;
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-muted);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.12s;

      &:hover { color: var(--color-text); border-color: var(--color-accent); }
    }

    .filter-tag--active {
      background: color-mix(in srgb, var(--color-accent) 20%, transparent);
      color: var(--color-accent);
      border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    }

    /* ── Notes list ────────────────────────────────── */
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

      &:hover .note-actions { opacity: 1; }

      &.highlighted {
        background: var(--color-surface-alt);
        border-left-color: var(--color-accent);
      }

      &.editing {
        cursor: default;
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

      .icon-small { font-size: 14px; }
    }

    .note-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      margin-bottom: 4px;
    }

    .note-tag {
      font-size: 0.6rem;
      padding: 1px 6px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--color-accent) 12%, transparent);
      color: var(--color-accent);
      border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
    }

    .note-text {
      margin: 0;
      font-size: 0.8rem;
      color: var(--color-text-secondary);
      line-height: 1.4;
      padding-right: 48px;
    }

    /* ── Note actions (hover) ──────────────────────── */
    .note-actions {
      position: absolute;
      top: 6px;
      right: 8px;
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .action-btn {
      background: none;
      border: none;
      color: var(--color-muted);
      font-size: 0.65rem;
      cursor: pointer;
      padding: 2px 3px;
      display: flex;
      align-items: center;
      border-radius: 3px;

      &:hover { color: var(--color-text); background: var(--color-border); }
    }

    .action-btn--delete:hover { color: var(--color-error, #e05c5c); background: none; }

    /* ── Inline edit ───────────────────────────────── */
    .inline-edit {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .edit-cancel-btn {
      background: none;
      border: 1px solid var(--color-border);
      color: var(--color-muted);
      border-radius: 4px;
      padding: 3px 10px;
      font-size: 0.7rem;
      font-family: inherit;
      cursor: pointer;

      &:hover { color: var(--color-text); }
    }

    .edit-save-btn {
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 3px 10px;
      font-size: 0.7rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;

      &:disabled { opacity: 0.4; cursor: default; }
      &:not(:disabled):hover { opacity: 0.85; }
    }
  `],
})
export class NotesPanelComponent {
  readonly notebookService = inject(NotebookService);
  private readonly mediaPlayer = inject(MediaPlayerService);
  readonly closed = output<void>();

  // Draft (creation)
  readonly draftText = signal('');
  readonly draftTags = signal<string[]>([]);
  readonly tagInput = signal('');

  // Filter
  readonly activeTagFilters = signal<Set<string>>(new Set());

  // Inline edit
  readonly editingNoteId = signal<string | null>(null);
  readonly editText = signal('');
  readonly editTags = signal<string[]>([]);
  readonly editTagInput = signal('');

  constructor() {
    effect(() => {
      const live = new Set(this.allTags());
      this.activeTagFilters.update((s) => {
        const pruned = new Set([...s].filter((t) => live.has(t)));
        return pruned.size !== s.size ? pruned : s;
      });
    });
  }

  readonly allTags = computed(() => {
    const tags = new Set<string>();
    for (const note of this.notebookService.notes()) {
      for (const tag of (note.tags ?? [])) tags.add(tag);
    }
    return Array.from(tags).sort();
  });

  readonly filteredNotes = computed(() => {
    const filters = this.activeTagFilters();
    if (filters.size === 0) return this.notebookService.notes();
    return this.notebookService.notes().filter((n) =>
      (n.tags ?? []).some((t) => filters.has(t))
    );
  });

  readonly filteredGroupedNotes = computed(() => {
    const notes = this.filteredNotes();
    const types: Array<'word' | 'segment' | 'clip'> = ['word', 'segment', 'clip'];
    return types
      .map((type) => ({ type, notes: notes.filter((n) => n.attachedToType === type) }))
      .filter((g) => g.notes.length > 0);
  });

  // ── Draft tag helpers ──────────────────────────────

  addDraftTag(): void {
    const raw = this.tagInput().trim().toLowerCase();
    if (!raw) return;
    const existing = this.draftTags();
    if (!existing.includes(raw) && existing.length < 10) {
      this.draftTags.update((t) => [...t, raw]);
    }
    this.tagInput.set('');
  }

  removeDraftTag(tag: string): void {
    this.draftTags.update((t) => t.filter((x) => x !== tag));
  }

  onTagBackspace(currentValue: string): void {
    if (currentValue === '') {
      this.draftTags.update((t) => t.slice(0, -1));
    }
  }

  // ── Edit tag helpers ───────────────────────────────

  addEditTag(): void {
    const raw = this.editTagInput().trim().toLowerCase();
    if (!raw) return;
    const existing = this.editTags();
    if (!existing.includes(raw) && existing.length < 10) {
      this.editTags.update((t) => [...t, raw]);
    }
    this.editTagInput.set('');
  }

  removeEditTag(tag: string): void {
    this.editTags.update((t) => t.filter((x) => x !== tag));
  }

  onEditTagBackspace(currentValue: string): void {
    if (currentValue === '') {
      this.editTags.update((t) => t.slice(0, -1));
    }
  }

  // ── Filter ─────────────────────────────────────────

  toggleFilter(tag: string): void {
    this.activeTagFilters.update((s) => {
      const next = new Set(s);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  onNoteClick(note: Note): void {
    if (this.editingNoteId() !== note.id) this.notebookService.clickNote(note);
  }

  // ── CRUD ───────────────────────────────────────────

  submitNote(): void {
    const text = this.draftText().trim();
    if (!text) return;
    const selection = this.notebookService.currentSelection();
    const attachedToType = selection ? selection.type : 'clip';
    const attachedToId = selection ? selection.id : 'unknown';
    this.notebookService.addNote({
      text,
      attachedToType,
      attachedToId,
      timecode: this.mediaPlayer.currentTime() || 0,
      tags: [...this.draftTags()],
    }).subscribe();
    this.draftText.set('');
    this.draftTags.set([]);
    this.tagInput.set('');
  }

  deleteNote(noteId: string): void {
    if (this.editingNoteId() === noteId) this.cancelEdit();
    this.notebookService.deleteNote(noteId).subscribe();
  }

  startEdit(note: Note): void {
    this.editingNoteId.set(note.id);
    this.editText.set(note.text);
    this.editTags.set([...(note.tags ?? [])]);
    this.editTagInput.set('');
  }

  saveEdit(note: Note): void {
    const text = this.editText().trim();
    if (!text) return;
    this.notebookService.updateNote(note.id, {
      text,
      tags: [...this.editTags()],
    }).subscribe();
    this.cancelEdit();
  }

  cancelEdit(): void {
    this.editingNoteId.set(null);
    this.editText.set('');
    this.editTags.set([]);
    this.editTagInput.set('');
  }

  formatTimecode(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
