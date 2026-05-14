# Notes Metadata Visualization & Creation — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

## Problem

The notes panel has two significant gaps:

1. **Blind attachment** — when creating a note, nothing tells the user what entity (word / segment / clip) will be attached. Falls back to `attachedToType: 'clip'` and `attachedToId: 'unknown'` silently when `currentSelection` is null.
2. **No metadata on notes** — notes carry only `text + timecode + attachedTo`. No way to tag, categorize, or filter notes. Scanning 10+ notes is slow and requires reading every item.

Inline editing is also missing — a note typo requires delete + re-create (losing timecode).

## Out of Scope

- Priority / severity levels
- Status / resolution tracking
- Grouping by tag instead of by type
- Full-text search

## Data Model Changes

### Client (`client/src/app/core/models/notebook.model.ts`)

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
  tags: string[];      // new — default []
}
```

### Server (`server/src/models/notebook.model.ts`)

Mirror the same two fields. The `tags` field stores a JSON-serialized string array in SQLite or a `TEXT[]` column in Postgres.

### API

- `POST /notebooks/:id/notes` — accepts `tags?: string[]`
- `PUT /notebooks/:id/notes/:noteId` — new endpoint; accepts `{ text: string; tags: string[] }`
- `GET /notebooks/:id/notes` — returns `tags` and `updatedAt` on each note

## Creation UI (`notes-panel.component.ts`)

**Selection chip** rendered above the textarea:

- When `currentSelection()` is non-null: purple chip showing entity type + preview (e.g. `📌 Word: "hello"` / `📌 Segment 3` / `📌 Clip: Interview.mp4`).
- When null: muted dashed chip `📌 Nothing selected — will attach to clip`. Note creation still allowed; the existing fallback behavior is preserved but made visible.

**Tag input** rendered below the textarea, above the Add button:

- Existing tags shown as removable pill chips (purple tint).
- Plain text input at end of pill list: type a tag + press Enter to add; Backspace on empty input removes last tag.
- Tags stored as `signal<string[]>` in component, reset on `submitNote()`.
- Tags are lowercased and deduplicated before save.

## Notes List (`notes-panel.component.ts`)

### Tag filter bar

Rendered between the add-form section and the notes list. Only visible when at least one note has at least one tag.

- Shows all unique tags across all loaded notes as clickable pills.
- Active filter tags highlighted (purple). Click to toggle.
- Multiple active tags = OR filter (note shown if it has any active tag).
- `activeTagFilters = signal<Set<string>>(new Set())` in component.
- `filteredNotes = computed(...)` derived from `notes()` + `activeTagFilters()`.
- `groupedNotes` computed from `filteredNotes` (not raw `notes()`).

### Note item

Each note item gains:

- **Tag pills** — rendered below timecode/type row, above note text. Same pill style as creation form (smaller, read-only).
- **Edit button** (pencil icon) — appears on hover alongside existing delete button. Clicking sets `editingNoteId` signal and renders an inline edit form replacing the note text.

### Inline edit form

Replaces note body when editing:

- Textarea pre-filled with current `note.text`.
- Tag pill input pre-filled with current `note.tags`.
- Save (Ctrl+Enter or button) → calls `updateNote()` → `PUT /notebooks/:id/notes/:noteId`.
- Cancel → restores read view, no change.
- `editingNoteId = signal<string | null>(null)` in component.

### `updateNote()` in `NotebookService`

```ts
updateNote(noteId: string, patch: { text: string; tags: string[] }): Observable<Note> {
  const nb = this._requireActive();
  return this.api.put<Note>(`/notebooks/${nb.id}/notes/${noteId}`, patch).pipe(
    tap((updated) => this.notes.update((list) => list.map((n) => (n.id === updated.id ? updated : n))))
  );
}
```

## Component State Summary (`NotesPanelComponent`)

| Signal | Type | Purpose |
|--------|------|---------|
| `draftText` | `signal<string>` | existing |
| `draftTags` | `signal<string[]>` | new — tags for note being created |
| `tagInput` | `signal<string>` | new — current text in tag text field |
| `activeTagFilters` | `signal<Set<string>>` | new — active filter tags |
| `editingNoteId` | `signal<string \| null>` | new — which note is in edit mode |
| `editText` | `signal<string>` | new — draft text for inline edit |
| `editTags` | `signal<string[]>` | new — draft tags for inline edit |

## Server Route Changes

- Add `PUT /notebooks/:notebookId/notes/:noteId` route handler.
- Validate `text` (non-empty string) and `tags` (array of strings, max 10, each max 50 chars).
- Update `updatedAt` on save.

## Files Changed

| File | Change |
|------|--------|
| `client/src/app/core/models/notebook.model.ts` | Add `tags`, `updatedAt` to `Note` |
| `client/src/app/core/services/notebook.service.ts` | Add `updateNote()` |
| `client/src/app/features/studio/notes-panel/notes-panel.component.ts` | Full UI overhaul |
| `server/src/models/notebook.model.ts` | Add `tags`, `updatedAt` |
| `server/src/services/notebook.service.ts` | Add update-note logic + DB migration |
| `server/src/routes/notebook.routes.ts` | Add PUT route |
