import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { projectService } from './project.service';
import { clipService } from './clip.service';
import { sseService } from './sse.service';
import { config } from '../config';
import { ensureDir } from '../utils/file.util';
import { Word } from '../models/word.model';

export type ExportFormat = 'video' | 'text-plain' | 'text-srt';

export interface ExportJob {
  id: string;
  projectId: string;
  clipIds?: string[];
  format: ExportFormat;
  status: 'pending' | 'running' | 'done' | 'error';
  outputPath?: string;
  error?: string;
  createdAt: string;
  startTime?: number;
  elapsedTime?: number;
  estimatedTotalTime?: number;
}

class ExportService {
  private jobs = new Map<string, ExportJob>();
  private exportsDir: string;

  constructor() {
    this.exportsDir = path.join(config.storage.projects, '..', 'exports');
    ensureDir(this.exportsDir);
  }

  getJob(id: string): ExportJob | undefined {
    return this.jobs.get(id);
  }

  /** Start an export job asynchronously. Returns jobId immediately. */
  start(projectId: string, format: ExportFormat): string {
    const id = uuidv4();
    const job: ExportJob = { id, projectId, format, status: 'pending', createdAt: new Date().toISOString() };
    this.jobs.set(id, job);
    setImmediate(() => this.run(id));
    return id;
  }

  private async run(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)!;
    job.status = 'running';

