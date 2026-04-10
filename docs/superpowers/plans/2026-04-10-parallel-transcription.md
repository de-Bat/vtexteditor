# Parallel Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split audio into fixed-duration chunks and transcribe them concurrently, reducing wall-clock time for long recordings.

**Architecture:** A shared `chunkAndTranscribe(audioPath, transcribeFn, opts, fileDurationSecs?)` utility handles splitting via ffmpeg, concurrent API calls via p-limit, timestamp adjustment, merging, and temp-file cleanup. The groq-whisper plugin extracts its Groq API call into a local `transcribeChunk` function and passes it in — no changes to the pipeline or plugin interface.

**Tech Stack:** Node.js/TypeScript, fluent-ffmpeg, p-limit@4, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `server/package.json` | Add p-limit@4 dependency |
| Modify | `server/src/utils/ffmpeg.util.ts` | Add `AudioChunk` type + `splitAudioTrack` |
| Create | `server/src/utils/chunked-transcription.util.ts` | `RawSegment`, `TranscribeFn`, `ChunkOptions`, `chunkAndTranscribe`, `adjustTimestamps` |
| Create | `server/src/utils/chunked-transcription.util.test.ts` | Vitest unit tests |
| Modify | `server/src/plugins/transcription/groq-whisper.plugin.ts` | Extract `transcribeChunk`, call `chunkAndTranscribe`, add config fields |

---

## Task 1: Install p-limit

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install p-limit@4**

```bash
cd server && npm install p-limit@4
```

p-limit v4 is the last version with CommonJS support. v5+ is ESM-only and incompatible with this server's `"module": "CommonJS"` tsconfig.

- [ ] **Step 2: Verify TypeScript can import it**

```bash
cd server && echo 'import pLimit from "p-limit"; const limit = pLimit(3); console.log(typeof limit);' > /tmp/test-plimit.ts && npx ts-node /tmp/test-plimit.ts
```

Expected output: `function`

- [ ] **Step 3: Commit**

```bash
cd C:/web.projects/VTextStudio && git add server/package.json server/package-lock.json && git commit -m "chore: add p-limit@4 for concurrency control"
```

---

## Task 2: Add `AudioChunk` type and `splitAudioTrack` to ffmpeg.util.ts

**Files:**
- Modify: `server/src/utils/ffmpeg.util.ts`

- [ ] **Step 1: Add imports and `AudioChunk` type**

Add these at the top of `server/src/utils/ffmpeg.util.ts`, after the existing imports:

```ts
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
```

Add this type export after the existing imports (before the first function):

```ts
/** One fixed-duration chunk produced by splitAudioTrack. */
export interface AudioChunk {
  path: string;         // absolute path to the WAV chunk file
  startOffset: number;  // seconds from the start of the original file
  index: number;        // zero-based chunk index
  isOriginal: boolean;  // true when no split occurred — file must NOT be deleted by cleanup
}
```

- [ ] **Step 2: Add `splitAudioTrack` function**

Add this at the end of `server/src/utils/ffmpeg.util.ts`:

```ts
/**
 * Split an audio file into fixed-duration WAV chunks using ffmpeg segment muxer.
 * Output files land in os.tmpdir() with a unique prefix.
 * Returns chunks sorted by index with pre-computed startOffset values.
 *
 * If the file is shorter than chunkDurationSecs, ffmpeg still runs but produces
 * a single chunk (index 0). The caller is responsible for deleting chunk files
 * that have isOriginal === false.
 */
export function splitAudioTrack(
  inputPath: string,
  chunkDurationSecs: number,
): Promise<AudioChunk[]> {
  const prefix = `vts-chunk-${uuidv4()}`;
  const outputPattern = path.join(os.tmpdir(), `${prefix}-%03d.wav`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-f', 'segment',
        '-segment_time', String(chunkDurationSecs),
        '-c', 'copy',
      ])
      .output(outputPattern)
      .on('error', (err: Error) => reject(new Error(`Audio split failed: ${err.message}`)))
      .on('end', () => {
        const files = fs
          .readdirSync(os.tmpdir())
          .filter((f) => f.startsWith(prefix))
          .sort()
          .map((f) => path.join(os.tmpdir(), f));

        const chunks: AudioChunk[] = files.map((filePath, index) => ({
          path: filePath,
          startOffset: index * chunkDurationSecs,
          index,
          isOriginal: false,
        }));

        resolve(chunks);
      })
      .run();
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
cd C:/web.projects/VTextStudio && git add server/src/utils/ffmpeg.util.ts && git commit -m "feat: splitAudioTrack — ffmpeg segment chunker"
```

