import { Router, Request, Response } from 'express';
import { projectService } from '../services/project.service';

export const projectsRoutes = Router();

/** GET /api/projects — list all project summaries */
projectsRoutes.get('/', (_req: Request, res: Response) => {
  res.json(projectService.list());
});

/** GET /api/projects/:id — get a single project by id */
projectsRoutes.get('/:id', (req: Request, res: Response) => {
  const id = String(req.params['id']);
  const project = projectService.get(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

/** POST /api/projects/:id/open — set as current project and return it */
projectsRoutes.post('/:id/open', (req: Request, res: Response) => {
  const id = String(req.params['id']);
  const project = projectService.open(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

/** DELETE /api/projects/:id — permanently delete a project */
projectsRoutes.delete('/:id', (req: Request, res: Response) => {
  const id = String(req.params['id']);
  const deleted = projectService.delete(id);
  if (!deleted) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.status(204).send();
});
