# Pipeline Cache Design

**Date:** 2026-04-11  
**Status:** Approved

## Problem

Transcription plugins always re-transcribe from scratch on every pipeline run — even when the same media file was already transcribed with the same settings. This wastes time and API credits.

## Goal

Provide a generic key-value cache through `PipelineContext` that any plugin can opt into. The plugin owns the cache key and the stored type. The pipeline owns the store.

---

## 1. Cache Interface

A new `PipelineCache` interface exposed on `PipelineContext`:

```ts
interface PipelineCache {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
}
```

No assumptions about what is stored. Consumers are fully responsible for their key and value shape.

---

## 2. PipelineContext Changes

Two additions to `PipelineContext`:

```ts
export interface PipelineContext {
  projectId: string;
  mediaPath: string;
  mediaInfo: MediaInfo;
  mediaHash: string;        // NEW — SHA-256 of media file, pre-computed by pipeline service
  clips: Clip[];
  metadata: Record<string, unknown>;
  cache: PipelineCache;     // NEW — generic plugin cache
}
```

`mediaHash` is provided so plugins can construct stable cache keys without calling the hash service themselves.

---

## 3. PipelineCacheService

A new singleton service at `server/src/services/pipeline-cache.service.ts`.

**Storage:** `storage/pipeline-cache.json` — same pattern as `hash-cache.json`.  
**Loaded** at startup into an in-memory `Map<string, unknown>`.  
**Written** to disk on every `set()` call (atomic write, same as existing pattern).

```ts
class PipelineCacheService implements PipelineCache {
  get<T>(key: string): T | null
  set<T>(key: string, value: T): void   // persists to disk
  has(key: string): boolean
}

export const pipelineCacheService = new PipelineCacheService();
```

---

## 4. Server-Side Hash Utility

A new `server/src/utils/media-hash.util.ts` replicates the client-side head+tail sampling algorithm so that the server and client produce identical hashes for the same file.

```ts
// SAMPLE = 2 MB head + 2 MB tail + 8-byte little-endian file size
export async function computeMediaHash(filePath: string): Promise<string>
```

Uses Node's `crypto.createHash('sha256')` and `fs` with positional reads — no full file load into memory.

---

## 5. PipelineService Changes

Before starting the pipeline run, the service:

1. Calls `computeMediaHash(params.mediaPath)` to get a stable hash.
2. Uses the `pipelineCacheService` singleton.
3. Passes both into the initial `PipelineContext`.

```ts
const mediaHash = await computeMediaHash(params.mediaPath);
let ctx: PipelineContext = {
  ...
  mediaHash,
  cache: pipelineCacheService,
};
```

---

## 6. Transcription Plugin Changes

Both `whisper-openai` and `groq-whisper` opt into the cache.

### Config schema addition (both plugins)

```json
"reuseIfCached": {
  "type": "boolean",
  "title": "Reuse cached transcription",
  "description": "Skip the API call if this media was already transcribed with the same settings.",
  "default": true
}
```

### Cache key

```ts
const cacheKey = `${pluginId}:${ctx.mediaHash}:${model}:${language}`;
```

### Plugin execution flow

```
if (reuseIfCached && ctx.cache.has(cacheKey))
  → log cache HIT
  → load RawSegment[] from cache
  → skip API call entirely
else
  → log cache MISS (or reuseIfCached=false)
  → transcribe (extract audio, chunk, call API)
  → log cache WRITE
  → ctx.cache.set(cacheKey, rawSegments)
```

**What is cached:** `RawSegment[]` — the raw API output before `Clip`/`Segment`/`Word` object construction. This keeps the cached value plugin-neutral and ensures current config options (`segmentBySpeech`, `showSilenceMarkers`) are applied fresh at build time.

---

## 7. Logging

All cache interactions are logged with a `[pipeline-cache]` tag and a `[plugin-id]` tag:

| Event | Log |
|-------|-----|
| Cache hit | `[whisper-openai] cache HIT key=whisper-openai:abc123:large-v3:en — skipping transcription` |
| Cache miss | `[whisper-openai] cache MISS key=whisper-openai:abc123:large-v3:en — transcribing` |
| Cache bypass | `[whisper-openai] reuseIfCached=false — transcribing (cache will be updated)` |
| Cache write | `[whisper-openai] cache WRITE key=whisper-openai:abc123:large-v3:en  segments: 42` |
| Hash computed | `[pipeline] mediaHash computed: abc123...  path: recording.mp4` |

---

## 8. Files Changed

| File | Change |
|------|--------|
| `server/src/models/pipeline-context.model.ts` | Add `mediaHash` and `cache` fields; add `PipelineCache` interface |
| `server/src/services/pipeline-cache.service.ts` | **New** — `PipelineCacheService` + singleton |
| `server/src/utils/media-hash.util.ts` | **New** — server-side head+tail hash (matches client algorithm) |
| `server/src/services/pipeline.service.ts` | Compute `mediaHash`, inject `cache` into context |
| `server/src/plugins/transcription/whisper-openai.plugin.ts` | Add `reuseIfCached` config + cache read/write |
| `server/src/plugins/transcription/groq-whisper.plugin.ts` | Add `reuseIfCached` config + cache read/write |

`srt-import` is excluded — it imports an existing file rather than making an API call, so caching provides no benefit.

---

## Out of Scope

- Cache eviction / TTL (not needed for now; cache entries are small and stable)
- Cache invalidation UI (user can force re-run by setting `reuseIfCached: false`)
- Caching for non-transcription plugins
