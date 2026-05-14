# Notes Metadata & Creation Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tags` to notes, show selection context chip on creation, add tag filter bar and inline edit to the notes list.

**Architecture:** JSON file storage on server (no DB migration — just update interfaces). Three server files change (model, service, routes). Three client files change (model, service, notes panel component). The panel component carries all UI state as Angular signals.

**Tech Stack:** Angular 20 (standalone, signals, OnPush), Express (TypeScript), Vitest (server tests), JSON file storage.

---

## File Map

| File | Change |
|------|--------|
| `server/src/models/notebook.model.ts` | Add `tags: string[]`, `updatedAt: string` to `Note` |
| `server/src/services/notebook.service.ts` | Add `updateNote()`, fix `addNote` omit type |
| `server/src/services/notebook.service.test.ts` | New — vitest tests for `updateNote` + `addNote` tags |
| `server/src/routes/notebook.routes.ts` | Add `PUT /notebooks/:id/notes/:noteId` |
| `client/src/app/core/models/notebook.model.ts` | Add `tags: string[]`, `updatedAt: string` to `Note` |
| `client/src/app/core/services/notebook.service.ts` | Add `updateNote()` method |
| `client/src/app/features/studio/notes-panel/notes-panel.component.ts` | Full UI overhaul |

---

### Task 1: Update server Note model

**Files:**
- Modify: `server/src/models/notebook.model.ts`

- [ ] **Step 1: Update the Note interface**

```ts
export interface Note {
  id: string;
  notebookId: string;
  text: string;
  attachedToType: 'word' | 'segment' | 'clip';
  attachedToId: string;
  timecode: number;
  createdAt: string;
  updatedAt: string;   // new
  tags: string[];      // new
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/models/notebook.model.ts
git commit -m "feat(server): add tags and updatedAt to Note model"
```

---

### Task 2: Add updateNote to server service (TDD)

**Files:**
- Modify: `server/src/services/notebook.service.ts`
- Create: `server/src/services/notebook.service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/services/notebook.service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { notebookService } from './notebook.service';

// Temporarily redirect project storage to a temp dir
let tmpDir: string;
const originalEnv = process.env['STORAGE_DIR'];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-test-'));
  process.env['STORAGE_DIR'] = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env['STORAGE_DIR'];
  else process.env['STORAGE_DIR'] = originalEnv;
});

describe('notebookService.addNote', () => {
  it('persists tags and updatedAt on creation', () => {
    const nb = notebookService.create('proj-1', 'My Notebook', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const note = notebookService.addNote('proj-1', nb.id, {
      text: 'hello',
      attachedToType: 'clip',
      attachedToId: 'clip-1',
      timecode: 10,
      tags: ['pacing', 'audio'],
    });
    expect(note).not.toBeNull();
    expect(note!.tags).toEqual(['pacing', 'audio']);
    expect(note!.updatedAt).toBeTruthy();
  });

  it('defaults tags to [] when omitted', () => {
    const nb = notebookService.create('proj-2', 'NB', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const note = notebookService.addNote('proj-2', nb.id, {
      text: 'test',
      attachedToType: 'word',
      attachedToId: 'w-1',
      timecode: 0,
      tags: [],
    });
    expect(note!.tags).toEqual([]);
  });
});

describe('notebookService.updateNote', () => {
  it('updates text and tags, bumps updatedAt', async () => {
    const nb = notebookService.create('proj-3', 'NB', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const note = notebookService.addNote('proj-3', nb.id, {
      text: 'original',
      attachedToType: 'clip',
      attachedToId: 'clip-1',
      timecode: 5,
      tags: [],
    })!;

    await new Promise(r => setTimeout(r, 5)); // ensure timestamp differs

    const updated = notebookService.updateNote('proj-3', nb.id, note.id, {
      text: 'revised',
      tags: ['b-roll'],
    });
    expect(updated).not.toBeNull();
    expect(updated!.text).toBe('revised');
    expect(updated!.tags).toEqual(['b-roll']);
    expect(updated!.updatedAt).not.toBe(note.updatedAt);
    expect(updated!.createdAt).toBe(note.createdAt);
  });

  it('returns null when note does not exist', () => {
    const nb = notebookService.create('proj-4', 'NB', { wordStates: {}, cutRegions: {}, clipOrder: [] });
    const result = notebookService.updateNote('proj-4', nb.id, 'no-such-id', { text: 'x', tags: [] });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run src/services/notebook.service.test.ts
```

