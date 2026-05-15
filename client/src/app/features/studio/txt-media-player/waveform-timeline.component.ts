// client/src/app/features/studio/txt-media-player/waveform-timeline.component.ts
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
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
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

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
      this.durationMs();
      this.cutOverlays();
      this.currentTimeMs();
      this.silenceThreshold();
      this.loaded();
      this.draw();
    });
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.canvasRef().nativeElement.parentElement!);
    this.draw();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  onCanvasClick(event: MouseEvent): void {
    const canvas = this.canvasRef().nativeElement;
    const rect = canvas.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const ms = Math.max(0, Math.min(1, ratio)) * this.durationMs();
    this.seekTo.emit(ms);
  }

  private draw(): void {
    const canvasEl = this.canvasRef()?.nativeElement;
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
