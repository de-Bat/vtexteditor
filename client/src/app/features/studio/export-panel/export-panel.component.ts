import { Component, computed, input, output, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Clip } from '../../../core/models/clip.model';
import { ApiService } from '../../../core/services/api.service';
import { SseService } from '../../../core/services/sse.service';

type ExportFormat = 'video' | 'text-plain' | 'text-srt';
type ExportScope = 'current' | 'selected' | 'all';
type ExportStatus = 'idle' | 'pending' | 'done' | 'error';

@Component({
  selector: 'app-export-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="export-panel">

      <!-- ── Header ── -->
      <div class="ep-header">
        <div class="ep-title-row">
          <span class="ep-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </span>
          <span class="ep-title">Export</span>
          @if (status() === 'done') {
            <span class="ep-status-chip done">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Ready
            </span>
          } @else if (status() === 'pending') {
            <span class="ep-status-chip running">Processing</span>
          } @else if (status() === 'error') {
            <span class="ep-status-chip error">Error</span>
          }
        </div>
        <div class="ep-header-actions">
          <button
            class="btn-export"
            [disabled]="status() === 'pending'"
            (click)="startExport()"
          >
            @if (status() === 'pending') {
              <span class="btn-spinner"></span>
              <span>Running…</span>
            } @else {
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
              <span>Start</span>
            }
          </button>
          <button class="btn-close" (click)="close.emit()" aria-label="Close Export Panel">×</button>
        </div>
      </div>

      <!-- ── Range Selection (Scope) ── -->
      <div class="ep-section">
        <div class="ep-section-label">Source Range</div>
        <div class="scope-grid">
          @for (s of scopes; track s.value) {
             <button
              class="scope-btn"
              [class.active]="exportScope() === s.value"
              [disabled]="status() === 'pending'"
              (click)="exportScope.set(s.value)"
            >
              <span class="sb-icon" [innerHTML]="getTrustedIconForScope(s.value)"></span>
              <span class="sb-label">{{ s.label }}</span>
            </button>
          }
        </div>

        @if (exportScope() === 'selected') {
          <div class="clip-selector fade-in">
            @for (clip of availableClips(); track clip.id) {
              <label class="clip-checkbox-row">
                <input
                  type="checkbox"
                  [checked]="selectedClipIds().has(clip.id)"
                  (change)="toggleClipSelection(clip.id)"
                  [disabled]="status() === 'pending'"
                />
                <span class="ccr-label">{{ clip.name }}</span>
                <span class="ccr-meta">{{ (clip.endTime - clip.startTime).toFixed(0) }}s</span>
              </label>
            }
            @if (availableClips().length === 0) {
              <div class="empty-selection">No clips found</div>
            }
          </div>
        }
      </div>

      <!-- ── Format selector ── -->
      <div class="ep-section">
        <div class="ep-section-label">Output Format</div>
        <div class="format-grid">
          @for (opt of formats; track opt.value) {
            <button
              class="format-card"
              [class.selected]="selectedFormat() === opt.value"
              [disabled]="status() === 'pending'"
              (click)="selectedFormat.set(opt.value)"
              [attr.aria-pressed]="selectedFormat() === opt.value"
              [attr.data-format]="opt.value"
            >
               <span class="fc-icon" [innerHTML]="getTrustedIcon(opt.value)"></span>
              <div class="fc-content">
                <span class="fc-label">{{ opt.label }}</span>
                <span class="fc-desc">{{ opt.desc }}</span>
              </div>
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
                  @if (getStepState(i) === 'done') {
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  } @else if (getStepState(i) === 'active') {
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
            <div class="ep-progress-label">
              <span class="ep-progress-percent">{{ progress() }}%</span>
              @if (elapsedTime() > 0) {
                <span class="ep-progress-time">
                  {{ formatTime(elapsedTime()) }} 
                  @if (remainingTime() > 0) {
                    <span class="time-sep">/</span> ~{{ formatTime(remainingTime()) }} left
                  }
                </span>
              }
            </div>
          }
        </div>
      }

      <!-- ── Result / error ── -->
      @if (status() === 'done') {
        <a class="btn-download" [href]="downloadUrl()" target="_blank" download>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download {{ formatLabel() }}
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
      width: 100%;
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
      gap: .5rem;
      min-width: 0;
    }
    .ep-header-actions {
      display: flex;
      align-items: center;
      gap: .4rem;
    }
    .btn-close {
      background: none;
      border: none;
      color: var(--color-muted);
      font-size: 1.2rem;
      cursor: pointer;
      padding: .2rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      &:hover { color: var(--color-text); }
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
      padding: .15rem .45rem;
      border-radius: 20px;
      display: inline-flex;
      align-items: center;
      gap: .25rem;
    }
    .ep-status-chip.done    { background: rgba(76,175,130,.12); color: var(--color-success); border: 1px solid rgba(76,175,130,.2); }
    .ep-status-chip.running { background: rgba(124,106,247,.12); color: var(--color-accent); border: 1px solid rgba(124,106,247,.2); }
    .ep-status-chip.error   { background: var(--color-error-subtle); color: var(--color-error); border: 1px solid rgba(224,92,92,.2); }

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
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: var(--color-surface-alt);
      color: var(--color-muted);
      transition: all .24s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }
    .format-card.selected .fc-icon {
      color: #fff;
    }

    /* Format Specific Colors */
    .format-card[data-format="video"].selected .fc-icon {
      background: #3b82f6;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
    }
    .format-card[data-format="text-plain"].selected .fc-icon {
      background: #10b981;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
    }
    .format-card[data-format="text-srt"].selected .fc-icon {
      background: #f59e0b;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
    }

    .fc-content {
      display: flex;
      flex-direction: column;
      gap: 1px;
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
      font-size: .68rem;
      color: var(--color-muted);
      margin-top: .3rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 500;
    }
    .ep-progress-percent { font-weight: 700; color: var(--color-accent); }
    .ep-progress-time { opacity: 0.8; font-family: 'JetBrains Mono', monospace; }
    .time-sep { margin: 0 2px; opacity: 0.4; }

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
      transition: all .15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: .4rem;
      &:hover { background: rgba(76,175,130,.25); transform: translateY(-1px); }
    }
    /* ── Range Selector ── */
    .scope-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: .35rem;
      margin-bottom: .6rem;
    }
    .scope-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: .3rem;
      padding: .5rem .25rem;
      background: var(--color-surface-alt);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      cursor: pointer;
      color: var(--color-text-secondary);
      transition: all .15s;
      &.active {
        border-color: var(--color-accent);
        background: var(--color-accent-subtle);
        color: var(--color-accent);
      }
      &:disabled { opacity: .5; cursor: default; }
      &:hover:not(.active):not(:disabled) {
        background: color-mix(in srgb, var(--color-accent) 5%, var(--color-surface-alt));
        border-color: color-mix(in srgb, var(--color-accent) 20%, var(--color-border));
        color: var(--color-text);
      }
    }
    .sb-icon { line-height: 1; }
    .sb-label { font-size: .65rem; font-weight: 600; text-align: center; }

    .clip-selector {
      margin-top: .5rem;
      max-height: 140px;
      overflow-y: auto;
      background: var(--color-surface-alt);
      border-radius: 6px;
      padding: .2rem;
      display: flex;
      flex-direction: column;
      gap: 1px;
      border: 1px solid var(--color-border);
    }
    .clip-checkbox-row {
      display: flex;
      align-items: center;
      gap: .5rem;
      padding: .35rem .5rem;
      border-radius: 4px;
      cursor: pointer;
      &:hover { background: rgba(0,0,0,0.05); }
      input { cursor: pointer; accent-color: var(--color-accent); }
    }
    .ccr-label { font-size: .73rem; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ccr-meta { font-size: .65rem; color: var(--color-muted); }
    .empty-selection { padding: .75rem; text-align: center; font-size: .7rem; color: var(--color-muted); font-style: italic; }

    .fade-in { animation: fadeIn .2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

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
  readonly activeClipId = input<string | null>(null);
  readonly availableClips = input<Clip[]>([]);
  readonly close = output<void>();

  readonly formats = [
    { value: 'video'      as ExportFormat, label: 'Video (MP4)',    desc: 'Removed words cut from media' },
    { value: 'text-plain' as ExportFormat, label: 'Plain Text',     desc: 'Active words as plain text'   },
    { value: 'text-srt'   as ExportFormat, label: 'SRT Subtitles',  desc: 'Active words as .srt file'    },
  ];

  readonly scopes = [
    { value: 'all'      as ExportScope, label: 'Whole Project', icon: 'project' },
    { value: 'current'  as ExportScope, label: 'Current Clip', icon: 'current' },
    { value: 'selected' as ExportScope, label: 'Selected Clips', icon: 'list' },
  ];

  readonly exportScope = signal<ExportScope>('all');
  readonly selectedClipIds = signal<Set<string>>(new Set());

  readonly flowSteps = [
    { id: 'queue',   label: 'Queued'     },
    { id: 'process', label: 'Processing' },
    { id: 'encode',  label: 'Encoding'   },
    { id: 'done',    label: 'Complete'   },
  ];

  readonly selectedFormat = signal<ExportFormat>('video');
  readonly status = signal<ExportStatus>('idle');
  readonly progress = signal(0);
  readonly elapsedTime = signal(0);
  readonly estimatedTotalTime = signal(0);
  readonly errorMsg = signal('');
  readonly downloadUrl = signal('');

  private jobId = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sanitizer = inject(DomSanitizer);

  constructor(private api: ApiService, private sse: SseService) {
    // Auto-select current clip ID when scope is 'selected' and it changes
    effect(() => {
      const active = this.activeClipId();
      if (active && this.exportScope() === 'current') {
        this.selectedClipIds.set(new Set([active]));
      }
    });
  }

  toggleClipSelection(clipId: string): void {
    this.selectedClipIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(clipId)) newSet.delete(clipId);
      else newSet.add(clipId);
      return newSet;
    });
  }

  getTrustedIconForScope(scope: ExportScope): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.getIconForScope(scope));
  }

  getIconForScope(scope: ExportScope): string {
    const size = 16;
    switch (scope) {
      case 'all': // Project/Box icon
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="20" x2="22" y2="20"/><line x1="12" y1="20" x2="12" y2="17"/></svg>`;
      case 'current': // Target/Crosshair icon
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`;
      case 'selected': // List/Checklist icon
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
      default: return '';
    }
  }

  getTrustedIcon(format: ExportFormat): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.getIcon(format));
  }

  getIcon(format: ExportFormat): string {
    const size = 20;
    const strokeWidth = 2;
    switch (format) {
      case 'video':
        return `
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 10l5-5v14l-5-5"></path>
            <rect x="2" y="3" width="13" height="18" rx="2" ry="2"></rect>
            <path d="M7 10l3 2-3 2v-4z" fill="currentColor"></path>
          </svg>`;
      case 'text-plain':
        return `
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <line x1="10" y1="9" x2="8" y2="9"></line>
          </svg>`;
      case 'text-srt':
        return `
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <path d="M7 8h10"></path>
            <path d="M7 12h10"></path>
          </svg>`;
      default:
        return '';
    }
  }

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
      clipIds: this.getClipIdsForExport(),
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
      this.api.get<{ status: string; progress?: number; error?: string; elapsedTime?: number; estimatedTotalTime?: number }>(`/export/${this.jobId}/status`).subscribe({
        next: (s) => {
          if (s.progress != null) this.progress.set(s.progress);
          if (s.elapsedTime != null) this.elapsedTime.set(s.elapsedTime);
          if (s.estimatedTotalTime != null) this.estimatedTotalTime.set(s.estimatedTotalTime);
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

  readonly remainingTime = computed(() => {
    const est = this.estimatedTotalTime();
    const elapsed = this.elapsedTime();
    if (est <= 0 || elapsed <= 0) return 0;
    return Math.max(0, est - elapsed);
  });

  formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private getClipIdsForExport(): string[] | undefined {
    const scope = this.exportScope();
    if (scope === 'all') return undefined; // Server handles undefined as all
    if (scope === 'current') {
      const active = this.activeClipId();
      return active ? [active] : [];
    }
    return Array.from(this.selectedClipIds());
  }
}

