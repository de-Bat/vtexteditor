# Notebooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named notebook save-states to VTextStudio so users can snapshot and restore editing state (word cuts, pending cuts, clip order) and attach timestamped notes to words/segments/clips.

**Architecture:** Full-snapshot model — each notebook stores a complete copy of editing state. `NotebookService` owns all signals and CRUD. A new `notebook-tabs` component renders browser-style tabs in the studio header. Notes are stored as separate entities attached to words/segments/clips by ID.

**Tech Stack:** Angular 20+, Angular Signals, `HttpTestingController` (Vitest), `ApiService`, `ConfirmService`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `client/src/app/core/models/notebook.model.ts` | `Notebook`, `NotebookSnapshot`, `Note` interfaces |
| Create | `client/src/app/core/services/notebook.service.ts` | All notebook CRUD + state signals |
| Create | `client/src/app/core/services/notebook.service.spec.ts` | Unit tests for service |
| Create | `client/src/app/features/studio/notebook-tabs/notebook-tabs.component.ts` | Tab bar UI |
| Create | `client/src/app/features/studio/notes-panel/notes-panel.component.ts` | Notes side panel |
| Modify | `client/src/app/features/studio/studio.component.ts` | Add tabs row + notes panel + Notes nav button |

---

## Task 1: Data Model

**Files:**
- Create: `client/src/app/core/models/notebook.model.ts`

- [ ] **Step 1: Create the model file**

```typescript
// client/src/app/core/models/notebook.model.ts
import { CutRegion } from './cut-region.model';

export interface NotebookSnapshot {
  wordStates: Record<string, { isRemoved: boolean; isPendingCut: boolean }>;
  cutRegions: Record<string, CutRegion[]>;
  clipOrder: string[];
}

export interface Notebook {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  snapshot: NotebookSnapshot;
}

export interface Note {
  id: string;
  notebookId: string;
  text: string;
  attachedToType: 'word' | 'segment' | 'clip';
  attachedToId: string;
  timecode: number;
  createdAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/app/core/models/notebook.model.ts
git commit -m "feat(notebooks): add Notebook, NotebookSnapshot, Note model interfaces"
```

---

## Task 2: NotebookService

**Files:**
- Create: `client/src/app/core/services/notebook.service.ts`

- [ ] **Step 1: Create the service**

