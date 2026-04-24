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
import { Segment } from '../models/segment.model';
import { ClipTransition } from '../models/clip-transition.model';

export type ExportFormat = 'video' | 'text-plain' | 'text-srt';

export interface ExportJob {
  id: string;
  projectId: string;
  clipIds?: string[];
  transitions?: ClipTransition[];
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
  start(projectId: string, format: ExportFormat, clipIds?: string[], transitions?: ClipTransition[]): string {
    const id = uuidv4();
    const job: ExportJob = { id, projectId, format, clipIds, transitions, status: 'pending', createdAt: new Date().toISOString() };
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
      const allWords: Word[] = clips.flatMap((c) => c.segments.flatMap((s: Segment) => s.words));
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
    // Branch to transition-aware export when transitions are configured
    if (job.transitions && job.transitions.length > 0 && job.clipIds && job.clipIds.length >= 2) {
      const clips = job.clipIds
        .map(id => (projectService.get(job.projectId)?.clips ?? []).find(c => c.id === id))
        .filter(Boolean) as import('../models/clip.model').Clip[];
      return this.exportVideoWithTransitions(job, inputPath, clips);
    }

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

  private exportVideoWithTransitions(
    job: ExportJob,
    inputPath: string,
    allClips: import('../models/clip.model').Clip[],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const orderedClips = job.clipIds!.map(id => allClips.find(c => c.id === id)).filter(Boolean) as import('../models/clip.model').Clip[];
      if (orderedClips.length < 2) return reject(new Error('Need at least 2 clips for transitions'));

      const clipStreams = orderedClips.map(clip => {
        const activeWords = clip.segments.flatMap(s => s.words).filter(w => !w.isRemoved);
        const kept = this.buildKeptSegmentsWithEffects(activeWords, [clip]);
        return { clipId: clip.id, kept } as any;
      });

      const project = projectService.get(job.projectId);
      const width = project?.mediaInfo?.width ?? 1920;
      const height = project?.mediaInfo?.height ?? 1080;
      const sampleRate = project?.mediaInfo?.sampleRate ?? 44100;

      const filterComplex = this.buildTransitionFilterComplex(
        clipStreams,
        job.transitions!,
        { width, height },
        sampleRate,
      );

      const outPath = path.join(this.exportsDir, `${job.id}.mp4`);
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

  private buildTransitionFilterComplex(
    clipStreams: Array<{
      clipId: string;
      kept: Array<{ start: number; end: number; effectAfter?: { effectType: string; effectDuration: number }; _skipConcat?: boolean }>;
      _xfadeConsumed?: boolean;
      _fadeInApplied?: boolean;
    }>,
    transitions: ClipTransition[],
    resolution: { width: number; height: number },
    sampleRate: number,
  ): string {
    const vFilters: string[] = [];
    const aFilters: string[] = [];
    const finalInputs: string[] = [];

    // Step 1: Build per-clip internal concat
    clipStreams.forEach((cs, clipIdx) => {
      const { kept } = cs;
      const clipVInputs: string[] = [];
      const clipAInputs: string[] = [];

      kept.forEach(({ start, end }, segIdx) => {
        const vLabel = `cv${clipIdx}_${segIdx}`;
        const aLabel = `ca${clipIdx}_${segIdx}`;
        vFilters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[${vLabel}]`);
        aFilters.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[${aLabel}]`);
        clipVInputs.push(`[${vLabel}]`);
        clipAInputs.push(`[${aLabel}]`);
      });

      if (clipVInputs.length === 0) return;

      if (clipVInputs.length === 1) {
        const srcV = clipVInputs[0].slice(1, -1);
        const srcA = clipAInputs[0].slice(1, -1);
        vFilters[vFilters.length - 1] = vFilters[vFilters.length - 1].replace(`[${srcV}]`, `[clip${clipIdx}_v]`);
        aFilters[aFilters.length - 1] = aFilters[aFilters.length - 1].replace(`[${srcA}]`, `[clip${clipIdx}_a]`);
      } else {
        const n = clipVInputs.length;
        vFilters.push(`${clipVInputs.join('')}concat=n=${n}:v=1:a=0[clip${clipIdx}_v]`);
        aFilters.push(`${clipAInputs.join('')}concat=n=${n}:v=0:a=1[clip${clipIdx}_a]`);
      }
    });

    // Step 2: Apply inter-clip transitions
    clipStreams.forEach((cs, clipIdx) => {
      if (clipIdx >= transitions.length) {
        // Last clip
        finalInputs.push(`[clip${clipIdx}_v][clip${clipIdx}_a]`);
        return;
      }

      const t = transitions[clipIdx];
      const halfDur = (t.durationMs / 2 / 1000).toFixed(4);
      const pauseSec = (t.pauseMs / 1000).toFixed(4);

      if (t.effect === 'hard-cut') {
        finalInputs.push(`[clip${clipIdx}_v][clip${clipIdx}_a]`);
        return;
      }

      if (t.effect === 'cross-dissolve') {
        const fullDur = (t.durationMs / 1000).toFixed(4);
        const clipDur = cs.kept.reduce((sum, s) => sum + (s.end - s.start), 0);
        const offset = Math.max(0, clipDur - Number(fullDur));
        vFilters.push(`[clip${clipIdx}_v][clip${clipIdx + 1}_v]xfade=transition=fade:duration=${fullDur}:offset=${offset.toFixed(4)}[xf${clipIdx}_v]`);
        aFilters.push(`[clip${clipIdx}_a][clip${clipIdx + 1}_a]acrossfade=d=${fullDur}:c1=tri:c2=tri[xf${clipIdx}_a]`);
        finalInputs.push(`[xf${clipIdx}_v][xf${clipIdx}_a]`);
        clipStreams[clipIdx + 1]._xfadeConsumed = true;
        return;
      }

      // fade-to-black, fade-to-white, dip-to-color
      const color = t.effect === 'dip-to-color' ? (t.color ?? '000000') :
                    t.effect === 'fade-to-white' ? 'white' : 'black';
      const { width, height } = resolution;
      const clipDur = cs.kept.reduce((sum, s) => sum + (s.end - s.start), 0);
      const fadeOutStart = Math.max(0, clipDur - Number(halfDur));

      vFilters.push(`[clip${clipIdx}_v]fade=t=out:st=${fadeOutStart.toFixed(4)}:d=${halfDur}:color=${color}[clip${clipIdx}_fo]`);
      aFilters.push(`[clip${clipIdx}_a]afade=t=out:st=${fadeOutStart.toFixed(4)}:d=${halfDur}[clip${clipIdx}_ao]`);
      finalInputs.push(`[clip${clipIdx}_fo][clip${clipIdx}_ao]`);

      if (t.pauseMs > 0) {
        vFilters.push(`color=c=${color}:s=${width}x${height}:d=${pauseSec}:r=25[pad${clipIdx}_v]`);
        aFilters.push(`anullsrc=r=${sampleRate}:cl=stereo,atrim=0:${pauseSec}[pad${clipIdx}_a]`);
        finalInputs.push(`[pad${clipIdx}_v][pad${clipIdx}_a]`);
      }

      vFilters.push(`[clip${clipIdx + 1}_v]fade=t=in:st=0:d=${halfDur}:color=${color}[clip${clipIdx + 1}_fi]`);
      aFilters.push(`[clip${clipIdx + 1}_a]afade=t=in:st=0:d=${halfDur}[clip${clipIdx + 1}_ai]`);
      clipStreams[clipIdx + 1]._fadeInApplied = true;
    });

    // Step 3: Rebuild final input list accounting for xfade consumed and fade-in applied
    const adjustedFinal: string[] = [];
    clipStreams.forEach((cs, clipIdx) => {
      if (cs._xfadeConsumed) return;
      if (cs._fadeInApplied) {
        adjustedFinal.push(`[clip${clipIdx}_fi][clip${clipIdx}_ai]`);
      } else {
        const existing = finalInputs.filter(f =>
          f.includes(`clip${clipIdx}_v`) || f.includes(`clip${clipIdx}_fo`) ||
          f.includes(`xf${clipIdx - 1}_v`) || f.includes(`pad${clipIdx - 1}_v`)
        );
        adjustedFinal.push(...existing);
      }
    });

    // Step 4: Final concat
    const allFilters = [...vFilters, ...aFilters];
    const n = adjustedFinal.length;
    if (n === 1) {
      allFilters.push(`${adjustedFinal[0]}concat=n=1:v=1:a=1[vout][aout]`);
    } else {
      allFilters.push(`${adjustedFinal.join('')}concat=n=${n}:v=1:a=1[vout][aout]`);
    }

    return allFilters.join(';');
  }
}

export const exportService = new ExportService();
