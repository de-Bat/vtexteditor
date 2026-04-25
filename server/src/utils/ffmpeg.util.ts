import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import ffmpeg, { FfprobeData } from 'fluent-ffmpeg';
import { MediaInfo } from '../models/project.model';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Resolve ffmpeg/ffprobe paths and cache them before any spawn occurs.
// We use spawnSync with a minimal env so the env block never exceeds Windows
// CreateProcess limits (32 767 bytes) even when process.env.PATH is huge.
(function resolveFfmpegPaths() {
  const minEnv = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' };

  function findBinary(name: string): string {
    if (process.platform === 'win32') {
      const whereExe = path.join(minEnv.SystemRoot, 'System32', 'where.exe');
      const r = spawnSync(whereExe, [name], { env: minEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return (r.stdout ?? '').toString().trim().split(/\r?\n/)[0] ?? '';
    }
    const r = spawnSync('/usr/bin/which', [name], { env: minEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return (r.stdout ?? '').toString().trim();
  }

  const ffmpegPath  = process.env.FFMPEG_PATH  || findBinary('ffmpeg');
  const ffprobePath = process.env.FFPROBE_PATH || findBinary('ffprobe');
  console.log('[VTS] ffmpeg path resolved:', JSON.stringify(ffmpegPath));
  console.log('[VTS] ffprobe path resolved:', JSON.stringify(ffprobePath));
  if (ffmpegPath)  ffmpeg.setFfmpegPath(ffmpegPath);
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
})();

/** One fixed-duration chunk produced by splitAudioTrack. */
export interface AudioChunk {
  path: string;         // absolute path to the WAV chunk file
  startOffset: number;  // seconds from the start of the original file
  index: number;        // zero-based chunk index
  isOriginal: boolean;  // true when no split occurred — file must NOT be deleted by cleanup
}

/** Extract media metadata using ffprobe */
export function getMediaInfo(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, metadata: FfprobeData) => {
      if (err) return reject(err);

      const format = metadata.format;
      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      const audioStream = metadata.streams.find((s) => s.codec_type === 'audio');

      const duration = format.duration ?? 0;
      const bitrate = format.bit_rate ? parseInt(String(format.bit_rate), 10) : undefined;
      const formatName = (format.format_name ?? '').split(',')[0];

      const info: MediaInfo = {
        duration: Number(duration),
        format: formatName,
        codec: audioStream?.codec_name ?? videoStream?.codec_name ?? 'unknown',
        videoCodec: videoStream?.codec_name,
        width: videoStream?.width,
        height: videoStream?.height,
        bitrate,
      };

      resolve(info);
    });
  });
}

/**
 * Extract the audio track from a video (or any media) file and write it as a
 * 16 kHz mono WAV file to `outputPath`.  Ideal for speech-recognition APIs.
 * If the source is already a pure-audio file the re-encode still works fine.
 * Returns a promise that resolves on success and rejects on FFmpeg error.
 */
export function extractAudioTrack(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec('pcm_s16le')
      .format('wav')
      .output(outputPath)
      .on('error', (err: Error) => reject(new Error(`Audio extraction failed: ${err.message}`)))
      .on('end', () => resolve())
      .run();
  });
}

/**
 * Build a temporary file path for an extracted audio track.
 * Uses os.tmpdir() so it never pollutes the uploads folder.
 */
export function makeTempAudioPath(baseName: string): string {
  return path.join(os.tmpdir(), `vts-audio-${baseName}.wav`);
}

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
