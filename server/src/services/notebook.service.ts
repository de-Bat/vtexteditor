import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Notebook, Note, NotebookSnapshot } from '../models/notebook.model';
import {
  getProjectDir,
  ensureDir,
  writeJsonAtomic,
  readJson,
  fileExists,
} from '../utils/file.util';

function getNotebooksPath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'notebooks.json');
}

function readNotebooks(projectId: string): Notebook[] {
  const fp = getNotebooksPath(projectId);
  if (!fileExists(fp)) return [];
  return readJson<Notebook[]>(fp);
}

function writeNotebooks(projectId: string, notebooks: Notebook[]): void {
  ensureDir(getProjectDir(projectId));
  writeJsonAtomic(getNotebooksPath(projectId), notebooks);
}

function getNotesPath(projectId: string, notebookId: string): string {
  return path.join(getProjectDir(projectId), `notes_${notebookId}.json`);
}

function readNotes(projectId: string, notebookId: string): Note[] {
  const fp = getNotesPath(projectId, notebookId);
  if (!fileExists(fp)) return [];
  return readJson<Note[]>(fp);
}

function writeNotes(projectId: string, notebookId: string, notes: Note[]): void {
  writeJsonAtomic(getNotesPath(projectId, notebookId), notes);
}

class NotebookService {
  /** List all notebooks for a project */
  list(projectId: string): Notebook[] {
    return readNotebooks(projectId);
  }

  /** Get a single notebook by id */
  get(notebookId: string, projectId: string): Notebook | null {
    return readNotebooks(projectId).find((n) => n.id === notebookId) ?? null;
  }

  /** Create a new notebook for a project */
  create(projectId: string, name: string, snapshot: NotebookSnapshot): Notebook {
    const notebooks = readNotebooks(projectId);
    const now = new Date().toISOString();
    const nb: Notebook = {
      id: uuidv4(),
      projectId,
      name,
      createdAt: now,
      updatedAt: now,
      snapshot,
    };
    notebooks.push(nb);
    writeNotebooks(projectId, notebooks);
    return nb;
  }

  /** Update name and/or snapshot */
  update(notebookId: string, projectId: string, name: string, snapshot: NotebookSnapshot): Notebook | null {
    const notebooks = readNotebooks(projectId);
    const idx = notebooks.findIndex((n) => n.id === notebookId);
    if (idx === -1) return null;
    const updated: Notebook = {
      ...notebooks[idx]!,
      name,
      snapshot,
      updatedAt: new Date().toISOString(),
    };
    notebooks[idx] = updated;
    writeNotebooks(projectId, notebooks);
    return updated;
  }

  /** Delete a notebook (and its notes) */
  delete(notebookId: string, projectId: string): boolean {
    const notebooks = readNotebooks(projectId);
    const idx = notebooks.findIndex((n) => n.id === notebookId);
    if (idx === -1) return false;
    notebooks.splice(idx, 1);
    writeNotebooks(projectId, notebooks);
    return true;
  }

  /** List notes for a notebook */
  listNotes(projectId: string, notebookId: string): Note[] {
    return readNotes(projectId, notebookId);
  }

  /** Add a note */
  addNote(
    projectId: string,
    notebookId: string,
    data: Omit<Note, 'id' | 'notebookId' | 'createdAt'>
  ): Note | null {
    // Ensure notebook exists
    if (!this.get(notebookId, projectId)) return null;
    const notes = readNotes(projectId, notebookId);
    const note: Note = {
      ...data,
      id: uuidv4(),
      notebookId,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    writeNotes(projectId, notebookId, notes);
    return note;
  }

  /** Delete a note */
  deleteNote(projectId: string, notebookId: string, noteId: string): boolean {
    const notes = readNotes(projectId, notebookId);
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) return false;
    notes.splice(idx, 1);
    writeNotes(projectId, notebookId, notes);
    return true;
  }

  /** Build an empty snapshot (for brand-new projects with no edits yet) */
  emptySnapshot(): NotebookSnapshot {
    return { wordStates: {}, cutRegions: {}, clipOrder: [] };
  }
}

export const notebookService = new NotebookService();
