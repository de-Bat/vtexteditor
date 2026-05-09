import {
  AfterViewInit,
  Component,
  ChangeDetectionStrategy,
  input,
  effect,
  ElementRef,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { DetectedObject, TrackedRange } from '../../../core/models/vision.model';

const EFFECT_COLORS: Record<string, string> = {
  blur: '#6366f1',
  inpaint: '#a78bfa',
  fill: '#f59e0b',
};

@Component({
  selector: 'app-vision-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas class="vision-canvas"></canvas>`,
  styles: [`
    .vision-canvas {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
    }
  `],
})
export class VisionOverlayComponent implements AfterViewInit, OnDestroy {
  objects = input<DetectedObject[]>([]);
  videoWidth = input<number>(0);
  videoHeight = input<number>(0);
  currentTime = input<number>(0);
  trackedRange = input<TrackedRange | null>(null);

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const objs = this.objects();
      const w = this.videoWidth();
      const h = this.videoHeight();
      const t = this.currentTime();
      const range = this.trackedRange();
      if (w > 0 && h > 0) {
        this.draw(objs, t, range);
      }
    });
  }

  ngAfterViewInit(): void {
    const el = this.canvas().nativeElement;
    this.resizeObserver = new ResizeObserver(() => {
      this.draw(this.objects(), this.currentTime(), this.trackedRange());
    });
    this.resizeObserver.observe(el.parentElement ?? el);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private draw(objects: DetectedObject[], currentTime: number, range: TrackedRange | null): void {
    const canvasEl = this.canvas().nativeElement;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width;
    canvasEl.height = rect.height;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    if (range && (currentTime < range.startSec || currentTime > range.endSec)) {
      return;
    }

    for (const obj of objects) {
      const color = obj.maskEnabled
        ? (EFFECT_COLORS[obj.effect] ?? '#6366f1')
        : '#444444';

      const [nx, ny, nw, nh] = obj.bbox;
      const px = nx * canvasEl.width;
      const py = ny * canvasEl.height;
      const pw = nw * canvasEl.width;
      const ph = nh * canvasEl.height;

      ctx.strokeStyle = color;
      ctx.lineWidth = obj.maskEnabled ? 2 : 1;
      ctx.setLineDash(obj.maskEnabled ? [] : [4, 4]);
      ctx.strokeRect(px, py, pw, ph);

      ctx.fillStyle = color;
      ctx.font = '11px Inter, sans-serif';
      const label = `${obj.label} ${Math.round(obj.confidence * 100)}%`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(px, py - 16, textWidth + 8, 16);
      ctx.fillStyle = obj.maskEnabled ? '#ffffff' : '#aaaaaa';
      ctx.fillText(label, px + 4, py - 3);
    }
  }
}
