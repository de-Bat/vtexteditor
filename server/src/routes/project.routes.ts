import { Router, Request, Response } from 'express';
import { projectService } from '../services/project.service';

export const projectRoutes = Router();

/** GET /api/project — return current project */
projectRoutes.get('/', (req: Request, res: Response) => {
  const project = projectService.getCurrent();
  if (!project) {
    res.status(404).json({ error: 'No active project' });
    return;
  }
  res.json(project);
});

/** PUT /api/project — update current project */
projectRoutes.put('/', (req: Request, res: Response) => {
  const current = projectService.getCurrent();
  if (!current) {
    res.status(404).json({ error: 'No active project' });
    return;
  }
  const updated = projectService.update(current.id, req.body);
  res.json(updated);
});
