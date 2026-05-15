# Waveform Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 48px audio waveform row below the existing player timeline that shows amplitude, silence, and cut regions, and seeks on click.

**Architecture:** Server extracts raw PCM from the clip's time range via ffmpeg, computes normalized peaks (1 per 50ms), caches per clipId. A new `WaveformTimelineComponent` renders a canvas with waveform bars, cut-region overlays, silence zones, and a playhead. The player v2 fetches waveform data on clip load and places the component below the existing track bar.

**Tech Stack:** Angular 21 (signals, OnPush, `effect()`), Node/Express, ffmpeg (already present), Vitest 4 (node env, `.test.ts` files).

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `server/src/services/waveform.service.ts` | ffmpeg PCM extraction, peak normalization, in-memory cache |
| Create | `server/src/services/waveform.service.test.ts` | Unit tests for peak extraction logic |
| Create | `server/src/routes/waveform.routes.ts` | GET `/api/clips/:clipId/waveform` handler |
| Modify | `server/src/main.ts` | Register waveform route |
| Create | `client/src/app/core/services/waveform.service.ts` | HTTP fetch + per-clipId cache |
| Create | `client/src/app/features/studio/txt-media-player/waveform-timeline.component.ts` | Canvas rendering component |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` | Import component, fetch waveform, wire inputs/outputs |

---

## Task 1: Server WaveformService

**Files:**
- Create: `server/src/services/waveform.service.ts`
- Create: `server/src/services/waveform.service.test.ts`

- [ ] **Step 1: Create the service**

```typescript
// server/src/services/waveform.service.ts
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
    const maxVal = Math.max(...peaks, 1);
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
        if (code !== 0 && chunks.length === 0) {
          // No audio track or ffmpeg error — return empty (flat line in UI)
          resolve({ peaks: [], durationMs: Math.round(durationSec * 1000), chunkMs: CHUNK_MS });
          return;
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
```

- [ ] **Step 2: Write unit tests**

```typescript
// server/src/services/waveform.service.test.ts
import { describe, it, expect } from 'vitest';
import { waveformService } from './waveform.service';

describe('WaveformService.computePeaks', () => {
  it('returns empty array for empty samples', () => {
    const result = waveformService.computePeaks(new Int16Array(0));
    expect(result).toEqual([]);
  });

  it('normalizes peaks so maximum value is 1', () => {
    // 800 samples = 2 chunks of 400 at 8kHz/50ms
    const samples = new Int16Array(800);
    // chunk 0: all zeros (silence)
    // chunk 1: all max value 1000
    for (let i = 400; i < 800; i++) samples[i] = 1000;

    const peaks = waveformService.computePeaks(samples);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBe(0);   // silent chunk normalizes to 0
    expect(peaks[1]).toBe(1);   // loudest chunk normalizes to 1
  });

  it('produces one peak per 400 samples', () => {
    const samples = new Int16Array(2000).fill(500);
    const peaks = waveformService.computePeaks(samples);
    // 2000 / 400 = 5 chunks
    expect(peaks).toHaveLength(5);
  });

  it('handles partial final chunk', () => {
    // 600 samples = 1 full chunk (400) + 1 partial (200)
    const samples = new Int16Array(600).fill(300);
    const peaks = waveformService.computePeaks(samples);
    expect(peaks).toHaveLength(2);
    // Both chunks same amplitude → both normalize to 1
    expect(peaks[0]).toBeCloseTo(1);
    expect(peaks[1]).toBeCloseTo(1);
  });

  it('all-silence input returns all-zero peaks', () => {
    const samples = new Int16Array(800).fill(0);
    const peaks = waveformService.computePeaks(samples);
    // max is 0 → clamped to 1 → all peaks are 0/1 = 0
    expect(peaks.every(p => p === 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd server && npx vitest run src/services/waveform.service.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/waveform.service.ts server/src/services/waveform.service.test.ts
git commit -m "feat(server): add WaveformService — PCM extraction + peak normalization"
```

---

## Task 2: Server Route + Registration

**Files:**
- Create: `server/src/routes/waveform.routes.ts`
- Modify: `server/src/main.ts`

- [ ] **Step 1: Create the route**

```typescript
// server/src/routes/waveform.routes.ts
import { Router, Request, Response } from 'express';
import { waveformService } from '../services/waveform.service';

const waveformRoutes = Router();

/** GET /api/clips/:clipId/waveform */
waveformRoutes.get('/:clipId/waveform', async (req: Request, res: Response) => {
  try {
    const data = await waveformService.compute(String(req.params.clipId));
    res.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('Clip not found')) {
      res.status(404).json({ error: msg });
    } else {
      res.status(500).json({ error: 'Failed to compute waveform' });
    }
  }
});

export default waveformRoutes;
```

- [ ] **Step 2: Register in main.ts**

In `server/src/main.ts`, add after the existing `import suggestRoutes` line:

```typescript
import waveformRoutes from './routes/waveform.routes';
```

Add after `app.use('/api/clips', suggestRoutes);`:

```typescript
app.use('/api/clips', waveformRoutes);
```

- [ ] **Step 3: Smoke-test the endpoint**

Start the server (`npm run dev` from project root or `cd server && npm run dev`), then with a known clipId from the project:

```bash
curl http://localhost:3000/api/clips/<your-clipId>/waveform
```

Expected: `{"peaks":[0.12,0.45,...], "durationMs":12000, "chunkMs":50}`

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/waveform.routes.ts server/src/main.ts
git commit -m "feat(server): add GET /api/clips/:clipId/waveform endpoint"
```

---

## Task 3: Client WaveformService

**Files:**
- Create: `client/src/app/core/services/waveform.service.ts`

- [ ] **Step 1: Create the service**

```typescript
// client/src/app/core/services/waveform.service.ts
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiService } from './api.service';

export interface WaveformData {
  peaks: number[];     // normalized [0,1]
  durationMs: number;
  chunkMs: number;
}

@Injectable({ providedIn: 'root' })
export class WaveformService {
  private readonly api = inject(ApiService);
  private readonly cache = new Map<string, WaveformData>();

  fetch(clipId: string): Observable<WaveformData> {
    const cached = this.cache.get(clipId);
    if (cached) return of(cached);
    return this.api.get<WaveformData>(`/clips/${clipId}/waveform`).pipe(
      tap(data => this.cache.set(clipId, data))
    );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/core/services/waveform.service.ts
git commit -m "feat(client): add WaveformService — fetch + cache waveform data"
```

---

## Task 4: WaveformTimelineComponent

**Files:**
- Create: `client/src/app/features/studio/txt-media-player/waveform-timeline.component.ts`

- [ ] **Step 1: Create the component**

```typescript
// client/src/app/features/studio/txt-media-player/waveform-timeline.component.ts
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  input,
  output,
} from '@angular/core';

export interface CutOverlay {
  startMs: number;   // ms relative to clip start
  endMs: number;     // ms relative to clip start
}

@Component({
  selector: 'app-waveform-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="waveform-wrap" [class.loading]="peaks().length === 0 && !loaded()">
      <canvas #canvas (click)="onCanvasClick($event)" aria-label="Audio waveform — click to seek"></canvas>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .waveform-wrap {
      position: relative;
      height: 48px;
      background: var(--color-surface, #111);
      border-bottom: 1px solid var(--color-border, #333);
      overflow: hidden;
      cursor: pointer;
    }
    .waveform-wrap.loading {
      background: linear-gradient(
        90deg,
        var(--color-surface, #111) 25%,
        color-mix(in srgb, var(--color-border, #333) 40%, transparent) 50%,
        var(--color-surface, #111) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    canvas {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
  `],
})
export class WaveformTimelineComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  /** Normalized amplitude values [0,1], one per chunkMs. */
  readonly peaks = input<number[]>([]);
  /** Total clip duration in milliseconds. */
  readonly durationMs = input<number>(0);
  /** Current playhead position in milliseconds relative to clip start. */
  readonly currentTimeMs = input<number>(0);
  /** Cut region time ranges in ms relative to clip start. */
  readonly cutOverlays = input<CutOverlay[]>([]);
  /** Peaks below this value are rendered as silence. */
  readonly silenceThreshold = input<number>(0.02);
  /** True once waveform data has been fetched (suppresses shimmer). */
  readonly loaded = input<boolean>(false);

  /** Emits ms offset from clip start when user clicks. */
  readonly seekTo = output<number>();

  private resizeObserver?: ResizeObserver;

  constructor() {
    effect(() => {
      // Track all inputs so the effect re-runs when any changes.
      this.peaks();
      this.cutOverlays();
      this.currentTimeMs();
      this.silenceThreshold();
      this.loaded();
      this.draw();
    });
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.canvasRef.nativeElement.parentElement!);
    this.draw();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  onCanvasClick(event: MouseEvent): void {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const ms = Math.max(0, Math.min(1, ratio)) * this.durationMs();
    this.seekTo.emit(ms);
  }

  private draw(): void {
    const canvasEl = this.canvasRef?.nativeElement;
    if (!canvasEl) return;

    const parent = canvasEl.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const HEIGHT = 48;

    canvasEl.width = width * dpr;
    canvasEl.height = HEIGHT * dpr;

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, HEIGHT);

    const peaks = this.peaks();
    const durationMs = this.durationMs();

    if (peaks.length === 0) {
      // No audio: flat line
      ctx.fillStyle = 'rgba(99,102,241,0.2)';
      ctx.fillRect(0, HEIGHT / 2 - 1, width, 2);
      this.drawPlayhead(ctx, width, HEIGHT, durationMs);
      return;
    }

    // ── Cut region overlays (behind waveform bars) ──
    ctx.fillStyle = 'rgba(231,76,60,0.18)';
    for (const overlay of this.cutOverlays()) {
      const x1 = (overlay.startMs / durationMs) * width;
      const x2 = (overlay.endMs / durationMs) * width;
      ctx.fillRect(x1, 0, x2 - x1, HEIGHT);
    }

    // ── Waveform bars ──
    const barWidth = width / peaks.length;
    const midY = HEIGHT / 2;
    const threshold = this.silenceThreshold();

    for (let i = 0; i < peaks.length; i++) {
      const peak = peaks[i];
      const isSilence = peak < threshold;
      const barH = Math.max(2, peak * HEIGHT);
      const x = i * barWidth;
      const y = midY - barH / 2;
      ctx.fillStyle = isSilence ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.65)';
      ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barH);
    }

    // ── Cut region border lines ──
    ctx.strokeStyle = 'rgba(231,76,60,0.55)';
    ctx.lineWidth = 1;
    for (const overlay of this.cutOverlays()) {
      const x1 = Math.round((overlay.startMs / durationMs) * width) + 0.5;
      const x2 = Math.round((overlay.endMs / durationMs) * width) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x1, 0); ctx.lineTo(x1, HEIGHT);
      ctx.moveTo(x2, 0); ctx.lineTo(x2, HEIGHT);
      ctx.stroke();
    }

    this.drawPlayhead(ctx, width, HEIGHT, durationMs);
  }

  private drawPlayhead(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    durationMs: number
  ): void {
    if (durationMs <= 0) return;
    const x = (this.currentTimeMs() / durationMs) * width;
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/features/studio/txt-media-player/waveform-timeline.component.ts
git commit -m "feat(client): add WaveformTimelineComponent — canvas waveform with cut overlays"
```

---

## Task 5: Integration in Player V2

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

The component needs four changes:
1. Import `WaveformService` and `WaveformTimelineComponent`
2. Add `waveformPeaks`, `waveformDurationMs`, `waveformLoaded` signals
3. Add `cutOverlays` computed from existing `cutRegions`
4. Fetch waveform when clip changes
5. Add `<app-waveform-timeline>` to template below the track div

- [ ] **Step 1: Add imports at the top of the component file**

After the existing import block, add:

```typescript
import { WaveformService } from '../../../core/services/waveform.service';
import { WaveformTimelineComponent, CutOverlay } from '../txt-media-player/waveform-timeline.component';
```

- [ ] **Step 2: Add `WaveformTimelineComponent` to `imports` array in `@Component`**

Find the `imports: [CommonModule, SegmentMetadataPanelComponent, VisionOverlayComponent]` line and add `WaveformTimelineComponent`:

```typescript
imports: [
  CommonModule,
  SegmentMetadataPanelComponent,
  VisionOverlayComponent,
  WaveformTimelineComponent,
],
```

- [ ] **Step 3: Add waveform state signals in the class body**

Find the section where `readonly clipDuration` and `readonly relativeTime` are defined (around line 1194). Add after them:

```typescript
private readonly waveformService = inject(WaveformService);
readonly waveformPeaks = signal<number[]>([]);
readonly waveformDurationMs = signal<number>(0);
readonly waveformLoaded = signal<boolean>(false);

readonly cutOverlays = computed<CutOverlay[]>(() => {
  const clipStart = this.clip().startTime;
  return this.cutRegionService.regions()
    .filter(r => r.startTime != null && r.endTime != null)
    .map(r => ({
      startMs: (r.startTime! - clipStart) * 1000,
      endMs: (r.endTime! - clipStart) * 1000,
    }));
});
```

- [ ] **Step 4: Fetch waveform when clip changes**

In the constructor (alongside the existing `effect()` calls), add one that reacts to `clip().id`. Use the `onCleanup` callback to unsubscribe if the clip changes before the fetch completes:

```typescript
effect((onCleanup) => {
  const clipId = this.clip().id;
  this.waveformPeaks.set([]);
  this.waveformLoaded.set(false);
  const sub = this.waveformService.fetch(clipId).subscribe({
    next: data => {
      this.waveformPeaks.set(data.peaks);
      this.waveformDurationMs.set(data.durationMs);
      this.waveformLoaded.set(true);
    },
    error: () => {
      // ffmpeg failed or no audio — component shows flat line
      this.waveformLoaded.set(true);
    },
  });
  onCleanup(() => sub.unsubscribe());
});
```

- [ ] **Step 5: Add waveform component to template**

In the template, find the closing `</div>` after the playhead div (around line 982–983):

```html
        <div class="playhead" [style.left.%]="progress()">
          <div class="playhead-dot"></div>
        </div>
      </div>
    </div>
```

Add `<app-waveform-timeline>` immediately after the closing `</div>` of the `.timeline-track` div and before `</div>` of the parent wrapper:

```html
        <div class="playhead" [style.left.%]="progress()">
          <div class="playhead-dot"></div>
        </div>
      </div>
      <app-waveform-timeline
        [peaks]="waveformPeaks()"
        [durationMs]="waveformDurationMs()"
        [currentTimeMs]="relativeTime() * 1000"
        [cutOverlays]="cutOverlays()"
        [loaded]="waveformLoaded()"
        (seekTo)="seekToTime(clip().startTime + $event / 1000)"
      />
    </div>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Manual verification checklist**

Start dev server and open a project with a clip:

- [ ] Waveform row appears below the timeline track (48px)
- [ ] Shimmer animation plays while data loads
- [ ] After load: amplitude bars visible
- [ ] Silent sections render as dim bars (noticeably lower opacity)
- [ ] Cut regions show red tinted overlay aligned with track bar above
- [ ] Playhead moves with video playback
- [ ] Clicking waveform seeks player to correct position
- [ ] Resizing the window redraws waveform correctly
- [ ] No audio clip: flat dim line with moving playhead
- [ ] No console errors

- [ ] **Step 8: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat(client): integrate WaveformTimelineComponent into player v2"
```