    try {
      const project = projectService.get(job.projectId);
      if (!project) throw new Error(`Project ${job.projectId} not found`);

      const clips = clipService.getAll(job.projectId);
      const allWords: Word[] = clips.flatMap((c) => c.segments.flatMap((s) => s.words));
      const activeWords = allWords.filter((w) => !w.isRemoved);

      if (job.format === 'text-plain') {
        await this.exportText(job, activeWords);
      } else if (job.format === 'text-srt') {
        await this.exportSrt(job, clips.flatMap((c) => c.segments));
      } else {
        await this.exportVideo(job, project.mediaPath, activeWords, activeWords);
      }

      job.status = 'done';
      sseService.broadcast({ type: 'export:complete', data: { jobId, format: job.format } });
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      sseService.broadcast({ type: 'export:error', data: { jobId, error: job.error } });
    }
  }

  private async exportText(job: ExportJob, words: Word[]): Promise<void> {
    const text = words.map((w) => w.text).join(' ');
    const outPath = path.join(this.exportsDir, `${job.id}.txt`);
    fs.writeFileSync(outPath, text, 'utf-8');
    job.outputPath = outPath;
  }

  private async exportSrt(job: ExportJob, segments: import('../models/segment.model').Segment[]): Promise<void> {
    const { toSrtTime } = await import('../utils/time.util');
    let index = 1;
    const lines: string[] = [];

    for (const seg of segments) {
      const activeWords = seg.words.filter((w) => !w.isRemoved);
      if (!activeWords.length) continue;

      const text = activeWords.map((w) => w.text).join(' ');
      const start = activeWords[0].startTime;
      const end = activeWords[activeWords.length - 1].endTime;

      lines.push(String(index++));
      lines.push(`${toSrtTime(start)} --> ${toSrtTime(end)}`);
      lines.push(text);
      lines.push('');
    }

    const outPath = path.join(this.exportsDir, `${job.id}.srt`);
    fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
    job.outputPath = outPath;
  }

  private exportVideo(
    job: ExportJob,
    inputPath: string,
    activeWords: Word[],
    _allWords: Word[],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!activeWords.length) return reject(new Error('No active words to export'));

      const clips = job.clipIds?.length
        ? (projectService.get(job.projectId)?.clips ?? []).filter((c) => job.clipIds!.includes(c.id))
        : (projectService.get(job.projectId)?.clips ?? []);

      // Build kept segments paired with their CutRegion effect metadata
      const kept = this.buildKeptSegmentsWithEffects(activeWords, clips);
      const outPath = path.join(this.exportsDir, `${job.id}.mp4`);

      const vFilters: string[] = [];
      const aFilters: string[] = [];
      const concatInputs: string[] = [];

      kept.forEach(({ start, end, effectAfter }, i) => {
        vFilters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);
        aFilters.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);

        if (effectAfter && i < kept.length - 1) {
          const halfDur = (effectAfter.effectDuration / 2 / 1000).toFixed(4);
          const fullDur = (effectAfter.effectDuration / 1000).toFixed(4);
          const segDur = end - start;

          if (effectAfter.effectType === 'fade') {
            const fadeOutStart = Math.max(0, segDur - Number(halfDur));
            vFilters[i] = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fade=t=out:st=${fadeOutStart}:d=${halfDur}[v${i}]`;
            aFilters[i] = `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeOutStart}:d=${halfDur}[a${i}]`;
            const nextIdx = i + 1;
            if (nextIdx < kept.length) {
              const n = kept[nextIdx];
              vFilters[nextIdx] = `[0:v]trim=start=${n.start}:end=${n.end},setpts=PTS-STARTPTS,fade=t=in:st=0:d=${halfDur}[v${nextIdx}]`;
              aFilters[nextIdx] = `[0:a]atrim=start=${n.start}:end=${n.end},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${halfDur}[a${nextIdx}]`;
            }
          } else if (effectAfter.effectType === 'cross-cut') {
            const nextIdx = i + 1;
            if (nextIdx < kept.length) {
              const n = kept[nextIdx];
              vFilters[i] = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}_raw]`;
              aFilters[i] = `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}_raw]`;
              vFilters[nextIdx] = `[0:v]trim=start=${n.start}:end=${n.end},setpts=PTS-STARTPTS[v${nextIdx}_raw]`;
              aFilters[nextIdx] = `[0:a]atrim=start=${n.start}:end=${n.end},asetpts=PTS-STARTPTS[a${nextIdx}_raw]`;
              const xfadeOffset = Math.max(0, (end - start) - Number(fullDur));
              vFilters.push(`[v${i}_raw][v${nextIdx}_raw]xfade=transition=fade:duration=${fullDur}:offset=${xfadeOffset.toFixed(4)}[v_xf${i}]`);
              aFilters.push(`[a${i}_raw][a${nextIdx}_raw]acrossfade=d=${fullDur}:c1=tri:c2=tri[a_xf${i}]`);
              concatInputs.push(`[v_xf${i}][a_xf${i}]`);
              kept[nextIdx]._skipConcat = true;
              return;
            }
          }
        }
        if (!kept[i]._skipConcat) {
          concatInputs.push(`[v${i}][a${i}]`);
        }
      });

      const n = concatInputs.length;
      const filterComplex = [
        ...vFilters,
        ...aFilters,
        `${concatInputs.join('')}concat=n=${n}:v=1:a=1[vout][aout]`,
      ].join(';');

      job.startTime = Date.now();
      let lastProgress = 0;
      ffmpeg(inputPath)
        .complexFilter(filterComplex)
        .outputOptions(['-map [vout]', '-map [aout]', '-c:v libx264', '-c:a aac', '-movflags +faststart'])
        .output(outPath)
        .on('progress', (p) => {
          if (p.percent && p.percent - lastProgress >= 1) {
            lastProgress = p.percent;
            const now = Date.now();
            const elapsed = now - (job.startTime || now);
            const total = Math.round(elapsed / (p.percent / 100));
            job.elapsedTime = elapsed;
            job.estimatedTotalTime = total;
            sseService.broadcast({
              type: 'export:progress',
              data: { jobId: job.id, progress: Math.round(p.percent), elapsedTime: elapsed, estimatedTotalTime: total },
            });
          }
        })
        .on('end', () => { job.outputPath = outPath; resolve(); })
        .on('error', reject)
        .run();
    });
  }

  private buildKeptSegmentsWithEffects(
    words: Word[],
    clips: import('../models/clip.model').Clip[],
  ): Array<{ start: number; end: number; effectAfter?: { effectType: string; effectDuration: number }; _skipConcat?: boolean }> {
    if (!words.length) return [];

    const sorted = [...words].sort((a, b) => a.startTime - b.startTime);
    const segments: Array<{ start: number; end: number; lastWordId: string }> = [];
    let cur = { start: sorted[0].startTime, end: sorted[0].endTime, lastWordId: sorted[0].id };

    for (let i = 1; i < sorted.length; i++) {
      const w = sorted[i];
      if (w.startTime <= cur.end + 0.05) {
        cur.end = Math.max(cur.end, w.endTime);
        cur.lastWordId = w.id;
      } else {
        segments.push(cur);
        cur = { start: w.startTime, end: w.endTime, lastWordId: w.id };
      }
    }
    segments.push(cur);

    return segments.map((seg, idx) => {
      if (idx === segments.length - 1) return { start: seg.start, end: seg.end };
      const nextSegStart = segments[idx + 1].start;
      let effectAfter: { effectType: string; effectDuration: number } | undefined;
      for (const clip of clips) {
        for (const region of clip.cutRegions ?? []) {
          const regionWords = region.wordIds
            .map((id) => clip.segments.flatMap((s) => s.words).find((w) => w.id === id))
            .filter((w): w is Word => !!w);
          if (!regionWords.length) continue;
          const rStart = Math.min(...regionWords.map((w) => w.startTime));
          const rEnd = Math.max(...regionWords.map((w) => w.endTime));
          if (rStart >= seg.end - 0.1 && rEnd <= nextSegStart + 0.1) {
            effectAfter = { effectType: region.effectType, effectDuration: region.effectDuration };
            break;
          }
        }
        if (effectAfter) break;
      }
      return { start: seg.start, end: seg.end, effectAfter };
    });
  }
}

export const exportService = new ExportService();
