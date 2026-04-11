# Pipeline Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic key-value cache to `PipelineContext` so transcription plugins can skip expensive API calls when the same media + settings were already transcribed.

**Architecture:** `PipelineCacheService` owns a JSON-persisted store exposed via `PipelineContext.cache`. The pipeline service computes a stable `mediaHash` (head+tail SHA-256, same algorithm as the client) and injects both into the context before executing plugins. Each transcription plugin opts in with a `reuseIfCached` config checkbox and constructs its own cache key.

**Tech Stack:** Node.js `crypto`, `fs` (positional reads), Vitest, TypeScript strict mode.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/src/models/pipeline-context.model.ts` | Modify | Add `PipelineCache` interface + `mediaHash`/`cache` fields |
| `server/src/services/pipeline-cache.service.ts` | **Create** | Generic key-value cache, JSON-persisted |
| `server/src/services/pipeline-cache.service.test.ts` | **Create** | Unit tests for cache service |
| `server/src/utils/media-hash.util.ts` | **Create** | Server-side head+tail SHA-256 (matches client) |
| `server/src/utils/media-hash.util.test.ts` | **Create** | Unit tests for hash utility |
| `server/src/services/pipeline.service.ts` | Modify | Compute `mediaHash`, inject `cache` into context |
| `server/src/plugins/transcription/whisper-openai.plugin.ts` | Modify | Add `reuseIfCached` config + cache read/write |
| `server/src/plugins/transcription/groq-whisper.plugin.ts` | Modify | Add `reuseIfCached` config + cache read/write |

---

## Task 1: Add `PipelineCache` to context model

**Files:**
- Modify: `server/src/models/pipeline-context.model.ts`

- [ ] **Step 1: Update the model**

Replace the entire file with:

```ts
import { Clip } from './clip.model';
import { MediaInfo } from './project.model';

export interface PipelineCache {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
}