```typescript
// client/src/app/core/services/notebook.service.ts
import { Injectable, inject, signal, effect } from '@angular/core';
import { Observable, tap, switchMap, map } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { ClipService } from './clip.service';
import { ConfirmService } from './confirm.service';
import { Notebook, Note, NotebookSnapshot } from '../models/notebook.model';
import { CutRegion } from '../models/cut-region.model';

@Injectable({ providedIn: 'root' })
export class NotebookService {
  private readonly api = inject(ApiService);
  private readonly clipService = inject(ClipService);
  private readonly confirmService = inject(ConfirmService);

  readonly notebooks = signal<Notebook[]>([]);
  readonly active = signal<Notebook | null>(null);
  readonly isDirty = signal(false);
  readonly notes = signal<Note[]>([]);

  private _suppressDirty = false;

  constructor() {
    effect(() => {
      // Track clips signal — any mutation marks active notebook dirty
      this.clipService.clips();
      if (!this._suppressDirty && this.active() !== null) {
        this.isDirty.set(true);
      }
    });
  }

  loadAll(projectId: string): Observable<void> {
    return this.api.get<Notebook[]>(`/projects/${projectId}/notebooks`).pipe(
      tap((list) => {
        this.notebooks.set(list);
        if (list.length > 0 && this.active() === null) {
          this._suppressDirty = true;
          this.active.set(list[0]);
          this._suppressDirty = false;
          this.isDirty.set(false);
        }
      }),
      map(() => void 0)
    );
  }

  create(name: string): Observable<Notebook> {
    const projectId = this._requireProjectId();
    const snapshot = this._captureSnapshot();
    return this.api.post<Notebook>(`/projects/${projectId}/notebooks`, { name, snapshot }).pipe(
      tap((nb) => {
        this.notebooks.update((list) => [...list, nb]);
        this._suppressDirty = true;
        this.active.set(nb);
        this._suppressDirty = false;
        this.isDirty.set(false);
        this.notes.set([]);
      })
    );
  }

  save(): Observable<Notebook> {
    const nb = this._requireActive();
    const snapshot = this._captureSnapshot();
    return this.api.put<Notebook>(`/notebooks/${nb.id}`, { name: nb.name, snapshot }).pipe(
      tap((updated) => {
        this.notebooks.update((list) => list.map((n) => (n.id === updated.id ? updated : n)));
        this.active.set(updated);
        this.isDirty.set(false);
      })
    );
  }

  async switchTo(notebook: Notebook): Promise<void> {
    if (this.active()?.id === notebook.id) return;

    if (this.isDirty()) {
      const confirmed = await this.confirmService.confirm({
        title: 'Unsaved changes',
        message: `Switching notebooks will discard unsaved changes to "${this.active()?.name}".`,
        confirmLabel: 'Switch Anyway',
        cancelLabel: 'Cancel',
        isDestructive: true,
      });
      if (!confirmed) return;
    }

    this._suppressDirty = true;
    this._applySnapshot(notebook.snapshot);
    this.active.set(notebook);
    this._suppressDirty = false;
    this.isDirty.set(false);
    this.loadNotes(notebook.id).subscribe();
  }

  rename(id: string, name: string): Observable<Notebook> {
    const nb = this.notebooks().find((n) => n.id === id);
    if (!nb) throw new Error(`Notebook ${id} not found`);
    return this.api.put<Notebook>(`/notebooks/${id}`, { name, snapshot: nb.snapshot }).pipe(
      tap((updated) => {
        this.notebooks.update((list) => list.map((n) => (n.id === updated.id ? updated : n)));
        if (this.active()?.id === updated.id) this.active.set(updated);
      })
    );
  }

  delete(id: string): Observable<void> {
    return this.api.delete<void>(`/notebooks/${id}`).pipe(
      tap(() => {
        const remaining = this.notebooks().filter((n) => n.id !== id);
        this.notebooks.set(remaining);
        if (this.active()?.id === id) {
          const next = remaining[0] ?? null;
          if (next) {
            this._suppressDirty = true;
            this._applySnapshot(next.snapshot);
            this.active.set(next);
            this._suppressDirty = false;
            this.isDirty.set(false);
            this.loadNotes(next.id).subscribe();
          } else {
            this.active.set(null);
          }
        }
      })
    );
  }

  loadNotes(notebookId: string): Observable<void> {
    return this.api.get<Note[]>(`/notebooks/${notebookId}/notes`).pipe(
      tap((n) => this.notes.set(n)),
      map(() => void 0)
    );
  }

  addNote(note: Omit<Note, 'id' | 'notebookId' | 'createdAt'>): Observable<Note> {
    const nb = this._requireActive();
    return this.api.post<Note>(`/notebooks/${nb.id}/notes`, note).pipe(
      tap((created) => this.notes.update((list) => [...list, created]))
    );
  }

  deleteNote(noteId: string): Observable<void> {
    const nb = this._requireActive();
    return this.api.delete<void>(`/notebooks/${nb.id}/notes/${noteId}`).pipe(
      tap(() => this.notes.update((list) => list.filter((n) => n.id !== noteId)))
    );
  }

  private _captureSnapshot(): NotebookSnapshot {
    const clips = this.clipService.clips();
    const wordStates: Record<string, { isRemoved: boolean; isPendingCut: boolean }> = {};
    const cutRegions: Record<string, CutRegion[]> = {};

    for (const clip of clips) {
      const pendingWordIds = new Set(
        clip.cutRegions.filter((cr) => cr.pending).flatMap((cr) => cr.wordIds)
      );
      for (const seg of clip.segments) {
        for (const word of seg.words) {
          wordStates[word.id] = {
            isRemoved: word.isRemoved,
            isPendingCut: pendingWordIds.has(word.id),
          };
        }
      }
      cutRegions[clip.id] = clip.cutRegions;
    }

    return { wordStates, cutRegions, clipOrder: clips.map((c) => c.id) };
  }

  private _applySnapshot(snapshot: NotebookSnapshot): void {
    const clips = this.clipService.clips();
    for (const clip of clips) {
      const updatedSegments = clip.segments.map((seg) => ({
        ...seg,
        words: seg.words.map((word) => ({
          ...word,
          isRemoved: snapshot.wordStates[word.id]?.isRemoved ?? word.isRemoved,
        })),
      }));
      const restoredCutRegions = snapshot.cutRegions[clip.id] ?? [];
      this.clipService.applyLocalUpdate({
        ...clip,
        segments: updatedSegments,
        cutRegions: restoredCutRegions,
      });
    }
  }

  private _requireActive(): Notebook {
    const nb = this.active();
    if (!nb) throw new Error('No active notebook');
    return nb;
  }

  private _requireProjectId(): string {
    const nb = this.notebooks()[0];
    if (nb) return nb.projectId;
    throw new Error('No notebooks loaded — projectId unknown');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/app/core/services/notebook.service.ts
git commit -m "feat(notebooks): add NotebookService with signals, CRUD, snapshot capture/restore"
```