Expected: FAIL — `notebookService.updateNote is not a function` (or similar).

- [ ] **Step 3: Implement updateNote and fix addNote in the service**

In `server/src/services/notebook.service.ts`, update `addNote` to include `updatedAt` and `tags`, and add `updateNote`:

```ts
/** Add a note */
addNote(
  projectId: string,
  notebookId: string,
  data: Omit<Note, 'id' | 'notebookId' | 'createdAt' | 'updatedAt'>
): Note | null {
  if (!this.get(notebookId, projectId)) return null;
  const notes = readNotes(projectId, notebookId);
  const now = new Date().toISOString();
  const note: Note = {
    ...data,
    tags: data.tags ?? [],
    id: uuidv4(),
    notebookId,
    createdAt: now,
    updatedAt: now,
  };
  notes.push(note);
  writeNotes(projectId, notebookId, notes);
  return note;
}

/** Update note text and tags */
updateNote(
  projectId: string,
  notebookId: string,
  noteId: string,
  patch: { text: string; tags: string[] }
): Note | null {
  const notes = readNotes(projectId, notebookId);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return null;
  const updated: Note = {
    ...notes[idx]!,
    text: patch.text,
    tags: patch.tags,
    updatedAt: new Date().toISOString(),
  };
  notes[idx] = updated;
  writeNotes(projectId, notebookId, notes);
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run src/services/notebook.service.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Check if STORAGE_DIR is the right env var**

Open `server/src/utils/file.util.ts` and find the `getProjectDir` function. Confirm it reads `process.env['STORAGE_DIR']` (or whatever env var controls the path). If the env var name differs, update the test's `beforeEach` to match.

- [ ] **Step 6: Run full server test suite**

```bash
cd server && npx vitest run
```

Expected: all existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/notebook.service.ts server/src/services/notebook.service.test.ts
git commit -m "feat(server): add updateNote, persist tags and updatedAt on notes"
```

---

### Task 3: Add PUT route for notes

**Files:**
- Modify: `server/src/routes/notebook.routes.ts`

- [ ] **Step 1: Add the route after the existing POST /notes route**

Add this block in `server/src/routes/notebook.routes.ts` after the `POST /notebooks/:id/notes` handler:

```ts
/** PUT /api/notebooks/:id/notes/:noteId */
notebookRoutes.put('/notebooks/:id/notes/:noteId', (req: Request, res: Response) => {
  const { id, noteId } = req.params;
  const { projectId, text, tags } = req.body as {
    projectId?: string;
    text: string;
    tags: string[];
  };

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string' || t.length > 50)) {
    return res.status(400).json({ error: 'tags must be an array of strings (max 50 chars each)' });
  }
  if (tags.length > 10) {
    return res.status(400).json({ error: 'max 10 tags per note' });
  }

  let pid = projectId;
  if (!pid) {
    const { listProjectIds } = require('../utils/file.util') as typeof import('../utils/file.util');
    const ids = listProjectIds();
    for (const pId of ids) {
      const nb = notebookService.get(id as string, pId);
      if (nb) { pid = pId; break; }
    }
  }

  if (!pid) return res.status(404).json({ error: 'Notebook not found' });

  const updated = notebookService.updateNote(pid, id as string, noteId as string, {
    text: text.trim(),
    tags: tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
  });
  if (!updated) return res.status(404).json({ error: 'Note not found' });
  res.json(updated);
});
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/notebook.routes.ts
git commit -m "feat(server): add PUT /notebooks/:id/notes/:noteId route"
```

---

### Task 4: Update client Note model

**Files:**
- Modify: `client/src/app/core/models/notebook.model.ts`

- [ ] **Step 1: Add tags and updatedAt to the Note interface**

```ts
export interface Note {
  id: string;
  notebookId: string;
  text: string;
  attachedToType: 'word' | 'segment' | 'clip';
  attachedToId: string;
  timecode: number;
  createdAt: string;
  updatedAt: string;   // new
  tags: string[];      // new
}
```

- [ ] **Step 2: Check for TypeScript errors**

```bash
cd client && npx tsc --noEmit
```

