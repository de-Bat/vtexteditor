import { Router, Request, Response } from 'express';
import { notebookService } from '../services/notebook.service';
import { NotebookSnapshot } from '../models/notebook.model';

export const notebookRoutes = Router();

/* ─── Project-scoped: /api/projects/:projectId/notebooks ─────────────────── */

/** GET /api/projects/:projectId/notebooks */
notebookRoutes.get('/projects/:projectId/notebooks', (req: Request, res: Response) => {
  const { projectId } = req.params;
  res.json(notebookService.list(projectId as string));
});

/** POST /api/projects/:projectId/notebooks */
notebookRoutes.post('/projects/:projectId/notebooks', (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { name, snapshot } = req.body as { name: string; snapshot: NotebookSnapshot };
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  const nb = notebookService.create(
    projectId as string,
    name.trim(),
    snapshot ?? notebookService.emptySnapshot()
  );
  res.status(201).json(nb);
});

/* ─── Notebook-scoped: /api/notebooks/:id ────────────────────────────────── */

/** PUT /api/notebooks/:id */
notebookRoutes.put('/notebooks/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, snapshot, projectId } = req.body as {
    name: string;
    snapshot: NotebookSnapshot;
    projectId?: string;
  };

  // Determine projectId: either from body or by searching all projects
  let pid = projectId;
  if (!pid) {
    // Search for the notebook across all projects (fallback)
    const { listProjectIds } = require('../utils/file.util') as typeof import('../utils/file.util');
    const ids = listProjectIds();
    for (const pId of ids) {
      const nb = notebookService.get(id as string, pId);
      if (nb) { pid = pId; break; }
    }
  }

  if (!pid) return res.status(404).json({ error: 'Notebook not found' });

  const updated = notebookService.update(id as string, pid, name, snapshot);
  if (!updated) return res.status(404).json({ error: 'Notebook not found' });
  res.json(updated);
});

/** DELETE /api/notebooks/:id */
notebookRoutes.delete('/notebooks/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { projectId } = req.query as { projectId?: string };

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

  const deleted = notebookService.delete(id as string, pid);
  if (!deleted) return res.status(404).json({ error: 'Notebook not found' });
  res.status(204).send();
});

/* ─── Notes: /api/notebooks/:id/notes ───────────────────────────────────── */

/** GET /api/notebooks/:id/notes */
notebookRoutes.get('/notebooks/:id/notes', (req: Request, res: Response) => {
  const { id } = req.params;
  const { projectId } = req.query as { projectId?: string };

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
  res.json(notebookService.listNotes(pid, id as string));
});

/** POST /api/notebooks/:id/notes */
notebookRoutes.post('/notebooks/:id/notes', (req: Request, res: Response) => {
  const { id } = req.params;
  const { projectId, ...noteData } = req.body;

  let pid = projectId as string | undefined;
  if (!pid) {
    const { listProjectIds } = require('../utils/file.util') as typeof import('../utils/file.util');
    const ids = listProjectIds();
    for (const pId of ids) {
      const nb = notebookService.get(id as string, pId);
      if (nb) { pid = pId; break; }
    }
  }

  if (!pid) return res.status(404).json({ error: 'Notebook not found' });

  const note = notebookService.addNote(pid, id as string, noteData);
  if (!note) return res.status(404).json({ error: 'Notebook not found' });
  res.status(201).json(note);
});

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

/** DELETE /api/notebooks/:id/notes/:noteId */
notebookRoutes.delete('/notebooks/:id/notes/:noteId', (req: Request, res: Response) => {
  const { id, noteId } = req.params;
  const { projectId } = req.query as { projectId?: string };

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
  const deleted = notebookService.deleteNote(pid, id as string, noteId as string);
  if (!deleted) return res.status(404).json({ error: 'Note not found' });
  res.status(204).send();
});
