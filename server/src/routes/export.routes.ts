import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { exportService, ExportFormat } from '../services/export.service';

export const exportRoutes = Router();

const ALLOWED_FORMATS: ExportFormat[] = ['video', 'text-plain', 'text-srt'];

/** POST /api/export — start export job */
exportRoutes.post('/', (req: Request, res: Response) => {
  const { projectId, format } = req.body as { projectId?: string; format?: string };

  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' });
    return;
  }
  if (!format || !ALLOWED_FORMATS.includes(format as ExportFormat)) {
    res.status(400).json({ error: `format must be one of: ${ALLOWED_FORMATS.join(', ')}` });
    return;
  }

  const jobId = exportService.start(projectId, format as ExportFormat);
  res.status(202).json({ jobId });
});

/** GET /api/export/:id/status */
exportRoutes.get('/:id/status', (req: Request, res: Response) => {
  const job = exportService.getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: 'Export job not found' });
    return;
  }
  res.json({ 
    id: job.id, 
    status: job.status, 
    format: job.format, 
    progress: job.status === 'done' ? 100 : (job.elapsedTime && job.estimatedTotalTime ? Math.round((job.elapsedTime / job.estimatedTotalTime) * 100) : 0),
    elapsedTime: job.elapsedTime,
    estimatedTotalTime: job.estimatedTotalTime,
    error: job.error ?? null 
  });
});

/** GET /api/export/:id/download — stream the output file */
exportRoutes.get('/:id/download', (req: Request, res: Response) => {
  const job = exportService.getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: 'Export job not found' });
    return;
  }
  if (job.status !== 'done' || !job.outputPath) {
    res.status(409).json({ error: 'Export not yet complete' });
    return;
  }
  if (!fs.existsSync(job.outputPath)) {
    res.status(404).json({ error: 'Export file not found' });
    return;
  }

  const ext = path.extname(job.outputPath);
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.txt': 'text/plain',
    '.srt': 'text/plain',
  };
  const contentType = mimeMap[ext] ?? 'application/octet-stream';
  const filename = `export${ext}`;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(job.outputPath).pipe(res);
});

