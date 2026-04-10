import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getUploadPath, fileExists } from '../utils/file.util';
import { getMediaInfo } from '../utils/ffmpeg.util';
import { projectService } from '../services/project.service';
import { lookupHash, registerHash } from '../services/file-hash-cache';
import fs from 'fs';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.storage.uploads),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (config.allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB max
});

export const mediaRoutes = Router();

/** POST /api/media — upload a media file, create project */
mediaRoutes.post('/', upload.single('media'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const mediaId = path.basename(req.file.filename, path.extname(req.file.filename));
  const filePath = req.file.path;
  const hash = req.body?.hash as string | undefined;
  if (hash && /^[0-9a-f]{64}$/i.test(hash)) registerHash(hash, filePath);
  const ext = path.extname(req.file.filename);
  const mediaType = ['.mp4', '.webm', '.mkv'].includes(ext) ? 'video' : 'audio';

  let mediaInfo = null;
  try { mediaInfo = await getMediaInfo(filePath); } catch { /* best effort */ }

  const project = projectService.create({
    name: path.basename(req.file.originalname, ext),
    mediaPath: filePath,
    mediaType,
    mediaInfo,
  });

  res.status(201).json({ mediaId, project });
});

/** POST /api/media/from-cache — create project from an already-uploaded file */
mediaRoutes.post('/from-cache', async (req: Request, res: Response) => {
  const { hash, originalName } = req.body as { hash: string; originalName: string };
  if (!hash || !originalName) {
    res.status(400).json({ error: 'hash and originalName are required' });
    return;
  }

  const filePath = lookupHash(hash);
  if (!filePath) {
    res.status(404).json({ error: 'File not in cache' });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Cached file no longer exists on disk' });
    return;
  }

  const ext = path.extname(filePath);
  const mediaType = ['.mp4', '.webm', '.mkv'].includes(ext) ? 'video' : 'audio';
  const mediaId = path.basename(filePath, ext);

  let mediaInfo = null;
  try { mediaInfo = await getMediaInfo(filePath); } catch { /* best effort */ }

  const project = projectService.create({
    name: path.basename(originalName, path.extname(originalName)),
    mediaPath: filePath,
    mediaType,
    mediaInfo,
  });

  res.status(201).json({ mediaId, project });
});

/** GET /api/media/check/:hash — check if a file hash is already in cache */
mediaRoutes.get('/check/:hash', (req: Request, res: Response) => {
  const hash = String(req.params['hash']);
  const filePath = lookupHash(hash);
  if (filePath) {
    res.json({ exists: true });
  } else {
    res.json({ exists: false });
  }
});

/** GET /api/media/:id/info — get media metadata */
mediaRoutes.get('/:id/info', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const files = fs.readdirSync(config.storage.uploads).filter((f) => f.startsWith(id));
  if (!files.length) {
    res.status(404).json({ error: 'Media not found' });
    return;
  }
  const filePath = path.join(config.storage.uploads, files[0]);
  try {
    const info = await getMediaInfo(filePath);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read media info' });
  }
});

/** GET /api/media/:id/stream — stream media with range-request support */
mediaRoutes.get('/:id/stream', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const files = fs.readdirSync(config.storage.uploads).filter((f) => f.startsWith(id));
  if (!files.length) {
    res.status(404).json({ error: 'Media not found' });
    return;
  }
  const filePath = path.join(config.storage.uploads, files[0]);
  const ext = path.extname(files[0]).toLowerCase();

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
