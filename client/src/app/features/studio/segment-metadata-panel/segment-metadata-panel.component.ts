import { Component, ChangeDetectionStrategy, input, output, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Clip } from '../../../core/models/clip.model';
import { MetadataEntry } from '../../../core/models/segment-metadata.model';
import { ClipService } from '../../../core/services/clip.service';
import { SmartCutQueueService } from '../txt-media-player/smart-cut-queue.service';
import type { SceneType } from '../../../core/models/clip.model';
import { MetadataEntryComponent } from './metadata-entry.component';
import { MetadataAddFormComponent } from './metadata-add-form.component';
import { NotesPanelComponent } from '../notes-panel/notes-panel.component';

@Component({
  selector: 'app-segment-metadata-panel',
  standalone: true,
  imports: [CommonModule, MetadataEntryComponent, MetadataAddFormComponent, NotesPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel-container">
      <div class="panel-content-wrapper">

      @if (activeTab() === 'notes') {
        <div class="panel-content notes-tab-content">
          <app-notes-panel />
        </div>
      } @else if (activeTab() === 'segment' && !segment()) {
        <div class="panel-empty">
          <span class="material-symbols-outlined large-icon">segment</span>
          <p>Select a segment in the transcript to manage its metadata.</p>
        </div>
      } @else {
        <div class="panel-content">
          @if (showAddForm()) {
            <app-metadata-add-form
              [allowTrails]="activeTab() === 'clip'"
              (submitted)="onAdd($event)"
              (cancelled)="showAddForm.set(false)"
            />
          } @else {
            <button type="button" class="add-meta-btn" (click)="showAddForm.set(true)">
              <span class="material-symbols-outlined">add</span>
              Add {{ activeTab() === 'clip' ? 'Clip' : 'Segment' }} Metadata
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
  private readonly queue = inject(SmartCutQueueService);

  readonly activeTab = input<'clip' | 'segment' | 'notes'>('segment');
  readonly tabChange = output<'clip' | 'segment' | 'notes'>();

  protected readonly showAddForm = signal(false);
  protected readonly collapsedSections = signal<Set<string>>(new Set());

  private readonly resetFormOnTabChange = effect(() => {
    this.activeTab();
    this.showAddForm.set(false);
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
    const isClip = this.activeTab() === 'clip';
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

  protected setTab(tab: 'clip' | 'segment' | 'notes'): void {
    this.tabChange.emit(tab);
    this.showAddForm.set(false);
  }

  protected toggleSection(type: string): void {
    const set = new Set(this.collapsedSections());
    if (set.has(type)) set.delete(type);
    else set.add(type);
    this.collapsedSections.set(set);
  }

  protected onEdit(updatedEntry: MetadataEntry): void {
    const isClip = this.activeTab() === 'clip';
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
    const isClip = this.activeTab() === 'clip';
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
    const isClip = this.activeTab() === 'clip';

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

  protected onSceneTypeChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const sceneType = select.value as SceneType;
    const clip = this.activeClip();
    if (!clip) return;

    this.clipService.updateSceneType(clip.id, sceneType);
    this.queue.invalidateClip(clip.id, clip.cutRegions.map(r => r.id));
    clip.cutRegions.forEach(r => this.queue.enqueue(r, { ...clip, sceneType }));
  }
}
