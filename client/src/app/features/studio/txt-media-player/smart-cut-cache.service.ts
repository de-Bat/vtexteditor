import { Injectable, InjectionToken, Inject, Optional } from '@angular/core';
import {
  SMART_CUT_IDB_DB_NAME,
  SMART_CUT_IDB_STORE,
  SMART_CUT_IDB_MAX_ENTRIES,
  SMART_CUT_IDB_MAX_BYTES,
} from './smart-cut.constants';

export const SMART_CUT_IDB_FACTORY = new InjectionToken<IDBFactory>('SMART_CUT_IDB_FACTORY');
export const SMART_CUT_MAX_ENTRIES_TOKEN = new InjectionToken<number>('SMART_CUT_MAX_ENTRIES_TOKEN');
export const SMART_CUT_MAX_BYTES_TOKEN = new InjectionToken<number>('SMART_CUT_MAX_BYTES_TOKEN');

export interface SmartCutResult {
  resumeOffsetMs: number;
  score: number;
  preThumb: Blob;
  postThumb: Blob;
  computedAt: number;
}

interface StoredEntry extends SmartCutResult {
  key: string;
  accessedAt: number;
  sizeBytes: number;
}

@Injectable({ providedIn: 'root' })
export class SmartCutCacheService {
  private db: Promise<IDBDatabase>;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(
    @Optional() @Inject(SMART_CUT_IDB_FACTORY) idbOverride?: IDBFactory,
    @Optional() @Inject(SMART_CUT_MAX_ENTRIES_TOKEN) maxEntriesOverride?: number,
    @Optional() @Inject(SMART_CUT_MAX_BYTES_TOKEN) maxBytesOverride?: number,
  ) {
    this.maxEntries = maxEntriesOverride ?? SMART_CUT_IDB_MAX_ENTRIES;
    this.maxBytes = maxBytesOverride ?? SMART_CUT_IDB_MAX_BYTES;
    this.db = this.openDb(idbOverride ?? indexedDB);
  }

  private openDb(idb: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = idb.open(SMART_CUT_IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(SMART_CUT_IDB_STORE, { keyPath: 'key' });
        store.createIndex('accessedAt', 'accessedAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(key: string): Promise<SmartCutResult | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SMART_CUT_IDB_STORE, 'readwrite');
      const store = tx.objectStore(SMART_CUT_IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry: StoredEntry | undefined = req.result;
        if (!entry) { resolve(undefined); return; }
        // Update access time for LRU
        store.put({ ...entry, accessedAt: Date.now() });
        const { key: _k, accessedAt: _a, sizeBytes: _s, ...result } = entry;
        resolve(result as SmartCutResult);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async put(key: string, result: SmartCutResult): Promise<void> {
    const db = await this.db;
    const sizeBytes = result.preThumb.size + result.postThumb.size + 200;
    const entry: StoredEntry = { ...result, key, accessedAt: Date.now(), sizeBytes };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SMART_CUT_IDB_STORE, 'readwrite');
      const store = tx.objectStore(SMART_CUT_IDB_STORE);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await this.evictIfNeeded(db);
  }

  async warmIndex(): Promise<string[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SMART_CUT_IDB_STORE, 'readonly');
      const req = tx.objectStore(SMART_CUT_IDB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });
  }

  private async evictIfNeeded(db: IDBDatabase): Promise<void> {
    const all = await new Promise<StoredEntry[]>((resolve, reject) => {
      const tx = db.transaction(SMART_CUT_IDB_STORE, 'readonly');
      const req = tx.objectStore(SMART_CUT_IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const totalBytes = all.reduce((s, e) => s + e.sizeBytes, 0);
    const overCount = all.length > this.maxEntries;
    const overBytes = totalBytes > this.maxBytes;
    if (!overCount && !overBytes) return;

    // Sort oldest-accessed first
    all.sort((a, b) => a.accessedAt - b.accessedAt);
    let runningBytes = totalBytes;
    let runningCount = all.length;

    const toDelete: string[] = [];
    for (const entry of all) {
      if (runningCount <= this.maxEntries && runningBytes <= this.maxBytes) break;
      toDelete.push(entry.key);
      runningCount--;
      runningBytes -= entry.sizeBytes;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SMART_CUT_IDB_STORE, 'readwrite');
      const store = tx.objectStore(SMART_CUT_IDB_STORE);
      toDelete.forEach(k => store.delete(k));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
