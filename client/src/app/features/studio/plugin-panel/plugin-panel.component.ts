import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { PluginService } from '../../../core/services/plugin.service';
import { SseService } from '../../../core/services/sse.service';
import { ClipService } from '../../../core/services/clip.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ApiService } from '../../../core/services/api.service';
import { PluginMeta, PipelineStep, PipelineOutput, PluginStepOutput } from '../../../core/models/plugin.model';
import { PluginOptionsComponent } from '../../onboarding/plugin-options/plugin-options.component';

type RunStatus = 'idle' | 'running' | 'done' | 'error';
type OutputTab = 'clips' | 'segments' | 'metadata';

@Component({
  selector: 'app-plugin-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DragDropModule, PluginOptionsComponent],
  template: `
    <div class="plugin-panel" [class.has-output]="selectedOutput() !== null">

      <!-- ── Pipeline Column ── -->
      <div class="pipeline-col">

        <!-- Inventory chips -->
        <div class="pp-section inventory-section">
          <div class="pp-label">Add Plugin</div>
          <div class="inventory-chips">
            @for (p of availablePlugins(); track p.id) {
              <button class="inv-chip" (click)="addStep(p)">
                <span class="chip-plus">+</span> {{ p.name }}
              </button>
            }
            @if (availablePlugins().length === 0) {
              <span class="pp-empty">Loading plugins…</span>
            }
          </div>
        </div>

        <!-- Pipeline steps -->
        <div class="pp-section pp-pipeline-section">
          <div class="pp-label">Pipeline</div>
          <div
            cdkDropList
            [cdkDropListData]="steps()"
            (cdkDropListDropped)="onDrop($event)"
            class="pipeline-list"
          >
            @for (step of steps(); track $index; let i = $index) {
              <div
                cdkDrag
                class="pp-node"
                [class.node-selected]="selectedStepIndex() === i"
                [class.node-done]="getStepStatus(i) === 'done'"
                [class.node-running]="getStepStatus(i) === 'running'"
                [class.node-error]="getStepStatus(i) === 'error'"
                (click)="selectStep(i)"
              >
                <!-- Drag handle -->
                <span cdkDragHandle class="drag-handle" (click)="$event.stopPropagation()" aria-label="Drag to reorder">⠿</span>

                <!-- Step number -->
                <span class="step-num">{{ i + 1 }}</span>

                <!-- Name + status -->
                <div class="step-info">
                  <span class="step-name">{{ getPlugin(step.pluginId)?.name ?? step.pluginId }}</span>
                  <span class="step-status" [attr.data-status]="getStepStatus(i)">{{ getStepStatus(i) }}</span>
                </div>

                <!-- Config toggle -->
                <button
                  class="btn-cfg"
                  [class.cfg-open]="expandedConfigStep() === i"
                  (click)="toggleConfig(i); $event.stopPropagation()"
                  title="Configure"
                  aria-label="Toggle plugin configuration"
                >⚙</button>

                <!-- Remove -->
                <button
                  class="btn-remove-step"
                  (click)="removeStep(i); $event.stopPropagation()"
                  title="Remove step"
                  aria-label="Remove plugin step"
                >×</button>

                <!-- Inline config (expand/collapse) -->
                @if (expandedConfigStep() === i) {
                  @if (getPlugin(step.pluginId); as plugin) {
                    <div class="step-config-expand" (click)="$event.stopPropagation()">
                      <app-plugin-options
                        [plugin]="plugin"
                        [stepIndex]="i"
                        (configChanged)="onConfigChanged($event)"
                      />
                    </div>
                  }
                }
              </div>

              @if (i < steps().length - 1) {
                <div class="step-connector" aria-hidden="true">↓</div>
              }
            }

            @if (steps().length === 0) {
              <div class="pipeline-empty">
                <span>Add plugins above to build your pipeline</span>
              </div>
            }
          </div>
        </div>

        <!-- Run area -->
        <div class="pp-run-area">
          @if (runStatus() === 'running') {
            <div class="pp-progress-bar" role="progressbar" [attr.aria-valuenow]="progress()">
              <div class="pp-progress-fill" [style.width.%]="progress()"></div>
            </div>
          }
          @if (errorMsg()) {
            <p class="pp-error">{{ errorMsg() }}</p>
          }
          <button
            class="btn-run"
            [disabled]="runStatus() === 'running' || steps().length === 0"
            (click)="runPipeline()"
          >
            @if (runStatus() === 'running') {
              <span class="btn-spinner"></span>
              Running…
            } @else {
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
              Run Pipeline
            }
          </button>
        </div>

      </div><!-- /.pipeline-col -->

      <!-- ── Output Column (visible when step selected and output available) ── -->
      @if (selectedOutput(); as stepOutput) {
        <div class="output-col">

          <!-- Output header -->
          <div class="out-header">
            <div class="out-header-info">
              <div class="out-plugin-name">
                {{ getPlugin(steps()[selectedStepIndex()!]?.pluginId)?.name ?? 'Plugin' }} — Output
              </div>
              <div class="out-meta">
                {{ stepOutput.wordCount }} words · {{ stepOutput.clips.length }} clips
              </div>
            </div>
            <button class="btn-close-out" (click)="closeOutput()" aria-label="Close output panel">×</button>
          </div>

          <!-- Output tabs -->
          <div class="out-tabs" role="tablist">
            <button
              role="tab"
              class="out-tab"
              [class.active]="activeOutputTab() === 'clips'"
              [attr.aria-selected]="activeOutputTab() === 'clips'"
              (click)="activeOutputTab.set('clips')"
            >Clips</button>
            <button
              role="tab"
              class="out-tab"
              [class.active]="activeOutputTab() === 'segments'"
              [attr.aria-selected]="activeOutputTab() === 'segments'"
              (click)="activeOutputTab.set('segments')"
            >Segments</button>
            <button
              role="tab"
              class="out-tab"
              [class.active]="activeOutputTab() === 'metadata'"
              [attr.aria-selected]="activeOutputTab() === 'metadata'"
              (click)="activeOutputTab.set('metadata')"
            >Metadata</button>
          </div>

          <!-- Output body -->
          <div class="out-body">

            @if (activeOutputTab() === 'clips') {
              @for (clip of stepOutput.clips; track clip.id) {
                <div class="out-clip-row">
                  <div class="out-clip-name">{{ clip.name }}</div>
                  <div class="out-clip-preview">
                    {{ clip.segments[0]?.text?.slice(0, 120) }}{{ (clip.segments[0]?.text?.length ?? 0) > 120 ? '…' : '' }}
                  </div>
                  <div class="out-clip-meta">{{ clip.segments.length }} segments</div>
                </div>
              }
              @if (stepOutput.clips.length === 0) {
                <p class="out-empty">No clips in this output</p>
              }
            }

            @if (activeOutputTab() === 'segments') {
              @for (clip of stepOutput.clips; track clip.id) {
                @for (seg of clip.segments; track seg.id) {
                  <div class="out-segment-row">
                    <div class="out-seg-time">{{ formatTime(seg.startTime) }} – {{ formatTime(seg.endTime) }}</div>
                    <div class="out-seg-text">{{ seg.text }}</div>
                  </div>
                }
              }
              @if (stepOutput.clips.flatMap(c => c.segments).length === 0) {
                <p class="out-empty">No segments in this output</p>
              }
            }

            @if (activeOutputTab() === 'metadata') {
              @for (entry of metadataEntries(); track entry.key) {
                <div class="out-meta-row">
                  <span class="meta-key">{{ entry.key }}</span>
                  <span class="meta-val">{{ entry.value }}</span>
                </div>
              }
              @if (metadataEntries().length === 0) {
                <p class="out-empty">No metadata for this step</p>
              }
            }

          </div><!-- /.out-body -->

          <!-- Output footer actions -->
          <div class="out-footer">
            <button class="btn-notebook" (click)="saveToNotebook()">
              💾 Save to Notebook
            </button>
            <button class="btn-activate" [disabled]="isActivating()" (click)="useAsWorkingData()">
              @if (isActivating()) {
                <span class="btn-spinner"></span> Applying…
              } @else {
                ⚡ Use as Working Data
              }
            </button>
          </div>

        </div><!-- /.output-col -->
      }

    </div><!-- /.plugin-panel -->
  `,
  styles: [`
    .plugin-panel {
      display: flex;
      height: 100%;
      background: var(--color-surface);
      overflow: hidden;
    }

    /* ── Pipeline column ── */
    .pipeline-col {
      width: 240px;
      min-width: 240px;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--color-border);
      overflow: hidden;
    }

    .has-output .pipeline-col {
      border-right: 1px solid var(--color-border);
    }

    .pp-section {
      padding: .6rem .75rem;
      border-bottom: 1px solid var(--color-border);
    }

    .pp-label {
      font-size: .58rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: var(--color-muted);
      margin-bottom: .5rem;
    }

    /* Inventory */
    .inventory-chips {
      display: flex;
      flex-wrap: wrap;
      gap: .3rem;
    }
    .inv-chip {
      display: inline-flex;
      align-items: center;
      gap: .25rem;
      padding: .22rem .55rem;
      border: 1px solid var(--color-border);
      border-radius: 5px;
      background: var(--color-surface-alt);
      color: var(--color-text-secondary);
      font-size: .68rem;
      font-weight: 500;
      cursor: pointer;
      transition: all .15s;
      &:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
        background: var(--color-accent-subtle);
      }
    }
    .chip-plus { opacity: .6; font-size: .9rem; line-height: 1; }
    .pp-empty { font-size: .65rem; color: var(--color-muted); font-style: italic; }

    /* Pipeline list */
    .pp-pipeline-section {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .pipeline-list {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .pipeline-empty {
      padding: 1.5rem .75rem;
      text-align: center;
      font-size: .68rem;
      color: var(--color-muted);
      font-style: italic;
    }

    /* Nodes */
    .pp-node {
      position: relative;
      display: flex;
      align-items: center;
      gap: .35rem;
      padding: .4rem .5rem;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      margin: .2rem 0;
      cursor: pointer;
      transition: border-color .15s, box-shadow .15s;
      flex-wrap: wrap;
      &:hover { border-color: rgba(255,255,255,.15); }
      &.node-selected {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 1px var(--color-accent);
        background: var(--color-accent-subtle);
      }
      &.node-done .step-num { background: var(--color-success); }
      &.node-running .step-num { background: var(--color-accent); animation: pulse-border 1.2s ease-in-out infinite; }
      &.node-error .step-num { background: var(--color-error); }
    }
    .drag-handle {
      font-size: .8rem;
      color: var(--color-muted);
      cursor: grab;
      flex-shrink: 0;
      &:active { cursor: grabbing; }
    }
    .step-num {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--color-surface-alt);
      border: 1px solid var(--color-border);
      font-size: .55rem;
      font-weight: 700;
      color: var(--color-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background .2s;
    }
    .step-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .step-name {
      font-size: .68rem;
      font-weight: 600;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .step-status {
      font-size: .55rem;
      color: var(--color-muted);
      text-transform: capitalize;
      &[data-status="done"] { color: var(--color-success); }
      &[data-status="running"] { color: var(--color-accent); }
      &[data-status="error"] { color: var(--color-error); }
    }
    .btn-cfg {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: .75rem;
      padding: .1rem .2rem;
      border-radius: 3px;
      flex-shrink: 0;
      &:hover { background: var(--color-surface-alt); color: var(--color-text); }
      &.cfg-open { color: var(--color-accent); }
    }
    .btn-remove-step {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: .85rem;
      padding: .1rem .2rem;
      border-radius: 3px;
      flex-shrink: 0;
      line-height: 1;
      &:hover { background: var(--color-error-subtle); color: var(--color-error); }
    }
    .step-config-expand {
      width: 100%;
      flex-basis: 100%;
      margin-top: .25rem;
      border-top: 1px solid var(--color-border);
      padding-top: .25rem;
    }
    .step-connector {
      text-align: center;
      font-size: .6rem;
      color: var(--color-border);
      line-height: 1;
      margin: 0;
      pointer-events: none;
      user-select: none;
    }

    /* CDK drag placeholder */
    .cdk-drag-placeholder { opacity: .3; }
    .cdk-drag-animating { transition: transform 200ms cubic-bezier(0, 0, 0.2, 1); }
    .pipeline-list.cdk-drop-list-dragging .pp-node:not(.cdk-drag-placeholder) {
      transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
    }

    /* Run area */
    .pp-run-area {
      padding: .6rem .75rem;
      border-top: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: .4rem;
      flex-shrink: 0;
    }
    .pp-progress-bar {
      height: 3px;
      background: var(--color-border);
      border-radius: 2px;
      overflow: hidden;
    }
    .pp-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--color-accent), #a78bfa);
      border-radius: 2px;
      transition: width .4s ease;
    }
    .pp-error {
      font-size: .65rem;
      color: var(--color-error);
      background: var(--color-error-subtle);
      border-radius: 4px;
      padding: .3rem .5rem;
      margin: 0;
    }
    .btn-run {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: .35rem;
      width: 100%;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: .4rem .75rem;
      font-size: .75rem;
      font-weight: 700;
      cursor: pointer;
      transition: all .15s;
      &:hover:not(:disabled) { opacity: .9; }
      &:disabled { opacity: .4; cursor: default; }
    }

    /* ── Output column ── */
    .output-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .out-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .6rem .75rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .out-plugin-name {
      font-size: .72rem;
      font-weight: 700;
      color: var(--color-accent);
    }
    .out-meta {
      font-size: .58rem;
      color: var(--color-muted);
      margin-top: 1px;
    }
    .btn-close-out {
      background: none;
      border: none;
      color: var(--color-muted);
      font-size: 1.1rem;
      cursor: pointer;
      padding: .1rem .3rem;
      border-radius: 3px;
      line-height: 1;
      &:hover { background: var(--color-surface-alt); color: var(--color-text); }
    }

    .out-tabs {
      display: flex;
      background: var(--color-surface-alt);
      padding: 2px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .out-tab {
      flex: 1;
      border: none;
      background: none;
      padding: .4rem;
      font-size: .65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: var(--color-muted);
      cursor: pointer;
      border-radius: 3px;
      transition: all .15s;
      &.active {
        background: var(--color-surface);
        color: var(--color-accent);
        box-shadow: 0 1px 3px rgba(0,0,0,.15);
      }
      &:hover:not(.active) { color: var(--color-text); }
    }

    .out-body {
      flex: 1;
      overflow-y: auto;
      padding: .5rem .75rem;
      display: flex;
      flex-direction: column;
      gap: .4rem;
    }
    .out-empty {
      font-size: .68rem;
      color: var(--color-muted);
      font-style: italic;
      text-align: center;
      padding: 1rem;
    }

    .out-clip-row {
      padding: .5rem .6rem;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: .2rem;
    }
    .out-clip-name { font-size: .7rem; font-weight: 600; color: var(--color-accent); }
    .out-clip-preview { font-size: .65rem; color: var(--color-text-secondary); line-height: 1.4; }
    .out-clip-meta { font-size: .58rem; color: var(--color-muted); }

    .out-segment-row {
      padding: .4rem .6rem;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-left: 2px solid var(--color-accent);
      border-radius: 0 5px 5px 0;
      display: flex;
      flex-direction: column;
      gap: .15rem;
    }
    .out-seg-time { font-size: .55rem; color: var(--color-muted); font-family: 'JetBrains Mono', monospace; }
    .out-seg-text { font-size: .65rem; color: var(--color-text-secondary); line-height: 1.4; }

    .out-meta-row {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: .5rem;
      padding: .35rem .6rem;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 5px;
      font-size: .65rem;
    }
    .meta-key { color: var(--color-muted); font-weight: 600; word-break: break-all; }
    .meta-val { color: var(--color-text-secondary); word-break: break-all; font-family: 'JetBrains Mono', monospace; font-size: .6rem; }

    .out-footer {
      display: flex;
      gap: .5rem;
      padding: .6rem .75rem;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .btn-notebook {
      flex: 1;
      border: 1px solid var(--color-border);
      background: var(--color-surface-alt);
      color: var(--color-text-secondary);
      border-radius: 6px;
      padding: .4rem .5rem;
      font-size: .68rem;
      font-weight: 600;
      cursor: pointer;
      transition: all .15s;
      &:hover { border-color: var(--color-accent); color: var(--color-accent); }
    }
    .btn-activate {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: .3rem;
      border: 1px solid rgba(76,175,130,.3);
      background: rgba(76,175,130,.12);
      color: var(--color-success);
      border-radius: 6px;
      padding: .4rem .5rem;
      font-size: .68rem;
      font-weight: 700;
      cursor: pointer;
      transition: all .15s;
      &:hover:not(:disabled) { background: rgba(76,175,130,.22); }
      &:disabled { opacity: .5; cursor: default; }
    }

    /* Shared spinner */
    .btn-spinner {
      display: inline-block;
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.3);
      border-top-color: currentColor;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse-border { 0%, 100% { box-shadow: 0 0 0 0 rgba(124,106,247,.4); } 50% { box-shadow: 0 0 0 3px rgba(124,106,247,0); } }
  `]
})
export class PluginPanelComponent implements OnInit {
  readonly projectId = input.required<string>();
  readonly close = output<void>();
  readonly outputPanelOpen = output<boolean>();