---

## Task 3: NotebookService Tests

**Files:**
- Create: `client/src/app/core/services/notebook.service.spec.ts`

- [ ] **Step 1: Write the tests**

```typescript
// client/src/app/core/services/notebook.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NotebookService } from './notebook.service';
import { ClipService } from './clip.service';
import { Notebook, Note } from '../models/notebook.model';
import { Clip } from '../models/clip.model';

const MOCK_CLIP: Clip = {
  id: 'clip-1',
  projectId: 'proj-1',
  name: 'Clip 1',
  startTime: 0,
  endTime: 10,
  cutRegions: [],
  segments: [
    {
      id: 'seg-1',
      clipId: 'clip-1',
      startTime: 0,
      endTime: 10,
      text: 'hello world',
      tags: [],
      words: [
        { id: 'w-1', segmentId: 'seg-1', text: 'hello', startTime: 0, endTime: 1, isRemoved: false },
        { id: 'w-2', segmentId: 'seg-1', text: 'world', startTime: 1, endTime: 2, isRemoved: true },
      ],
    },
  ],
};

const MOCK_NOTEBOOK: Notebook = {
  id: 'nb-1',
  projectId: 'proj-1',
  name: 'Draft',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  snapshot: {
    wordStates: { 'w-1': { isRemoved: false, isPendingCut: false }, 'w-2': { isRemoved: true, isPendingCut: false } },
    cutRegions: { 'clip-1': [] },
    clipOrder: ['clip-1'],
  },
};

describe('NotebookService', () => {
  let service: NotebookService;
  let clipService: ClipService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotebookService);
    clipService = TestBed.inject(ClipService);
    httpMock = TestBed.inject(HttpTestingController);
    clipService.clips.set([MOCK_CLIP]);
  });

  afterEach(() => httpMock.verify());

  it('loadAll sets notebooks signal and activates first', () => {
    service.loadAll('proj-1').subscribe();
    httpMock.expectOne('/api/projects/proj-1/notebooks').flush([MOCK_NOTEBOOK]);

    expect(service.notebooks()).toHaveLength(1);
    expect(service.active()?.id).toBe('nb-1');
    expect(service.isDirty()).toBe(false);
  });

  it('create posts snapshot and activates new notebook', () => {
    let result: Notebook | undefined;
    service.create('My Notebook').subscribe((nb) => (result = nb));

    const req = httpMock.expectOne('/api/projects/proj-1/notebooks');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.name).toBe('My Notebook');
    expect(req.request.body.snapshot.clipOrder).toEqual(['clip-1']);
    req.flush({ ...MOCK_NOTEBOOK, id: 'nb-2', name: 'My Notebook' });

    expect(result?.name).toBe('My Notebook');
    expect(service.active()?.id).toBe('nb-2');
    expect(service.isDirty()).toBe(false);
  });

  it('save puts current snapshot and clears isDirty', () => {
    service.notebooks.set([MOCK_NOTEBOOK]);
    service.active.set(MOCK_NOTEBOOK);
    service.isDirty.set(true);

    service.save().subscribe();

    const req = httpMock.expectOne('/api/notebooks/nb-1');
    expect(req.request.method).toBe('PUT');
    req.flush({ ...MOCK_NOTEBOOK, updatedAt: '2026-01-02T00:00:00Z' });

    expect(service.isDirty()).toBe(false);
  });

  it('rename updates notebook name in list and active', () => {
    service.notebooks.set([MOCK_NOTEBOOK]);
    service.active.set(MOCK_NOTEBOOK);

    service.rename('nb-1', 'Final Cut').subscribe();

    const req = httpMock.expectOne('/api/notebooks/nb-1');
    expect(req.request.body.name).toBe('Final Cut');
    req.flush({ ...MOCK_NOTEBOOK, name: 'Final Cut' });

    expect(service.notebooks()[0].name).toBe('Final Cut');
    expect(service.active()?.name).toBe('Final Cut');
  });

  it('delete removes notebook and activates next', () => {
    const nb2: Notebook = { ...MOCK_NOTEBOOK, id: 'nb-2', name: 'Other' };
    service.notebooks.set([MOCK_NOTEBOOK, nb2]);
    service.active.set(MOCK_NOTEBOOK);

    service.delete('nb-1').subscribe();
    httpMock.expectOne('/api/notebooks/nb-1').flush(null);
    // loadNotes fires for next notebook
    httpMock.expectOne('/api/notebooks/nb-2/notes').flush([]);

    expect(service.notebooks()).toHaveLength(1);
    expect(service.active()?.id).toBe('nb-2');
  });

  it('addNote posts and appends to notes signal', () => {
    service.active.set(MOCK_NOTEBOOK);
    const payload = { text: 'Check this', attachedToType: 'word' as const, attachedToId: 'w-1', timecode: 1.5 };

    service.addNote(payload).subscribe();

    const req = httpMock.expectOne('/api/notebooks/nb-1/notes');
    expect(req.request.method).toBe('POST');
    const created: Note = { ...payload, id: 'note-1', notebookId: 'nb-1', createdAt: '2026-01-01T00:00:00Z' };
    req.flush(created);

    expect(service.notes()).toHaveLength(1);
    expect(service.notes()[0].id).toBe('note-1');
  });

  it('deleteNote removes from notes signal', () => {
    const note: Note = { id: 'note-1', notebookId: 'nb-1', text: 'x', attachedToType: 'word', attachedToId: 'w-1', timecode: 0, createdAt: '' };
    service.active.set(MOCK_NOTEBOOK);
    service.notes.set([note]);

    service.deleteNote('note-1').subscribe();
    httpMock.expectOne('/api/notebooks/nb-1/notes/note-1').flush(null);

    expect(service.notes()).toHaveLength(0);
  });

  it('_captureSnapshot records isRemoved and cutRegions', () => {
    service.notebooks.set([MOCK_NOTEBOOK]);
    service.active.set(MOCK_NOTEBOOK);
    service.isDirty.set(false);

    // Trigger save to capture snapshot
    service.save().subscribe();
    const req = httpMock.expectOne('/api/notebooks/nb-1');
    const body = req.request.body;

    expect(body.snapshot.wordStates['w-1'].isRemoved).toBe(false);
    expect(body.snapshot.wordStates['w-2'].isRemoved).toBe(true);
    expect(body.snapshot.clipOrder).toEqual(['clip-1']);
    req.flush(MOCK_NOTEBOOK);
  });
});
```

