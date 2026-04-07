import os from 'os';
import path from 'path';
import ffmpeg, { FfprobeData } from 'fluent-ffmpeg';
import { MediaInfo } from '../models/project.model';

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
