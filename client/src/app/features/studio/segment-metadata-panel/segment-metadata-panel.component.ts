import { Component, ChangeDetectionStrategy, input, output, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Clip } from '../../../core/models/clip.model';
import { MetadataEntry } from '../../../core/models/segment-metadata.model';
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
      <div class="panel-side-label"><span>METADATA</span></div>
      
      <div class="panel-content-wrapper">
        <div class="panel-tabs">
          <button class="tab-btn" [class.active]="currentTab() === 'clip'" (click)="setTab('clip')">
            <span class="material-symbols-outlined">movie</span>
            Clip
          </button>
          <button class="tab-btn" [class.active]="currentTab() === 'segment'" (click)="setTab('segment')">
            <span class="material-symbols-outlined">segment</span>
            Segments
          </button>
        </div>

        <div class="panel-header">
          @if (currentTab() === 'segment') {
            @if (segment(); as res) {
              <span class="range-badge">
                 {{ formatSecs(res.segment.startTime) }} &ndash; {{ formatSecs(res.segment.endTime) }}
              </span>
            } @else {
              <span class="range-badge range-empty">NO SELECTION</span>
            }
          } @else {
            <span class="range-badge clip-badge">{{ (activeClip()).name }}</span>
          }
        </div>

      @if (currentTab() === 'segment' && !segment()) {
        <div class="panel-empty">
          <span class="material-symbols-outlined large-icon">segment</span>
          <p>Select a segment in the transcript to manage its metadata.</p>
        </div>
      } @else {
        <div class="panel-content">
          @if (showAddForm()) {
            <app-metadata-add-form 
              [allowTrails]="currentTab() === 'clip'"
              (submitted)="onAdd($event)" 
              (cancelled)="showAddForm.set(false)" 
            />
          } @else {
            <button type="button" class="add-meta-btn" (click)="showAddForm.set(true)">
              <span class="material-symbols-outlined">add</span>
              Add {{ currentTab() === 'clip' ? 'Clip' : 'Segment' }} Metadata
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
                <p>No metadata entries found.</p>
              </div>
            }
          }
        </div>
      }
      </div>
    </div>
  `,
  styleUrl: './segment-metadata-panel.component.scss',
})
export class SegmentMetadataPanelComponent {
  readonly segmentId = input<string | null>(null);
  readonly clips = input<Clip[]>([]);

  private readonly clipService = inject(ClipService);

  protected readonly currentTab = signal<'clip' | 'segment'>('segment');
  protected readonly showAddForm = signal(false);
  protected readonly collapsedSections = signal<Set<string>>(new Set());

  // Automatically switch to 'segment' tab if a segment is selected
  private readonly autoSwitchTab = effect(() => {
    if (this.segmentId()) {
      this.currentTab.set('segment');
    } else {
      this.currentTab.set('clip');
    }
  }, { allowSignalWrites: true });

  protected readonly activeClip = computed(() => {
    return this.clips()[0] || null;
  });

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
    const isClip = this.currentTab() === 'clip';
    let metadata: Record<string, MetadataEntry[]> = {};
    
    if (isClip) {
      metadata = this.activeClip()?.metadata ?? {};
    } else {
      const res = this.segment();
      if (!res) return [];
      metadata = res.segment.metadata ?? {};
    }

    const groupedMap: Map<string, Array<{ entry: MetadataEntry; sourcePluginId: string }>> = new Map();
    
    for (const [sourceId, entries] of Object.entries(metadata)) {
      for (const entry of entries) {
        if (!groupedMap.has(entry.type)) groupedMap.set(entry.type, []);
        groupedMap.get(entry.type)!.push({ entry, sourcePluginId: sourceId });
      }
    }
    
    return Array.from(groupedMap.entries()).map(([type, items]) => ({ type, items }));
  });

  protected setTab(tab: 'clip' | 'segment'): void {
    this.currentTab.set(tab);
    this.showAddForm.set(false);
  }

  protected toggleSection(type: string): void {
    const set = new Set(this.collapsedSections());
    if (set.has(type)) set.delete(type);
    else set.add(type);
    this.collapsedSections.set(set);
  }

  protected onEdit(updatedEntry: MetadataEntry): void {
    const isClip = this.currentTab() === 'clip';
    const sourceId = updatedEntry.sourcePluginId;

    if (isClip) {
      const clip = this.activeClip();
      if (!clip) return;
      const currentEntries = clip.metadata?.[sourceId] ?? [];
      const updatedEntries = currentEntries.map(e => e === updatedEntry ? updatedEntry : e);
      this.clipService.updateClipMetadata(clip.projectId, clip.id, sourceId, updatedEntries);
    } else {
      const res = this.segment();
      if (!res) return;
      const { segment, clipId, projectId } = res;
      const currentEntries = segment.metadata?.[sourceId] ?? [];
      const updatedEntries = currentEntries.map(e => e === updatedEntry ? updatedEntry : e);
      this.clipService.updateSegmentMetadata(projectId, clipId, segment.id, sourceId, updatedEntries);
    }
  }

  protected onDelete(entryToDelete: MetadataEntry): void {
    const isClip = this.currentTab() === 'clip';
    const sourceId = entryToDelete.sourcePluginId;

    if (isClip) {
      const clip = this.activeClip();
      if (!clip) return;
      const currentEntries = clip.metadata?.[sourceId] ?? [];
      const updatedEntries = currentEntries.filter(e => e !== entryToDelete);
      this.clipService.updateClipMetadata(clip.projectId, clip.id, sourceId, updatedEntries);
    } else {
      const res = this.segment();
      if (!res) return;
      const { segment, clipId, projectId } = res;
      const currentEntries = segment.metadata?.[sourceId] ?? [];
      const updatedEntries = currentEntries.filter(e => e !== entryToDelete);
      this.clipService.updateSegmentMetadata(projectId, clipId, segment.id, sourceId, updatedEntries);
    }
  }

  protected onAdd(newEntry: MetadataEntry): void {
    const isClip = this.currentTab() === 'clip';

    if (isClip) {
      const clip = this.activeClip();
      if (!clip) return;
      const currentUserEntries = clip.metadata?.['user'] ?? [];
      this.clipService.updateClipMetadata(
        clip.projectId, clip.id, 'user', [...currentUserEntries, newEntry]
      );
    } else {
      const res = this.segment();
      if (!res) return;
      const { segment, clipId, projectId } = res;
      const currentUserEntries = segment.metadata?.['user'] ?? [];
      this.clipService.updateSegmentMetadata(
        projectId, clipId, segment.id, 'user', [...currentUserEntries, newEntry]
      );
    }
    
    this.showAddForm.set(false);
  }

  protected formatSecs(s: number): string {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}
