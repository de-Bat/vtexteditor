import { Router, Request, Response } from 'express';
import { pluginRegistry } from '../plugins/plugin-registry';
import { pipelineService } from '../services/pipeline.service';
import { projectService } from '../services/project.service';

export const pluginRoutes = Router();

/** GET /api/plugins — list all registered plugins (metadata only, no execute fn) */
pluginRoutes.get('/', (_req: Request, res: Response) => {
  const plugins = pluginRegistry.getAll().map(({ id, name, description, type, configSchema, hasUI }) => ({
    id,
    name,
    description,
    type,
    configSchema,
    hasUI,
  }));
  res.json(plugins);
});

/** POST /api/plugins/pipeline/run — execute a pipeline */
pluginRoutes.post('/pipeline/run', async (req: Request, res: Response) => {
  const { projectId, steps } = req.body as {
    projectId: string;
    steps: Array<{ pluginId: string; config: Record<string, unknown>; order: number }>;
  };

  if (!projectId || !steps?.length) {
    res.status(400).json({ error: 'projectId and steps are required' });
    return;
  }

  // Resolve mediaPath server-side from stored project (prevents path traversal)
  const project = projectService.get(projectId);
  if (!project) {
    res.status(404).json({ error: `Project ${projectId} not found` });
    return;
  }

  const jobId = await pipelineService.start({
    projectId,
    mediaPath: project.mediaPath,
    mediaInfo: project.mediaInfo as never,
    steps,
    metadata: {},
  });
  res.status(202).json({ jobId });
});
