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
 * @param audioPath        Path to the source WAV audio file.
 * @param transcribeFn     Caller-provided function that transcribes one WAV chunk.
 * @param opts             Chunk size and concurrency settings.
 * @param fileDurationSecs Known duration of the file in seconds. When provided
 *                         and <= chunkDurationSecs, splitting is skipped entirely.
 */
export async function chunkAndTranscribe(
  audioPath: string,
  transcribeFn: TranscribeFn,
  opts: ChunkOptions,
  fileDurationSecs?: number,
): Promise<RawSegment[]> {
  const { chunkDurationSecs, maxConcurrent } = opts;
  const tag = '[chunked-transcription]';

  // Skip splitting if the file fits in a single chunk
  let chunks: AudioChunk[];
  if (fileDurationSecs !== undefined && fileDurationSecs <= chunkDurationSecs) {
    console.log(`${tag} file fits in one chunk (${fileDurationSecs?.toFixed(1)}s <= ${chunkDurationSecs}s) — skipping split`);
    chunks = [{ path: audioPath, startOffset: 0, index: 0, isOriginal: true }];
  } else {
    console.log(`${tag} splitting audio into ${chunkDurationSecs}s chunks (maxConcurrent=${maxConcurrent})…`);
    chunks = await splitAudioTrack(audioPath, chunkDurationSecs);
    console.log(`${tag} split into ${chunks.length} chunk(s)`);
  }

  const limit = pLimit(maxConcurrent);
  let completed = 0;

  try {
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        limit(async () => {
          console.log(`${tag} chunk ${chunk.index + 1}/${chunks.length} starting (offset=${chunk.startOffset}s)`);
          const segments = await transcribeFn(chunk.path);
          completed++;
          console.log(`${tag} chunk ${chunk.index + 1}/${chunks.length} done — ${segments.length} segment(s)  [${completed}/${chunks.length} complete]`);
          return adjustTimestamps(segments, chunk.startOffset);
        }),
      ),
    );
    const merged = chunkResults.flat();
    console.log(`${tag} all chunks done — ${merged.length} total segment(s)`);
    return merged;
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