  private readonly pluginService = inject(PluginService);
  private readonly sseService = inject(SseService);
  private readonly clipService = inject(ClipService);
  private readonly notifications = inject(NotificationService);
  private readonly api = inject(ApiService);

  readonly availablePlugins = signal<PluginMeta[]>([]);
  readonly steps = signal<PipelineStep[]>([]);
  readonly stepStatuses = signal<Record<number, RunStatus>>({});
  readonly runStatus = signal<RunStatus>('idle');
  readonly progress = signal(0);
  readonly currentJobId = signal<string | null>(null);
  readonly pipelineOutput = signal<PipelineOutput | null>(null);
  readonly selectedStepIndex = signal<number | null>(null);
  readonly activeOutputTab = signal<OutputTab>('clips');
  readonly expandedConfigStep = signal<number | null>(null);
  readonly errorMsg = signal('');
  readonly isActivating = signal(false);

  private readonly pluginMap = new Map<string, PluginMeta>();

  readonly selectedOutput = computed<PluginStepOutput | null>(() => {
    const idx = this.selectedStepIndex();
    const out = this.pipelineOutput();
    if (idx === null || !out) return null;
    return out.steps.find(s => s.stepIndex === idx) ?? null;
  });

  readonly metadataEntries = computed<{ key: string; value: string }[]>(() => {
    const out = this.selectedOutput();
    if (!out) return [];
    return Object.entries(out.metadata).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  });

