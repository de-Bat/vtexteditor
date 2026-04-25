import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  inject,
  effect,
  signal,
  computed,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators, AbstractControl, ValidatorFn } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { InputField, InputRequest, InputResponse } from '../../../core/models/plugin.model';

@Component({
  selector: 'app-plugin-input-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <div class="plugin-input-form">
      <h3 class="form-title">{{ request().title }}</h3>

      @if (request().content) {
        <div class="form-content" [innerHTML]="sanitizedContent()"></div>
      }

      @if (request().fields.length > 0) {
        <form [formGroup]="form()" class="form-fields">
          @for (field of request().fields; track field.id) {
            <div class="field-group">
              <label [for]="field.id" class="field-label">
                {{ field.label }}
                @if (field.required) { <span class="required" aria-hidden="true">*</span> }
              </label>
              @if (field.description) {
                <span class="field-desc" [id]="field.id + '-desc'">{{ field.description }}</span>
              }

              @switch (field.type) {
                @case ('text') {
                  <input
                    type="text"
                    [formControlName]="field.id"
                    [id]="field.id"
                    class="field-input"
                    [attr.aria-describedby]="field.description ? field.id + '-desc' : null"
                  />
                }
                @case ('number') {
                  <input
                    type="number"
                    [formControlName]="field.id"
                    [id]="field.id"
                    class="field-input"
                    [attr.aria-describedby]="field.description ? field.id + '-desc' : null"
                  />
                }
                @case ('boolean') {
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      [formControlName]="field.id"
                      [id]="field.id"
                      class="field-checkbox"
                    />
                    <span class="checkbox-text">{{ field.label }}</span>
                  </label>
                }
                @case ('textarea') {
                  <textarea
                    [formControlName]="field.id"
                    [id]="field.id"
                    class="field-textarea"
                    rows="3"
                    [attr.aria-describedby]="field.description ? field.id + '-desc' : null"
                  ></textarea>
                }
                @case ('select') {
                  <select
                    [formControlName]="field.id"
                    [id]="field.id"
                    class="field-select"
                    [attr.aria-describedby]="field.description ? field.id + '-desc' : null"
                  >
                    <option value="">-- Select --</option>
                    @for (opt of field.options ?? []; track opt.value) {
                      <option [value]="opt.value">{{ opt.label }}</option>
                    }
                  </select>
                }
                @case ('multi-select') {
                  <div
                    class="multi-select-group"
                    role="group"
                    [attr.aria-labelledby]="field.id + '-label'"
                    [attr.aria-describedby]="field.description ? field.id + '-desc' : null"
                  >
                    @for (opt of field.options ?? []; track opt.value) {
                      <label class="multi-opt">
                        <input
                          type="checkbox"
                          [checked]="isMultiSelected(field.id, opt.value)"
                          (change)="toggleMultiSelect(field.id, opt.value)"
                          class="field-checkbox"
                        />
                        <span>{{ opt.label }}</span>
                      </label>
                    }
                  </div>
                }
              }

              @if (form().get(field.id)?.invalid && form().get(field.id)?.touched) {
                <span class="field-error" role="alert">{{ getErrorMessage(field) }}</span>
              }
            </div>
          }
        </form>
      }

      <div class="form-actions">
        @if (request().skippable) {
          <button class="btn-skip" type="button" (click)="onSkip()">
            {{ request().skipLabel ?? 'Skip' }}
          </button>
        }
        <button
          class="btn-submit"
          type="button"
          (click)="onSubmit()"
          [disabled]="form().invalid"
          [attr.aria-disabled]="form().invalid"
        >
          {{ request().submitLabel ?? 'Submit' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .plugin-input-form {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 1.25rem;
      margin-top: 0.75rem;
    }

    .form-title {
      margin: 0 0 0.75rem;
      font-size: 1rem;
      font-weight: 700;
      color: var(--color-text);
    }

    .form-content {
      font-size: 0.85rem;
      color: var(--color-text-secondary);
      margin-bottom: 1rem;
      line-height: 1.5;
    }

    .form-fields { display: flex; flex-direction: column; gap: 1rem; }

    .field-group { display: flex; flex-direction: column; gap: 0.3rem; }

    .field-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--color-text);
    }

    .required { color: var(--color-error); margin-left: 0.2rem; }

    .field-desc {
      font-size: 0.75rem;
      color: var(--color-muted);
    }

    .field-input, .field-select, .field-textarea {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      color: var(--color-text);
      font-size: 0.85rem;
      padding: 0.45rem 0.7rem;
      width: 100%;
      box-sizing: border-box;
      transition: border-color 0.15s;

      &:focus {
        outline: none;
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px rgba(124, 106, 247, 0.2);
      }
    }

    .field-textarea { resize: vertical; font-family: inherit; }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--color-text);
    }

    .field-checkbox { cursor: pointer; accent-color: var(--color-accent); }

    .multi-select-group { display: flex; flex-direction: column; gap: 0.4rem; }

    .multi-opt {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
      color: var(--color-text);
      cursor: pointer;
    }

    .field-error {
      font-size: 0.75rem;
      color: var(--color-error);
    }

    .form-actions {
      display: flex;
      gap: 0.75rem;
      justify-content: flex-end;
      margin-top: 1.25rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .btn-skip, .btn-submit {
      padding: 0.45rem 1rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .btn-skip {
      background: transparent;
      border: 1px solid var(--color-border);
      color: var(--color-muted);
      &:hover { border-color: var(--color-text-secondary); color: var(--color-text); }
    }

    .btn-submit {
      background: var(--color-accent);
      color: #fff;
      &:hover:not(:disabled) { filter: brightness(1.15); }
      &:disabled { opacity: 0.4; cursor: default; }
    }
  `],
})
export class PluginInputFormComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly request = input.required<InputRequest>();
  readonly submitted = output<InputResponse>();
  readonly skipped = output<InputResponse>();

  readonly form = signal<FormGroup>(new FormGroup({}));

  constructor() {
    effect(() => {
      const req = this.request();
      const controls: Record<string, AbstractControl> = {};

      for (const field of req.fields) {
        const validators: ValidatorFn[] = [];
        if (field.required) validators.push(Validators.required);

        if (field.type === 'number') {
          if (field.validation?.min !== undefined) validators.push(Validators.min(field.validation.min));
          if (field.validation?.max !== undefined) validators.push(Validators.max(field.validation.max));
          controls[field.id] = new FormControl<number | null>(
            field.defaultValue as number ?? null,
            validators,
          );
        } else if (field.type === 'boolean') {
          controls[field.id] = new FormControl<boolean>(
            field.defaultValue as boolean ?? false,
          );
        } else if (field.type === 'multi-select') {
          controls[field.id] = new FormControl<string[]>(
            (field.defaultValue as string[]) ?? [],
          );
        } else {
          if (field.validation?.minLength !== undefined) validators.push(Validators.minLength(field.validation.minLength));
          if (field.validation?.maxLength !== undefined) validators.push(Validators.maxLength(field.validation.maxLength));
          if (field.validation?.pattern) validators.push(Validators.pattern(field.validation.pattern));
          controls[field.id] = new FormControl<string>(
            field.defaultValue as string ?? '',
            validators,
          );
        }
      }

      this.form.set(new FormGroup(controls));
    }, { allowSignalWrites: true });
  }

  readonly sanitizedContent = computed<SafeHtml>(() => {
    const content = this.request().content;
    if (!content) return '';
    return this.sanitizer.bypassSecurityTrustHtml(content);
  });

  isMultiSelected(fieldId: string, value: string): boolean {
    const ctrl = this.form().get(fieldId);
    const values = (ctrl?.value as string[]) ?? [];
    return values.includes(value);
  }

  toggleMultiSelect(fieldId: string, value: string): void {
    const ctrl = this.form().get(fieldId);
    if (!ctrl) return;
    const current = (ctrl.value as string[]) ?? [];
    ctrl.setValue(current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value],
    );
    ctrl.markAsTouched();
  }

  getErrorMessage(field: InputField): string {
    const ctrl = this.form().get(field.id);
    if (!ctrl?.errors) return '';
    const e = ctrl.errors;
    if (e['required']) return `${field.label} is required`;
    if (e['minlength']) return `Minimum ${e['minlength'].requiredLength} characters`;
    if (e['maxlength']) return `Maximum ${e['maxlength'].requiredLength} characters`;
    if (e['min']) return `Minimum value is ${e['min'].min}`;
    if (e['max']) return `Maximum value is ${e['max'].max}`;
    if (e['pattern']) return 'Invalid format';
    return 'Invalid value';
  }

  onSubmit(): void {
    const f = this.form();
    f.markAllAsTouched();
    if (f.invalid) return;
    this.submitted.emit({
      requestId: this.request().requestId,
      skipped: false,
      values: f.value as Record<string, unknown>,
    });
  }

  onSkip(): void {
    this.skipped.emit({
      requestId: this.request().requestId,
      skipped: true,
      values: {},
    });
  }
}
