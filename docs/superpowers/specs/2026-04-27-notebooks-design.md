# Notebooks Feature Design

**Date:** 2026-04-27  
**Status:** Approved

---

## Overview

Notebooks are named save-states of a project's editing state. Each notebook captures a full snapshot of all cuts, pending cuts, and clip structure at save time. Multiple notebooks per project allow non-destructive parallel edit histories (e.g., "Draft Edit", "Final Cut"). Notes can be attached to individual words, segments, or clips with a timecode.

---

## Data Model

```typescript
interface Notebook {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  snapshot: NotebookSnapshot;
}

interface NotebookSnapshot {
  wordStates: Record<string, { isRemoved: boolean; isPendingCut: boolean }>;
  cutRegions: Record<string, CutRegion[]>;  // clipId → CutRegion[]
  clipOrder: string[];                       // ordered clip IDs
}

interface Note {
  id: string;
  notebookId: string;
  text: string;
  attachedToType: 'word' | 'segment' | 'clip';
  attachedToId: string;
  timecode: number;
  createdAt: string;
}
```

`notes` are separate entities (not embedded in snapshot) — queried independently per notebook.

---

## API Endpoints

```
GET    /api/projects/:projectId/notebooks     → Notebook[]
POST   /api/projects/:projectId/notebooks     → Notebook      (create with snapshot)
PUT    /api/notebooks/:id                     → Notebook      (rename and/or save snapshot)
DELETE /api/notebooks/:id                     → 204

GET    /api/notebooks/:id/notes               → Note[]
POST   /api/notebooks/:id/notes               → Note
DELETE /api/notebooks/:notebookId/notes/:noteId → 204
```

Save = PUT with full snapshot payload. No diff/delta.

**First load:** `loadAll()` called on studio init. If response is empty, auto-create a default notebook named "Default" with current snapshot.

---

## Client Architecture

### NotebookService (`core/services/notebook.service.ts`)

```typescript
// State signals
notebooks    = signal<Notebook[]>([]);
active       = signal<Notebook | null>(null);
isDirty      = signal<boolean>(false);
notes        = signal<Note[]>([]);

// Methods
loadAll(projectId: string): Observable<void>
create(name: string): Observable<Notebook>
save(): Observable<Notebook>           // captures snapshot from WordService + ClipService
switchTo(notebook: Notebook): void     // blocks if dirty → confirm dialog
rename(id: string, name: string): Observable<Notebook>
delete(id: string): Observable<void>
loadNotes(notebookId: string): Observable<void>
addNote(note: Omit<Note, 'id' | 'notebookId' | 'createdAt'>): Observable<Note>
deleteNote(noteId: string): Observable<void>
```

`isDirty` is set to `true` via an `effect()` that watches `WordService.words` and `ClipService.clips` signals. It resets to `false` after a successful `save()`.

`save()` reads current state from `WordService` and `ClipService` to build `NotebookSnapshot` — no coupling to component state.

`switchTo()` calls the existing `ConfirmDialog` if `isDirty` is true. On confirm, restores snapshot by calling `WordService` and `ClipService` mutation methods.

---

## UI Components

### Notebook Tabs Bar (`features/studio/notebook-tabs/`)

Browser-tab style row inserted between the main studio header and the player toolbar.

**Layout:**
```
[Draft Edit ✕]  [Final Cut ● ✕]  [Version 3 ✕]  ✱          [💾 Save]
                 ↑ active (purple glow, bottom border breaks)
                        ↑ amber dot = unsaved changes
```

**Interactions:**

| Action | Behavior |
|--------|----------|
| Edit word/cut/restore | `isDirty → true`, amber dot on active tab, Save button enables |
| Click Save | PUT snapshot → `isDirty → false`, dot clears |
| Click another tab (clean) | Switches immediately, restores snapshot |
| Click another tab (dirty) | Confirm dialog: Save / Discard / Cancel |
| Click ✕ on tab | If active + dirty → confirm; if inactive → delete confirm |
| Click ✱ | Creates "Untitled Notebook" with current snapshot, inline rename |
| Double-click tab name | Inline rename (input in-place) |

### Notes Panel (`features/studio/notes-panel/`)

Side panel toggled by a new "Notes" button in the main studio header nav row (alongside Plugins / Export), or by clicking a word's amber badge. Lists all notes for the active notebook, grouped by attachment type (clip / segment / word).

### Inline Note Indicator

Words/segments with attached notes show an amber superscript badge in the transcript. Click opens the notes panel scrolled to that note.

---

## New Files

```
client/src/app/core/models/notebook.model.ts
client/src/app/core/services/notebook.service.ts
client/src/app/features/studio/notebook-tabs/
  notebook-tabs.component.ts
  notebook-tabs.component.html
  notebook-tabs.component.scss
client/src/app/features/studio/notes-panel/
  notes-panel.component.ts
  notes-panel.component.html
  notes-panel.component.scss
```

### Modified Files

```
client/src/app/features/studio/studio.component.ts   ← add tabs row, notes panel
client/src/app/features/studio/studio.component.html
client/src/app/features/studio/studio.component.scss
```

---

## Out of Scope

- Notebook merge / diff view
- Export per-notebook
- Notebook sharing across projects
- Offline persistence (all state server-side, consistent with existing app)