- [ ] **Step 2: Run tests and verify they pass**

```bash
cd client && ng test --include="**/notebook.service.spec.ts"
```

Expected: All 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/core/services/notebook.service.spec.ts
git commit -m "test(notebooks): add NotebookService unit tests"
```

---

## Task 4: NotebookTabs Component

**Files:**
- Create: `client/src/app/features/studio/notebook-tabs/notebook-tabs.component.ts`

- [ ] **Step 1: Create the component**

```typescript
// client/src/app/features/studio/notebook-tabs/notebook-tabs.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChildren,
  QueryList,
  inject,
  signal,
  computed,
} from '@angular/core';
import { NotebookService } from '../../../core/services/notebook.service';
import { Notebook } from '../../../core/models/notebook.model';

@Component({
  selector: 'app-notebook-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notebook-bar" role="tablist" aria-label="Notebooks">
      @for (nb of notebookService.notebooks(); track nb.id) {
        <div
          class="tab"
          role="tab"
          [class.active]="nb.id === notebookService.active()?.id"
          [attr.aria-selected]="nb.id === notebookService.active()?.id"
          [attr.tabindex]="nb.id === notebookService.active()?.id ? 0 : -1"
          (click)="onTabClick(nb)"
          (dblclick)="startRename(nb)"
          (keydown.enter)="onTabClick(nb)"
          (keydown.F2)="startRename(nb)"
        >
          @if (renamingId() === nb.id) {
            <input
              class="rename-input"
              [value]="nb.name"
              (blur)="commitRename(nb, $any($event.target).value)"
              (keydown.enter)="commitRename(nb, $any($event.target).value)"
              (keydown.escape)="renamingId.set(null)"
              (click)="$event.stopPropagation()"
            />
          } @else {
            <span class="tab-name">{{ nb.name }}</span>
            @if (nb.id === notebookService.active()?.id && notebookService.isDirty()) {
              <span class="dirty-dot" aria-label="Unsaved changes" title="Unsaved changes"></span>
            }
          }
          <button
            class="tab-close"
            [attr.aria-label]="'Close ' + nb.name"
            (click)="onCloseClick(nb, $event)"
          >✕</button>
        </div>
      }

      <button
        class="new-tab-btn"
        title="New Notebook"
        aria-label="New Notebook"
        (click)="createNotebook()"
      >✱</button>

      <div class="tab-spacer"></div>

      <button
        class="save-btn"
        [disabled]="!notebookService.isDirty()"
        [attr.aria-disabled]="!notebookService.isDirty()"
        (click)="save()"
        title="Save notebook"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save
      </button>
    </div>
  `,
  styles: [`
    .notebook-bar {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding: 0 1rem;
      background: var(--color-bg);
      border-bottom: 2px solid var(--color-accent);
      min-height: 34px;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 6px 6px 0 0;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      background: var(--color-surface-alt);
      color: var(--color-muted);
      border: 1px solid var(--color-border);
      border-bottom: none;
      margin-bottom: -2px;
      transition: background 0.15s;
      user-select: none;

      &:hover {
        background: var(--color-surface);
        color: var(--color-text-secondary);
      }

      &.active {
        background: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg));
        color: var(--color-text);
        font-weight: 600;
        border-color: var(--color-accent);
        border-bottom-color: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg));
        box-shadow: 0 -2px 8px color-mix(in srgb, var(--color-accent) 25%, transparent);
      }
    }

    .tab-name {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f59e0b;
      flex-shrink: 0;
    }

    .rename-input {
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--color-accent);
      color: var(--color-text);
      font-size: 0.75rem;
      font-weight: 600;
      font-family: inherit;
      outline: none;
      width: 100px;
      padding: 0;
    }

    .tab-close {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: 0.65rem;
      padding: 0 2px;
      line-height: 1;
      opacity: 0.5;
      transition: opacity 0.15s;

      &:hover {
        opacity: 1;
        color: var(--color-text);
      }
    }

    .new-tab-btn {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: 1rem;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
      align-self: center;
      margin-bottom: 2px;
      transition: color 0.15s;

      &:hover {
        color: var(--color-text);
      }
    }

    .tab-spacer {
      flex: 1;
    }

    .save-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 3px 10px;
      font-size: 0.75rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      margin-bottom: 4px;
      transition: opacity 0.15s;

      &:disabled {
        opacity: 0.35;
        cursor: default;
      }

      &:not(:disabled):hover {
        opacity: 0.85;
      }
    }
  `],
})
export class NotebookTabsComponent {
  readonly notebookService = inject(NotebookService);
  readonly renamingId = signal<string | null>(null);

  onTabClick(nb: Notebook): void {
    this.notebookService.switchTo(nb);
  }

  startRename(nb: Notebook): void {
    this.renamingId.set(nb.id);
    // Focus the input on the next tick
    setTimeout(() => {
      const input = document.querySelector('.rename-input') as HTMLInputElement | null;
      input?.select();
    });
  }

  commitRename(nb: Notebook, name: string): void {
    const trimmed = name.trim();
    this.renamingId.set(null);
    if (trimmed && trimmed !== nb.name) {
      this.notebookService.rename(nb.id, trimmed).subscribe();
    }
  }

  onCloseClick(nb: Notebook, event: MouseEvent): void {
    event.stopPropagation();
    this.notebookService.delete(nb.id).subscribe();
  }

  createNotebook(): void {
    this.notebookService.create('Untitled Notebook').subscribe((nb) => {
      this.startRename(nb);
    });
  }

  save(): void {
    this.notebookService.save().subscribe();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/app/features/studio/notebook-tabs/notebook-tabs.component.ts
git commit -m "feat(notebooks): add NotebookTabsComponent with browser-tab UI"
```

