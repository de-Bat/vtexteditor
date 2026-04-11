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

      <!-- ── Header with always-visible action ── -->
      <div class="ep-header">
        <div class="ep-title-row">
          <span class="ep-icon">⬡</span>
          <span class="ep-title">Export</span>
          @if (status() === 'done') {
            <span class="ep-status-chip done">✓ Ready</span>
          } @else if (status() === 'pending') {
            <span class="ep-status-chip running">Processing</span>
          } @else if (status() === 'error') {
            <span class="ep-status-chip error">Error</span>
          }
        </div>
        <button
          class="btn-export"
          [disabled]="status() === 'pending'"
          (click)="startExport()"
        >
          @if (status() === 'pending') {
            <span class="btn-spinner"></span>
            <span>Running…</span>
          } @else {
            <span class="btn-play-icon">▶</span>
            <span>Start</span>
          }
        </button>
      </div>

      <!-- ── Format selector (compact grid, no scroll) ── -->
      <div class="ep-section">
        <div class="ep-section-label">Format</div>
        <div class="format-grid">
          @for (opt of formats; track opt.value) {
            <button
              class="format-card"
              [class.selected]="selectedFormat() === opt.value"
              [disabled]="status() === 'pending'"
              (click)="selectedFormat.set(opt.value)"
              [attr.aria-pressed]="selectedFormat() === opt.value"
            >
              <span class="fc-icon">{{ opt.icon }}</span>
              <span class="fc-label">{{ opt.label }}</span>
              <span class="fc-desc">{{ opt.desc }}</span>
            </button>
          }
        </div>
      </div>

      <!-- ── Processing flow ── -->
      @if (status() !== 'idle') {
        <div class="ep-section ep-flow">
          <div class="ep-section-label">Pipeline</div>
          <div class="flow-steps">
            @for (step of flowSteps; track step.id; let i = $index) {
              <div class="flow-step" [class]="getStepState(i)">
                <div class="fs-dot">
                  @if (getStepState(i) === 'done') { ✓ }
                  @else if (getStepState(i) === 'active') {
                    <span class="fs-pulse"></span>
                  } @else { {{ i + 1 }} }
                </div>
                @if (i < flowSteps.length - 1) {
                  <div class="fs-line"></div>
                }
                <div class="fs-label">{{ step.label }}</div>
              </div>
            }
          </div>
          @if (status() === 'pending') {
            <div class="ep-progress-bar">
              <div class="ep-progress-fill" [style.width.%]="progress()"></div>
            </div>
            <div class="ep-progress-label">{{ progress() }}%</div>
          }
        </div>
      }

      <!-- ── Result / error ── -->
      @if (status() === 'done') {
        <a class="btn-download" [href]="downloadUrl()" target="_blank" download>
          ↓ Download {{ formatLabel() }}
        </a>
      }
      @if (status() === 'error') {
        <p class="ep-error">{{ errorMsg() }}</p>
      }

    </div>
  `,
  styles: [`
    .export-panel {
      display: flex;
      flex-direction: column;
      gap: 0;
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      width: 230px;
      min-width: 230px;
      height: 100%;
      overflow: hidden;
    }

    /* ── Header ── */
    .ep-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .65rem .85rem .65rem .85rem;
      border-bottom: 1px solid var(--color-border);
      gap: .5rem;
      flex-shrink: 0;
    }
    .ep-title-row {
      display: flex;
      align-items: center;
      gap: .4rem;
      min-width: 0;
    }
    .ep-icon {
      color: var(--color-accent);
      font-size: .9rem;
      line-height: 1;
    }
    .ep-title {
      font-size: .85rem;
      font-weight: 700;
      letter-spacing: .02em;
      color: var(--color-text);
    }
    .ep-status-chip {
      font-size: .65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      padding: .1rem .45rem;
      border-radius: 20px;
    }
    .ep-status-chip.done    { background: rgba(76,175,130,.15); color: var(--color-success); }
    .ep-status-chip.running { background: rgba(124,106,247,.15); color: var(--color-accent); }
    .ep-status-chip.error   { background: var(--color-error-subtle); color: var(--color-error); }

    /* ── Start button — always visible in header ── */
    .btn-export {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 7px;
      padding: .3rem .7rem;
      font-size: .78rem;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity .15s, transform .1s, box-shadow .15s;
      box-shadow: 0 2px 8px rgba(124,106,247,.3);
      &:hover:not(:disabled) {
        opacity: .88;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(124,106,247,.4);
      }
      &:active:not(:disabled) { transform: translateY(0); }
      &:disabled { opacity: .45; cursor: default; box-shadow: none; }
    }
    .btn-play-icon { font-size: .7rem; }
    .btn-spinner {
      display: inline-block;
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.3);
      border-top-color: #fff;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Sections ── */
    .ep-section {
      padding: .7rem .85rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .ep-section-label {
      font-size: .65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: var(--color-muted);
      margin-bottom: .5rem;
    }

    /* ── Format grid ── */
    .format-grid {
      display: flex;
      flex-direction: column;
      gap: .3rem;
    }
    .format-card {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      gap: 0 .5rem;
      align-items: center;
      padding: .45rem .6rem;
      border: 1px solid var(--color-border);
      border-radius: 7px;
      background: var(--color-bg);
      cursor: pointer;
      text-align: left;
      transition: border-color .15s, background .15s;
      &.selected {
        border-color: var(--color-accent);
        background: var(--color-accent-subtle);
        .fc-label { color: var(--color-accent); }
      }
      &:hover:not(.selected):not(:disabled) {
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
        background: color-mix(in srgb, var(--color-accent) 5%, var(--color-bg));
      }
      &:disabled { opacity: .5; cursor: default; }
    }
    .fc-icon {
      grid-row: 1 / 3;
      font-size: 1.1rem;
      line-height: 1;
      opacity: .75;
    }
    .fc-label {
      font-size: .78rem;
      font-weight: 600;
      color: var(--color-text);
      line-height: 1.2;
    }
    .fc-desc {
      font-size: .68rem;
      color: var(--color-muted);
      line-height: 1.2;
    }

    /* ── Flow steps ── */
    .ep-flow { }
    .flow-steps {
      display: flex;
      flex-direction: column;
      gap: 0;
      margin-bottom: .6rem;
    }
    .flow-step {
      display: flex;
      align-items: flex-start;
      gap: .5rem;
      position: relative;
    }
    .fs-dot {
      width: 20px; height: 20px;
      border-radius: 50%;
      border: 2px solid var(--color-border);
      background: var(--color-bg);
      color: var(--color-muted);
      font-size: .65rem;
      font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      position: relative;
      z-index: 1;
      transition: all .3s ease;
    }
    .flow-step.done .fs-dot {
      background: rgba(76,175,130,.2);
      border-color: var(--color-success);
      color: var(--color-success);
    }
    .flow-step.active .fs-dot {
      background: rgba(124,106,247,.2);
      border-color: var(--color-accent);
    }
    .fs-pulse {
      display: block;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--color-accent);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.4); opacity: .6; }
    }
    .fs-line {
      position: absolute;
      left: 9px;
      top: 20px;
      width: 2px;
      height: 18px;
      background: var(--color-border);
    }
    .flow-step.done .fs-line { background: var(--color-success); opacity: .4; }
    .fs-label {
      font-size: .73rem;
      color: var(--color-text-secondary);
      padding-top: .18rem;
      padding-bottom: .4rem;
    }
    .flow-step.done .fs-label { color: var(--color-success); }
    .flow-step.active .fs-label { color: var(--color-accent); font-weight: 600; }

    /* ── Progress bar ── */
    .ep-progress-bar {
      height: 4px;
      background: var(--color-border);
      border-radius: 2px;
      overflow: hidden;
    }
    .ep-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--color-accent), #a78bfa);
      border-radius: 2px;
      transition: width .4s ease;
    }
    .ep-progress-label {
      font-size: .72rem;
      color: var(--color-muted);
      margin-top: .3rem;
      text-align: right;
    }

    /* ── Download / error ── */
    .btn-download {
      display: block;
      margin: .7rem .85rem;
      padding: .5rem;
      background: rgba(76,175,130,.15);
      color: var(--color-success);
      border: 1px solid rgba(76,175,130,.25);
      border-radius: 8px;
      text-align: center;
      text-decoration: none;
      font-size: .8rem;
      font-weight: 600;
      transition: background .15s;
      &:hover { background: rgba(76,175,130,.25); }
    }
    .ep-error {
      margin: .5rem .85rem;
      padding: .4rem .6rem;
      background: var(--color-error-subtle);
      color: var(--color-error);
      border-radius: 6px;
      font-size: .75rem;
      line-height: 1.4;
    }
  `]
})
export class ExportPanelComponent {
  readonly projectId = input.required<string>();

  readonly formats = [
    { value: 'video'      as ExportFormat, icon: '🎬', label: 'Video (MP4)',    desc: 'Removed words cut from media' },
    { value: 'text-plain' as ExportFormat, icon: '📄', label: 'Plain Text',     desc: 'Active words as plain text'   },
    { value: 'text-srt'   as ExportFormat, icon: '💬', label: 'SRT Subtitles',  desc: 'Active words as .srt file'    },
  ];

  readonly flowSteps = [
    { id: 'queue',   label: 'Queued'     },
    { id: 'process', label: 'Processing' },
    { id: 'encode',  label: 'Encoding'   },
    { id: 'done',    label: 'Complete'   },
  ];

  readonly selectedFormat = signal<ExportFormat>('video');
  readonly status = signal<ExportStatus>('idle');
  readonly progress = signal(0);
  readonly errorMsg = signal('');
  readonly downloadUrl = signal('');

  private jobId = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private api: ApiService, private sse: SseService) {}

  formatLabel(): string {
    return this.formats.find(f => f.value === this.selectedFormat())?.label ?? '';
  }

  getStepState(index: number): 'done' | 'active' | 'pending' {
    const p = this.progress();
    const status = this.status();
    if (status === 'done') return 'done';
    if (status !== 'pending') return 'pending';
    // Map progress % to active step
    const thresholds = [0, 30, 70, 100];
    const activeStep = thresholds.findIndex((t, i) =>
      p >= t && (i === thresholds.length - 1 || p < thresholds[i + 1])
    );
    if (index < activeStep) return 'done';
    if (index === activeStep) return 'active';
    return 'pending';
  }

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
      this.api.get<{ status: string; progress?: number; error?: string }>(`/export/${this.jobId}/status`).subscribe({
        next: (s) => {
          if (s.progress != null) this.progress.set(s.progress);
          if (s.status === 'done') {
            this.clearPolling();
            this.progress.set(100);
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

