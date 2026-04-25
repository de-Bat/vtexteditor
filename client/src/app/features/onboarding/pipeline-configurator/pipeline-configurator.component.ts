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
      <div class="pipeline-header">
        <h3>Pipeline Workflow</h3>
        <p class="subtitle">Chain processing units to extract and refine transcription</p>
      </div>

      <div class="available-plugins">
        <span class="section-label">Inventory</span>
        <div class="plugin-chips">
          @for (plugin of availablePlugins(); track plugin.id) {
            <button class="chip" (click)="addPlugin(plugin)">
              <span class="plus">+</span> {{ plugin.name }}
            </button>
          }
        </div>
      </div>

      <div class="flow-container">
        <span class="section-label">Active Chain</span>
        <div class="flow-list">
          @for (step of steps(); track step.pluginId; let i = $index) {
            <div class="flow-node">
              <div class="node-track">
                <div class="node-dot">
                  <span class="num">{{ i + 1 }}</span>
                </div>
                @if (i < steps().length - 1) {
                  <div class="node-line"></div>
                }
              </div>
              
              <div class="node-content">
                <div class="node-header">
                  <span class="node-name">{{ getPlugin(step.pluginId)?.name ?? step.pluginId }}</span>
                  @if (getPlugin(step.pluginId)?.requiresInteraction) {
                    <span class="interactive-badge">Interactive</span>
                  }
                  <div class="node-actions">
                    <button class="btn-sm" (click)="moveUp(i)" [disabled]="i === 0" title="Move Up">↑</button>
                    <button class="btn-sm" (click)="moveDown(i)" [disabled]="i === steps().length - 1" title="Move Down">↓</button>
                    <button class="btn-sm remove" (click)="removeStep(i)" title="Remove">✕</button>
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
            </div>
          }
          @if (steps().length === 0) {
            <div class="empty-state">
              <div class="empty-icon">⬡</div>
              <p>Add plugins from the inventory above to start building your pipeline.</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pipeline-config { display: flex; flex-direction: column; gap: 1.5rem; }
    .pipeline-header { margin-bottom: 0.5rem; }
    h3 { margin: 0; font-size: 1.1rem; color: var(--color-text); font-weight: 700; }
    .subtitle { margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--color-muted); }
    
    .section-label {
      display: block;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-muted);
      margin-bottom: 0.75rem;
    }

    .plugin-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .chip {
      padding: 0.35rem 0.8rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-surface-alt);
      color: var(--color-text-secondary);
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      transition: all 0.2s;
      &:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
        background: var(--color-accent-subtle);
      }
      .plus { font-size: 1.1rem; line-height: 1; opacity: 0.7; }
    }

    .flow-container { background: rgba(0,0,0,0.1); padding: 1rem; border-radius: 12px; border: 1px solid var(--color-border); }
    .flow-list { display: flex; flex-direction: column; }
    
    .flow-node {
      display: flex;
      gap: 1.25rem;
      min-height: 60px;
    }
    
    .node-track {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 24px;
      flex-shrink: 0;
    }
    
    .node-dot {
      width: 24px; height: 24px;
      border-radius: 50%;
      background: var(--color-bg);
      border: 2px solid var(--color-border);
      display: flex; align-items: center; justify-content: center;
      position: relative;
      z-index: 1;
      .num { font-size: 0.7rem; font-weight: 800; color: var(--color-muted); }
    }
    
    .flow-node:hover .node-dot { border-color: var(--color-accent); .num { color: var(--color-accent); } }
    
    .node-line {
      width: 2px;
      flex: 1;
      background: var(--color-border);
      margin: 4px 0;
    }
    
    .node-content {
      flex: 1;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      margin-bottom: 1rem;
      overflow: hidden;
      transition: border-color 0.2s;
      &:hover { border-color: rgba(255,255,255,0.15); }
    }
    
    .node-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      background: rgba(255,255,255,0.03);
    }
    
    .node-name { font-size: 0.85rem; font-weight: 600; color: var(--color-text); }

    .interactive-badge {
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      background: rgba(255, 193, 7, 0.15);
      color: #ffc107;
    }
    
    .node-actions { display: flex; gap: 0.2rem; }
    .btn-sm {
      background: transparent;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 4px;
      font-size: 0.8rem;
      &:hover:not(:disabled) { background: rgba(255,255,255,0.1); color: var(--color-text); }
      &:disabled { opacity: 0.2; cursor: default; }
      &.remove:hover { color: var(--color-error); background: var(--color-error-subtle); }
    }
    
    .empty-state {
      padding: 2.5rem;
      text-align: center;
      color: var(--color-muted);
      border: 2px dashed var(--color-border);
      border-radius: 12px;
    }
    .empty-icon { font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.3; }
    .empty-hint { font-size: 0.85rem; margin: 0; }
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