  constructor() {
    effect(() => {
      const event = this.sseService.lastEvent();
      if (!event) return;
      const { type, data } = event;
      if (data['jobId'] !== this.currentJobId()) return;

      if (type === 'pipeline:progress') {
        const stepIndex = data['stepIndex'] as number | undefined;
        const prog = data['progress'] as number | undefined;
        if (prog != null) this.progress.set(prog);
        if (stepIndex != null) {
          this.stepStatuses.update(s => ({ ...s, [stepIndex]: 'running' }));
        }
      } else if (type === 'pipeline:complete') {
        this.runStatus.set('done');
        this.progress.set(100);
        const allDone: Record<number, RunStatus> = {};
        this.steps().forEach((_, i) => { allDone[i] = 'done'; });
        this.stepStatuses.set(allDone);
        const jobId = this.currentJobId();
        if (jobId) {
          this.pluginService.getOutputs(jobId).subscribe({
            next: output => this.pipelineOutput.set(output),
          });
        }
      } else if (type === 'pipeline:error') {
        this.runStatus.set('error');
        this.errorMsg.set((data['error'] as string | undefined) ?? 'Pipeline failed');
        const stepIndex = data['stepIndex'] as number | undefined;
        if (stepIndex != null) {
          this.stepStatuses.update(s => ({ ...s, [stepIndex]: 'error' }));
        }
      }
    });
  }