---

## Task 3: Create `chunked-transcription.util.ts` and tests

**Files:**
- Create: `server/src/utils/chunked-transcription.util.ts`
- Create: `server/src/utils/chunked-transcription.util.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/utils/chunked-transcription.util.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./ffmpeg.util', () => ({
  splitAudioTrack: vi.fn(),
}));

import { chunkAndTranscribe, adjustTimestamps, RawSegment } from './chunked-transcription.util';
import { splitAudioTrack } from './ffmpeg.util';

const mockSplit = vi.mocked(splitAudioTrack);

const seg = (start: number, end: number, text = 'hi'): RawSegment => ({ start, end, text });
const segWithWords = (start: number, end: number): RawSegment => ({
  start,
  end,
  text: 'hello world',
  words: [
    { word: 'hello', start, end: start + 0.5 },
    { word: 'world', start: start + 0.5, end },
  ],
});

describe('adjustTimestamps', () => {
  it('returns segments unchanged when offset is 0', () => {
    const segs = [seg(1, 2), seg(3, 4)];
    expect(adjustTimestamps(segs, 0)).toEqual(segs);
  });

  it('adds offset to segment start and end', () => {
    const result = adjustTimestamps([seg(1, 2)], 300);
    expect(result[0].start).toBe(301);
    expect(result[0].end).toBe(302);
  });

  it('adds offset to word timestamps', () => {
    const result = adjustTimestamps([segWithWords(0, 1)], 300);
    expect(result[0].words![0].start).toBe(300);
    expect(result[0].words![0].end).toBe(300.5);
    expect(result[0].words![1].start).toBe(300.5);
    expect(result[0].words![1].end).toBe(301);
  });

  it('handles segments without words', () => {
    const result = adjustTimestamps([seg(5, 10)], 100);
    expect(result[0].words).toBeUndefined();
  });
});

describe('chunkAndTranscribe', () => {
  beforeEach(() => {
    mockSplit.mockReset();
  });

  it('skips splitting when fileDurationSecs <= chunkDurationSecs', async () => {
    const transcribeFn = vi.fn().mockResolvedValue([seg(0, 5)]);

    const result = await chunkAndTranscribe(
      '/audio.wav',
      transcribeFn,
      { chunkDurationSecs: 300, maxConcurrent: 3 },
      120, // 2 minutes — shorter than chunk duration
    );

    expect(mockSplit).not.toHaveBeenCalled();
    expect(transcribeFn).toHaveBeenCalledOnce();
    expect(transcribeFn).toHaveBeenCalledWith('/audio.wav');
    expect(result).toEqual([seg(0, 5)]);
  });

  it('calls splitAudioTrack when fileDurationSecs > chunkDurationSecs', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
      { path: '/chunk-1.wav', startOffset: 300, index: 1, isOriginal: false },
    ]);
    const transcribeFn = vi.fn()
      .mockResolvedValueOnce([seg(0, 5)])
      .mockResolvedValueOnce([seg(0, 10)]); // chunk-relative timestamps

    const result = await chunkAndTranscribe(
      '/audio.wav',
      transcribeFn,
      { chunkDurationSecs: 300, maxConcurrent: 3 },
      700,
    );

    expect(mockSplit).toHaveBeenCalledWith('/audio.wav', 300);
    expect(result).toHaveLength(2);
    // First chunk: no offset
    expect(result[0]).toEqual(seg(0, 5));
    // Second chunk: timestamps adjusted by 300
    expect(result[1].start).toBe(300);
    expect(result[1].end).toBe(310);
  });

  it('calls splitAudioTrack when fileDurationSecs is not provided', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
    ]);
    const transcribeFn = vi.fn().mockResolvedValue([seg(1, 2)]);

    await chunkAndTranscribe('/audio.wav', transcribeFn, { chunkDurationSecs: 300, maxConcurrent: 3 });

    expect(mockSplit).toHaveBeenCalledWith('/audio.wav', 300);
  });

  it('merges results from all chunks in order', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
      { path: '/chunk-1.wav', startOffset: 300, index: 1, isOriginal: false },
      { path: '/chunk-2.wav', startOffset: 600, index: 2, isOriginal: false },
    ]);
    const transcribeFn = vi.fn()
      .mockResolvedValueOnce([seg(0, 10, 'first')])
      .mockResolvedValueOnce([seg(0, 10, 'second')])
      .mockResolvedValueOnce([seg(0, 10, 'third')]);

    const result = await chunkAndTranscribe(
      '/audio.wav',
      transcribeFn,
      { chunkDurationSecs: 300, maxConcurrent: 3 },
    );

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('first');
    expect(result[1].start).toBe(300);
    expect(result[1].text).toBe('second');
    expect(result[2].start).toBe(600);
    expect(result[2].text).toBe('third');
  });

  it('respects maxConcurrent limit', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
      { path: '/chunk-1.wav', startOffset: 300, index: 1, isOriginal: false },
      { path: '/chunk-2.wav', startOffset: 600, index: 2, isOriginal: false },
      { path: '/chunk-3.wav', startOffset: 900, index: 3, isOriginal: false },
    ]);

    let concurrent = 0;
    let maxObserved = 0;

    const slowTranscribe = async (): Promise<RawSegment[]> => {
      concurrent++;
      maxObserved = Math.max(maxObserved, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return [];
    };

    await chunkAndTranscribe('/audio.wav', slowTranscribe, { chunkDurationSecs: 300, maxConcurrent: 2 });

    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it('throws when transcribeFn rejects, and does not swallow the error', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
    ]);
    const transcribeFn = vi.fn().mockRejectedValue(new Error('API down'));

    await expect(
      chunkAndTranscribe('/audio.wav', transcribeFn, { chunkDurationSecs: 300, maxConcurrent: 3 }),
    ).rejects.toThrow('API down');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npx vitest run src/utils/chunked-transcription.util.test.ts
```

