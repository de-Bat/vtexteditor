import { Component, input, output, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PluginMeta } from '../../../core/models/plugin.model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaProperty = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaObject = { properties?: Record<string, SchemaProperty>; required?: string[] } & Record<string, any>;

@Component({
  selector: 'app-plugin-options',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="plugin-options">
      <div class="options-header" (click)="collapsed.set(!collapsed())">
        <div class="header-text">
          <span class="toggle-icon">{{ collapsed() ? '▶' : '▼' }}</span>
          <h4>{{ plugin().name }} Settings</h4>
        </div>
        <p class="plugin-desc" *ngIf="collapsed()">{{ plugin().description | slice:0:60 }}{{ plugin().description.length > 60 ? '...' : '' }}</p>
      </div>

      <div class="options-body" [class.collapsed]="collapsed()">
        <p class="plugin-desc">{{ plugin().description }}</p>
        @if (schema(); as s) {
          <div class="form-grid">
            @for (key of propertyKeys(); track key) {
              <div class="form-field">
                <label [for]="'opt-' + key">
                  {{ getProp(s, key, 'title') ?? key }}
                  @if (s['required']?.includes(key)) { <span class="required">*</span> }
                </label>
                @if (getProp(s, key, 'type') === 'boolean') {
                  <div class="checkbox-wrap">
                    <input
                      type="checkbox"
                      [id]="'opt-' + key"
                      [(ngModel)]="config[key]"
                      (change)="emitChange()"
                    />
                  </div>
                } @else if (getProp(s, key, 'enum')) {
                  <select [id]="'opt-' + key" [(ngModel)]="config[key]" (change)="emitChange()">
                    @for (opt of getPropEnum(s, key); track opt) {
                      <option [value]="opt">{{ opt }}</option>
                    }
                  </select>
                } @else {
                  <input
                    type="text"
                    [id]="'opt-' + key"
                    [(ngModel)]="config[key]"
                    [placeholder]="getProp(s, key, 'description') ?? ''"
                    (input)="emitChange()"
                  />
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .plugin-options {
      border-top: 1px solid var(--color-border);
      background: rgba(255,255,255,0.02);
    }
    .options-header {
      padding: 0.5rem 0.75rem;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      &:hover { background: rgba(255,255,255,0.05); }
    }
    .header-text {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .toggle-icon {
      font-size: 0.7rem;
      color: var(--color-accent);
      width: 12px;
    }
    .options-body {
      padding: 0 0.75rem 0.75rem;
      overflow: hidden;
      max-height: 1000px;
      transition: max-height 0.3s ease-out, padding 0.3s;
      &.collapsed {
        max-height: 0;
        padding-bottom: 0;
      }
    }
    h4 { margin: 0; font-size: 0.85rem; font-weight: 600; color: var(--color-text-secondary); }
    .plugin-desc { font-size: 0.75rem; color: var(--color-muted); margin: 0; }
    
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .form-field { display: flex; flex-direction: column; gap: 0.25rem; }
    label { font-size: 0.75rem; font-weight: 500; color: var(--color-muted); }
    .required { color: var(--color-error); }
    input[type="text"], select {
      width: 100%;
      padding: 0.3rem 0.5rem;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      background: var(--color-bg);
      color: var(--color-text);
      font-size: 0.8rem;
      outline: none;
      &:focus { border-color: var(--color-accent); }
    }
    .checkbox-wrap {
      display: flex;
      align-items: center;
      height: 26px;
    }
  `]
})
export class PluginOptionsComponent implements OnInit {
  readonly plugin = input.required<PluginMeta>();
  readonly stepIndex = input.required<number>();
  readonly configChanged = output<{ index: number; config: Record<string, unknown> }>();

  readonly collapsed = signal(true);

  readonly schema = computed<SchemaObject | undefined>(() => this.plugin().configSchema as SchemaObject | undefined);
  readonly propertyKeys = computed<string[]>(() => {
    const props = this.schema()?.['properties'];
    return props ? Object.keys(props) : [];
  });

  config: Record<string, unknown> = {};

  getProp(s: SchemaObject, key: string, prop: string): unknown {
    return s['properties']?.[key]?.[prop];
  }

  getPropEnum(s: SchemaObject, key: string): string[] {
    const enumVal = s['properties']?.[key]?.['enum'];
    return Array.isArray(enumVal) ? enumVal : [];
  }

  ngOnInit(): void {
    const props = this.schema()?.['properties'];
    if (props) {
      for (const key of Object.keys(props)) {
        const def = props[key]['default'];
        if (def !== undefined) this.config[key] = def;
      }
    }
  }

  emitChange(): void {
    this.configChanged.emit({ index: this.stepIndex(), config: { ...this.config } });
  }
}