  ngOnInit(): void {
    this.pluginService.loadAll().subscribe(plugins => {
      this.availablePlugins.set(plugins);
      plugins.forEach(p => this.pluginMap.set(p.id, p));
    });
  }

  getPlugin(id: string): PluginMeta | undefined {
    return this.pluginMap.get(id);
  }

  getStepStatus(index: number): RunStatus {
    return this.stepStatuses()[index] ?? 'idle';
  }

  addStep(plugin: PluginMeta): void {
    this.steps.update(s => [...s, { pluginId: plugin.id, config: {}, order: s.length }]);
  }

  removeStep(index: number): void {
    this.steps.update(s =>
      s.filter((_, i) => i !== index).map((step, i) => ({ ...step, order: i }))
    );
    if (this.selectedStepIndex() === index) {
      this.selectedStepIndex.set(null);
      this.outputPanelOpen.emit(false);
    }
    if (this.expandedConfigStep() === index) {
      this.expandedConfigStep.set(null);
    }
  }

  onDrop(event: CdkDragDrop<PipelineStep[]>): void {
    this.steps.update(s => {
      const copy = [...s];
      moveItemInArray(copy, event.previousIndex, event.currentIndex);
      return copy.map((step, i) => ({ ...step, order: i }));
    });
    this.stepStatuses.set({});
    this.selectedStepIndex.set(null);
    this.expandedConfigStep.set(null);
    this.outputPanelOpen.emit(false);
  }

