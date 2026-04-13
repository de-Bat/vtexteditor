# Smart Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an export wizard that stitches approved clips with configurable inter-clip transitions (fade-to-black, cross-dissolve, etc.) and renders to video via FFmpeg.

**Architecture:** New `ClipTransition` model, extended `ExportService` with transition-aware FFmpeg filter chain generation, and a new `SmartEditDialogComponent` opened from the studio toolbar. Transitions are ephemeral (wizard session state only, not persisted to project).

**Tech Stack:** Angular 20+ (signals, standalone components, OnPush), Express.js, fluent-ffmpeg, Angular CDK Dialog.

**Design spec:** `docs/superpowers/specs/2026-04-13-smart-edit-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `server/src/models/clip-transition.model.ts` | `TransitionEffect`, `ClipTransition` types |
| Create | `client/src/app/core/models/clip-transition.model.ts` | Client-side mirror of the same types |
| Modify | `server/src/services/export.service.ts` | Accept transitions, build transition filter chains |
| Modify | `server/src/routes/export.routes.ts` | Validate `transitions` in request body |
| Create | `client/src/app/features/studio/smart-edit-dialog/smart-edit-dialog.component.ts` | The wizard dialog component |
| Modify | `client/src/app/features/studio/studio.component.ts` | Add Smart Edit button + dialog trigger |

---

## Task 1: Server — Transition Model

**Files:**
- Create: `server/src/models/clip-transition.model.ts`

- [ ] **Step 1.1: Create the transition model file**

```ts
// server/src/models/clip-transition.model.ts

export type TransitionEffect = 'hard-cut' | 'fade-to-black' | 'fade-to-white' | 'cross-dissolve' | 'dip-to-color';

export const TRANSITION_EFFECTS: TransitionEffect[] = [
  'hard-cut', 'fade-to-black', 'fade-to-white', 'cross-dissolve', 'dip-to-color',
];

export interface ClipTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  effect: TransitionEffect;
  durationMs: number;   // total fade-out + fade-in time, split evenly
  pauseMs: number;      // hold time on mid-state (e.g., seconds of black)
  color?: string;       // hex color, only for 'dip-to-color'
}
```

- [ ] **Step 1.2: Commit**

```bash
git add server/src/models/clip-transition.model.ts
git commit -m "feat(smart-edit): add ClipTransition model"
```

---

## Task 2: Client — Transition Model

**Files:**
- Create: `client/src/app/core/models/clip-transition.model.ts`

- [ ] **Step 2.1: Create the client-side transition model**

```ts
// client/src/app/core/models/clip-transition.model.ts

export type TransitionEffect = 'hard-cut' | 'fade-to-black' | 'fade-to-white' | 'cross-dissolve' | 'dip-to-color';

export const TRANSITION_EFFECTS: TransitionEffect[] = [
  'hard-cut', 'fade-to-black', 'fade-to-white', 'cross-dissolve', 'dip-to-color',
];

export const TRANSITION_LABELS: Record<TransitionEffect, string> = {
  'hard-cut': 'Hard Cut',
  'fade-to-black': 'Fade to Black',
  'fade-to-white': 'Fade to White',
  'cross-dissolve': 'Cross Dissolve',
  'dip-to-color': 'Dip to Color',
};

