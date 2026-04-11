import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { clipService } from '../services/clip.service';
import { config } from '../config';

export const clipRoutes = Router();

/** GET /api/clips — list all clips */
clipRoutes.get('/', (_req: Request, res: Response) => {
  res.json(clipService.getAll());
});

/** GET /api/clips/:id — get single clip */
clipRoutes.get('/:id', (req: Request, res: Response) => {
  const clip = clipService.getById(String(req.params.id));
  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }
  res.json(clip);
});

/** GET /api/clips/:id/stream — stream clip media (range requests) */
clipRoutes.get('/:id/stream', (req: Request, res: Response) => {
  const clip = clipService.getById(String(req.params.id));
  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }

  // The media file is identified by the project's mediaPath
  const project = require('../services/project.service').projectService.getCurrent();
  if (!project) {
    res.status(404).json({ error: 'No active project' });
    return;
  }

  const filePath = path.join(config.storage.uploads, path.basename(project.mediaPath));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Media file not found' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
  };
  const contentType = mimeMap[ext] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

/** PUT /api/clips/:id/words — update word removal states */
clipRoutes.put('/:id/words', (req: Request, res: Response) => {
  // Client sends { updates: [...] }; accept both that shape and a bare array.
  const body = req.body as { updates?: Array<{ id: string; isRemoved: boolean }> } | Array<{ id: string; isRemoved: boolean }>;
  const updates = Array.isArray(body) ? body : body.updates;
  if (!Array.isArray(updates)) {
    res.status(400).json({ error: 'Body must be an array or { updates: [...] } of { id, isRemoved }' });
    return;
  }
  const updated = clipService.updateWordStates(String(req.params.id), updates);
  if (!updated) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }
  res.json(updated);
});
