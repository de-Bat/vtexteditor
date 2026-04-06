import { Router, Request, Response } from 'express';
import { pluginRegistry } from '../plugins/plugin-registry';
import { pipelineService } from '../services/pipeline.service';

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
  const { projectId, mediaPath, mediaInfo, steps, metadata } = req.body as {
    projectId: string;
    mediaPath: string;
    mediaInfo: Record<string, unknown>;
    steps: Array<{ pluginId: string; config: Record<string, unknown>; order: number }>;
    metadata?: Record<string, unknown>;
  };

  if (!projectId || !mediaPath || !steps?.length) {
    res.status(400).json({ error: 'projectId, mediaPath, and steps are required' });
    return;
  }

  // Start async — return job ID immediately
  const jobId = await pipelineService.start({ projectId, mediaPath, mediaInfo: mediaInfo as never, steps, metadata: metadata ?? {} });
  res.status(202).json({ jobId });
});
