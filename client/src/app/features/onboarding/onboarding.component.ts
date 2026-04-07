import { Component, computed, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MediaUploaderComponent } from './media-uploader/media-uploader.component';
import { PipelineConfiguratorComponent } from './pipeline-configurator/pipeline-configurator.component';
import { ProcessingProgressComponent } from './processing-progress/processing-progress.component';
import { SettingsPanelComponent } from './settings-panel/settings-panel.component';
import { forkJoin } from 'rxjs';
import { SseService } from '../../core/services/sse.service';
import { PluginService } from '../../core/services/plugin.service';
import { ProjectService } from '../../core/services/project.service';
import { ProjectSummary } from '../../core/models/project.model';

type Step = 'home' | 'upload' | 'pipeline' | 'processing';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    MediaUploaderComponent,
    PipelineConfiguratorComponent,
    ProcessingProgressComponent,
    SettingsPanelComponent,
  ],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent implements OnInit {
  readonly currentStep = signal<Step>('home');
  readonly processingDone = signal(false);
  readonly projects = signal<ProjectSummary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly selectionMode = signal(false);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly emptyProjects = computed(() => this.projects().filter(p => p.clipCount === 0));
  readonly showSettings = signal(false);

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
      },
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

  toggleSelectionMode(): void {
    const next = !this.selectionMode();
    this.selectionMode.set(next);
    if (!next) this.selectedIds.set(new Set());
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  toggleSelection(id: string): void {
    this.selectedIds.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  clearSelected(): void {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    const label = ids.length + ' selected project' + (ids.length !== 1 ? 's' : '');
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
    this._deleteMany(ids, () => {
      this.selectionMode.set(false);
      this.selectedIds.set(new Set());
    });
  }

  clearEmpty(): void {
    const ids = this.emptyProjects().map(p => p.id);
    if (!ids.length) return;
    const label = ids.length + ' empty project' + (ids.length !== 1 ? 's' : '');
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
    this._deleteMany(ids);
  }

  clearAll(): void {
    const all = this.projects();
    if (!all.length) return;
    const label = 'all ' + all.length + ' project' + (all.length !== 1 ? 's' : '');
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
    this._deleteMany(all.map(p => p.id));
  }

  private _deleteMany(ids: string[], onComplete?: () => void): void {
    if (!ids.length) return;
    forkJoin(ids.map(id => this.projectService.deleteProject(id))).subscribe({
      next: () => {
        this.projects.update(ps => ps.filter(p => !ids.includes(p.id)));
        if (this.projects().length === 0) this.currentStep.set('upload');
        onComplete?.();
      },
      error: () => this.loadError.set('Some projects could not be deleted.'),
    });
  }

  deleteProject(id: string): void {
    const project = this.projects().find(p => p.id === id);
    if (!project) return;
    if (!confirm('Delete "' + project.name + '"? This cannot be undone.')) return;
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

  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  formatRelativeDate(isoDate: string): string {
    const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    if (days < 14) return '1 week ago';
    if (days < 30) return Math.floor(days / 7) + ' weeks ago';
    if (days < 60) return '1 month ago';
    if (days < 365) return Math.floor(days / 30) + ' months ago';
    if (days < 730) return '1 year ago';
    return Math.floor(days / 365) + ' years ago';
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
