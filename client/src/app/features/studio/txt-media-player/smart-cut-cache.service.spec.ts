import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { SmartCutCacheService, SmartCutResult } from './smart-cut-cache.service';
import { SMART_CUT_IDB_DB_NAME } from './smart-cut.constants';

function makeResult(score = 5, sizeBytes = 200): SmartCutResult {
  const bytes = new Uint8Array(sizeBytes / 2);
  const blob = new Blob([bytes], { type: 'image/webp' });
  return { resumeOffsetMs: 10, score, preThumb: blob, postThumb: blob, computedAt: Date.now() };
}

describe('SmartCutCacheService', () => {
  let svc: SmartCutCacheService;

  beforeEach(() => {
    // Each test gets a fresh IDB instance so tests don't share state
    svc = new SmartCutCacheService(new IDBFactory());
  });

  it('put() then get() returns the stored result', async () => {
    await svc.put('key1', makeResult());
    const result = await svc.get('key1');
    expect(result).toBeDefined();
    expect(result!.score).toBe(5);
    expect(result!.resumeOffsetMs).toBe(10);
  });

  it('get() returns undefined for unknown key', async () => {
    const result = await svc.get('missing');
    expect(result).toBeUndefined();
  });

  it('warmIndex() returns known keys without loading thumbs', async () => {
    await svc.put('k1', makeResult(3));
    await svc.put('k2', makeResult(7));
    const keys = await svc.warmIndex();
    expect(keys).toContain('k1');
    expect(keys).toContain('k2');
    expect(keys.length).toBe(2);
  });

  it('second put() for same key overwrites', async () => {
    await svc.put('k1', makeResult(3));
    await svc.put('k1', makeResult(9));
    const result = await svc.get('k1');
    expect(result!.score).toBe(9);
  });

  it('evicts oldest entry when max entries exceeded', async () => {
    // Use a service with maxEntries=2 for this test
    const smallSvc = new SmartCutCacheService(new IDBFactory(), 2, 50 * 1024 * 1024);
    await smallSvc.put('old1', makeResult(1));
    await new Promise(r => setTimeout(r, 5)); // ensure different accessedAt
    await smallSvc.put('old2', makeResult(2));
    await new Promise(r => setTimeout(r, 5));
    await smallSvc.put('new1', makeResult(3)); // should evict old1

    const keys = await smallSvc.warmIndex();
    expect(keys).not.toContain('old1');
    expect(keys).toContain('old2');
    expect(keys).toContain('new1');
  });
});