---

## Task 5: NotesPanel Component

**Files:**
- Create: `client/src/app/features/studio/notes-panel/notes-panel.component.ts`

- [ ] **Step 1: Create the component**

```typescript
// client/src/app/features/studio/notes-panel/notes-panel.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  output,
} from '@angular/core';
import { NotebookService } from '../../../core/services/notebook.service';
import { Note } from '../../../core/models/notebook.model';

@Component({
  selector: 'app-notes-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notes-panel" role="complementary" aria-label="Notes">
      <div class="notes-header">
        <span class="notes-title">Notes</span>
        <span class="notes-notebook">{{ notebookService.active()?.name }}</span>
        <button class="close-btn" aria-label="Close notes panel" (click)="closed.emit()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

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
                <div class="note-item" [attr.data-note-id]="note.id">
                  <div class="note-meta">
                    <span class="note-timecode">{{ formatTimecode(note.timecode) }}</span>
                    <span class="note-attached">{{ note.attachedToId }}</span>
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
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      min-width: 260px;
      max-width: 320px;
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

      &:hover .delete-note { opacity: 1; }
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

    .note-attached {
      font-size: 0.7rem;
      color: var(--color-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
    this.notebookService.addNote({
      text,
      attachedToType: 'clip',
      attachedToId: '',
      timecode: 0,
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
```