Expected: FAIL — `Cannot find module './chunked-transcription.util'`

- [ ] **Step 3: Implement `chunked-transcription.util.ts`**

Create `server/src/utils/chunked-transcription.util.ts`:

```ts
import fs from 'fs';
import pLimit from 'p-limit';
import { splitAudioTrack, AudioChunk } from './ffmpeg.util';

/** Minimal segment shape returned by any Whisper-compatible API. */
export interface RawSegment {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

/** Caller-supplied transcription function. Receives a path to a WAV file. */
export type TranscribeFn = (audioPath: string) => Promise<RawSegment[]>;

export interface ChunkOptions {
  /** Duration of each audio chunk in seconds. Default: 300. */
  chunkDurationSecs: number;
  /** Maximum simultaneous transcription API calls. Default: 3. */
  maxConcurrent: number;
}

/**
 * Split audio into chunks, transcribe them concurrently, adjust timestamps,
 * and return merged segments in chronological order.
 *
 * @param audioPath     Path to the source WAV audio file.
 * @param transcribeFn  Caller-provided function that transcribes one WAV chunk.
 * @param opts          Chunk size and concurrency settings.
 * @param fileDurationSecs  Known duration of the file in seconds. When provided
 *                          and <= chunkDurationSecs, splitting is skipped entirely.
 */
export async function chunkAndTranscribe(
  audioPath: string,
  transcribeFn: TranscribeFn,
  opts: ChunkOptions,
  fileDurationSecs?: number,
): Promise<RawSegment[]> {
  const { chunkDurationSecs, maxConcurrent } = opts;

  // Skip splitting if the file fits in a single chunk
  let chunks: AudioChunk[];
  if (fileDurationSecs !== undefined && fileDurationSecs <= chunkDurationSecs) {
    chunks = [{ path: audioPath, startOffset: 0, index: 0, isOriginal: true }];
  } else {
    chunks = await splitAudioTrack(audioPath, chunkDurationSecs);
  }

  const limit = pLimit(maxConcurrent);

  try {
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        limit(async () => {
          const segments = await transcribeFn(chunk.path);
          return adjustTimestamps(segments, chunk.startOffset);
        }),
      ),
    );
    return chunkResults.flat();
  } finally {
    // Delete temp chunk files — never delete the original audio
    for (const chunk of chunks) {
      if (!chunk.isOriginal && fs.existsSync(chunk.path)) {
        fs.unlinkSync(chunk.path);
      }
    }
  }
}

/**
 * Shift all timestamps in a segment array by `offset` seconds.
 * Returns the same array reference when offset === 0 (no allocation).
 */
export function adjustTimestamps(segments: RawSegment[], offset: number): RawSegment[] {
  if (offset === 0) return segments;
  return segments.map((seg) => ({
    ...seg,
    start: seg.start + offset,
    end: seg.end + offset,
    words: seg.words?.map((w) => ({
      ...w,
      start: w.start + offset,
      end: w.end + offset,
    })),
  }));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npx vitest run src/utils/chunked-transcription.util.test.ts
```