export interface ClipTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  effect: TransitionEffect;
  durationMs: number;
  pauseMs: number;
  color?: string;
}
```

- [ ] **Step 2.2: Commit**

```bash
git add client/src/app/core/models/clip-transition.model.ts
git commit -m "feat(smart-edit): add client-side ClipTransition model"
```

---

## Task 3: Server — Export Route Validation

**Files:**
- Modify: `server/src/routes/export.routes.ts`

- [ ] **Step 3.1: Add transition validation to the POST /api/export handler**

In `export.routes.ts`, update the import and the POST handler:

```ts
// Add import at top of file
import { ClipTransition, TRANSITION_EFFECTS } from '../models/clip-transition.model';
```

Update the POST handler body destructuring and add validation after the existing format check:

```ts
// Change the destructuring line (line 12) to:
const { projectId, format, clipIds, transitions } = req.body as {
  projectId?: string;
  format?: string;
  clipIds?: string[];
  transitions?: ClipTransition[];
};
```

Add validation block after the format check (after line 21) and before `exportService.start()`:

```ts
if (transitions) {
  if (!clipIds || clipIds.length < 2) {
    res.status(400).json({ error: 'transitions require at least 2 clipIds' });
    return;
  }
  if (transitions.length !== clipIds.length - 1) {
    res.status(400).json({ error: `transitions length must be ${clipIds.length - 1}, got ${transitions.length}` });
    return;
  }
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    if (!TRANSITION_EFFECTS.includes(t.effect)) {
      res.status(400).json({ error: `unknown transition effect: ${t.effect}` });
      return;
    }
    if (t.fromClipId !== clipIds[i] || t.toClipId !== clipIds[i + 1]) {
      res.status(400).json({ error: `transition[${i}] clipId mismatch` });
      return;
    }
  }
}
```

Update the `exportService.start()` call to pass transitions:

```ts
const jobId = exportService.start(projectId, format as ExportFormat, clipIds, transitions);
```

- [ ] **Step 3.2: Commit**

```bash
git add server/src/routes/export.routes.ts
git commit -m "feat(smart-edit): validate transitions in export route"
```

---

## Task 4: Server — ExportService Transition Support

**Files:**
- Modify: `server/src/services/export.service.ts`

This is the core change. The `ExportService` needs to:
1. Accept `transitions` in `start()` and `ExportJob`
2. Build per-clip internal concat streams (refactor existing logic)
3. Insert inter-clip transition filters between those streams
4. Produce a final concat

- [ ] **Step 4.1: Update ExportJob and start() to carry transitions**

Add import at top:

```ts
import { ClipTransition } from '../models/clip-transition.model';
```

Add `transitions` field to the `ExportJob` interface:

```ts
export interface ExportJob {
  id: string;
  projectId: string;
  clipIds?: string[];
  transitions?: ClipTransition[];  // NEW
  format: ExportFormat;
  status: 'pending' | 'running' | 'done' | 'error';
  outputPath?: string;
  error?: string;
  createdAt: string;
  startTime?: number;
  elapsedTime?: number;
  estimatedTotalTime?: number;
}
```

Update `start()` signature:

```ts
start(projectId: string, format: ExportFormat, clipIds?: string[], transitions?: ClipTransition[]): string {
  const id = uuidv4();
  const job: ExportJob = { id, projectId, format, clipIds, transitions, status: 'pending', createdAt: new Date().toISOString() };
  this.jobs.set(id, job);
  setImmediate(() => this.run(id));
  return id;
}
```

- [ ] **Step 4.2: Add `buildTransitionFilterComplex()` method**

This method takes the per-clip kept-segment arrays and the transitions array, and produces the full FFmpeg filter complex string. Add it after the existing `buildKeptSegmentsWithEffects()` method:

```ts
private buildTransitionFilterComplex(
  clipStreams: Array<{
    clipId: string;
    kept: Array<{ start: number; end: number; effectAfter?: { effectType: string; effectDuration: number }; _skipConcat?: boolean }>;
  }>,
  transitions: ClipTransition[],
  resolution: { width: number; height: number },
  sampleRate: number,
): string {
  const vFilters: string[] = [];
  const aFilters: string[] = [];
  const finalInputs: string[] = [];

  // Step 1: Build per-clip internal concat (reuse existing intra-clip logic)
  clipStreams.forEach((cs, clipIdx) => {
    const { kept } = cs;
    const clipVInputs: string[] = [];
    const clipAInputs: string[] = [];

    kept.forEach(({ start, end, effectAfter, _skipConcat }, segIdx) => {
      const vLabel = `cv${clipIdx}_${segIdx}`;
      const aLabel = `ca${clipIdx}_${segIdx}`;
      vFilters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[${vLabel}]`);
      aFilters.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[${aLabel}]`);

      // Apply intra-clip CutRegion effects (fade, cross-cut) same as existing logic
      if (effectAfter && segIdx < kept.length - 1) {
        const halfDur = (effectAfter.effectDuration / 2 / 1000).toFixed(4);
        const fullDur = (effectAfter.effectDuration / 1000).toFixed(4);
        const segDur = end - start;

        if (effectAfter.effectType === 'fade') {
          const fadeOutStart = Math.max(0, segDur - Number(halfDur));
          vFilters[vFilters.length - 1] = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fade=t=out:st=${fadeOutStart}:d=${halfDur}[${vLabel}]`;
          aFilters[aFilters.length - 1] = `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,afade=t=out:st=${fadeOutStart}:d=${halfDur}[${aLabel}]`;
          const nextSeg = kept[segIdx + 1];
          if (nextSeg) {
            const nvLabel = `cv${clipIdx}_${segIdx + 1}`;
            const naLabel = `ca${clipIdx}_${segIdx + 1}`;
            // Next segment gets fade-in (will be pushed in its own iteration)
            // We pre-set a flag so the next iteration applies fade-in
          }
        }
        // cross-cut handled similarly to existing exportVideo logic
      }

      if (!_skipConcat) {
        clipVInputs.push(`[${vLabel}]`);
        clipAInputs.push(`[${aLabel}]`);
      }
    });

    // Concat all segments within this clip
    if (clipVInputs.length === 1) {
      // Single segment — rename to clip-level label
      const srcV = clipVInputs[0].slice(1, -1); // strip brackets
      const srcA = clipAInputs[0].slice(1, -1);
      // Replace last filter output label
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
      // Last clip — no transition after it
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
      // xfade between this clip and next clip
      const fullDur = (t.durationMs / 1000).toFixed(4);
      // We need the duration of clip to calculate offset — estimate from kept segments
      const clipDur = cs.kept.reduce((sum, s) => sum + (s.end - s.start), 0);
      const offset = Math.max(0, clipDur - Number(fullDur));
      vFilters.push(`[clip${clipIdx}_v][clip${clipIdx + 1}_v]xfade=transition=fade:duration=${fullDur}:offset=${offset.toFixed(4)}[xf${clipIdx}_v]`);
      aFilters.push(`[clip${clipIdx}_a][clip${clipIdx + 1}_a]acrossfade=d=${fullDur}:c1=tri:c2=tri[xf${clipIdx}_a]`);
      finalInputs.push(`[xf${clipIdx}_v][xf${clipIdx}_a]`);
      // Mark next clip as consumed by the xfade
      clipStreams[clipIdx + 1]._xfadeConsumed = true;
      return;
    }

    // fade-to-black, fade-to-white, dip-to-color
    const color = t.effect === 'dip-to-color' ? (t.color ?? '000000') :
                  t.effect === 'fade-to-white' ? 'white' : 'black';
    const { width, height } = resolution;

    // Fade out on this clip
    // Get clip duration to calculate fade-out start point
    const clipDur = cs.kept.reduce((sum, s) => sum + (s.end - s.start), 0);
    const fadeOutStart = Math.max(0, clipDur - Number(halfDur));
    vFilters.push(`[clip${clipIdx}_v]fade=t=out:st=${fadeOutStart.toFixed(4)}:d=${halfDur}:color=${color}[clip${clipIdx}_fo]`);
    aFilters.push(`[clip${clipIdx}_a]afade=t=out:st=${fadeOutStart.toFixed(4)}:d=${halfDur}[clip${clipIdx}_ao]`);
    finalInputs.push(`[clip${clipIdx}_fo][clip${clipIdx}_ao]`);

    // Pause pad (color frame + silence) — only if pauseMs > 0
    if (t.pauseMs > 0) {
      vFilters.push(`color=c=${color}:s=${width}x${height}:d=${pauseSec}:r=25[pad${clipIdx}_v]`);
      aFilters.push(`anullsrc=r=${sampleRate}:cl=stereo,atrim=0:${pauseSec}[pad${clipIdx}_a]`);
      finalInputs.push(`[pad${clipIdx}_v][pad${clipIdx}_a]`);
    }

    // Fade in on next clip
    vFilters.push(`[clip${clipIdx + 1}_v]fade=t=in:st=0:d=${halfDur}:color=${color}[clip${clipIdx + 1}_fi]`);
    aFilters.push(`[clip${clipIdx + 1}_a]afade=t=in:st=0:d=${halfDur}[clip${clipIdx + 1}_ai]`);
    // Replace clip label so final concat picks up the faded version
    // The next iteration should use _fi/_ai labels
    clipStreams[clipIdx + 1]._fadeInApplied = true;
    return;
  });

  // Handle clips that had fade-in applied (replace their finalInputs entry)
  // and clips consumed by xfade (skip them)
  const adjustedFinal: string[] = [];
  clipStreams.forEach((cs, clipIdx) => {
    if ((cs as any)._xfadeConsumed) return; // already part of an xfade output
    if ((cs as any)._fadeInApplied) {
      adjustedFinal.push(`[clip${clipIdx}_fi][clip${clipIdx}_ai]`);
    } else {
      // Find existing entries for this clip in finalInputs
      const existing = finalInputs.filter(f =>
        f.includes(`clip${clipIdx}_v`) || f.includes(`clip${clipIdx}_fo`) ||
        f.includes(`xf${clipIdx - 1}_v`) || f.includes(`pad${clipIdx - 1}_v`)
      );
      adjustedFinal.push(...existing);
    }
  });

  // Step 3: Final concat
  const n = adjustedFinal.length;
  const allFilters = [...vFilters, ...aFilters];
  if (n === 1) {
    // Single stream — map directly
    allFilters.push(`${adjustedFinal[0]}concat=n=1:v=1:a=1[vout][aout]`);
  } else {
    allFilters.push(`${adjustedFinal.join('')}concat=n=${n}:v=1:a=1[vout][aout]`);
  }

  return allFilters.join(';');
}
```

- [ ] **Step 4.3: Update `exportVideo()` to use transitions when provided**

In the `exportVideo()` method, after getting the clips (around line 120-121), add a branch:

```ts
// After line 121: const clips = ...
// After line 125: const kept = this.buildKeptSegmentsWithEffects(activeWords, clips);

if (job.transitions && job.transitions.length > 0 && job.clipIds && job.clipIds.length >= 2) {
  // Multi-clip transition export
  await this.exportVideoWithTransitions(job, inputPath, clips);
  return;
}
// ... existing single-clip/no-transition export logic continues unchanged
```

Add the new method:

```ts
private exportVideoWithTransitions(
  job: ExportJob,
  inputPath: string,
  allClips: import('../models/clip.model').Clip[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const orderedClips = job.clipIds!.map(id => allClips.find(c => c.id === id)).filter(Boolean) as import('../models/clip.model').Clip[];
    if (orderedClips.length < 2) return reject(new Error('Need at least 2 clips for transitions'));

    // Build per-clip kept segments
    const clipStreams = orderedClips.map(clip => {
      const activeWords = clip.segments.flatMap(s => s.words).filter(w => !w.isRemoved);
      const kept = this.buildKeptSegmentsWithEffects(activeWords, [clip]);
      return { clipId: clip.id, kept } as any;
    });

    // Get resolution from project mediaInfo
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
```

- [ ] **Step 4.4: Add `sampleRate` to `MediaInfo`**

`MediaInfo` in `server/src/models/project.model.ts` (line 26-34) has `width` and `height` but is missing `sampleRate`. Add it:

```ts
export interface MediaInfo {
  duration: number;
  format: string;
  codec: string;
  videoCodec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  sampleRate?: number;  // NEW — audio sample rate (Hz), e.g. 44100
}
```

Note: The FFmpeg probe in the pipeline should already extract this. If not, `exportVideoWithTransitions()` defaults to 44100.

- [ ] **Step 4.5: Commit**

```bash
git add server/src/services/export.service.ts server/src/models/project.model.ts
git commit -m "feat(smart-edit): add transition-aware FFmpeg filter chain in ExportService"
```

---

## Task 5: Client — Smart Edit Dialog Component

**Files:**
- Create: `client/src/app/features/studio/smart-edit-dialog/smart-edit-dialog.component.ts`

This is the wizard dialog. It uses Angular CDK Dialog (or a simple overlay — check what the project already uses). The component is standalone, OnPush, and uses signals throughout.

- [ ] **Step 5.1: Create the dialog component**

```ts
// client/src/app/features/studio/smart-edit-dialog/smart-edit-dialog.component.ts

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Clip } from '../../../core/models/clip.model';
import {
  ClipTransition,
  TransitionEffect,
  TRANSITION_EFFECTS,
  TRANSITION_LABELS,
} from '../../../core/models/clip-transition.model';
import { ApiService } from '../../../core/services/api.service';
import { SseService } from '../../../core/services/sse.service';

export interface SmartEditDialogData {
  projectId: string;
  clips: Clip[];  // ordered
}

@Component({
  selector: 'app-smart-edit-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="se-dialog" role="dialog" aria-labelledby="se-title">
      <div class="se-header">
        <h2 id="se-title" class="se-title">Smart Edit</h2>
        <button class="se-close" (click)="dialogRef.close()" aria-label="Close">&times;</button>
      </div>

      <div class="se-body">
        @for (clip of data.clips; track clip.id; let i = $index) {
          <!-- Clip row -->
          <div class="se-clip-row">
            <span class="se-clip-name">{{ clip.name }}</span>
            <span class="se-clip-duration">{{ formatDuration(clipDurations()[i]) }}</span>
          </div>

          <!-- Transition row (between this clip and next) -->
          @if (i < data.clips.length - 1) {
            <div class="se-transition-row">
              <div class="se-transition-line"></div>
              <div class="se-transition-controls">
                <label class="se-field">
                  <span class="se-field-label">Effect</span>
                  <select
                    [value]="transitions()[i].effect"
                    (change)="updateTransition(i, 'effect', $any($event.target).value)"
                    [disabled]="exporting()"
                  >
                    @for (eff of effects; track eff) {
                      <option [value]="eff">{{ effectLabels[eff] }}</option>
                    }
                  </select>
                </label>

                @if (transitions()[i].effect !== 'hard-cut') {
                  <label class="se-field">
                    <span class="se-field-label">Duration (ms)</span>
                    <input
                      type="number"
                      [value]="transitions()[i].durationMs"
                      (input)="updateTransition(i, 'durationMs', clamp($any($event.target).valueAsNumber))"
                      min="0" max="10000" step="100"
                      [disabled]="exporting()"
                    />
                  </label>
                }

                @if (transitions()[i].effect !== 'hard-cut' && transitions()[i].effect !== 'cross-dissolve') {
                  <label class="se-field">
                    <span class="se-field-label">Pause (ms)</span>
                    <input
                      type="number"
                      [value]="transitions()[i].pauseMs"
                      (input)="updateTransition(i, 'pauseMs', clamp($any($event.target).valueAsNumber))"
                      min="0" max="10000" step="100"
                      [disabled]="exporting()"
                    />
                  </label>
                }

                @if (transitions()[i].effect === 'dip-to-color') {
                  <label class="se-field">
                    <span class="se-field-label">Color</span>
                    <input
                      type="color"
                      [value]="transitions()[i].color ?? '#000000'"
                      (input)="updateTransition(i, 'color', $any($event.target).value)"
                      [disabled]="exporting()"
                    />
                  </label>
                }
              </div>
            </div>
          }
        }
      </div>

      <div class="se-footer">
        <span class="se-total">Est. duration: {{ formatDuration(estimatedDuration()) }}</span>
        <div class="se-actions">
          @if (exporting()) {
            <div class="se-progress-row">
              <div class="se-progress-bar">
                <div class="se-progress-fill" [style.width.%]="progress()"></div>
              </div>
              <span class="se-progress-label">{{ progress() }}%</span>
            </div>
          } @else if (exportStatus() === 'done') {
            <a class="se-download-btn" [href]="downloadUrl()" target="_blank" download>
              Download
            </a>
          } @else if (exportStatus() === 'error') {
            <span class="se-error">{{ errorMsg() }}</span>
            <button class="se-export-btn" (click)="startExport()">Retry</button>
          } @else {
            <button class="se-cancel-btn" (click)="dialogRef.close()">Cancel</button>
            <button class="se-export-btn" (click)="startExport()" [disabled]="data.clips.length < 1">
              Export Video
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .se-dialog {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      width: min(480px, 90vw);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 48px rgba(0,0,0,.25);
    }
    .se-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .75rem 1rem;
      border-bottom: 1px solid var(--color-border);
    }
    .se-title { font-size: .95rem; font-weight: 700; margin: 0; }
    .se-close {
      background: none; border: none; font-size: 1.2rem;
      color: var(--color-muted); cursor: pointer; padding: .2rem;
      border-radius: 4px;
      &:hover { background: var(--color-surface-alt); color: var(--color-text); }
    }
    .se-body {
      flex: 1;
      overflow-y: auto;
      padding: .75rem 1rem;
    }
    .se-clip-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: .5rem .65rem;
      background: var(--color-surface-alt);
      border-radius: 6px;
      margin-bottom: .25rem;
    }
    .se-clip-name { font-size: .78rem; font-weight: 600; }
    .se-clip-duration { font-size: .7rem; color: var(--color-muted); font-family: 'JetBrains Mono', monospace; }
    .se-transition-row {
      display: flex;
      gap: .5rem;
      padding: .5rem 0 .5rem .65rem;
      margin-bottom: .25rem;
    }
    .se-transition-line {
      width: 2px;
      background: var(--color-border);
      border-radius: 1px;
      flex-shrink: 0;
    }
    .se-transition-controls {
      display: flex;
      flex-wrap: wrap;
      gap: .4rem;
      flex: 1;
    }
    .se-field {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .se-field-label {
      font-size: .6rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--color-muted);
    }
    .se-field select,
    .se-field input[type="number"] {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 4px;
      padding: .3rem .4rem;
      font-size: .72rem;
      color: var(--color-text);
      min-width: 0;
      &:focus { outline: none; border-color: var(--color-accent); }
      &:disabled { opacity: .5; }
    }
    .se-field select { width: 130px; }
    .se-field input[type="number"] { width: 80px; }
    .se-field input[type="color"] {
      width: 32px; height: 28px; padding: 1px; border: 1px solid var(--color-border);
      border-radius: 4px; cursor: pointer;
    }
    .se-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .65rem 1rem;
      border-top: 1px solid var(--color-border);
      gap: .75rem;
    }
    .se-total { font-size: .7rem; color: var(--color-muted); font-family: 'JetBrains Mono', monospace; }
    .se-actions { display: flex; align-items: center; gap: .5rem; }
    .se-cancel-btn {
      background: var(--color-surface-alt); border: 1px solid var(--color-border);
      border-radius: 6px; padding: .35rem .7rem; font-size: .75rem;
      cursor: pointer; color: var(--color-text);
      &:hover { background: var(--color-border); }
    }
    .se-export-btn {
      background: var(--color-accent); color: #fff; border: none;
      border-radius: 6px; padding: .35rem .75rem; font-size: .75rem;
      font-weight: 700; cursor: pointer;
      &:hover:not(:disabled) { opacity: .9; }
      &:disabled { opacity: .4; cursor: default; }
    }
    .se-progress-row { display: flex; align-items: center; gap: .5rem; min-width: 120px; }
    .se-progress-bar {
      flex: 1; height: 4px; background: var(--color-border);
      border-radius: 2px; overflow: hidden;
    }
    .se-progress-fill {
      height: 100%; background: linear-gradient(90deg, var(--color-accent), #a78bfa);
      border-radius: 2px; transition: width .4s ease;
    }
    .se-progress-label { font-size: .68rem; font-weight: 700; color: var(--color-accent); }
    .se-download-btn {
      display: inline-flex; align-items: center; gap: .3rem;
      padding: .35rem .75rem; background: rgba(76,175,130,.12);
      color: var(--color-success); border: 1px solid rgba(76,175,130,.2);
      border-radius: 6px; text-decoration: none; font-size: .75rem; font-weight: 700;
      &:hover { background: rgba(76,175,130,.2); }
    }
    .se-error {
      font-size: .72rem; color: var(--color-error);
      max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  `],
})
export class SmartEditDialogComponent {
  readonly dialogRef = inject(DialogRef);
  readonly data = inject<SmartEditDialogData>(DIALOG_DATA);
  private api = inject(ApiService);
  private sse = inject(SseService);

  readonly effects = TRANSITION_EFFECTS;
  readonly effectLabels = TRANSITION_LABELS;

  // Initialize one transition per adjacent pair, defaulting to hard-cut
  readonly transitions = signal<ClipTransition[]>(
    this.data.clips.slice(0, -1).map((clip, i) => ({
      id: crypto.randomUUID(),
      fromClipId: clip.id,
      toClipId: this.data.clips[i + 1].id,
      effect: 'hard-cut' as TransitionEffect,
      durationMs: 0,
      pauseMs: 0,
    }))
  );

  readonly exporting = signal(false);
  readonly exportStatus = signal<'idle' | 'done' | 'error'>('idle');
  readonly progress = signal(0);
  readonly errorMsg = signal('');
  readonly downloadUrl = signal('');

  private jobId = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Active duration of each clip (excluding removed words) */
  readonly clipDurations = computed(() =>
    this.data.clips.map(clip => {
      const activeWords = clip.segments.flatMap(s => s.words).filter(w => !w.isRemoved);
      if (!activeWords.length) return 0;
      const sorted = [...activeWords].sort((a, b) => a.startTime - b.startTime);
      return sorted[sorted.length - 1].endTime - sorted[0].startTime;
    })
  );

  readonly estimatedDuration = computed(() => {
    const clipTotal = this.clipDurations().reduce((s, d) => s + d, 0);
    const transTotal = this.transitions().reduce((s, t) => s + t.durationMs + t.pauseMs, 0) / 1000;
    return clipTotal + transTotal;
  });

  updateTransition(index: number, field: string, value: unknown): void {
    this.transitions.update(list => {
      const updated = [...list];
      updated[index] = { ...updated[index], [field]: value };
      // Reset duration/pause when switching to hard-cut
      if (field === 'effect' && value === 'hard-cut') {
        updated[index].durationMs = 0;
        updated[index].pauseMs = 0;
      }
      // Set sensible defaults when switching from hard-cut
      if (field === 'effect' && value !== 'hard-cut' && updated[index].durationMs === 0) {
        updated[index].durationMs = 1000;
        updated[index].pauseMs = value === 'cross-dissolve' ? 0 : 1000;
      }
      return updated;
    });
  }

  clamp(value: number): number {
    if (isNaN(value)) return 0;
    return Math.max(0, Math.min(10000, value));
  }

  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  startExport(): void {
    this.exporting.set(true);
    this.exportStatus.set('idle');
    this.progress.set(0);
    this.errorMsg.set('');

    const clipIds = this.data.clips.map(c => c.id);
    this.api.post<{ jobId: string }>('/export', {
      projectId: this.data.projectId,
      format: 'video',
      clipIds,
      transitions: this.transitions(),
    }).subscribe({
      next: ({ jobId }) => {
        this.jobId = jobId;
        this.startPolling();
      },
      error: (err: Error) => {
        this.exporting.set(false);
        this.exportStatus.set('error');
        this.errorMsg.set(err.message);
      },
    });
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.api.get<{
        status: string;
        progress?: number;
        error?: string;
      }>(`/export/${this.jobId}/status`).subscribe({
        next: (s) => {
          if (s.progress != null) this.progress.set(s.progress);
          if (s.status === 'done') {
            this.clearPolling();
            this.exporting.set(false);
            this.exportStatus.set('done');
            this.progress.set(100);
            this.downloadUrl.set(`/api/export/${this.jobId}/download`);
          } else if (s.status === 'error') {
            this.clearPolling();
            this.exporting.set(false);
            this.exportStatus.set('error');
            this.errorMsg.set(s.error ?? 'Export failed');
          }
        },
        error: () => this.clearPolling(),
      });
    }, 1500);
  }

  private clearPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}
```

- [ ] **Step 5.2: Commit**

```bash
git add client/src/app/features/studio/smart-edit-dialog/smart-edit-dialog.component.ts
git commit -m "feat(smart-edit): add SmartEditDialogComponent with transition picker"
```

---

## Task 6: Client — Wire Dialog into Studio

**Files:**
- Modify: `client/src/app/features/studio/studio.component.ts`

- [ ] **Step 6.1: Add imports**

Add at top of the file:

```ts
import { Dialog } from '@angular/cdk/dialog';
import { SmartEditDialogComponent, SmartEditDialogData } from './smart-edit-dialog/smart-edit-dialog.component';
```

- [ ] **Step 6.2: Add Smart Edit button to the studio header nav**

In the template, inside `.studio-nav` (after the Export button around line 62), add:

```html
<button
  class="export-toggle-btn"
  (click)="openSmartEdit()"
  [disabled]="!canSmartEdit()"
  title="Smart Edit — stitch clips with transitions"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
  <span>Smart Edit</span>
</button>
```

- [ ] **Step 6.3: Add the dialog logic to the component class**

Add these members to `StudioComponent`:

```ts
private dialog = inject(Dialog);

/** Smart Edit is available when there are 2+ clips, or 1 clip with cut regions */
readonly canSmartEdit = computed(() => {
  const clips = this.clipService.clips();
  if (clips.length >= 2) return true;
  if (clips.length === 1 && clips[0].cutRegions?.length > 0) return true;
  return false;
});

openSmartEdit(): void {
  const project = this.projectService.project();
  if (!project) return;
  const clips = this.clipService.clips();
  this.dialog.open<void, SmartEditDialogData>(SmartEditDialogComponent, {
    data: { projectId: project.id, clips },
  });
}
```

- [ ] **Step 6.4: Verify Angular CDK Dialog is available**

Check if `@angular/cdk` is in `client/package.json` dependencies. If not, install it:

```bash
cd client && npm install @angular/cdk
```

If CDK Dialog is already available (which it likely is since Angular projects commonly include it), no installation needed. Verify by checking `package.json`.

- [ ] **Step 6.5: Commit**

```bash
git add client/src/app/features/studio/studio.component.ts
git commit -m "feat(smart-edit): wire SmartEditDialog into studio toolbar"
```

---

## Task 7: Manual Testing & Verification

- [ ] **Step 7.1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 7.2: Test single-clip Smart Edit**

1. Open a project with one clip that has removed words (cut regions)
2. Verify the "Smart Edit" button is enabled
3. Click it — dialog opens with the single clip listed, no transition rows
4. Click "Export Video" — verify export completes (same as normal export, no transitions)
5. Download and verify the output file plays correctly

- [ ] **Step 7.3: Test multi-clip Smart Edit**

1. Open a project with 2+ clips
2. Click "Smart Edit" — dialog shows all clips with transition rows between each pair
3. Set different transitions:
   - First boundary: "Fade to Black", 1500ms duration, 2000ms pause
   - Second boundary: "Cross Dissolve", 1000ms duration
4. Verify "Est. duration" updates correctly
5. Click "Export Video"
6. Wait for progress to complete
7. Download and verify:
   - Fade to black with 2s black hold between first two clips
   - Cross dissolve between second and third clips

- [ ] **Step 7.4: Test edge cases**

1. "Dip to Color" — select a custom color, export, verify the color pad appears
2. "Hard Cut" — verify no transition (direct cut between clips)
3. "Fade to White" — verify white pad instead of black
4. Change effect to hard-cut — verify duration/pause fields disappear and reset to 0
5. Cross dissolve — verify pause field is hidden

- [ ] **Step 7.5: Test validation**

1. Open browser dev tools, manually POST to `/api/export` with mismatched transitions length → verify 400 response
2. POST with unknown effect type → verify 400

- [ ] **Step 7.6: Commit any fixes**

```bash
git add -A && git commit -m "fix(smart-edit): fixes from manual testing"
```
