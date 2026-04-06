import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getUploadPath, fileExists } from '../utils/file.util';
import { getMediaInfo } from '../utils/ffmpeg.util';
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

/** POST /api/media — upload a media file */
mediaRoutes.post('/', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  const filePath = req.file.path;

  try {
    const info = await getMediaInfo(filePath);
    res.status(201).json({ id, filename: req.file.filename, info });
  } catch (err) {
    // If metadata fails, still return the upload id
    res.status(201).json({ id, filename: req.file.filename, info: null });
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
