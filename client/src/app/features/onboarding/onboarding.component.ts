import { Component, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MediaUploaderComponent } from './media-uploader/media-uploader.component';
import { PipelineConfiguratorComponent } from './pipeline-configurator/pipeline-configurator.component';
import { ProcessingProgressComponent } from './processing-progress/processing-progress.component';
import { SseService } from '../../core/services/sse.service';
import { PluginService } from '../../core/services/plugin.service';
import { ProjectService } from '../../core/services/project.service';
import { Project, ProjectSummary } from '../../core/models/project.model';

type Step = 'home' | 'upload' | 'pipeline' | 'processing';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    MediaUploaderComponent,
    PipelineConfiguratorComponent,
    ProcessingProgressComponent,
  ],
  template: `
    <div class="onboarding-page">
      <header class="page-header">
        <div class="logo">
          <span class="logo-icon">✦</span>
          <span class="logo-text">VTextStudio</span>
        </div>
        <p class="tagline">Edit your media by editing text</p>
      </header>

      <!-- ── Home: existing projects list ── -->
      @if (currentStep() === 'home') {
        <section class="projects-section">
          <div class="projects-header">
            <h2>Your Projects</h2>
            <button class="btn-primary" (click)="currentStep.set('upload')">+ New Project</button>
          </div>

          @if (loading()) {
            <div class="projects-loading">
              <span class="spinner"></span> Loading projects…
            </div>
          } @else {
            <div class="projects-grid">
              @for (p of projects(); track p.id) {
                <div class="project-card">
                  <div class="card-top">
                    <div class="card-title-row">
                      <h3 class="card-name">{{ p.name }}</h3>
                      <span class="media-badge" [class.audio]="p.mediaType === 'audio'">
                        {{ p.mediaType === 'video' ? '▶ Video' : '♪ Audio' }}
                      </span>
                    </div>
                    <div class="card-file">{{ mediaFilename(p.mediaPath) }}</div>
                    @if (p.mediaInfo) {
                      <div class="card-meta">
                        {{ formatDuration(p.mediaInfo.duration) }}
                        @if (p.mediaInfo.bitrate) {
                          <span class="sep">·</span>
                          {{ (p.mediaInfo.bitrate / 1000).toFixed(0) }} kbps
                        }
                      </div>
                    }
                  </div>

                  <div class="card-stats">
                    <div class="stat">
                      <span class="stat-val">{{ p.clipCount }}</span>
                      <span class="stat-lbl">clip{{ p.clipCount !== 1 ? 's' : '' }}</span>
                    </div>
                    <div class="stat">
                      <span class="stat-val">{{ p.segmentCount }}</span>
                      <span class="stat-lbl">segment{{ p.segmentCount !== 1 ? 's' : '' }}</span>
                    </div>
                    <div class="stat">
                      <span class="stat-val">{{ p.wordCount.toLocaleString() }}</span>
                      <span class="stat-lbl">words</span>
                    </div>
                  </div>

                  <div class="card-transcription">
                    @if (p.hasTranscription) {
                      <span class="tx-icon ok">✓</span>
                      <span class="tx-label">{{ pluginLabel(p.transcriptionPlugin) }}</span>
                    } @else {
                      <span class="tx-icon none">–</span>
                      <span class="tx-label muted">No transcription</span>
                    }
                  </div>

                  <div class="card-footer">
                    <span class="card-date">{{ formatRelativeDate(p.updatedAt) }}</span>
                    <div class="card-actions">
                      <button class="btn-danger-sm" (click)="deleteProject(p.id)"
                              [attr.aria-label]="'Delete ' + p.name">
                        🗑
                      </button>
                      <button class="btn-primary" (click)="openProject(p.id)">Open →</button>
                    </div>
                  </div>
                </div>
              }
            </div>
          }

          @if (loadError()) {
            <p class="error-msg">{{ loadError() }}</p>
          }
        </section>
      }

      <!-- ── Wizard steps ── -->
      @if (currentStep() !== 'home') {
        <main class="wizard">
          <div class="steps-bar">
            <div class="step-item" [class.active]="currentStep() === 'upload'" [class.done]="isStepDone('upload')">
              <span class="step-dot">{{ isStepDone('upload') ? '✓' : '1' }}</span>
              <span>Upload Media</span>
            </div>
            <div class="step-divider"></div>
            <div class="step-item" [class.active]="currentStep() === 'pipeline'" [class.done]="isStepDone('pipeline')">
              <span class="step-dot">{{ isStepDone('pipeline') ? '✓' : '2' }}</span>
              <span>Configure Pipeline</span>
            </div>
            <div class="step-divider"></div>
            <div class="step-item" [class.active]="currentStep() === 'processing'">
              <span class="step-dot">3</span>
              <span>Process</span>
            </div>
          </div>

          <div class="wizard-body">
            @if (currentStep() === 'upload') {
              <section class="wizard-step">
                <div class="wizard-step-header">
                  @if (projects().length > 0) {
                    <button class="btn-back-home" (click)="currentStep.set('home')">← Projects</button>
                  }
                  <h2>Upload your media file</h2>
                </div>
                <app-media-uploader (uploaded)="onMediaUploaded($event)" />
              </section>
            }

            @if (currentStep() === 'pipeline') {
              <section class="wizard-step">
                <h2>Set up transcription pipeline</h2>
                <app-pipeline-configurator #pipelineConfig />
                <div class="wizard-actions">
                  <button class="btn-secondary" (click)="currentStep.set('upload')">← Back</button>
                  <button class="btn-primary" (click)="runPipeline()">Run Pipeline →</button>
                </div>
              </section>
            }

            @if (currentStep() === 'processing') {
              <section class="wizard-step">
                <h2>Processing…</h2>
                <app-processing-progress [event]="sseService.lastEvent()" />
                @if (processingDone()) {
                  <div class="wizard-actions">
                    <button class="btn-primary" (click)="goToStudio()">Open Studio →</button>
                  </div>
                }
              </section>
            }
          </div>
        </main>
      }
    </div>
  `,
  styles: [`
    .onboarding-page {
      min-height: 100vh;
      background: var(--color-bg);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }
    .page-header { text-align: center; margin-bottom: 2.5rem; }
    .logo { display: flex; align-items: center; gap: .5rem; justify-content: center; margin-bottom: .5rem; }
    .logo-icon { font-size: 1.5rem; color: var(--color-accent); }
    .logo-text { font-size: 1.75rem; font-weight: 700; color: var(--color-text); }
    .tagline { color: var(--color-muted); font-size: .95rem; margin: 0; }

    /* ── Projects section ── */
    .projects-section {
      width: 100%;
      max-width: 960px;
    }
    .projects-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
      h2 { margin: 0; font-size: 1.3rem; color: var(--color-text); }
    }
    .projects-loading {
      display: flex; align-items: center; gap: .5rem;
      color: var(--color-muted); padding: 2rem;
    }
    .spinner {
      display: inline-block;
      width: 16px; height: 16px;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }
    .project-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: .75rem;
      transition: border-color .15s, box-shadow .15s;
      &:hover {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 1px var(--color-accent);
      }
    }
    .card-top { display: flex; flex-direction: column; gap: .3rem; }
    .card-title-row { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
    .card-name {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .media-badge {
      font-size: .7rem;
      font-weight: 700;
      padding: .15rem .45rem;
      border-radius: 4px;
      background: color-mix(in srgb, var(--color-accent) 15%, transparent);
      color: var(--color-accent);
      white-space: nowrap;
      flex-shrink: 0;
      &.audio { background: color-mix(in srgb, #a78bfa 15%, transparent); color: #a78bfa; }
    }
    .card-file {
      font-size: .75rem;
      color: var(--color-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-meta { font-size: .75rem; color: var(--color-muted); }
    .sep { margin: 0 .3rem; }

    .card-stats {
      display: flex;
      gap: 1rem;
      padding: .6rem .75rem;
      background: var(--color-surface-alt);
      border-radius: 8px;
    }
    .stat { display: flex; flex-direction: column; align-items: center; }
    .stat-val { font-size: .95rem; font-weight: 700; color: var(--color-text); }
    .stat-lbl { font-size: .65rem; color: var(--color-muted); }

    .card-transcription {
      display: flex;
      align-items: center;
      gap: .4rem;
      font-size: .8rem;
    }
    .tx-icon {
      font-weight: 700;
      &.ok { color: var(--color-success); }
      &.none { color: var(--color-muted); }
    }
    .tx-label { color: var(--color-text); }
    .tx-label.muted { color: var(--color-muted); }

    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: auto;
      padding-top: .5rem;
      border-top: 1px solid var(--color-border);
    }
    .card-date { font-size: .75rem; color: var(--color-muted); }
    .card-actions { display: flex; gap: .5rem; align-items: center; }

    .btn-danger-sm {
      background: transparent;
      border: 1px solid var(--color-border);
      color: var(--color-muted);
      border-radius: 6px;
      padding: .3rem .5rem;
      font-size: .85rem;
      cursor: pointer;
      transition: border-color .15s, color .15s;
      &:hover { border-color: #ef4444; color: #ef4444; }
    }
    .error-msg { color: #ef4444; font-size: .85rem; margin-top: .5rem; }

    /* ── Wizard ── */
    .wizard {
      width: 100%;
      max-width: 640px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      overflow: hidden;
    }
    .steps-bar {
      display: flex;
      align-items: center;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--color-border);
      background: var(--color-surface-alt);
      gap: .5rem;
    }
    .step-item {
      display: flex; align-items: center; gap: .5rem;
      font-size: .8rem; color: var(--color-muted);
      &.active { color: var(--color-accent); font-weight: 600; }
      &.done { color: var(--color-success); }
    }
    .step-dot {
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--color-border);
      display: flex; align-items: center; justify-content: center;
      font-size: .7rem; font-weight: 700;
      .active & { background: var(--color-accent); color: #fff; }
      .done & { background: var(--color-success); color: #fff; }
    }
    .step-divider { flex: 1; height: 1px; background: var(--color-border); }

    .wizard-body { padding: 2rem 1.5rem; }
    .wizard-step h2 { margin: 0 0 1.5rem; font-size: 1.2rem; }
    .wizard-step-header {
      display: flex; align-items: center; gap: .75rem; margin-bottom: 1.5rem;
      h2 { margin: 0; font-size: 1.2rem; }
    }
    .btn-back-home {
      background: transparent;
      border: 1px solid var(--color-border);
      color: var(--color-muted);
      border-radius: 6px;
      padding: .3rem .65rem;
      font-size: .8rem;
      cursor: pointer;
      &:hover { color: var(--color-text); border-color: var(--color-text); }
    }
    .wizard-actions {
      display: flex; justify-content: flex-end; gap: .75rem;
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--color-border);
    }
    .btn-primary, .btn-secondary {
      padding: .6rem 1.25rem;
      border-radius: 8px; font-size: .875rem; font-weight: 600; cursor: pointer;
      border: none; transition: opacity .15s;
      &:hover { opacity: .85; }
    }
    .btn-primary { background: var(--color-accent); color: #fff; }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--color-border);
      color: var(--color-text);
    }
  `]
})
      &.done { color: var(--color-success); }
    }
    .step-dot {
      width: 22px; height: 22px; border-radius: 50%;
      background: var(--color-border);
      display: flex; align-items: center; justify-content: center;
      font-size: .7rem; font-weight: 700;
      .active & { background: var(--color-accent); color: #fff; }
      .done & { background: var(--color-success); color: #fff; }
    }
    .step-divider { flex: 1; height: 1px; background: var(--color-border); }

    .wizard-body { padding: 2rem 1.5rem; }
    .wizard-step h2 { margin: 0 0 1.5rem; font-size: 1.2rem; }
    .wizard-actions {
      display: flex; justify-content: flex-end; gap: .75rem;
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--color-border);
    }
    .btn-primary, .btn-secondary {
      padding: .6rem 1.25rem;
      border-radius: 8px; font-size: .875rem; font-weight: 600; cursor: pointer;
      border: none; transition: opacity .15s;
      &:hover { opacity: .85; }
    }
    .btn-primary { background: var(--color-accent); color: #fff; }
    .btn-secondary {
      background: transparent;
      border: 1px solid var(--color-border);
      color: var(--color-text);
    }
  `]
})
export class OnboardingComponent implements OnInit {
  readonly currentStep = signal<Step>('home');
  readonly processingDone = signal(false);
  readonly projects = signal<ProjectSummary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  private projectId = '';
  private mediaId = '';

  readonly pipelineConfig = viewChild<PipelineConfiguratorComponent>('pipelineConfig');

  constructor(
    readonly sseService: SseService,
    private pluginService: PluginService,
    private projectService: ProjectService,
    private router: Router,
  ) {
    sseService.connect();
  }

  ngOnInit(): void {
    this.projectService.listAll().subscribe({
      next: (list) => {
        this.projects.set(list);
        this.loading.set(false);
        if (list.length === 0) {
          this.currentStep.set('upload');
        }
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('Could not load projects. Please try again.');
        this.currentStep.set('upload');
      },
    });
  }

  isStepDone(step: Exclude<Step, 'home'>): boolean {
    const order: Exclude<Step, 'home'>[] = ['upload', 'pipeline', 'processing'];
    const current = this.currentStep();
    if (current === 'home') return false;
    return order.indexOf(current as Exclude<Step, 'home'>) > order.indexOf(step);
  }

  onMediaUploaded(result: { mediaId: string; project: { id: string } }): void {
    this.mediaId = result.mediaId;
    this.projectId = result.project.id;
    this.currentStep.set('pipeline');
  }

  runPipeline(): void {
    const steps = this.pipelineConfig()?.getSteps() ?? [];
    if (!steps.length) return;

    this.currentStep.set('processing');
    this.processingDone.set(false);

    this.pluginService.runPipeline(this.projectId, steps).subscribe({
      next: () => {
        const check = setInterval(() => {
          const ev = this.sseService.lastEvent();
          if (ev?.type === 'pipeline:complete' || ev?.type === 'pipeline:error') {
            clearInterval(check);
            this.processingDone.set(true);
          }
        }, 500);
      },
      error: () => {
        this.processingDone.set(true);
      }
    });
  }

  goToStudio(): void {
    this.router.navigate(['/studio']);
  }

  openProject(id: string): void {
    this.projectService.open(id).subscribe({
      next: () => this.router.navigate(['/studio']),
      error: () => this.loadError.set('Could not open project.'),
    });
  }

  deleteProject(id: string): void {
    const project = this.projects().find(p => p.id === id);
    if (!project) return;
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    this.projectService.deleteProject(id).subscribe({
      next: () => {
        this.projects.update(ps => ps.filter(p => p.id !== id));
        if (this.projects().length === 0) {
          this.currentStep.set('upload');
        }
      },
      error: () => this.loadError.set('Could not delete project.'),
    });
  }

  // ── Formatting helpers ──

  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  formatRelativeDate(isoDate: string): string {
    const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
    if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
    return `${Math.floor(days / 365)} year${days < 730 ? '' : 's'} ago`;
  }

  pluginLabel(pluginId: string | null): string {
    const labels: Record<string, string> = {
      'groq-whisper': 'Groq Whisper',
      'whisper-openai': 'Whisper (OpenAI)',
      'srt-import': 'SRT Import',
    };
    return pluginId ? (labels[pluginId] ?? pluginId) : 'None';
  }

  mediaFilename(mediaPath: string): string {
    return mediaPath.split(/[\\/]/).pop() ?? mediaPath;
  }
}
