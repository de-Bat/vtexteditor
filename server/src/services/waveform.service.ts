import { spawn } from 'child_process';
import path from 'path';
import { clipService } from './clip.service';
import { projectService } from './project.service';
import { config } from '../config';

export interface WaveformData {
  peaks: number[];   // normalized [0,1], one entry per chunkMs
  durationMs: number;
  chunkMs: number;
}

const SAMPLE_RATE = 8000;          // Hz — low rate is fine for waveform visualization
const CHUNK_MS = 50;
const SAMPLES_PER_CHUNK = (SAMPLE_RATE * CHUNK_MS) / 1000; // 400

class WaveformService {
  private cache = new Map<string, WaveformData>();

  invalidate(clipId: string): void {
    this.cache.delete(clipId);
  }

  async compute(clipId: string): Promise<WaveformData> {
    const cached = this.cache.get(clipId);
    if (cached) return cached;

    const clip = clipService.getById(clipId);
    if (!clip) throw new Error(`Clip not found: ${clipId}`);

    const project = projectService.getCurrent();
    if (!project) throw new Error('No active project');

    const mediaPath = path.join(
      config.storage.uploads,
      path.basename(project.mediaPath)
    );

    const startSec = clip.startTime;
    const durationSec = Math.max(0, clip.endTime - clip.startTime);

    const data = await this.extractPeaks(mediaPath, startSec, durationSec);
    this.cache.set(clipId, data);
    return data;
  }

  /** Exported for unit testing only. */
  computePeaks(samples: Int16Array): number[] {
    const peaks: number[] = [];
    for (let i = 0; i < samples.length; i += SAMPLES_PER_CHUNK) {
      const end = Math.min(i + SAMPLES_PER_CHUNK, samples.length);
      let sumSq = 0;
      for (let j = i; j < end; j++) sumSq += samples[j] * samples[j];
      peaks.push(Math.sqrt(sumSq / (end - i)));
    }
    let maxVal = 1;
    for (const p of peaks) { if (p > maxVal) maxVal = p; }
    return peaks.map(p => p / maxVal);
  }

  private extractPeaks(
    mediaPath: string,
    startSec: number,
    durationSec: number
  ): Promise<WaveformData> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      // -ss before -i = fast keyframe seek; -t limits extraction to clip duration
      const ffmpeg = spawn('ffmpeg', [
        '-ss', String(startSec),
        '-t', String(durationSec),
        '-i', mediaPath,
        '-ac', '1',
        '-ar', String(SAMPLE_RATE),
        '-f', 's16le',
        'pipe:1',
      ]);

      ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

      ffmpeg.stderr.on('data', () => { /* suppress ffmpeg log noise */ });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          if (chunks.length === 0) {
            // No audio track or ffmpeg error — return empty (flat line in UI)
            resolve({ peaks: [], durationMs: Math.round(durationSec * 1000), chunkMs: CHUNK_MS });
            return;
          }
          console.warn(`[WaveformService] ffmpeg exited ${code} after writing ${chunks.length} chunk(s) — using partial data`);
        }
        const buf = Buffer.concat(chunks);
        const samples = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
        const actualDurationMs = Math.round((samples.length / SAMPLE_RATE) * 1000);
        const peaks = this.computePeaks(samples);
        resolve({ peaks, durationMs: actualDurationMs, chunkMs: CHUNK_MS });
      });

      ffmpeg.on('error', reject);
    });
  }
}

export const waveformService = new WaveformService();