> **Note:** `attachedToType`, `attachedToId`, and `timecode` default to `'clip'`, `''`, and `0` for generic notes. Future work can wire these to the selected word/segment context.

- [ ] **Step 2: Commit**

```bash
git add client/src/app/features/studio/notes-panel/notes-panel.component.ts
git commit -m "feat(notebooks): add NotesPanelComponent"
```

---

## Task 6: Wire into StudioComponent

**Files:**
- Modify: `client/src/app/features/studio/studio.component.ts`

- [ ] **Step 1: Import new components and service**

In `studio.component.ts`, add these imports at the top of the file alongside existing ones:

```typescript
import { NotebookService } from '../../core/services/notebook.service';
import { NotebookTabsComponent } from './notebook-tabs/notebook-tabs.component';
import { NotesPanelComponent } from './notes-panel/notes-panel.component';
```

- [ ] **Step 2: Add `NotebookTabsComponent` and `NotesPanelComponent` to the `imports` array**

In the `@Component` decorator `imports` array, add:

```typescript
imports: [
  CommonModule,
  RouterLink,
  ClipListComponent,
  TxtMediaPlayerV2Component,
  ExportPanelComponent,
  StoryReviewPanelComponent,
  PluginPanelComponent,
  NotebookTabsComponent,   // ← add
  NotesPanelComponent,     // ← add
],
```

- [ ] **Step 3: Add `showNotesPanel` signal and inject `NotebookService`**

In the `StudioComponent` class body, add after the existing signals:

```typescript
readonly showNotesPanel = signal(false);
readonly notebookService = inject(NotebookService);
```

Remove `private storyApi = inject(StoryApiService);` and re-add with the existing injection pattern (keep `storyApi` and `dialog` as they are, just insert the new ones alongside).

The final injections section should look like:

```typescript
private dialog = inject(Dialog);
private storyApi = inject(StoryApiService);
readonly notebookService = inject(NotebookService);
```

- [ ] **Step 4: Load notebooks on init — add to `ngOnInit`**