export interface PipelineContext {
  projectId: string;
  /** Absolute path to the uploaded media file */
  mediaPath: string;
  mediaInfo: MediaInfo;
  /** SHA-256 head+tail hash of the media file — stable cache key ingredient */
  mediaHash: string;
  clips: Clip[];
  /** Arbitrary metadata passed between plugins */
  metadata: Record<string, unknown>;
  /** Generic key-value cache provided by the pipeline service */
  cache: PipelineCache;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors (other files that construct `PipelineContext` will fail — fix those in later tasks).

- [ ] **Step 3: Commit**

```bash
git add server/src/models/pipeline-context.model.ts
git commit -m "feat(pipeline): add PipelineCache interface and mediaHash to PipelineContext"
```

---

## Task 2: `PipelineCacheService`

**Files:**
- Create: `server/src/services/pipeline-cache.service.ts`
- Create: `server/src/services/pipeline-cache.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/pipeline-cache.service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { pipelineCacheService, clearPipelineCache } from './pipeline-cache.service';

describe('PipelineCacheService', () => {
  beforeEach(() => clearPipelineCache());

  it('returns null for unknown key', () => {
    expect(pipelineCacheService.get('no-such-key')).toBeNull();
  });

  it('has() returns false for unknown key', () => {
    expect(pipelineCacheService.has('no-such-key')).toBe(false);
  });

  it('stores and retrieves a value', () => {
    pipelineCacheService.set('k', { segments: [1, 2, 3] });
    expect(pipelineCacheService.get('k')).toEqual({ segments: [1, 2, 3] });
  });

  it('has() returns true after set', () => {
    pipelineCacheService.set('k', 42);
    expect(pipelineCacheService.has('k')).toBe(true);
  });

  it('overwrites existing entry', () => {
    pipelineCacheService.set('k', 'old');
    pipelineCacheService.set('k', 'new');
    expect(pipelineCacheService.get<string>('k')).toBe('new');
  });

  it('isolates keys', () => {
    pipelineCacheService.set('a', 1);
    pipelineCacheService.set('b', 2);
    expect(pipelineCacheService.get('a')).toBe(1);
    expect(pipelineCacheService.get('b')).toBe(2);
  });

  it('returns null after clearPipelineCache', () => {
    pipelineCacheService.set('k', 'v');
    clearPipelineCache();
    expect(pipelineCacheService.get('k')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd server && npm test -- pipeline-cache.service
```

Expected: fails with "Cannot find module './pipeline-cache.service'"

- [ ] **Step 3: Implement `pipeline-cache.service.ts`**

Create `server/src/services/pipeline-cache.service.ts`:

```ts
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

/** Only for use in tests — clears all entries without writing to disk. */
export function clearPipelineCache(): void {
  store.clear();
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd server && npm test -- pipeline-cache.service
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/pipeline-cache.service.ts server/src/services/pipeline-cache.service.test.ts
git commit -m "feat(pipeline): add PipelineCacheService with JSON persistence"
```

---

## Task 3: `media-hash.util.ts`

**Files:**
- Create: `server/src/utils/media-hash.util.ts`
- Create: `server/src/utils/media-hash.util.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/utils/media-hash.util.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');

import fs from 'fs';
import { computeMediaHash } from './media-hash.util';

const mockStatSync = vi.mocked(fs.statSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadSync = vi.mocked(fs.readSync);
const mockCloseSync = vi.mocked(fs.closeSync);

const SAMPLE = 2 * 1024 * 1024; // 2 MB

describe('computeMediaHash', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads full file when size <= 4 MB', async () => {
    const fakeData = Buffer.alloc(100, 0xab);
    mockStatSync.mockReturnValue({ size: 100 } as fs.Stats);
    mockReadFileSync.mockReturnValue(fakeData);

    const hash = await computeMediaHash('/small.wav');

    expect(mockReadFileSync).toHaveBeenCalledWith('/small.wav');
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64); // SHA-256 hex
  });

  it('uses head+tail sampling for large files', async () => {
    const largeSize = SAMPLE * 2 + 1000;
    mockStatSync.mockReturnValue({ size: largeSize } as fs.Stats);
    mockOpenSync.mockReturnValue(3 as unknown as number);
    mockReadSync.mockReturnValue(SAMPLE);
    mockCloseSync.mockReturnValue(undefined);

    const hash = await computeMediaHash('/large.mp4');

    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockOpenSync).toHaveBeenCalledWith('/large.mp4', 'r');
    // Two positional reads: head at offset 0, tail at offset (size - SAMPLE)
    expect(mockReadSync).toHaveBeenCalledTimes(2);
    expect(mockReadSync).toHaveBeenNthCalledWith(1, 3, expect.any(Buffer), 0, SAMPLE, 0);
    expect(mockReadSync).toHaveBeenNthCalledWith(2, 3, expect.any(Buffer), 0, SAMPLE, largeSize - SAMPLE);
    expect(mockCloseSync).toHaveBeenCalledWith(3);
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
  });

  it('produces different hashes for different small file contents', async () => {
    mockStatSync.mockReturnValue({ size: 10 } as fs.Stats);
    mockReadFileSync
      .mockReturnValueOnce(Buffer.alloc(10, 0xaa))
      .mockReturnValueOnce(Buffer.alloc(10, 0xbb));

    const h1 = await computeMediaHash('/file1.wav');
    const h2 = await computeMediaHash('/file2.wav');

    expect(h1).not.toBe(h2);
  });

  it('produces the same hash for the same content', async () => {
    const data = Buffer.alloc(50, 0x42);
    mockStatSync.mockReturnValue({ size: 50 } as fs.Stats);
    mockReadFileSync.mockReturnValue(data);

    const h1 = await computeMediaHash('/a.wav');
    const h2 = await computeMediaHash('/a.wav');

    expect(h1).toBe(h2);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd server && npm test -- media-hash.util
```

Expected: fails with "Cannot find module './media-hash.util'"

- [ ] **Step 3: Implement `media-hash.util.ts`**

Create `server/src/utils/media-hash.util.ts`:

```ts
import { createHash } from 'crypto';
import fs from 'fs';

const SAMPLE = 2 * 1024 * 1024; // 2 MB — matches client-side FileHashService

/**
 * Compute a stable SHA-256 hash of a media file using head+tail sampling.
 * Algorithm matches the client-side FileHashService so that client-computed
 * and server-computed hashes are identical for the same file.
 *
 * Files <= 4 MB: full content is hashed.
 * Files > 4 MB:  first 2 MB + last 2 MB + 8-byte little-endian file size.
 */
export async function computeMediaHash(filePath: string): Promise<string> {
  const { size } = fs.statSync(filePath);

  if (size <= SAMPLE * 2) {
    const buffer = fs.readFileSync(filePath);
    return createHash('sha256').update(buffer).digest('hex');
  }

  const head = Buffer.alloc(SAMPLE);
  const tail = Buffer.alloc(SAMPLE);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, head, 0, SAMPLE, 0);
  fs.readSync(fd, tail, 0, SAMPLE, size - SAMPLE);
  fs.closeSync(fd);

  // 8-byte little-endian file size — prevents collision between files with
  // identical head/tail bytes but different total lengths.
  const sizeBytes = Buffer.alloc(8);
  sizeBytes.writeBigUInt64LE(BigInt(size), 0);

  return createHash('sha256')
    .update(head)
    .update(tail)
    .update(sizeBytes)
    .digest('hex');
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd server && npm test -- media-hash.util
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/media-hash.util.ts server/src/utils/media-hash.util.test.ts
git commit -m "feat(pipeline): add server-side media-hash utility (head+tail SHA-256)"
```

---

## Task 4: Wire `mediaHash` and `cache` into `PipelineService`

**Files:**
- Modify: `server/src/services/pipeline.service.ts`

- [ ] **Step 1: Update `pipeline.service.ts`**

Replace the entire file with:

```ts
import { v4 as uuidv4 } from 'uuid';
import { PipelineContext } from '../models/pipeline-context.model';
import { MediaInfo } from '../models/project.model';
import { pluginRegistry } from '../plugins/plugin-registry';
import { projectService } from './project.service';
import { sseService } from './sse.service';
import { pipelineCacheService } from './pipeline-cache.service';
import { computeMediaHash } from '../utils/media-hash.util';

const TAG = '[pipeline]';

interface PipelineStartParams {
  projectId: string;
  mediaPath: string;
  mediaInfo: MediaInfo;
  steps: Array<{ pluginId: string; config: Record<string, unknown>; order: number }>;
  metadata: Record<string, unknown>;
}

class PipelineService {
  /** Start an async pipeline execution. Returns a job ID immediately. */
  async start(params: PipelineStartParams): Promise<string> {
    const jobId = uuidv4();

    // Run the pipeline asynchronously
    setImmediate(() => this.run(jobId, params).catch((err) => {
      console.error(`${TAG} Unhandled error:`, err);
      sseService.broadcast({
        type: 'pipeline:error',
        data: { jobId, error: String(err) },
      });
    }));

    return jobId;
  }

  private async run(jobId: string, params: PipelineStartParams): Promise<void> {
    const sortedSteps = [...params.steps].sort((a, b) => a.order - b.order);
    const totalSteps = sortedSteps.length;

    console.log(`${TAG} computing media hash for ${params.mediaPath}`);
    const mediaHash = await computeMediaHash(params.mediaPath);
    console.log(`${TAG} mediaHash: ${mediaHash.slice(0, 12)}…  path: ${params.mediaPath}`);

    let ctx: PipelineContext = {
      projectId: params.projectId,
      mediaPath: params.mediaPath,
      mediaInfo: params.mediaInfo,
      mediaHash,
      clips: [],
      metadata: params.metadata,
      cache: pipelineCacheService,
    };

    for (let i = 0; i < sortedSteps.length; i++) {
      const step = sortedSteps[i];
      const plugin = pluginRegistry.getById(step.pluginId);
      if (!plugin) {
        throw new Error(`Plugin not found: ${step.pluginId}`);
      }

      // Merge step config into metadata under plugin ID key
      ctx = { ...ctx, metadata: { ...ctx.metadata, [step.pluginId]: step.config } };

      sseService.broadcast({
        type: 'pipeline:progress',
        data: {
          jobId,
          step: i + 1,
          totalSteps,
          pluginId: step.pluginId,
          pluginName: plugin.name,
          percent: Math.round((i / totalSteps) * 100),
        },
      });

      ctx = await plugin.execute(ctx);

      sseService.broadcast({
        type: 'pipeline:progress',
        data: {
          jobId,
          step: i + 1,
          totalSteps,
          pluginId: step.pluginId,
          pluginName: plugin.name,
          percent: Math.round(((i + 1) / totalSteps) * 100),
        },
      });
    }

    // Persist clips into the project
    const project = projectService.get(params.projectId);
    if (project) {
      projectService.update(params.projectId, { clips: ctx.clips });
    }

    sseService.broadcast({
      type: 'pipeline:complete',
      data: { jobId, clipCount: ctx.clips.length },
    });
  }
}

export const pipelineService = new PipelineService();
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors (plugin files still construct `PipelineContext` without the new fields, so TypeScript may complain there — that's fine, fixed in Tasks 5 & 6).

- [ ] **Step 3: Commit**

```bash
git add server/src/services/pipeline.service.ts
git commit -m "feat(pipeline): inject mediaHash and cache into PipelineContext"
```

---

## Task 5: Cache integration in `whisper-openai` plugin

**Files:**
- Modify: `server/src/plugins/transcription/whisper-openai.plugin.ts`

- [ ] **Step 1: Add `reuseIfCached` to config interface and schema**

In `whisper-openai.plugin.ts`, update the `WhisperConfig` interface to add `reuseIfCached`:

```ts
interface WhisperConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  language?: string;
  segmentBySpeech?: boolean;
  showSilenceMarkers?: boolean;
  clipName?: string;
  chunkDurationSecs?: number;
  maxConcurrent?: number;
  reuseIfCached?: boolean;   // ADD THIS
}
```

In `configSchema.properties`, add the following entry after `maxConcurrent`:

```ts
reuseIfCached: {
  type: 'boolean',
  title: 'Reuse cached transcription',
  description: 'Skip the API call if this media was already transcribed with the same plugin, model, and language.',
  default: true,
},
```

- [ ] **Step 2: Add cache check and write to `execute()`**

In `execute()`, after resolving `model` and `language` (around line 126), add:

```ts
const reuseIfCached = cfg.reuseIfCached !== false; // default true
const cacheKey = `whisper-openai:${ctx.mediaHash}:${model}:${language}`;
```

Then, immediately before the `if (!fs.existsSync(ctx.mediaPath))` check, insert the cache-hit branch:

```ts
if (reuseIfCached && ctx.cache.has(cacheKey)) {
  console.log(`${tag} cache HIT  key=${cacheKey.slice(0, 48)}… — skipping transcription`);
  const cached = ctx.cache.get<RawSegment[]>(cacheKey)!;
  return buildClip(cached, cfg, ctx);
}
console.log(reuseIfCached
  ? `${tag} cache MISS  key=${cacheKey.slice(0, 48)}… — transcribing`
  : `${tag} reuseIfCached=false — transcribing (cache will be updated)`);
