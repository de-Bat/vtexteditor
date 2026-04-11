import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { PipelineCache } from '../models/pipeline-context.model';

const CACHE_FILE = path.join(config.storage.root, 'pipeline-cache.json');
const TAG = '[pipeline-cache]';

function loadFromDisk(): Map<string, unknown> {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const entries = JSON.parse(raw) as [string, unknown][];
    const map = new Map(entries);
    console.log(`${TAG} loaded ${map.size} cached entry(ies) from disk`);
    return map;
  } catch {
    return new Map();
  }
}

function saveToDisk(map: Map<string, unknown>): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify([...map.entries()]), 'utf8');
  } catch {
    // Best-effort — persistence failure must not break the pipeline.
  }
}

const store: Map<string, unknown> = loadFromDisk();

class PipelineCacheService implements PipelineCache {
  get<T>(key: string): T | null {
    const val = store.get(key);
    return val !== undefined ? (val as T) : null;
  }

  set<T>(key: string, value: T): void {
    store.set(key, value);
    saveToDisk(store);
  }

  has(key: string): boolean {
    return store.has(key);
  }
}

export const pipelineCacheService = new PipelineCacheService();

/** Only for use in tests — clears all entries and flushes to disk. */
export function clearPipelineCache(): void {
  store.clear();
  saveToDisk(store);
}
