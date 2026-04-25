import { Router, Request, Response } from 'express';
import { pluginRegistry } from '../plugins/plugin-registry';
import { pipelineService } from '../services/pipeline.service';
import { projectService } from '../services/project.service';
import { settingsService } from '../services/settings.service';
import { InputResponse } from '../models/input-request.model';

export const pluginRoutes = Router();

/** GET /api/plugins — list all registered plugins (metadata only, no execute fn) */
pluginRoutes.get('/', (_req: Request, res: Response) => {
  const plugins = pluginRegistry.getAll().map(({ id, name, description, type, configSchema, hasUI, settingsMap }) => {
    // Inject current app setting values as schema defaults so the client panel
    // pre-fills fields without requiring any client-side changes.
    let schema = configSchema;
    if (settingsMap) {
      schema = JSON.parse(JSON.stringify(configSchema)) as Record<string, unknown>;
      const props = (schema as Record<string, unknown>)['properties'] as Record<string, Record<string, unknown>> | undefined;
      if (props) {
        for (const [field, settingKey] of Object.entries(settingsMap)) {
          const value = settingsService.get(settingKey);
          if (value && props[field]) {
            props[field]['default'] = value;
          }
        }
      }
    }
    return { id, name, description, type, configSchema: schema, hasUI };
  });
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

/** POST /api/plugins/input/:requestId — submit user response to a pending input request */
pluginRoutes.post('/input/:requestId', (req: Request, res: Response) => {
  const requestId = req.params['requestId'] as string;
  const response: InputResponse = {
    requestId,
    skipped: req.body.skipped ?? false,
    values: req.body.values ?? {},
  };
  const resolved = pipelineService.resolveInput(requestId, response);
  if (!resolved) {
    res.status(404).json({ error: 'No pending input request with this ID' });
    return;
  }
  res.json({ ok: true });
});