```

After `rawSegments` is assigned (after the `chunkAndTranscribe` try/finally block), write to cache:

```ts
console.log(`${tag} cache WRITE  key=${cacheKey.slice(0, 48)}…  segments: ${rawSegments.length}`);
ctx.cache.set(cacheKey, rawSegments);
```

- [ ] **Step 3: Extract `buildClip` helper**

The existing code after `rawSegments` assignment (building the `Clip` and returning) is duplicated between the cache-hit path and the normal path. Extract it into a local function `buildClip(rawSegments: RawSegment[], cfg: WhisperConfig, ctx: PipelineContext): PipelineContext` at the bottom of the file:

```ts
function buildClip(rawSegments: RawSegment[], cfg: WhisperConfig, ctx: PipelineContext): PipelineContext {
  const clipId = uuidv4();
  const clipName = cfg.clipName ?? 'Whisper Transcription';
  const segments: Segment[] = rawSegments.map((raw) => {
    const segId = uuidv4();
    let words: Word[];
    if (raw.words?.length) {
      words = raw.words.map((w) => ({
        id: uuidv4(),
        segmentId: segId,
        text: w.word.trim(),
        startTime: w.start,
        endTime: w.end,
        isRemoved: false,
      }));
    } else {
      words = estimateWords(segId, raw.text, raw.start, raw.end);
    }
    return {
      id: segId,
      clipId,
      startTime: raw.start,
      endTime: raw.end,
      text: raw.text,
      words,
      tags: [],
    };
  });

  const coerceBool = (v: unknown, fallback: boolean) =>
    v === true || String(v).toLowerCase() === 'true' ? true
      : v === false || String(v).toLowerCase() === 'false' ? false
      : fallback;

  const segmentBySpeech = coerceBool(cfg.segmentBySpeech, true);
  const showSilenceMarkers = coerceBool(cfg.showSilenceMarkers, false);
  const finalSegments = segmentBySpeech ? segments : mergeSegments(clipId, segments);

  const clip: Clip = {
    id: clipId,
    projectId: ctx.projectId,
    name: clipName,
    startTime: finalSegments[0]?.startTime ?? 0,
    endTime: finalSegments[finalSegments.length - 1]?.endTime ?? (ctx.mediaInfo?.duration ?? 0),
    segments: finalSegments,
    showSilenceMarkers,
  };

  const totalWords = finalSegments.reduce((n, s) => n + s.words.length, 0);
  console.log(
    `[whisper-openai] clip built — "${clipName}"  segments: ${finalSegments.length}  words: ${totalWords}` +
    `  segmentBySpeech: ${segmentBySpeech}  showSilenceMarkers: ${showSilenceMarkers}`,
  );

  return { ...ctx, clips: [...ctx.clips, clip] };
}
```

Replace the existing clip-building code in `execute()` with a call to `buildClip(rawSegments, cfg, ctx)`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
cd server && npm test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/plugins/transcription/whisper-openai.plugin.ts
git commit -m "feat(whisper-openai): add reuseIfCached transcription cache"
```