Expected: PASS — 9 tests (4 `adjustTimestamps` + 6 `chunkAndTranscribe`)

- [ ] **Step 5: Commit**

```bash
cd C:/web.projects/VTextStudio && git add server/src/utils/chunked-transcription.util.ts server/src/utils/chunked-transcription.util.test.ts && git commit -m "feat: chunkAndTranscribe utility — parallel chunked transcription"
```

---

## Task 4: Update groq-whisper plugin

**Files:**
- Modify: `server/src/plugins/transcription/groq-whisper.plugin.ts`

The plugin currently calls the Groq API inline. We extract that into a `transcribeChunk` local function, add two new config fields, and call `chunkAndTranscribe`.

- [ ] **Step 1: Add imports**

At the top of `server/src/plugins/transcription/groq-whisper.plugin.ts`, add:

```ts
import { chunkAndTranscribe, RawSegment } from '../../utils/chunked-transcription.util';
```

- [ ] **Step 2: Add new config fields to `GroqConfig`**

Update the `GroqConfig` interface (currently at the top of the file):

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
}
```

- [ ] **Step 3: Add config schema entries**

In `configSchema.properties`, add after `showSilenceMarkers`:

```ts
chunkDurationSecs: {
  type: 'number',
  title: 'Chunk Duration (seconds)',
  description: 'Audio is split into chunks of this length and transcribed in parallel. Reduce for faster results on long recordings.',
  default: 300,
},
maxConcurrent: {
  type: 'number',
  title: 'Max Parallel Chunks',
  description: 'Maximum number of simultaneous Groq API calls. Lower this if you hit rate limits.',
  default: 3,
},
```

- [ ] **Step 4: Refactor `execute()` to use `chunkAndTranscribe`**

Replace the entire `execute` method with the following. The logic is identical except the Groq call is extracted into `transcribeChunk` and called via `chunkAndTranscribe`:

```ts
async execute(ctx: PipelineContext): Promise<PipelineContext> {
  const cfg = (ctx.metadata['groq-whisper'] ?? {}) as GroqConfig;
  const apiKey = cfg.apiKey ?? process.env['GROQ_API_KEY'] ?? settingsService.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('Groq API key required. Set GROQ_API_KEY env var, configure it in App Settings, or provide apiKey in the pipeline config.');

  const groq = new Groq({ apiKey });

  if (!fs.existsSync(ctx.mediaPath)) throw new Error(`Media file not found: ${ctx.mediaPath}`);

  // For video files, strip the video track first
  let audioPath = ctx.mediaPath;
  let tempCreated = false;
  if (ctx.mediaInfo.videoCodec) {
    const tempPath = makeTempAudioPath(uuidv4());
    await extractAudioTrack(ctx.mediaPath, tempPath);
    audioPath = tempPath;
    tempCreated = true;
  }

  // Local function: transcribe one WAV chunk via Groq
  const transcribeChunk = async (chunkPath: string): Promise<RawSegment[]> => {
    const fileStream = fs.createReadStream(chunkPath) as unknown as File;
    const transcription = await groq.audio.transcriptions.create({
      file: fileStream,
      model: (cfg.model ?? 'whisper-large-v3-turbo') as 'whisper-large-v3' | 'whisper-large-v3-turbo' | 'distil-whisper-large-v3-en',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      ...(cfg.language ? { language: cfg.language } : {}),
    });
    const raw = transcription as unknown as { segments?: GroqSegment[] };
    return (raw.segments ?? []).map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      words: seg.words?.map((w) => ({ word: w.word, start: w.start, end: w.end })),
    }));
  };

  const chunkDurationSecs = typeof cfg.chunkDurationSecs === 'number' ? cfg.chunkDurationSecs : 300;
  const maxConcurrent = typeof cfg.maxConcurrent === 'number' ? cfg.maxConcurrent : 3;

  let rawSegments: RawSegment[];
  try {
    rawSegments = await chunkAndTranscribe(
      audioPath,
      transcribeChunk,
      { chunkDurationSecs, maxConcurrent },
      ctx.mediaInfo?.duration,
    );
  } finally {
    if (tempCreated && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }

  // Coerce boolean settings; settingsService.get() returns strings.
  const coerceBool = (v: unknown, fallback: boolean) =>
    v === true || String(v).toLowerCase() === 'true' ? true
      : v === false || String(v).toLowerCase() === 'false' ? false
      : fallback;

  const segmentBySpeech = coerceBool(cfg.segmentBySpeech, true);
  const showSilenceMarkers = coerceBool(cfg.showSilenceMarkers, false);

  const clipId = uuidv4();
  const clipName = cfg.clipName ?? 'Groq Transcription';

  // Build Segment objects from raw segments
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
},
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run all server tests**

