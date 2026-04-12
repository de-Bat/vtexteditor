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
      background: var(--surface-2, #f5f5f7);
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 8px;
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }

    .entry-card:hover {
      border-color: #ddd;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }

    .entry-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .type-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 20px;
      background: rgba(0,0,0,0.05);
    }

    .type-badge .icon { font-size: 14px; }
    .type-badge .type-name { 
      font-size: 10px; 
      text-transform: uppercase; 
      font-weight: 700;
      letter-spacing: 0.05em;
    }

    .actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.2s; }
    .entry-card:hover .actions { opacity: 1; }

    .icon-btn {
      background: none;
      border: none;
      padding: 4px;
      border-radius: 4px;
      cursor: pointer;
      color: #888;
      display: flex;
    }
    .icon-btn:hover { background: rgba(0,0,0,0.05); color: #333; }
    .icon-btn.delete:hover { color: #ff3b30; }
    .icon-btn .material-symbols-outlined { font-size: 18px; }

    .entry-body { margin-bottom: 8px; }
    .main-val { font-size: 14px; font-weight: 600; color: #1d1d1f; }
    .sub-val { font-size: 12px; color: #86868b; margin-top: 2px; }

    .entry-footer {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #999;
      border-top: 1px solid rgba(0,0,0,0.03);
      padding-top: 6px;
    }

    /* Type-specific accents */
    .type-speaker .type-badge { color: #007aff; background: rgba(0,122,255,0.1); }
    .type-geo .type-badge { color: #34c759; background: rgba(52,199,89,0.1); }
    .type-timeRange .type-badge { color: #5856d6; background: rgba(88,86,214,0.1); }
    .type-language .type-badge { color: #ff9500; background: rgba(255,149,0,0.1); }
    .type-custom .type-badge { color: #8e8e93; background: rgba(142,142,147,0.1); }
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
      default: return 'label';
    }
  }

  // Type-safe casting helpers for template
  protected asSpeaker(e: any) { return e as any; }
  protected asGeo(e: any) { return e as any; }
  protected asTime(e: any) { return e as any; }
  protected asLang(e: any) { return e as any; }
  protected asCustom(e: any) { return e as any; }
}
