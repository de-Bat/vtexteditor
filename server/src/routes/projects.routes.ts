import { Router, Request, Response } from 'express';
import { projectService } from '../services/project.service';
import { clipService } from '../services/clip.service';
import { validateMetadataMap, validateMetadataEntry } from '../validators/segment-metadata.validator';
import { MetadataEntry } from '../models/segment-metadata.model';

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

/** PUT /api/projects/:projectId/clips/:clipId/segments/:segmentId/metadata — replace all metadata */
projectsRoutes.put('/:projectId/clips/:clipId/segments/:segmentId/metadata', (req: Request, res: Response) => {
  const { projectId, clipId, segmentId } = req.params;
  const validation = validateMetadataMap(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const segment = clipService.updateSegmentMetadata(
      projectId as string, clipId as string, segmentId as string,
      req.body as Record<string, MetadataEntry[]>
    );
    if (!segment) return res.status(404).json({ error: 'Project, clip, or segment not found' });
    res.json(segment);
  } catch (err) {
    console.error(`[PUT metadata] Error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** PATCH /api/projects/:projectId/clips/:clipId/segments/:segmentId/metadata/:sourcePluginId — replace one plugin's entries */
projectsRoutes.patch('/:projectId/clips/:clipId/segments/:segmentId/metadata/:sourcePluginId', (req: Request, res: Response) => {
  const { projectId, clipId, segmentId, sourcePluginId } = req.params;
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be an array of metadata entries' });
  }
  for (let i = 0; i < req.body.length; i++) {
    const result = validateMetadataEntry(req.body[i]);
    if (!result.valid) {
      return res.status(400).json({ error: `entries[${i}]: ${result.error}` });
    }
    if ((req.body[i] as Record<string, unknown>).sourcePluginId !== sourcePluginId) {
      return res.status(400).json({
        error: `entries[${i}].sourcePluginId must match route param "${sourcePluginId}"`
      });
    }
  }
  try {
    const segment = clipService.patchSegmentMetadata(
      projectId as string, clipId as string, segmentId as string, sourcePluginId as string,
      req.body as MetadataEntry[]
    );
    if (!segment) return res.status(404).json({ error: 'Project, clip, or segment not found' });
    res.json(segment);
  } catch (err) {
    console.error(`[PATCH metadata] Error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** PUT /api/projects/:projectId/clips/:clipId/metadata — replace all clip metadata */
projectsRoutes.put('/:projectId/clips/:clipId/metadata', (req: Request, res: Response) => {
  const { projectId, clipId } = req.params;
  const validation = validateMetadataMap(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const clip = clipService.updateClipMetadata(
      projectId as string, clipId as string,
      req.body as Record<string, MetadataEntry[]>
    );
    if (!clip) return res.status(404).json({ error: 'Project or clip not found' });
    res.json(clip);
  } catch (err) {
    console.error(`[PUT clip metadata] Error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** PATCH /api/projects/:projectId/clips/:clipId/metadata/:sourcePluginId — replace one plugin's entries */
projectsRoutes.patch('/:projectId/clips/:clipId/metadata/:sourcePluginId', (req: Request, res: Response) => {
  const { projectId, clipId, sourcePluginId } = req.params;
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be an array of metadata entries' });
  }
  for (let i = 0; i < req.body.length; i++) {
    const result = validateMetadataEntry(req.body[i]);
    if (!result.valid) {
      return res.status(400).json({ error: `entries[${i}]: ${result.error}` });
    }
    if ((req.body[i] as Record<string, unknown>).sourcePluginId !== sourcePluginId) {
      return res.status(400).json({
        error: `entries[${i}].sourcePluginId must match route param "${sourcePluginId}"`
      });
    }
  }
  try {
    const clip = clipService.patchClipMetadata(
      projectId as string, clipId as string, sourcePluginId as string,
      req.body as MetadataEntry[]
    );
    if (!clip) return res.status(404).json({ error: 'Project or clip not found' });
    res.json(clip);
  } catch (err) {
    console.error(`[PATCH clip metadata] Error:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
