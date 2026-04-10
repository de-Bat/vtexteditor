import fs from 'fs';
import path from 'path';
import { config } from '../config';

const CACHE_FILE = path.join(config.storage.root, 'hash-cache.json');

// Load persisted cache from disk, if it exists.
function loadFromDisk(): Map<string, string> {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const entries = JSON.parse(raw) as [string, string][];
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveToDisk(map: Map<string, string>): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify([...map.entries()]), 'utf8');
  } catch {
    // Best-effort — persistence failure must not break uploads.
  }
}

const cache: Map<string, string> = loadFromDisk();

export function lookupHash(hash: string): string | undefined {
  return cache.get(hash);
}

export function registerHash(hash: string, filePath: string): void {
  cache.set(hash, filePath);
  saveToDisk(cache);
}

/** Only for use in tests — clears all entries without writing to disk. */
export function clearCache(): void {
  cache.clear();
}
