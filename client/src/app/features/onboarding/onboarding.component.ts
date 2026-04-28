import { Component, computed, OnInit, signal, viewChild, inject } from '@angular/core';
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
import { ConfirmService } from '../../core/services/confirm.service';
import { ApiService } from '../../core/services/api.service';
import { ProjectSummary, NotebookSummary } from '../../core/models/project.model';
import { PipelineStep } from '../../core/models/plugin.model';
import { Notebook } from '../../core/models/notebook.model';

type Step = 'home' | 'upload' | 'pipeline' | 'processing';

const ACTIVE_NOTEBOOK_KEY = 'vtx_active_notebook';

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
  private readonly api = inject(ApiService);

  readonly currentStep = signal<Step>('home');
  readonly processingDone = signal(false);
  readonly projects = signal<ProjectSummary[]>([]);
  readonly pipelineSteps = signal<PipelineStep[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly selectionMode = signal(false);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly emptyProjects = computed(() => this.projects().filter(p => p.clipCount === 0));
  readonly showSettings = signal(false);

  /** Which project cards have the notebooks section expanded */
  readonly expandedNotebookProjectIds = signal<Set<string>>(new Set());

  /** Active notebook id per project, stored in localStorage */
  private activeNotebookMap: Record<string, string> = {};

  private projectId = '';
  private mediaId = '';

  readonly pipelineConfig = viewChild<PipelineConfiguratorComponent>('pipelineConfig');

  constructor(
    readonly sseService: SseService,
    private pluginService: PluginService,
    private projectService: ProjectService,
    private confirmService: ConfirmService,
    private router: Router,
  ) {
    sseService.connect();
    // Load active-notebook map from localStorage
    try {
      const raw = localStorage.getItem(ACTIVE_NOTEBOOK_KEY);
      if (raw) this.activeNotebookMap = JSON.parse(raw);
    } catch { /* ignore */ }
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

    this.pipelineSteps.set(steps);
    this.sseService.reset();
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

  onPipelineBack(): void {
    this.currentStep.set('pipeline');
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

  async clearSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    const label = ids.length + ' selected project' + (ids.length !== 1 ? 's' : '');
    
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Selected',
      message: `Delete ${label}? This cannot be undone.`,
      confirmLabel: 'Delete',
      isDestructive: true
    });
    
    if (!confirmed) return;
    this._deleteMany(ids, () => {
      this.selectionMode.set(false);
      this.selectedIds.set(new Set());
    });
  }

  async clearEmpty(): Promise<void> {
    const ids = this.emptyProjects().map(p => p.id);
    if (!ids.length) return;
    const label = ids.length + ' empty project' + (ids.length !== 1 ? 's' : '');
    
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Empty Projects',
      message: `Delete ${label}? This cannot be undone.`,
      confirmLabel: 'Delete',
      isDestructive: true
    });
    
    if (!confirmed) return;
    this._deleteMany(ids);
  }

  async clearAll(): Promise<void> {
    const all = this.projects();
    if (!all.length) return;
    const label = 'all ' + all.length + ' project' + (all.length !== 1 ? 's' : '');
    
    const confirmed = await this.confirmService.confirm({
      title: 'Delete All Projects',
      message: `Delete ${label}? This action is irreversible.`,
      confirmLabel: 'Delete All',
      isDestructive: true
    });
    
    if (!confirmed) return;
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

  async deleteProject(id: string): Promise<void> {
    const project = this.projects().find(p => p.id === id);
    if (!project) return;
    
    const confirmed = await this.confirmService.confirm({
      title: 'Delete Project',
      message: `Are you sure you want to delete "${project.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      isDestructive: true
    });
    
    if (!confirmed) return;
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

  /* ──── Notebook helpers ──────────────────────────────────────────────── */

  toggleNotebooks(projectId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.expandedNotebookProjectIds.update(s => {
      const next = new Set(s);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }

  isNotebooksExpanded(projectId: string): boolean {
    return this.expandedNotebookProjectIds().has(projectId);
  }

  getActiveNotebookId(projectId: string): string | null {
    return this.activeNotebookMap[projectId] ?? null;
  }

  isActiveNotebook(projectId: string, notebookId: string): boolean {
    const stored = this.activeNotebookMap[projectId];
    if (stored) return stored === notebookId;
    // default: first notebook is considered active
    const project = this.projects().find(p => p.id === projectId);
    return project?.notebooks[0]?.id === notebookId;
  }

  setActiveNotebook(projectId: string, notebookId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.activeNotebookMap[projectId] = notebookId;
    try {
      localStorage.setItem(ACTIVE_NOTEBOOK_KEY, JSON.stringify(this.activeNotebookMap));
    } catch { /* ignore */ }
    // Trigger re-render by updating the signal
    this.expandedNotebookProjectIds.update(s => new Set(s));
  }

  createDefaultNotebook(projectId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.api.post<Notebook>(`/projects/${projectId}/notebooks`, {
      name: 'Default',
      snapshot: { wordStates: {}, cutRegions: {}, clipOrder: [] },
    }).subscribe({
      next: (nb) => {
        this.projects.update(ps => ps.map(p => {
          if (p.id !== projectId) return p;
          return { ...p, notebooks: [...(p.notebooks || []), { id: nb.id, name: nb.name, updatedAt: nb.updatedAt }] };
        }));
      },
      error: () => this.loadError.set('Could not create notebook.'),
    });
  }

  /* ──── Formatting helpers ─────────────────────────────────────────────── */

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