---

## Task 6: Cache integration in `groq-whisper` plugin

**Files:**
- Modify: `server/src/plugins/transcription/groq-whisper.plugin.ts`

- [ ] **Step 1: Add `reuseIfCached` to config interface and schema**

In `groq-whisper.plugin.ts`, update the `GroqConfig` interface:

```ts
interface GroqConfig {
  apiKey?: string;
  model?: string;
  language?: string;
  clipName?: string;
  segmentBySpeech?: boolean;
  showSilenceMarkers?: boolean;
  chunkDurationSecs?: number;
  maxConcurrent?: number;
  reuseIfCached?: boolean;   // ADD THIS
}
```

In `configSchema.properties`, add after `maxConcurrent`:

```ts
reuseIfCached: {
  type: 'boolean',
  title: 'Reuse cached transcription',
  description: 'Skip the API call if this media was already transcribed with the same plugin, model, and language.',
  default: true,
},
```

- [ ] **Step 2: Add cache check and write to `execute()`**

In `execute()`, after resolving `cfg`, add:

```ts
const tag = '[groq-whisper]';
const reuseIfCached = cfg.reuseIfCached !== false; // default true
const model = cfg.model ?? 'whisper-large-v3-turbo';
const language = cfg.language ?? '';
const cacheKey = `groq-whisper:${ctx.mediaHash}:${model}:${language}`;
```