```bash
cd server && npx vitest run
```

Expected: all tests pass (including the new `chunked-transcription.util.test.ts`)

- [ ] **Step 7: Commit**

```bash
cd C:/web.projects/VTextStudio && git add server/src/plugins/transcription/groq-whisper.plugin.ts && git commit -m "feat: groq-whisper parallel transcription via chunkAndTranscribe"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|------------|
| Shared utility `chunkAndTranscribe(audioPath, transcribeFn, opts)` | Task 3 |
| `TranscribeFn`, `RawSegment`, `ChunkOptions` types | Task 3 |
| `splitAudioTrack` ffmpeg helper | Task 2 |
| `AudioChunk` with `isOriginal` flag | Task 2 |
| Skip splitting when file ≤ chunk duration | Task 3 — `fileDurationSecs` param |
| Concurrency via p-limit | Task 1 + Task 3 |
| Timestamp adjustment (start, end, words) | Task 3 `adjustTimestamps` |
| Temp file cleanup in finally block | Task 3 |
| Don't delete original audio (`isOriginal: true`) | Task 3 |
| `chunkDurationSecs` and `maxConcurrent` config on groq-whisper | Task 4 |
| groq-whisper uses `chunkAndTranscribe` | Task 4 |
| Error in chunk propagates to pipeline | Task 3 (throws) + Task 4 (no catch) |

All spec requirements covered. ✅
