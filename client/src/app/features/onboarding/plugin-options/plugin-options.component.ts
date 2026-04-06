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
      <h4>{{ plugin().name }}</h4>
      <p class="plugin-desc">{{ plugin().description }}</p>
      @if (schema(); as s) {
        @for (key of propertyKeys(); track key) {
          <div class="form-field">
            <label [for]="'opt-' + key">
              {{ getProp(s, key, 'title') ?? key }}
              @if (s['required']?.includes(key)) { <span class="required">*</span> }
            </label>
            @if (getProp(s, key, 'type') === 'boolean') {
              <input
                type="checkbox"
                [id]="'opt-' + key"
                [(ngModel)]="config[key]"
                (change)="emitChange()"
              />
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
      }
    </div>
  `,
  styles: [`
    .plugin-options { padding: .75rem 0; }
    h4 { margin: 0 0 .25rem; font-size: .95rem; }
    .plugin-desc { font-size: .8rem; color: var(--color-muted); margin: 0 0 .75rem; }
    .form-field { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .6rem; }
    label { font-size: .8rem; font-weight: 500; color: var(--color-text-secondary); }
    .required { color: var(--color-error); }
    input[type="text"], select {
      padding: .35rem .6rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-surface);
      color: var(--color-text);
      font-size: .85rem;
      outline: none;
      &:focus { border-color: var(--color-accent); }
    }
  `]
})
export class PluginOptionsComponent implements OnInit {
  readonly plugin = input.required<PluginMeta>();
  readonly stepIndex = input.required<number>();
  readonly configChanged = output<{ index: number; config: Record<string, unknown> }>();

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