Before the `if (!fs.existsSync(ctx.mediaPath))` check, insert:

```ts
if (reuseIfCached && ctx.cache.has(cacheKey)) {
  console.log(`${tag} cache HIT  key=${cacheKey.slice(0, 48)}… — skipping transcription`);
  const cached = ctx.cache.get<RawSegment[]>(cacheKey)!;
  return buildClip(cached, cfg, ctx);
}
console.log(reuseIfCached
  ? `${tag} cache MISS  key=${cacheKey.slice(0, 48)}… — transcribing`
  : `${tag} reuseIfCached=false — transcribing (cache will be updated)`);
```

After `rawSegments` is assigned (after the try/finally), write to cache:

```ts
console.log(`${tag} cache WRITE  key=${cacheKey.slice(0, 48)}…  segments: ${rawSegments.length}`);
ctx.cache.set(cacheKey, rawSegments);
```

- [ ] **Step 3: Extract `buildClip` helper**

Same pattern as Task 5. Add at the bottom of `groq-whisper.plugin.ts`:

```ts
function buildClip(rawSegments: RawSegment[], cfg: GroqConfig, ctx: PipelineContext): PipelineContext {
  const coerceBool = (v: unknown, fallback: boolean) =>
    v === true || String(v).toLowerCase() === 'true' ? true
      : v === false || String(v).toLowerCase() === 'false' ? false
      : fallback;

  const segmentBySpeech = coerceBool(cfg.segmentBySpeech, true);
  const showSilenceMarkers = coerceBool(cfg.showSilenceMarkers, false);
  const clipId = uuidv4();
  const clipName = cfg.clipName ?? 'Groq Transcription';

  const segments: Segment[] = rawSegments.map((raw) => {
    const segId = uuidv4();
    let words: Word[];
    if (raw.words?.length) {
      words = raw.words.map((w) => ({
        id: uuidv4(),
        segmentId: segId,
        text: w.word.trim(),
        startTime: w.start,
        endTime: w.end,
        isRemoved: false,
      }));
    } else {
      words = estimateWords(segId, raw.text, raw.start, raw.end);
    }
    return {
      id: segId,
      clipId,
      startTime: raw.start,
      endTime: raw.end,
      text: raw.text,
      words,
      tags: [],
    };
  });

  const finalSegments = segmentBySpeech ? segments : mergeSegments(clipId, segments);

  const clip: Clip = {
    id: clipId,
    projectId: ctx.projectId,
    name: clipName,
    startTime: finalSegments[0]?.startTime ?? 0,
    endTime: finalSegments[finalSegments.length - 1]?.endTime ?? (ctx.mediaInfo?.duration ?? 0),
    segments: finalSegments,
    showSilenceMarkers,
  };

  return { ...ctx, clips: [...ctx.clips, clip] };
}
```

Replace the existing clip-building code in `execute()` with `return buildClip(rawSegments, cfg, ctx);`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/plugins/transcription/groq-whisper.plugin.ts
git commit -m "feat(groq-whisper): add reuseIfCached transcription cache"
```

---

## Done

After all tasks:
- `storage/pipeline-cache.json` is created on first cache write and persists across server restarts
- Both whisper plugins log `cache HIT / MISS / WRITE` on every run
- `reuseIfCached` checkbox appears in the pipeline configurator UI for both plugins (auto-rendered via JSON schema)
- Cache key: `pluginId:mediaHash:model:language` — same media + same settings = same key
- Setting `reuseIfCached: false` forces a fresh transcription but still updates the cache
