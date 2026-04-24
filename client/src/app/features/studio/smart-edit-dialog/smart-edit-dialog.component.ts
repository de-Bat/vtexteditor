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

export interface SmartEditDialogData {
  projectId: string;
  clips: Clip[];
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
          <div class="se-clip-row">
            <span class="se-clip-name">{{ clip.name }}</span>
            <span class="se-clip-duration">{{ formatDuration(clipDurations()[i]) }}</span>
          </div>

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
    }
    .se-close:hover { background: var(--color-surface-alt); color: var(--color-text); }
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
    }
    .se-field select:focus,
    .se-field input[type="number"]:focus { outline: none; border-color: var(--color-accent); }
    .se-field select:disabled,
    .se-field input[type="number"]:disabled { opacity: .5; }
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
    }
    .se-cancel-btn:hover { background: var(--color-border); }
    .se-export-btn {
      background: var(--color-accent); color: #fff; border: none;
      border-radius: 6px; padding: .35rem .75rem; font-size: .75rem;
      font-weight: 700; cursor: pointer;
    }
    .se-export-btn:hover:not(:disabled) { opacity: .9; }
    .se-export-btn:disabled { opacity: .4; cursor: default; }
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
    }
    .se-download-btn:hover { background: rgba(76,175,130,.2); }
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

  readonly effects = TRANSITION_EFFECTS;
  readonly effectLabels = TRANSITION_LABELS;

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
      if (field === 'effect' && value === 'hard-cut') {
        updated[index].durationMs = 0;
        updated[index].pauseMs = 0;
      }
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