Fix any errors before proceeding. Likely none since `tags` is additive and `updatedAt` is a string like `createdAt`.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/core/models/notebook.model.ts
git commit -m "feat(client): add tags and updatedAt to Note model"
```

---

### Task 5: Add updateNote to client NotebookService

**Files:**
- Modify: `client/src/app/core/services/notebook.service.ts`

- [ ] **Step 1: Add updateNote method**

In `client/src/app/core/services/notebook.service.ts`, add after `deleteNote`:

```ts
updateNote(noteId: string, patch: { text: string; tags: string[] }): Observable<Note> {
  const nb = this._requireActive();
  return this.api.put<Note>(`/notebooks/${nb.id}/notes/${noteId}`, patch).pipe(
    tap((updated) => this.notes.update((list) => list.map((n) => (n.id === updated.id ? updated : n))))
  );
}
```

- [ ] **Step 2: Update addNote call signature**

The `addNote` method's type parameter `Omit<Note, 'id' | 'notebookId' | 'createdAt'>` now also needs to exclude `updatedAt`. Update it:

```ts
addNote(note: Omit<Note, 'id' | 'notebookId' | 'createdAt' | 'updatedAt'>): Observable<Note> {
  const nb = this._requireActive();
  return this.api.post<Note>(`/notebooks/${nb.id}/notes`, note).pipe(
    tap((created) => this.notes.update((list) => [...list, created]))
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/app/core/services/notebook.service.ts
git commit -m "feat(client): add updateNote to NotebookService, fix addNote omit type"
```

---

### Task 6: Overhaul NotesPanelComponent

**Files:**
- Modify: `client/src/app/features/studio/notes-panel/notes-panel.component.ts`

This is the largest task. Replace the entire component. Read the current file first to preserve any logic not covered below.

- [ ] **Step 1: Replace the component**

Replace the full content of `client/src/app/features/studio/notes-panel/notes-panel.component.ts` with:

```ts
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
                  (click)="editingNoteId() === note.id ? null : notebookService.clickNote(note)"
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
                  @if (note.tags?.length && editingNoteId() !== note.id) {
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
    this.editingNoteId.set(null);
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd client && npx tsc --noEmit
```

Fix any errors. Common issues:
- If `color-mix` in CSS causes linting issues, replace with `rgba` fallbacks — it's purely cosmetic.
- If `slice` pipe is missing in imports, import `SlicePipe` from `@angular/common` and add to `imports: [TitleCasePipe, SlicePipe]`.

- [ ] **Step 3: Verify no IDE diagnostics**

In your IDE, open the component and confirm no red underlines on signal methods or template bindings.

- [ ] **Step 4: Start dev server and smoke-test**

```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm start
```

Open the app. In the notes panel:
1. Select a word in the transcript → chip should show `Word: <id>`.
2. Clear selection → chip should show dashed "Nothing selected".
3. Type a note, add tags (type + Enter), click "Add Note" → note appears with tag pills.
4. Hover a note → edit (pencil) and delete buttons appear.
5. Click pencil → inline edit form opens with pre-filled text and tags.
6. Edit text and tags, click Save → note updates in list.
7. If notes have tags, filter bar appears above the list. Clicking a tag filters notes.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/notes-panel/notes-panel.component.ts
git commit -m "feat(client): notes panel — selection chip, tags, inline edit, tag filter"
```

---

## Self-Review

**Spec coverage:**
- ✅ Selection chip (active + empty states)
- ✅ `tags: string[]` on Note model (client + server)
- ✅ `updatedAt` on Note model
- ✅ Tag pill input (add by Enter, remove by ✕ or Backspace)
- ✅ Tags displayed on each note item
- ✅ Tag filter bar (OR semantics, toggle)
- ✅ Inline edit (text + tags)
- ✅ `updateNote()` on both services
- ✅ `PUT /notebooks/:id/notes/:noteId` route
- ✅ Validation (max 10 tags, max 50 chars each)
- ✅ Tags lowercased + deduplicated before save

**Placeholder scan:** None found.

**Type consistency:**
- `draftTags` / `editTags` are `signal<string[]>` throughout.
- `updateNote(noteId, { text, tags })` signature matches service definition and component call.
- `Omit<Note, 'id' | 'notebookId' | 'createdAt' | 'updatedAt'>` used consistently in both client service and server service.
- `filteredGroupedNotes` derived from `filteredNotes` (not raw `notes()`).