Inside `ngOnInit`, after the `clipService.loadAll()` subscribe block, add:

```typescript
this.projectService.load().subscribe({
  next: (project) => {
    this.checkForProposal(project?.id);
    if (project?.id) {
      this.notebookService.loadAll(project.id).subscribe({
        next: () => {
          if (this.notebookService.notebooks().length === 0) {
            this.notebookService.create('Default').subscribe();
          }
        },
      });
    }
  },
});
```

> **Important:** The existing `ngOnInit` already calls `this.projectService.load()`. Replace that existing call with this expanded version so we don't double-load the project. The complete `ngOnInit` should call `projectService.load()` once, `clipService.loadAll()` once, and `settingsService.load()` once.

- [ ] **Step 5: Add "Notes" nav button to header**

In the template, inside `<nav class="studio-nav">`, add this button after the Export button:

```html
<button
  class="export-toggle-btn"
  [class.active]="showNotesPanel()"
  (click)="showNotesPanel.update(v => !v)"
  title="Toggle Notes Panel"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
  <span>Notes</span>
</button>
```

- [ ] **Step 6: Add notebook tabs row between header and main body**

In the template, after the closing `</header>` tag and before the `@if (pendingProposal())` block, insert:

```html
<app-notebook-tabs />
```

- [ ] **Step 7: Add notes panel as a resizable sidebar in the studio body**

Inside `<main class="studio-body">`, add the notes panel alongside the existing panels. Insert before the closing `</main>` tag (after the `@if (showReviewPanel() && pendingProposal())` block):

```html
@if (showNotesPanel()) {
  <aside class="side-panel-wrapper notes-wrapper opened" [style.order]="isRtl() ? 0 : 8">
    <app-notes-panel (closed)="showNotesPanel.set(false)" />
  </aside>
}
```

- [ ] **Step 8: Add notes panel CSS in the component styles**

In the `styles` array, add the following inside the existing `` styles: [` ... `] ``:

```css
.notes-wrapper {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--color-border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 9: Commit**

```bash
git add client/src/app/features/studio/studio.component.ts
git commit -m "feat(notebooks): wire NotebookTabs and NotesPanel into StudioComponent"
```

---

## Task 7: Smoke Test in Browser

- [ ] **Step 1: Start the dev server**

```bash
cd client && ng serve
```

- [ ] **Step 2: Verify the following in the browser**

Open `http://localhost:4200/studio` (or the configured dev port).

| Check | Expected |
|-------|----------|
| Notebook tabs row visible | Purple underline, browser-tab style |
| Default notebook auto-created | "Default" tab appears if no notebooks existed |
| Click ✱ | Creates "Untitled Notebook", inline rename opens |
| Type a name + Enter | Tab renames |
| Make an edit (remove a word) | Amber dot appears on active tab, Save button enables |
| Click Save | Dot disappears, Save grays out |
| Click another tab (dirty) | Confirm dialog: "Switch Anyway / Cancel" |
| Click Notes in header | Notes panel slides open |
| Type a note + Enter | Note appears in list |
| Click ✕ on note | Note removed |
| Refresh page | Notebooks reload, active notebook restored |

- [ ] **Step 3: Fix any issues found, then commit**

---

## Self-Review Checklist

- [x] Task 1 covers `Notebook`, `NotebookSnapshot`, `Note` models from spec
- [x] Task 2 covers all `NotebookService` methods from spec
- [x] Task 3 covers unit tests for service
- [x] Task 4 covers tab bar UI with all interactions from spec
- [x] Task 5 covers notes panel
- [x] Task 6 covers studio wiring (tabs row, notes nav button, panel, init load, auto-create default)
- [x] `isDirty` tracking via effect — documented correctly
- [x] `switchTo` 2-button confirm (simplified from 3-button — consistent with explicit-save design)
- [x] `_suppressDirty` prevents dirty flag during restore
- [x] Type names consistent across all tasks (`Notebook`, `Note`, `NotebookSnapshot`, `NotebookService`, `NotebookTabsComponent`, `NotesPanelComponent`)
- [x] All API paths match spec
- [x] `applyLocalUpdate` used for snapshot restore (in-memory, immediate UI)
