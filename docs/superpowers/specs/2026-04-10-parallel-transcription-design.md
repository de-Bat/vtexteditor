# Parallel Transcription — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

---

## Overview

Reduce transcription time for long audio/video files by splitting the audio into fixed-duration chunks and transcribing them concurrently. A shared `chunkAndTranscribe` utility handles splitting, concurrency, timestamp adjustment, merging, and cleanup. The groq-whisper plugin calls it; any future transcription plugin (OpenAI Whisper, AssemblyAI) can do the same by passing its own `TranscribeFn` callback. No abstract plugin infrastructure is introduced.

---

## Architecture

```
groq-whisper.execute()
        │
        ▼
extractAudioTrack()               ← existing, unchanged
        │
        ▼
chunkAndTranscribe(audioPath, transcribeFn, opts)   ← new utility
        │
        ├── splitAudioTrack()     ← new ffmpeg helper
        │     splits into N WAV chunks of chunkDurationSecs
        │     if file duration ≤ chunkDurationSecs: single chunk, no split
        │
        ├── run transcribeFn() on each chunk
        │     concurrency capped at maxConcurrent using p-limit
        │
        ├── adjust timestamps: add startOffset to every start/end in each chunk's segments
        │
        ├── merge all segments in chronological order
        │
        └── delete temp chunk files in finally block (success or failure)
                │
                ▼
        merged RawSegment[]
                │
                ▼
        build Clip → Segments → Words   ← existing logic, unchanged
```

---

## Data Shapes

```ts
/** Minimal segment shape returned by any Whisper-compatible API. */
interface RawSegment {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

/** Caller-supplied transcription function. Receives a path to a WAV chunk. */
type TranscribeFn = (audioPath: string) => Promise<RawSegment[]>;

interface ChunkOptions {
  chunkDurationSecs: number;  // default: 300
  maxConcurrent: number;      // default: 3
}

/** Returned by splitAudioTrack — one entry per output file. */
interface AudioChunk {
  path: string;         // absolute path to the WAV chunk file
  startOffset: number;  // seconds from the start of the original file
  index: number;        // zero-based chunk index
  isOriginal: boolean;  // true when no split occurred — file must not be deleted by cleanup
}
```

---

## New groq-whisper Config Fields

```ts
interface GroqConfig {
  // ... existing fields ...
  chunkDurationSecs?: number;  // default 300 — chunk size for parallel transcription
  maxConcurrent?: number;      // default 3 — max simultaneous Groq API calls
}
```

Added to `configSchema` in the plugin:

```ts
chunkDurationSecs: {
  type: 'number',
  title: 'Chunk Duration (seconds)',
  description: 'Audio is split into chunks of this length and transcribed in parallel.',
  default: 300,
},
maxConcurrent: {
  type: 'number',
  title: 'Max Parallel Chunks',
  description: 'Maximum number of simultaneous API calls. Lower this if you hit rate limits.',
  default: 3,
},
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| File shorter than `chunkDurationSecs` | `splitAudioTrack` returns a single chunk (the full audio) — no splitting overhead, identical to current behaviour |
| Any chunk's `transcribeFn` throws | `chunkAndTranscribe` throws; pipeline emits `pipeline:error`; all temp chunk files are deleted in `finally` |
| Groq 429 rate limit | Propagates as a normal error — user retries with a lower `maxConcurrent` value |
| Chunk produces zero segments | Treated as empty array — merged result omits that time range (consistent with Whisper's silence handling) |
| Temp file cleanup | `finally` block in `chunkAndTranscribe` deletes all chunk files regardless of success or failure |

No automatic retry logic — keeps the utility simple. Rate-limit retry can be added later if needed.

---

## Files to Create / Modify

### Server
- `server/src/utils/chunked-transcription.util.ts` — new: `chunkAndTranscribe` utility
- `server/src/utils/chunked-transcription.util.test.ts` — new: Vitest unit tests
- `server/src/utils/ffmpeg.util.ts` — add `splitAudioTrack(inputPath: string, chunkDurationSecs: number): Promise<AudioChunk[]>` (uses `os.tmpdir()` internally)
- `server/src/plugins/transcription/groq-whisper.plugin.ts` — extract inner transcribe fn, call `chunkAndTranscribe`, add config fields

### Dependencies
- `p-limit` — concurrency control. Already commonly available in Node.js ecosystems; add to server `package.json` if not present.

---

## Implementation Notes

- `splitAudioTrack` uses ffmpeg's `-f segment -segment_time N` flag to split. Output files are named `chunk-000.wav`, `chunk-001.wav`, etc. in `os.tmpdir()`.
- If the source duration is known (from `mediaInfo`) and is ≤ `chunkDurationSecs`, `splitAudioTrack` skips ffmpeg and returns `[{ path: inputPath, startOffset: 0, index: 0 }]` — no copy, no overhead. The caller's `finally` must not delete the original audio in this case; the utility sets a `isOriginal: true` flag on the single-chunk entry, and only deletes files where `isOriginal` is false.
- `p-limit` is used to cap concurrent `transcribeFn` calls. All chunk tasks are created upfront; `p-limit` schedules them.
- Timestamp adjustment: for each chunk `i`, add `chunk.startOffset` to `segment.start`, `segment.end`, and every `word.start` / `word.end`. The `startOffset` is `i * chunkDurationSecs` (exact, not derived from actual ffmpeg output — avoids floating-point drift from ffprobe re-reads).
- The groq-whisper plugin refactor: extract the block that calls the Groq API and returns `RawSegment[]` into a local `async function transcribeChunk(audioPath: string): Promise<RawSegment[]>`. Pass this as `transcribeFn` to `chunkAndTranscribe`. The rest of the plugin (clip building) is unchanged.
