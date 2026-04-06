import { CommonModule } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { Segment } from '../../../core/models/segment.model';

@Component({
  selector: 'app-segment-timeline',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="timeline" (click)="onTimelineClick($event)">
      <div class="segments">
        @for (segment of segments(); track segment.id) {
          <div
            class="segment"
            [style.width.%]="segmentWidth(segment)"
            [style.background]="segmentColor(segment)"
            [title]="segmentTooltip(segment)"
          ></div>
        }
      </div>
      <div class="playhead" [style.left.%]="playheadPercent()"></div>
    </div>
  `,
  styles: [`
    .timeline {
      position: relative;
      height: 26px;
      border-top: 1px solid var(--color-border);
      border-bottom: 1px solid var(--color-border);
      background: var(--color-surface);
      cursor: pointer;
      overflow: hidden;
    }
    .segments {
      display: flex;
      height: 100%;
      width: 100%;
    }
    .segment {
      min-width: 1px;
      opacity: 0.8;
      transition: opacity 120ms ease;
    }
    .segment:hover {
      opacity: 1;
    }
    .playhead {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      margin-left: -1px;
      background: var(--color-accent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 30%, transparent);
      pointer-events: none;
    }
  `],
})
export class SegmentTimelineComponent {
  readonly segments = input.required<Segment[]>();
  readonly duration = input.required<number>();
  readonly currentTime = input.required<number>();
  readonly seekRequested = output<number>();

  readonly playheadPercent = computed(() => {
    const duration = this.duration();
    if (duration <= 0) return 0;
    return Math.max(0, Math.min(100, (this.currentTime() / duration) * 100));
  });

  segmentWidth(segment: Segment): number {
    const duration = this.duration();
    if (duration <= 0) return 0;
    const segDuration = Math.max(0, segment.endTime - segment.startTime);
    return (segDuration / duration) * 100;
  }

  onTimelineClick(event: MouseEvent): void {
    const timelineEl = event.currentTarget as HTMLElement;
    const rect = timelineEl.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const time = Math.max(0, Math.min(1, ratio)) * Math.max(0, this.duration());
    this.seekRequested.emit(time);
  }

  segmentColor(segment: Segment): string {
    const palette = ['#5fb3b3', '#f39c12', '#4e79a7', '#e15759', '#59a14f', '#edc949'];
    const key = segment.tags[0] ?? segment.id;
    const hash = Array.from(key).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return palette[hash % palette.length];
  }

  segmentTooltip(segment: Segment): string {
    const preview = segment.text.length > 50 ? `${segment.text.slice(0, 50)}...` : segment.text;
    const labels = segment.tags.length ? segment.tags.join(', ') : 'No tags';
    const segDuration = Math.max(0, segment.endTime - segment.startTime).toFixed(2);
    return `${preview}\nDuration: ${segDuration}s\nTags: ${labels}`;
  }
}
