import {
  Component, ChangeDetectionStrategy, input, computed, signal, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Clip } from '../../../core/models/clip.model';
import { SegmentMetadata } from '../../../core/models/segment-metadata.model';
import { ClipService } from '../../../core/services/clip.service';
import { MetadataEntryComponent } from './metadata-entry.component';
import { MetadataAddFormComponent } from './metadata-add-form.component';

@Component({
  selector: 'app-segment-metadata-panel',
  standalone: true,
  imports: [CommonModule, MetadataEntryComponent, MetadataAddFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel-container">
      <div class="panel-header">
        <span class="title">Segment Metadata</span>
        @if (segment(); as res) {
          <span class="segment-range">
             {{ formatSecs(res.segment.startTime) }} &ndash; {{ formatSecs(res.segment.endTime) }}
          </span>
        }
      </div>

      @if (!segment()) {
        <div class="panel-empty">
          <span class="material-symbols-outlined large-icon">info</span>
          <p>Select a segment to view and manage structured metadata.</p>
        </div>
      } @else {
        <div class="panel-content">
          @if (showAddForm()) {
            <app-metadata-add-form 
              (submitted)="onAdd($event)" 
              (cancelled)="showAddForm.set(false)" 
            />
          } @else {
            <button type="button" class="add-meta-btn" (click)="showAddForm.set(true)">
              <span class="material-symbols-outlined">add</span>
              Add Metadata
            </button>
          }

          @for (group of groupedEntries(); track group.type) {
            <div class="type-section">
              <div class="section-header" (click)="toggleSection(group.type)">
                <span class="material-symbols-outlined chevron" [class.open]="!collapsedSections().has(group.type)">
                  chevron_right
                </span>
                <span class="section-title">{{ group.type }}</span>
                <span class="count">{{ group.items.length }}</span>
              </div>
              
              @if (!collapsedSections().has(group.type)) {
                <div class="section-items">
                  @for (item of group.items; track item.entry) {
                    <app-metadata-entry 
                      [entry]="item.entry"
                      (edit)="onEdit($event)"
                      (delete)="onDelete(item.entry)"
                    />
                  }
                </div>
              }
            </div>
          } @empty {
            @if (!showAddForm()) {
              <div class="no-meta">
                <p>No metadata entries for this segment.</p>
              </div>
            }
          }
        </div>
      }
    </div>
  `,
  styleUrl: './segment-metadata-panel.component.scss',
})
export class SegmentMetadataPanelComponent {
  readonly segmentId = input<string | null>(null);
  readonly clips = input<Clip[]>([]);

  private readonly clipService = inject(ClipService);

  protected readonly showAddForm = signal(false);
  protected readonly collapsedSections = signal<Set<string>>(new Set());

  protected readonly segment = computed(() => {
    const id = this.segmentId();
    if (!id) return null;
    for (const clip of this.clips()) {
      const seg = clip.segments.find(s => s.id === id);
      if (seg) return { segment: seg, clipId: clip.id, projectId: clip.projectId };
    }
    return null;
  });

  protected readonly groupedEntries = computed(() => {
    const res = this.segment();
    if (!res) return [];
    
    const metadata = res.segment.metadata ?? {};
    const groupedMap: Map<string, Array<{ entry: SegmentMetadata; sourcePluginId: string }>> = new Map();
    
    for (const [sourceId, entries] of Object.entries(metadata)) {
      for (const entry of entries) {
        if (!groupedMap.has(entry.type)) groupedMap.set(entry.type, []);
        groupedMap.get(entry.type)!.push({ entry, sourcePluginId: sourceId });
      }
    }
    
    return Array.from(groupedMap.entries()).map(([type, items]) => ({ type, items }));
  });

  protected toggleSection(type: string): void {
    const set = new Set(this.collapsedSections());
    if (set.has(type)) set.delete(type);
    else set.add(type);
    this.collapsedSections.set(set);
  }

  protected onEdit(updatedEntry: SegmentMetadata): void {
    const res = this.segment();
    if (!res) return;
    const { segment, clipId, projectId } = res;
    
    // For now, if user edits a plugin result, we move it to 'user' source
    // to preserve it regardless of plugin reruns, or we just overwrite.
    // The spec says: sourcePluginId is maintained if it's a plugin entry.
    const sourceId = updatedEntry.sourcePluginId;
    const currentEntries = segment.metadata?.[sourceId] ?? [];
    
    // Find index by reference or some stable id? 
    // Metadata entries don't have IDs. We'll use reference match for now.
    const updatedEntries = currentEntries.map(e => e === updatedEntry ? updatedEntry : e);
    
    this.clipService.updateSegmentMetadata(projectId, clipId, segment.id, sourceId, updatedEntries);
  }

  protected onDelete(entryToDelete: SegmentMetadata): void {
    const res = this.segment();
    if (!res) return;
    const { segment, clipId, projectId } = res;
    
    const sourceId = entryToDelete.sourcePluginId;
    const currentEntries = segment.metadata?.[sourceId] ?? [];
    const updatedEntries = currentEntries.filter(e => e !== entryToDelete);
    
    this.clipService.updateSegmentMetadata(projectId, clipId, segment.id, sourceId, updatedEntries);
  }

  protected onAdd(newEntry: SegmentMetadata): void {
    const res = this.segment();
    if (!res) return;
    const { segment, clipId, projectId } = res;
    
    const currentUserEntries = segment.metadata?.['user'] ?? [];
    this.clipService.updateSegmentMetadata(
      projectId, clipId, segment.id, 'user', [...currentUserEntries, newEntry]
    );
    
    this.showAddForm.set(false);
  }

  protected formatSecs(s: number): string {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
