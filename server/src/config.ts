import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  storage: {
    root: path.join(ROOT, 'storage'),
    uploads: path.join(ROOT, 'storage', 'uploads'),
    projects: path.join(ROOT, 'storage', 'projects'),
  },
  allowedMimeTypes: [
    'video/mp4',
    'video/webm',
    'video/x-matroska',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/flac',
    'audio/ogg',
  ],
  allowedExtensions: ['.mp4', '.webm', '.mkv', '.mp3', '.wav', '.flac', '.ogg'],
};
