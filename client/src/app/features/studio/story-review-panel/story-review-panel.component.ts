import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { SlicePipe } from '@angular/common';
import { StoryEvent, StoryProposal, StorySegmentRef } from '../../../core/models/story-proposal.model';

interface MutableSegmentRef extends StorySegmentRef {
  accepted: boolean;
}

interface MutableEvent {
  id: string;
  title: string;
  segments: MutableSegmentRef[];
  collapsed: boolean;
  editingTitle: boolean;
}

@Component({
  selector: 'app-story-review-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SlicePipe],
  template: `
    <div class="panel" role="complementary" aria-label="Story review panel">
      <div class="panel-header">
        <h2 class="panel-title">Story Review</h2>
        <button class="close-btn" (click)="discard.emit()" aria-label="Close panel">×</button>
      </div>

      <div class="panel-body">
        @for (event of events(); track event.id) {
          <section class="event-section">
            <div class="event-header">
              @if (event.editingTitle) {
                <input
                  class="title-input"
                  [value]="event.title"
                  (blur)="finishEditTitle(event, $any($event.target).value)"
                  (keydown.enter)="finishEditTitle(event, $any($event.target).value)"
                  aria-label="Event title"
                />
              } @else {
                <button
                  class="event-title"
                  (click)="toggleCollapse(event)"
                  [attr.aria-expanded]="!event.collapsed"
                >
                  {{ event.collapsed ? '▶' : '▼' }} {{ event.title }}
                </button>
              }
              <button
                class="edit-btn"
                (click)="startEditTitle(event)"
                aria-label="Edit event title"
              >edit</button>
            </div>

            @if (!event.collapsed) {
              <ul class="segment-list" role="list">
                @for (seg of event.segments; track seg.segmentId) {
                  <li
                    class="segment-row"
                    [class.rejected]="!seg.accepted"
                    role="listitem"
                  >
                    <button
                      class="segment-toggle"
                      (click)="toggleSegment(seg)"
                      [attr.aria-pressed]="seg.accepted"
                      [attr.aria-label]="seg.accepted ? 'Reject segment' : 'Accept segment'"
                    >{{ seg.accepted ? '✓' : '✗' }}</button>
                    <span class="segment-text">
                      {{ (segmentTexts()[seg.segmentId] ?? seg.segmentId) | slice:0:120 }}
                    </span>
                  </li>
                }
              </ul>
            }
          </section>
        }
      </div>

      <div class="panel-footer">
        <button
          class="btn-discard"
          data-testid="btn-discard"
          (click)="discard.emit()"
        >Discard Story</button>
        <button
          class="btn-commit"
          data-testid="btn-commit"
          (click)="onCommit()"
        >Commit Story</button>
      </div>
    </div>
  `,
  styles: [`
    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      width: 340px;
      overflow: hidden;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .75rem 1rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .panel-title { margin: 0; font-size: .95rem; font-weight: 600; }
    .close-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.2rem; color: var(--color-muted);
      line-height: 1; padding: 0;
    }
    .panel-body { flex: 1; overflow-y: auto; padding: .5rem 0; }
    .event-section { border-bottom: 1px solid var(--color-border); }
    .event-header {
      display: flex; align-items: center; gap: .5rem;
      padding: .5rem 1rem;
    }
    .event-title {
      flex: 1; text-align: left; background: none; border: none;
      cursor: pointer; font-weight: 600; font-size: .88rem;
      color: var(--color-text);
    }
    .title-input {
      flex: 1; font-size: .88rem; font-weight: 600;
      border: 1px solid var(--color-accent); border-radius: 4px;
      padding: .2rem .4rem; background: var(--color-bg); color: var(--color-text);
    }
    .edit-btn {
      background: none; border: none; cursor: pointer;
      font-size: .75rem; color: var(--color-muted);
    }
    .segment-list { list-style: none; margin: 0; padding: 0 1rem .5rem; }
    .segment-row {
      display: flex; align-items: flex-start; gap: .5rem;
      padding: .25rem 0; font-size: .82rem;
    }
    .segment-row.rejected .segment-text { text-decoration: line-through; color: var(--color-muted); }
    .segment-toggle {
      flex-shrink: 0; background: none; border: 1px solid var(--color-border);
      border-radius: 3px; cursor: pointer; font-size: .8rem; width: 1.4rem; height: 1.4rem;
      display: flex; align-items: center; justify-content: center;
    }
    .segment-text { line-height: 1.4; }
    .panel-footer {
      display: flex; justify-content: space-between; gap: .5rem;
      padding: .75rem 1rem; border-top: 1px solid var(--color-border); flex-shrink: 0;
    }
    .btn-discard {
      background: none; border: 1px solid var(--color-border); border-radius: 6px;
      padding: .4rem .8rem; cursor: pointer; font-size: .85rem; color: var(--color-muted);
    }
    .btn-commit {
      background: var(--color-accent); color: #fff; border: none; border-radius: 6px;
      padding: .4rem .8rem; cursor: pointer; font-size: .85rem; font-weight: 600;
    }
  `],
})
export class StoryReviewPanelComponent {
  readonly proposal = input.required<StoryProposal>();
  readonly segmentTexts = input<Record<string, string>>({});

  readonly commit = output<StoryEvent[]>();
  readonly discard = output<void>();

  readonly events = signal<MutableEvent[]>([]);

  constructor() {
    effect(() => {
      this.events.set(
        this.proposal().events.map(e => ({
          id: e.id,
          title: e.title,
          segments: e.segments.map(s => ({ ...s })),
          collapsed: false,
          editingTitle: false,
        }))
      );
    });
  }

  toggleCollapse(event: MutableEvent): void {
    event.collapsed = !event.collapsed;
    this.events.update(evts => [...evts]);
  }

  startEditTitle(event: MutableEvent): void {
    event.editingTitle = true;
    this.events.update(evts => [...evts]);
  }

  finishEditTitle(event: MutableEvent, newTitle: string): void {
    event.title = newTitle.trim() || event.title;
    event.editingTitle = false;
    this.events.update(evts => [...evts]);
  }

  toggleSegment(seg: MutableSegmentRef): void {
    seg.accepted = !seg.accepted;
    this.events.update(evts => [...evts]);
  }

  onCommit(): void {
    const result: StoryEvent[] = this.events().map(e => ({
      id: e.id,
      title: e.title,
      segments: e.segments,
    }));
    this.commit.emit(result);
  }
}
