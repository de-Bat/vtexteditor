import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SegmentMetadata } from '../../../core/models/segment-metadata.model';

@Component({
  selector: 'app-metadata-entry',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="entry-card" [class]="'type-' + entry().type">
      <div class="entry-header">
        <div class="type-badge">
          <span class="material-symbols-outlined icon">{{ getIcon(entry().type) }}</span>
          <span class="type-name">{{ entry().type }}</span>
        </div>
        <div class="actions">
          <button class="icon-btn" (click)="edit.emit(entry())" title="Edit">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="icon-btn delete" (click)="delete.emit(entry())" title="Delete">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </div>

      <div class="entry-body">
        @switch (entry().type) {
          @case ('speaker') {
            <div class="main-val">{{ asSpeaker(entry()).name }}</div>
            @if (asSpeaker(entry()).label) {
              <div class="sub-val">{{ asSpeaker(entry()).label }}</div>
            }
          }
          @case ('geo') {
            <div class="main-val">{{ asGeo(entry()).placeName || 'Unknown Location' }}</div>
            <div class="sub-val">{{ asGeo(entry()).lat.toFixed(4) }}, {{ asGeo(entry()).lng.toFixed(4) }}</div>
          }
          @case ('timeRange') {
            <div class="main-val">{{ asTime(entry()).label || 'Time Range' }}</div>
            <div class="sub-val">{{ asTime(entry()).from }}s &ndash; {{ asTime(entry()).to }}s</div>
          }
          @case ('language') {
            <div class="main-val">{{ asLang(entry()).name || asLang(entry()).code }}</div>
            <div class="sub-val">ISO: {{ asLang(entry()).code.toUpperCase() }}</div>
          }
          @case ('custom') {
            <div class="main-val">{{ asCustom(entry()).key }}</div>
            <div class="sub-val">{{ asCustom(entry()).value }}</div>
          }
          @case ('text') {
            <div class="main-val text-content">{{ asText(entry()).content }}</div>
          }
        }
      </div>

      <div class="entry-footer">
        <span class="source">Source: {{ entry().sourcePluginId }}</span>
        @if (entry().confidence !== undefined) {
          <span class="confidence" [style.opacity]="entry().confidence">
            {{ (entry().confidence! * 100).toFixed(0) }}% cert.
          </span>
        }
      </div>
    </div>
  `,
  styles: [`
    .entry-card {
      background: var(--surface-container-high, #1f1f22);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .entry-card:hover {
      border-color: rgba(186, 158, 255, 0.3);
      transform: translateY(-1px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
    }

    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .type-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.03);
    }

    .type-badge .icon { font-size: 14px; }
    .type-badge .type-name { 
      font-size: 9px; 
      text-transform: uppercase; 
      font-weight: 800;
      letter-spacing: 0.1em;
      opacity: 0.8;
    }

    .actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.2s; }
    .entry-card:hover .actions { opacity: 1; }

    .icon-btn {
      background: none;
      border: none;
      padding: 6px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--on-surface-variant, #acaaad);
      display: flex;
      transition: all 0.2s;
    }
    .icon-btn:hover { background: rgba(255, 255, 255, 0.05); color: var(--on-surface, #f6f3f5); }
    .icon-btn.delete:hover { color: #ff6e84; background: rgba(255, 110, 132, 0.1); }
    .icon-btn .material-symbols-outlined { font-size: 16px; }

    .entry-body { margin-bottom: 10px; }
    .main-val { font-size: 13px; font-weight: 500; color: var(--on-surface, #f6f3f5); line-height: 1.5; }
    .sub-val { font-size: 11px; color: var(--on-surface-variant, #acaaad); margin-top: 4px; font-family: 'Space Grotesk', sans-serif; }
    
    .text-content {
      font-family: 'Inter', sans-serif;
      white-space: pre-wrap;
      background: rgba(0, 0, 0, 0.15);
      padding: 8px;
      border-radius: 6px;
      font-size: 12px;
      border-left: 2px solid var(--primary, #ba9eff);
    }

    .entry-footer {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: var(--outline, #767577);
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Type-specific accents */
    .type-speaker .type-badge { color: #ba9eff; background: rgba(186, 158, 255, 0.1); }
    .type-geo .type-badge { color: #34d399; background: rgba(52, 211, 153, 0.1); }
    .type-timeRange .type-badge { color: #9093ff; background: rgba(144, 147, 255, 0.1); }
    .type-language .type-badge { color: #fbbf24; background: rgba(251, 191, 36, 0.1); }
    .type-custom .type-badge { color: #acaaad; background: rgba(172, 170, 173, 0.1); }
    .type-text .type-badge { color: var(--primary); background: rgba(186, 158, 255, 0.1); }
  `]
})
export class MetadataEntryComponent {
  readonly entry = input.required<SegmentMetadata>();
  readonly edit = output<SegmentMetadata>();
  readonly delete = output<SegmentMetadata>();

  protected getIcon(type: string): string {
    switch (type) {
      case 'speaker': return 'person';
      case 'geo': return 'location_on';
      case 'timeRange': return 'schedule';
      case 'language': return 'language';
      case 'text': return 'notes';
      default: return 'label';
    }
  }

  // Type-safe casting helpers for template
  protected asSpeaker(e: any) { return e as any; }
  protected asGeo(e: any) { return e as any; }
  protected asTime(e: any) { return e as any; }
  protected asLang(e: any) { return e as any; }
  protected asCustom(e: any) { return e as any; }
  protected asText(e: any) { return e as any; }
}
