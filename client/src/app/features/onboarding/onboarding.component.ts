import { Component, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MediaUploaderComponent } from './media-uploader/media-uploader.component';
import { PipelineConfiguratorComponent } from './pipeline-configurator/pipeline-configurator.component';
import { ProcessingProgressComponent } from './processing-progress/processing-progress.component';
import { SseService } from '../../core/services/sse.service';
import { PluginService } from '../../core/services/plugin.service';
import { Project } from '../../core/models/project.model';

type Step = 'upload' | 'pipeline' | 'processing';

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

      <main class="wizard">
        <!-- Step indicators -->
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
              <h2>Upload your media file</h2>
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
export class OnboardingComponent {
  readonly currentStep = signal<Step>('upload');
  readonly processingDone = signal(false);

  private projectId = '';
  private mediaId = '';

  readonly pipelineConfig = viewChild<PipelineConfiguratorComponent>('pipelineConfig');

  constructor(
    readonly sseService: SseService,
    private pluginService: PluginService,
    private router: Router,
  ) {
    sseService.connect();
  }

  isStepDone(step: Step): boolean {
    const order: Step[] = ['upload', 'pipeline', 'processing'];
    return order.indexOf(this.currentStep()) > order.indexOf(step);
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
        // Wait for SSE pipeline:complete
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
}
