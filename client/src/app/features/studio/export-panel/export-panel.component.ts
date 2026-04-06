import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { SseService } from '../../../core/services/sse.service';

type ExportFormat = 'video' | 'text-plain' | 'text-srt';
type ExportStatus = 'idle' | 'pending' | 'done' | 'error';

@Component({
  selector: 'app-export-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="export-panel">
      <h3>Export</h3>

      <div class="format-group">
        <label class="format-label">Format</label>
        <div class="format-options">
          @for (opt of formats; track opt.value) {
            <label class="format-opt" [class.selected]="selectedFormat() === opt.value">
              <input
                type="radio"
                name="export-format"
                [value]="opt.value"
                [checked]="selectedFormat() === opt.value"
                (change)="selectedFormat.set(opt.value)"
              />
              <span class="opt-label">{{ opt.label }}</span>
              <span class="opt-desc">{{ opt.desc }}</span>
            </label>
          }
        </div>
      </div>

      @if (status() === 'pending') {
        <div class="export-progress">
          <div class="spinner"></div>
          <span>Exporting… {{ progress() }}%</span>
        </div>
      } @else if (status() === 'done') {
        <div class="export-done">
          <span>✓ Ready to download</span>
          <a class="btn-download" [href]="downloadUrl()" target="_blank" download>Download</a>
        </div>
      } @else if (status() === 'error') {
        <p class="export-error">{{ errorMsg() }}</p>
      }

      <button
        class="btn-export"
        [disabled]="status() === 'pending'"
        (click)="startExport()"
      >
        {{ status() === 'pending' ? 'Exporting…' : 'Export' }}
      </button>
    </div>
  `,
  styles: [`
    .export-panel {
      padding: 1rem;
      border-left: 1px solid var(--color-border);
      background: var(--color-surface);
      min-width: 240px;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    h3 { margin: 0; font-size: 1rem; }
    .format-label { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--color-text-secondary); }
    .format-options { display: flex; flex-direction: column; gap: .4rem; margin-top: .5rem; }
    .format-opt {
      display: flex;
      flex-direction: column;
      padding: .5rem .7rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      cursor: pointer;
      gap: .1rem;
      &.selected { border-color: var(--color-accent); background: var(--color-accent-subtle); }
      input { display: none; }
    }
    .opt-label { font-size: .875rem; font-weight: 500; }
    .opt-desc { font-size: .75rem; color: var(--color-muted); }
    .export-progress { display: flex; align-items: center; gap: .6rem; font-size: .85rem; }
    .spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-accent);
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .export-done { display: flex; align-items: center; justify-content: space-between; }
    .export-done span { color: var(--color-success); font-size: .85rem; }
    .btn-download {
      background: var(--color-accent);
      color: #fff;
      padding: .3rem .7rem;
      border-radius: 6px;
      font-size: .8rem;
      text-decoration: none;
    }
    .export-error { color: var(--color-error); font-size: .8rem; margin: 0; }
    .btn-export {
      padding: .55rem;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: .875rem;
      font-weight: 600;
      cursor: pointer;
      &:disabled { opacity: .5; cursor: default; }
    }
  `]
})
export class ExportPanelComponent {
  readonly projectId = input.required<string>();

  readonly formats = [
    { value: 'video' as ExportFormat, label: 'Video (MP4)', desc: 'Removed words cut from media' },
    { value: 'text-plain' as ExportFormat, label: 'Plain Text', desc: 'Active words as plain text' },
    { value: 'text-srt' as ExportFormat, label: 'SRT Subtitles', desc: 'Active words as .srt file' },
  ];

  readonly selectedFormat = signal<ExportFormat>('video');
  readonly status = signal<ExportStatus>('idle');
  readonly progress = signal(0);
  readonly errorMsg = signal('');
  readonly downloadUrl = signal('');

  private jobId = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private api: ApiService, private sse: SseService) {}

  startExport(): void {
    this.status.set('pending');
    this.progress.set(0);
    this.errorMsg.set('');

    this.api.post<{ jobId: string }>('/export', {
      projectId: this.projectId(),
      format: this.selectedFormat(),
    }).subscribe({
      next: ({ jobId }) => {
        this.jobId = jobId;
        this.startPolling();
      },
      error: (err: Error) => {
        this.status.set('error');
        this.errorMsg.set(err.message);
      }
    });
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.api.get<{ status: string; error?: string }>(`/export/${this.jobId}/status`).subscribe({
        next: (s) => {
          if (s.status === 'done') {
            this.clearPolling();
            this.status.set('done');
            this.downloadUrl.set(`/api/export/${this.jobId}/download`);
          } else if (s.status === 'error') {
            this.clearPolling();
            this.status.set('error');
            this.errorMsg.set(s.error ?? 'Unknown export error');
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
