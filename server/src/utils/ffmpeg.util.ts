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
