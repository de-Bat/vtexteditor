import fs from 'fs';
import path from 'path';
import { config } from '../config';

export function ensureStorageDirs(): void {
  [config.storage.uploads, config.storage.projects].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function getUploadPath(id: string, ext: string): string {
  return path.join(config.storage.uploads, `${id}${ext}`);
}

export function getProjectDir(projectId: string): string {
  return path.join(config.storage.projects, projectId);
}

export function getProjectFilePath(projectId: string): string {
  return path.join(getProjectDir(projectId), 'project.json');
}

export function getExportDir(projectId: string): string {
  const dir = path.join(getProjectDir(projectId), 'exports');
  ensureDir(dir);
  return dir;
}

/** Atomic JSON write: write to temp file then rename */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