  selectStep(index: number): void {
    if (this.selectedOutput() === null && this.pipelineOutput() === null) return;
    const current = this.selectedStepIndex();
    if (current === index) {
      this.selectedStepIndex.set(null);
      this.outputPanelOpen.emit(false);
    } else {
      this.selectedStepIndex.set(index);
      this.outputPanelOpen.emit(true);
    }
  }

  toggleConfig(index: number): void {
    this.expandedConfigStep.update(i => i === index ? null : index);
  }

  onConfigChanged(event: { index: number; config: Record<string, unknown> }): void {
    this.steps.update(s => {
      const copy = [...s];
      copy[event.index] = { ...copy[event.index], config: event.config };
      return copy;
    });
  }

  closeOutput(): void {
    this.selectedStepIndex.set(null);
    this.outputPanelOpen.emit(false);
  }

  runPipeline(): void {
    if (this.steps().length === 0 || this.runStatus() === 'running') return;
    this.runStatus.set('running');
    this.progress.set(0);
    this.stepStatuses.set({});
    this.pipelineOutput.set(null);
    this.selectedStepIndex.set(null);
    this.expandedConfigStep.set(null);
    this.errorMsg.set('');
    this.outputPanelOpen.emit(false);

    this.pluginService.runPipeline(this.projectId(), this.steps()).subscribe({
      next: ({ jobId }) => this.currentJobId.set(jobId),
      error: (err: Error) => {
        this.runStatus.set('error');
        this.errorMsg.set(err.message);
      },
    });
  }

  saveToNotebook(): void {
    const out = this.selectedOutput();
    const jobId = this.currentJobId();
    const idx = this.selectedStepIndex();
    if (!out || !jobId || idx === null) return;

    const pluginName = this.getPlugin(this.steps()[idx]?.pluginId)?.name ?? 'Plugin';
    this.api.post('/notebooks', {
      projectId: this.projectId(),
      jobId,
      stepIndex: idx,
      label: `${pluginName} output`,
    }).subscribe({
      next: () => this.notifications.push('success', 'Saved to notebook'),
      error: () => this.notifications.push('error', 'Failed to save to notebook'),
    });
  }

  useAsWorkingData(): void {
    const jobId = this.currentJobId();
    const idx = this.selectedStepIndex();
    if (!jobId || idx === null || this.isActivating()) return;

    this.isActivating.set(true);
    this.pluginService.activateOutput(this.projectId(), jobId, idx).subscribe({
      next: () => {
        this.clipService.loadAll().subscribe();
        this.notifications.push('success', 'Working data updated');
        this.isActivating.set(false);
        this.closeOutput();
      },
      error: (err: Error) => {
        this.notifications.push('error', err.message);
        this.isActivating.set(false);
      },
    });
  }

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
