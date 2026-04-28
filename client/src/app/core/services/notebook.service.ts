import { Injectable, inject, signal, effect } from '@angular/core';
import { Observable, tap, map } from 'rxjs';
import { ApiService } from './api.service';
import { ClipService } from './clip.service';
import { ConfirmService } from './confirm.service';
import { Notebook, Note, NotebookSnapshot } from '../models/notebook.model';
import { CutRegion } from '../models/cut-region.model';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotebookService {
  private readonly api = inject(ApiService);
  private readonly clipService = inject(ClipService);
  private readonly confirmService = inject(ConfirmService);

  readonly notebooks = signal<Notebook[]>([]);
  readonly active = signal<Notebook | null>(null);
  readonly isDirty = signal(false);
  readonly notes = signal<Note[]>([]);

  readonly highlightedNoteId = signal<string | null>(null);
  readonly currentSelection = signal<{ type: 'word' | 'segment' | 'clip', id: string } | null>(null);

  readonly noteJumpEvent = signal<{ note: Note; ts: number } | null>(null);

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
          let chosenId: string | null = null;
          try {
            const raw = localStorage.getItem('vtx_active_notebook');
            if (raw) {
              const map = JSON.parse(raw);
              chosenId = map[projectId];
            }
          } catch { /* ignore */ }

          const target = list.find(n => n.id === chosenId) ?? list[0]!;

          this._suppressDirty = true;
          // Apply the snapshot of the chosen notebook immediately so the clips update
          this._applySnapshot(target.snapshot);
          this.active.set(target);
          this._suppressDirty = false;
          this.isDirty.set(false);
          this.loadNotes(target.id).subscribe();
        }
      }),
      map(() => void 0)
    );
  }

  create(name: string, overrideProjectId?: string): Observable<Notebook> {
    const projectId = overrideProjectId || this._requireProjectId();
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

  clickNote(note: Note): void {
    this.highlightedNoteId.set(note.id);
    this.noteJumpEvent.set({ note, ts: Date.now() });
  }

  selectEntity(type: 'word' | 'segment' | 'clip', id: string): void {
    const note = this.notes().find(n => n.attachedToType === type && n.attachedToId === id);
    this.highlightedNoteId.set(note ? note.id : null);
    this.currentSelection.set({ type, id });
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
    // Fallback: try active notebook
    const active = this.active();
    if (active) return active.projectId;
    throw new Error('No notebooks loaded — projectId unknown');
  }
}
