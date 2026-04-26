import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Clip } from '../../../core/models/clip.model';

@Component({
  selector: 'app-clip-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="clip-list">
      <div class="clip-list-header">
        <span>Clips</span>
        <span class="count">{{ clips().length }}</span>
      </div>

      @if (!clips().length) {
        <div class="clip-list-empty">
          <p>No clips yet. Run a transcription pipeline to generate clips.</p>
        </div>
      }

      @for (clip of clips(); track clip.id) {
        <button
          class="clip-item"
          [class.active]="clip.id === activeClipId()"
          (click)="clipSelected.emit(clip)"
        >
          <div class="clip-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
              <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/>
            </svg>
          </div>
          <div class="clip-info">
            <span class="clip-name">{{ clip.name }}</span>
            <span class="clip-meta">
              {{ clip.segments.length }} segments · {{ formatDuration(clip.endTime - clip.startTime) }}
            </span>
          </div>
        </button>
      }
    </div>
  `,
  styles: [`
    .clip-list { display: flex; flex-direction: column; }
    .clip-list-header {
      display: flex;
      align-items: center;
      padding: .75rem 1rem;
      font-size: .75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: var(--color-text-secondary);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .count {
      margin-left: auto;
      background: var(--color-border);
      border-radius: 999px;
      padding: .1rem .45rem;
      font-size: .7rem;
    }
    .clip-list-empty {
      padding: 1.5rem 1rem;
      text-align: center;
      color: var(--color-muted);
      font-size: .8rem;
    }
    .clip-item {
      display: flex;
      align-items: center;
      gap: .6rem;
      padding: .65rem 1rem;
      text-align: left;
      background: none;
      border: none;
      border-bottom: 1px solid var(--color-border);
      cursor: pointer;
      width: 100%;
      color: var(--color-text);
      transition: background .15s;
      &:hover { background: var(--color-surface-alt); }
      &.active { background: var(--color-accent-subtle); border-left: 3px solid var(--color-accent); }
    }
    .clip-icon { color: var(--color-muted); flex-shrink: 0; }
    .clip-info { display: flex; flex-direction: column; gap: .1rem; min-width: 0; }
    .clip-name { font-size: .875rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .clip-meta { font-size: .72rem; color: var(--color-muted); }
  `]
})
export class ClipListComponent {
  readonly clips = input.required<Clip[]>();
  readonly activeClipId = input<string | null>(null);
  readonly clipSelected = output<Clip>();

  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
