import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PluginMeta, PipelineStep } from '../../../core/models/plugin.model';
import { PluginService } from '../../../core/services/plugin.service';
import { PluginOptionsComponent } from '../plugin-options/plugin-options.component';

export type PipelineConfig = PipelineStep[];

@Component({
  selector: 'app-pipeline-configurator',
  standalone: true,
  imports: [CommonModule, PluginOptionsComponent],
  template: `
    <div class="pipeline-config">
      <h3>Pipeline Configuration</h3>

      <div class="available-plugins">
        <h4>Available Plugins</h4>
        <div class="plugin-chips">
          @for (plugin of availablePlugins(); track plugin.id) {
            <button class="chip" (click)="addPlugin(plugin)">
              + {{ plugin.name }}
            </button>
          }
        </div>
      </div>

      @if (steps().length) {
        <div class="pipeline-steps">
          <h4>Pipeline Steps</h4>
          @for (step of steps(); track step.pluginId; let i = $index) {
            <div class="step-card">
              <div class="step-header">
                <span class="step-num">{{ i + 1 }}</span>
                <span class="step-name">{{ getPlugin(step.pluginId)?.name ?? step.pluginId }}</span>
                <div class="step-actions">
                  <button (click)="moveUp(i)" [disabled]="i === 0">↑</button>
                  <button (click)="moveDown(i)" [disabled]="i === steps().length - 1">↓</button>
                  <button class="remove" (click)="removeStep(i)">✕</button>
                </div>
              </div>
              @if (getPlugin(step.pluginId); as plugin) {
                <app-plugin-options
                  [plugin]="plugin"
                  [stepIndex]="i"
                  (configChanged)="onConfigChanged($event)"
                />
              }
            </div>
          }
        </div>
      } @else {
        <p class="empty-hint">Add at least one plugin to extract transcription from your media.</p>
      }
    </div>
  `,
  styles: [`
    .pipeline-config { display: flex; flex-direction: column; gap: 1.25rem; }
    h3 { margin: 0; font-size: 1.1rem; }
    h4 { margin: 0 0 .6rem; font-size: .875rem; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: .05em; }
    .plugin-chips { display: flex; flex-wrap: wrap; gap: .5rem; }
    .chip {
      padding: .3rem .75rem;
      border: 1px solid var(--color-accent);
      border-radius: 999px;
      background: transparent;
      color: var(--color-accent);
      cursor: pointer;
      font-size: .8rem;
      transition: background .15s;
      &:hover { background: var(--color-accent-subtle); }
    }
    .pipeline-steps { display: flex; flex-direction: column; gap: .75rem; }
    .step-card {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: .6rem;
      padding: .5rem .75rem;
      background: var(--color-surface-alt);
      border-bottom: 1px solid var(--color-border);
    }
    .step-num {
      width: 22px; height: 22px;
      border-radius: 50%;
      background: var(--color-accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: .75rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .step-name { flex: 1; font-size: .875rem; font-weight: 500; }
    .step-actions { display: flex; gap: .25rem; }
    .step-actions button {
      border: none;
      background: none;
      cursor: pointer;
      padding: .2rem .4rem;
      border-radius: 4px;
      color: var(--color-text-secondary);
      &:hover { background: var(--color-border); }
      &:disabled { opacity: .3; cursor: default; }
      &.remove:hover { background: var(--color-error-subtle); color: var(--color-error); }
    }
    app-plugin-options { display: block; padding: 0 .75rem; }
    .empty-hint { font-size: .875rem; color: var(--color-muted); margin: 0; }
  `]
})
export class PipelineConfiguratorComponent implements OnInit {
  readonly availablePlugins = signal<PluginMeta[]>([]);
  readonly steps = signal<PipelineStep[]>([]);
  private pluginMap = new Map<string, PluginMeta>();

  constructor(private pluginService: PluginService) {}

  ngOnInit(): void {
    this.pluginService.loadAll().subscribe((plugins) => {
      this.availablePlugins.set(plugins);
      this.pluginMap = new Map(plugins.map((p) => [p.id, p]));
    });
  }

  getPlugin(id: string): PluginMeta | undefined {
    return this.pluginMap.get(id);
  }

  addPlugin(plugin: PluginMeta): void {
    this.steps.update((s) => [...s, { pluginId: plugin.id, order: s.length, config: {} }]);
  }

  removeStep(index: number): void {
    this.steps.update((s) => {
      const copy = [...s];
      copy.splice(index, 1);
      return copy.map((step, i) => ({ ...step, order: i }));
    });
  }

  moveUp(index: number): void {
    if (index === 0) return;
    this.steps.update((s) => {
      const copy = [...s];
      [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
      return copy.map((step, i) => ({ ...step, order: i }));
    });
  }

  moveDown(index: number): void {
    this.steps.update((s) => {
      if (index >= s.length - 1) return s;
      const copy = [...s];
      [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
      return copy.map((step, i) => ({ ...step, order: i }));
    });
  }

  onConfigChanged(e: { index: number; config: Record<string, unknown> }): void {
    this.steps.update((s) => {
      const copy = [...s];
      copy[e.index] = { ...copy[e.index], config: e.config };
      return copy;
    });
  }

  getSteps(): PipelineStep[] {
    return this.steps();
  }
}
