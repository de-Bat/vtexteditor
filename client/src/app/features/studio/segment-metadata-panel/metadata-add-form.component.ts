import {
  Component, ChangeDetectionStrategy, output, signal, inject, input
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators, FormsModule } from '@angular/forms';
import {
  MetadataEntry, MetadataType,
  SpeakerMetadata, GeoMetadata, TimeRangeMetadata, LanguageMetadata, CustomMetadata, TrailMetadata, TrailPoint
} from '../../../core/models/segment-metadata.model';

@Component({
  selector: 'app-metadata-add-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="add-form-container">
      <div class="form-header">
        <h3>Add Metadata</h3>
        <button type="button" class="close-btn" (click)="cancelled.emit()">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()" class="add-form">
        <div class="field-group">
          <label for="meta-type">Type</label>
          <select id="meta-type" formControlName="type" class="form-select">
            <option value="speaker">Speaker</option>
            <option value="geo">Geo Location</option>
            @if (allowTrails()) {
              <option value="trail">Trail (Path)</option>
            }
            <option value="timeRange">Time Range</option>
            <option value="language">Language</option>
            <option value="custom">Custom Key/Value</option>
            <option value="text">Text Note</option>
          </select>
        </div>

        <div class="dynamic-fields">
          @switch (selectedType()) {
            @case ('speaker') {
              <div class="field-group">
                <label>Name</label>
                <input formControlName="name" placeholder="Name" class="form-input" />
              </div>
              <div class="field-group">
                <label>Label</label>
                <input formControlName="label" placeholder="Label (optional)" class="form-input" />
              </div>
            }
            @case ('geo') {
              <div class="field-row">
                <div class="field-group">
                  <label>Lat</label>
                  <input formControlName="lat" type="number" placeholder="0.0000" class="form-input" />
                </div>
                <div class="field-group">
                  <label>Lng</label>
                  <input formControlName="lng" type="number" placeholder="0.0000" class="form-input" />
                </div>
              </div>
              <div class="field-group">
                <label>Place</label>
                <input formControlName="placeName" placeholder="Place name (optional)" class="form-input" />
              </div>
            }
            @case ('timeRange') {
              <div class="field-row">
                <div class="field-group">
                  <label>From (s)</label>
                  <input formControlName="from" type="number" step="0.1" class="form-input" />
                </div>
                <div class="field-group">
                  <label>To (s)</label>
                  <input formControlName="to" type="number" step="0.1" class="form-input" />
                </div>
              </div>
              <div class="field-group">
                <label>Label</label>
                <input formControlName="label" placeholder="Label (optional)" class="form-input" />
              </div>
            }
            @case ('language') {
              <div class="field-group">
                <label>ISO Code</label>
                <input formControlName="code" placeholder="e.g. en" class="form-input" />
              </div>
              <div class="field-group">
                <label>Name</label>
                <input formControlName="name" placeholder="Language name (optional)" class="form-input" />
              </div>
            }
            @case ('custom') {
              <div class="field-group">
                <label>Key</label>
                <input formControlName="key" placeholder="Key" class="form-input" />
              </div>
              <div class="field-group">
                <label>Value</label>
                <input formControlName="value" placeholder="Value" class="form-input" />
              </div>
            }
            @case ('trail') {
              <div class="trail-editor">
                <div class="field-header">
                  <label>Points ({{ trailPoints().length }})</label>
                  <button type="button" class="btn-icon" (click)="addTrailPoint()">
                    <span class="material-symbols-outlined">add_location_alt</span>
                  </button>
                </div>
                
                <div class="points-list">
                  @for (p of trailPoints(); track $index) {
                    <div class="point-item">
                      <div class="point-fields">
                        <input [(ngModel)]="p.lat" [ngModelOptions]="{standalone: true}" type="number" placeholder="Lat" class="form-input mini" />
                        <input [(ngModel)]="p.lng" [ngModelOptions]="{standalone: true}" type="number" placeholder="Lng" class="form-input mini" />
                        <input [(ngModel)]="p.name" [ngModelOptions]="{standalone: true}" placeholder="Name (opt)" class="form-input mini name" />
                      </div>
                      <button type="button" class="btn-remove" (click)="removeTrailPoint($index)">
                        <span class="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  } @empty {
                    <p class="empty-hint">Add at least one point to the trail</p>
                  }
                </div>
              </div>
            }
            @case ('text') {
              <div class="field-group">
                <label>Content</label>
                <textarea formControlName="content" placeholder="Enter descriptive note..." class="form-input form-textarea" rows="3"></textarea>
              </div>
            }
          }
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" (click)="cancelled.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="form.invalid">Add Entry</button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .add-form-container {
      background: var(--surface-container-highest, #262528);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
      margin-bottom: 20px;
      animation: slide-down 300ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes slide-down {
      from { transform: translateY(-10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .form-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .form-header h3 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 13px;
      font-weight: 700;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--on-surface, #f6f3f5);
    }

    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--outline, #767577);
      display: flex;
      padding: 4px;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .close-btn:hover { background: rgba(255, 255, 255, 0.05); color: var(--on-surface, #f6f3f5); }

    .field-group {
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field-row {
      display: flex;
      gap: 12px;
    }

    .field-row .field-group { flex: 1; }

    label {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 10px;
      font-weight: 700;
      color: var(--outline, #767577);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding-left: 2px;
    }

    .form-select, .form-input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 13px;
      background: rgba(0, 0, 0, 0.2);
      color: var(--on-surface, #f6f3f5);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      font-family: 'Inter', sans-serif;
    }

    .form-textarea {
      resize: vertical;
      min-height: 80px;
      line-height: 1.5;
    }

    .form-select:focus, .form-input:focus {
      outline: none;
      border-color: var(--primary, #ba9eff);
      background: rgba(0, 0, 0, 0.3);
      box-shadow: 0 0 0 3px rgba(186, 158, 255, 0.15);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    .btn {
      padding: 10px 18px;
      border-radius: 8px;
      font-family: 'Space Grotesk', sans-serif;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      border: none;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: var(--on-surface-variant, #acaaad);
    }

    .btn-secondary:hover { background: rgba(255, 255, 255, 0.1); color: var(--on-surface, #f6f3f5); }

    .btn-primary {
      background: var(--primary, #ba9eff);
      color: var(--on-primary-container, #2b006e);
    }

    .btn-primary:hover { 
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(186, 158, 255, 0.3);
    }
    .btn-primary:disabled { opacity: 0.3; cursor: not-allowed; transform: none; box-shadow: none; }

    .trail-editor {
      background: rgba(0,0,0,0.1);
      border-radius: 8px;
      padding: 12px;
      margin-top: 8px;
    }
    .field-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .btn-icon {
      background: transparent;
      border: none;
      color: var(--primary, #ba9eff);
      cursor: pointer;
      display: flex;
      padding: 4px;
      border-radius: 4px;
      &:hover { background: rgba(186, 158, 255, 0.1); }
    }
    .points-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 200px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .point-item {
      display: flex;
      gap: 8px;
      align-items: center;
      background: rgba(255, 255, 255, 0.03);
      padding: 6px;
      border-radius: 6px;
    }
    .point-fields {
      display: flex;
      gap: 4px;
      flex: 1;
    }
    .form-input.mini {
      padding: 6px 8px;
      font-size: 11px;
    }
    .form-input.name { flex: 1.5; }
    .btn-remove {
      background: transparent;
      border: none;
      color: var(--error, #ffb4ab);
      cursor: pointer;
      display: flex;
      padding: 4px;
      border-radius: 4px;
      &:hover { background: rgba(255, 180, 171, 0.1); }
      .material-symbols-outlined { font-size: 16px; }
    }
    .empty-hint {
      font-size: 11px;
      color: #777;
      text-align: center;
      margin: 8px 0;
      font-style: italic;
    }
  `]
})
export class MetadataAddFormComponent {
  readonly allowTrails = input(false);
  readonly submitted = output<MetadataEntry>();
  readonly cancelled = output<void>();

  protected readonly trailPoints = signal<TrailPoint[]>([]);

  protected readonly form = new FormGroup({
    type: new FormControl<MetadataType>('speaker', { nonNullable: true }),
    name: new FormControl(''),
    label: new FormControl(''),
    lat: new FormControl<number | null>(null),
    lng: new FormControl<number | null>(null),
    placeName: new FormControl(''),
    from: new FormControl<number | null>(null),
    to: new FormControl<number | null>(null),
    code: new FormControl(''),
    key: new FormControl(''),
    value: new FormControl(''),
    content: new FormControl(''),
  });

  protected readonly selectedType = signal<MetadataType>('speaker');

  constructor() {
    this.form.controls.type.valueChanges.subscribe(t => {
      this.selectedType.set(t);
      this.updateValidators(t);
    });
    this.updateValidators('speaker');
  }

  private updateValidators(type: MetadataType): void {
    // Reset all validators
    Object.values(this.form.controls).forEach(c => {
      if (c !== this.form.controls.type) {
        c.clearValidators();
        c.updateValueAndValidity();
      }
    });

    // Set specific validators
    switch (type) {
      case 'speaker':
        this.form.controls.name.setValidators([Validators.required]);
        break;
      case 'geo':
        this.form.controls.lat.setValidators([Validators.required]);
        this.form.controls.lng.setValidators([Validators.required]);
        break;
      case 'timeRange':
        this.form.controls.from.setValidators([Validators.required]);
        this.form.controls.to.setValidators([Validators.required]);
        break;
      case 'language':
        this.form.controls.code.setValidators([Validators.required]);
        break;
      case 'custom':
        this.form.controls.key.setValidators([Validators.required]);
        this.form.controls.value.setValidators([Validators.required]);
        break;
      case 'text':
        this.form.controls.content.setValidators([Validators.required]);
        break;
      case 'trail':
        // Trail points are managed via signal, we'll check validity in submit()
        break;
    }
    
    Object.values(this.form.controls).forEach(c => c.updateValueAndValidity());
  }

  protected submit(): void {
    if (this.form.invalid) return;
    
    const v = this.form.getRawValue();
    let entry: MetadataEntry;
    
    switch (v.type) {
      case 'speaker':
        entry = { type: 'speaker', sourcePluginId: 'user', name: v.name! };
        if (v.label) (entry as SpeakerMetadata).label = v.label;
        break;
      case 'geo':
        entry = { type: 'geo', sourcePluginId: 'user', lat: v.lat!, lng: v.lng! };
        if (v.placeName) (entry as GeoMetadata).placeName = v.placeName;
        break;
      case 'timeRange':
        entry = { type: 'timeRange', sourcePluginId: 'user', from: v.from!, to: v.to! };
        if (v.label) (entry as TimeRangeMetadata).label = v.label;
        break;
      case 'language':
        entry = { type: 'language', sourcePluginId: 'user', code: v.code! };
        if (v.name) (entry as LanguageMetadata).name = v.name;
        break;
      case 'custom':
        entry = { type: 'custom', sourcePluginId: 'user', key: v.key!, value: v.value! };
        break;
      case 'text':
        entry = { type: 'text', sourcePluginId: 'user', content: v.content! };
        break;
      case 'trail':
        if (this.trailPoints().length === 0) return;
        entry = { type: 'trail', sourcePluginId: 'user', points: [...this.trailPoints()] };
        break;
    }
    
    this.submitted.emit(entry!);
    this.form.reset({ type: v.type });
    this.trailPoints.set([]);
    this.updateValidators(v.type);
  }

  protected addTrailPoint(): void {
    this.trailPoints.update(pts => [...pts, { lat: 0, lng: 0 }]);
  }

  protected removeTrailPoint(index: number): void {
    this.trailPoints.update(pts => pts.filter((_, i) => i !== index));
  }
}
