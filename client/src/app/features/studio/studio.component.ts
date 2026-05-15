import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  effect,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { ClipService } from '../../core/services/clip.service';
import { ProjectService } from '../../core/services/project.service';
import { SseService } from '../../core/services/sse.service';
import { ClipListComponent } from './clip-list/clip-list.component';
import { TxtMediaPlayerV2Component } from './txt-media-player-v2/txt-media-player-v2.component';
import { ExportPanelComponent } from './export-panel/export-panel.component';
import { StoryReviewPanelComponent } from './story-review-panel/story-review-panel.component';
import { PluginPanelComponent } from './plugin-panel/plugin-panel.component';
import { VisionPanelComponent } from './vision-panel/vision-panel.component';
import { StoryApiService } from './story-review-panel/story-api.service';
import { Clip } from '../../core/models/clip.model';
import { StoryEvent, StoryProposal } from '../../core/models/story-proposal.model';
import { SettingsService } from '../../core/services/settings.service';
import { NotebookService } from '../../core/services/notebook.service';
import { NotebookTabsComponent } from './notebook-tabs/notebook-tabs.component';
import { NotificationsPanelComponent } from './notifications-panel/notifications-panel.component';
import { NotificationService } from '../../core/services/notification.service';
import { DetectedObject, TrackedRange } from '../../core/models/vision.model';
import { SuggestionsPanelComponent } from './suggestions-panel/suggestions-panel.component';
import { MediaPlayerService } from './txt-media-player/media-player.service';

@Component({
  selector: 'app-studio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:mousemove)': 'onMouseMove($event)',
    '(window:mouseup)': 'onMouseUp()',
  },
  imports: [
    CommonModule,
    RouterLink,
    ClipListComponent,
    TxtMediaPlayerV2Component,
    ExportPanelComponent,
    StoryReviewPanelComponent,
    PluginPanelComponent,
    VisionPanelComponent,
    NotebookTabsComponent,
    NotificationsPanelComponent,
    SuggestionsPanelComponent,
  ],
  template: `
    <div class="studio-layout">
      <header class="studio-header">
        <div class="logo">
          <span class="logo-icon">✦</span>
          <span class="logo-text">VTextStudio</span>
        </div>
        <button class="sidebar-toggle" (click)="toggleSidebar()" aria-label="Toggle clip sidebar">☰</button>
        <h1 class="project-name">{{ (projectService.project()?.name) ?? 'Untitled Project' }}</h1>
        <nav class="studio-nav">
          <a routerLink="/" class="nav-link">← New Project</a>
          <button
            class="export-toggle-btn"
            [class.active]="showPluginsPanel()"
            (click)="showPluginsPanel.update(v => !v)"
            title="Toggle Plugin Panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>
            <span>Plugins</span>
          </button>
          <button
            class="export-toggle-btn"
            [class.active]="showExportPanel()"
            (click)="showExportPanel.update(v => !v)"
            title="Toggle Export Panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            <span>Export</span>
          </button>
          <button
            class="export-toggle-btn"
            type="button"
            [class.active]="showNotificationsPanel()"
            (click)="showNotificationsPanel.update(v => !v)"
            title="Toggle Notifications Panel"
            [attr.aria-label]="'Toggle notifications panel, ' + notifications.history().length + ' notifications'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span>Notifications</span>
            @if (notifications.history().length > 0) {
              <span class="notif-badge" aria-hidden="true">{{ notifications.history().length }}</span>
            }
          </button>
          <button
            class="export-toggle-btn"
            type="button"
            [class.active]="showSuggestionsPanel()"
            (click)="showSuggestionsPanel.update(v => !v)"
            title="Toggle Suggestions Panel"
            aria-label="Toggle cut suggestions panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <span>Suggest</span>
          </button>

        </nav>
      </header>

      <app-notebook-tabs />

      @if (pendingProposal()) {
        <div class="proposal-banner" role="alert">
          <span>A story reconstruction is ready for your review.</span>
          <button class="banner-btn" (click)="openReviewPanel()">Review Story</button>
          <button class="banner-dismiss" (click)="pendingProposal.set(null)" aria-label="Dismiss banner">×</button>
        </div>
      }

      <main class="studio-body" [class.rtl-layout]="isRtl()" [class.resizing]="isResizing()">
        
        <!-- Sidebar: Clips (Order 1 in LTR, 3 in RTL) -->
        <aside class="side-panel-wrapper clips-wrapper" 
          [class.opened]="isSidebarOpen()"
          [style.order]="isRtl() ? 5 : 1"
          [style.width.px]="isSidebarOpen() ? leftSidebarWidth() : 36">
          <div class="side-label" (click)="toggleSidebar()"><span>CLIPS</span></div>
          <div class="panel-content">
            @if (isLoadingClips()) {
              <div class="clip-loading">Loading...</div>
            } @else {
              <app-clip-list
                [clips]="clipService.clips()"
                [activeClipId]="activeClipId()"
                (clipSelected)="selectClip($event)"
              />
            }
          </div>
        </aside>

        <!-- Left Resizer (Clips) -->
        @if (isSidebarOpen()) {
          <div 
            class="resizer clips-resizer" 
            [style.order]="isRtl() ? 6 : 2"
            (mousedown)="startResizing('left', $event)"
          ></div>
        }

        <!-- Notifications Panel (To the right of clips) -->
        <aside
          class="side-panel-wrapper notif-wrapper"
          [class.opened]="showNotificationsPanel()"
          [style.order]="isRtl() ? 4 : 2.3"
          [style.width.px]="showNotificationsPanel() ? notifPanelWidth() : 0"
          aria-label="Notifications"
        >
          <div class="panel-content">
            <app-notifications-panel
              (close)="showNotificationsPanel.set(false)"
            />
          </div>
        </aside>

        <!-- Notifications Panel Resizer -->
        @if (showNotificationsPanel()) {
          <div
            class="resizer notif-resizer"
            [style.order]="isRtl() ? 4.5 : 2.7"
            (mousedown)="startResizing('notifications', $event)"
          ></div>
        }

        <!-- Player Panel (Order 2 in LTR, 5 in RTL) -->
        <section class="player-panel" [style.order]="isRtl() ? 7 : 3">
          @if (activeClip()) {
            <app-txt-media-player-v2
              [clip]="activeClip()!"
              [isRtl]="isRtl()"
              [visionObjects]="visionObjects()"
              [visionTrackedRange]="visionTrackedRange()"
              [visionPanelVisible]="showVisionPanel()"
              (toggleVision)="showVisionPanel.update(v => !v)"
              (currentTimeChange)="playerCurrentTime.set($event)"
            />
          } @else {
            <div class="empty-player">
              <p>Select a clip from the list to start editing</p>
            </div>
          }
        </section>

        <!-- Export Panel Resizer -->
        @if (showExportPanel()) {
          <div
            class="resizer export-resizer"
            [style.order]="isRtl() ? 2 : 4"
            (mousedown)="startResizing('right', $event)"
          ></div>
        }

        <!-- Export Panel (Order 5 in LTR, 1 in RTL) -->
        @if (projectService.project(); as proj) {
          <aside class="side-panel-wrapper export-wrapper"
            [class.opened]="showExportPanel()"
            [style.order]="isRtl() ? 1 : 5"
            [style.width.px]="showExportPanel() ? rightSidebarWidth() : 0">
            <div class="panel-content">
              <app-export-panel
                [projectId]="proj.id"
                [activeClipId]="activeClipId()"
                [availableClips]="clipService.clips()"
                (close)="showExportPanel.set(false)"
              />
            </div>
          </aside>
        }

        <!-- Plugin Panel Resizer -->
        @if (showPluginsPanel()) {
          <div
            class="resizer plugin-resizer"
            [style.order]="isRtl() ? 4 : 6"
            (mousedown)="startResizing('plugin', $event)"
          ></div>
        }

        <!-- Plugin Panel (Order 7 in LTR, 3 in RTL) -->
        @if (projectService.project(); as proj) {
          <aside class="side-panel-wrapper plugin-wrapper"
            [class.opened]="showPluginsPanel()"
            [style.order]="isRtl() ? 3 : 7"
            [style.width.px]="showPluginsPanel() ? pluginsPanelWidth() : 0">
            <div class="panel-content">
              <app-plugin-panel
                [projectId]="proj.id"
                (close)="showPluginsPanel.set(false)"
                (outputPanelOpen)="pluginsPanelWidth.set($event ? 750 : 400)"
              />
            </div>
          </aside>
        }

        <!-- Vision Panel Resizer (Order 7.5 in LTR, 2.5 in RTL) -->
        @if (showVisionPanel()) {
          <div
            class="resizer vision-resizer"
            [style.order]="isRtl() ? 2.5 : 7.5"
            (mousedown)="startResizing('vision', $event)"
          ></div>
        }

        <!-- Vision Panel (Order 8 in LTR, 2 in RTL) -->
        @if (showVisionPanel() && projectService.project(); as proj) {
          <aside class="side-panel-wrapper vision-wrapper opened"
            [style.order]="isRtl() ? 2 : 8"
            [style.width.px]="visionPanelWidth()">
            <app-vision-panel
              [projectId]="proj.id"
              [clipId]="activeClipId()!"
              [mediaPath]="proj.mediaPath"
              [currentTime]="playerCurrentTime()"
              (objectsChange)="onVisionObjectsChange($event)"
              (trackedRangeChange)="onVisionTrackedRangeChange($event)"
            />
          </aside>
        }

        <!-- Suggestions Panel Resizer -->
        @if (showSuggestionsPanel()) {
          <div
            class="resizer suggestions-resizer"
            [style.order]="isRtl() ? 1.5 : 8.5"
            (mousedown)="startResizing('suggestions', $event)"
          ></div>
        }

        <!-- Suggestions Panel -->
        @if (showSuggestionsPanel()) {
          <aside class="side-panel-wrapper suggestions-wrapper opened"
            [style.order]="isRtl() ? 1 : 9"
            [style.width.px]="suggestionsPanelWidth()">
            <app-suggestions-panel
              [clipId]="activeClipId()"
              (focusSuggestion)="onFocusSuggestion($event)"
            />
          </aside>
        }

        @if (showReviewPanel() && pendingProposal()) {
          <aside class="review-panel-wrapper">
            <app-story-review-panel
              [proposal]="pendingProposal()!"
              [segmentTexts]="segmentTexts()"
              (commit)="onCommit($event)"
              (discard)="onDiscard()"
            />
          </aside>
        }


      </main>
    </div>
  `,
  styles: [`
    .studio-layout {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--color-bg);
      overflow: hidden;
    }
    .studio-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: .6rem 1.25rem;
      border-bottom: 1px solid var(--color-border);
      background: var(--color-surface);
      flex-shrink: 0;
    }
    .logo { display: flex; align-items: center; gap: .4rem; }
    .logo-icon { color: var(--color-accent); font-size: 1.1rem; }
    .logo-text { font-weight: 700; font-size: 1rem; }
    .project-name { flex: 1; font-size: .95rem; color: var(--color-text-secondary); margin: 0; font-weight: 400; }
    .studio-nav { display: flex; gap: .75rem; }
    .sidebar-toggle {
      display: none;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-bg);
      color: var(--color-text);
      cursor: pointer;
      font-size: .95rem;
      line-height: 1;
      padding: .28rem .42rem;
    }
    .nav-link { color: var(--color-muted); font-size: .8rem; text-decoration: none; padding: .3rem .5rem; &:hover { color: var(--color-text); } }
    .export-toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: .4rem;
      background: var(--color-surface-alt);
      color: var(--color-text-secondary);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: .3rem .75rem;
      font-size: .8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all .2s ease;
      svg { opacity: .7; }
      &:hover {
        background: var(--color-border);
        color: var(--color-text);
        svg { opacity: 1; }
      }
      &.active {
        background: var(--color-accent-subtle);
        color: var(--color-accent);
        border-color: var(--color-accent);
        svg { opacity: 1; color: var(--color-accent); }
      }
    }
    .notif-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 8px;
      background: var(--color-error);
      color: #fff;
      font-size: .6rem;
      font-weight: 700;
      line-height: 1;
    }
    .studio-body {
      display: flex;
      flex: 1;
      overflow: hidden;
      position: relative;
    }
    
    .side-panel-wrapper {
      /* Shared sidebar logic - can also rely on styles.scss but adding specific overrides here if needed */
      width: 36px;
      overflow: hidden;
      transition: width .3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-shrink: 0;

      &.clips-wrapper.opened { width: 320px; }
      &.export-wrapper {
        width: 0;
        border-right: none;
        border-left: 1px solid var(--color-border);
        &.opened { width: 400px; }
      }
      &.plugin-wrapper {
        width: 0;
        border-right: none;
        border-left: 1px solid var(--color-border);
        &.opened { width: 400px; }
      }
      &.notif-wrapper {
        width: 0;
        border-left: none;
        border-right: 1px solid var(--color-border);
        &.opened { width: 320px; }
      }
      .panel-content {
        /* Matching the premium scrollbar from transcript */
        &::-webkit-scrollbar { width: 4px; }
        &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
      }
      &.suggestions-wrapper {
        border-left: 1px solid var(--color-border);
      }
    }

    .rtl-layout {
      flex-direction: row-reverse;
      
      .side-panel-wrapper {
        flex-direction: row; /* Label on inner edge? User wants label to be toggle. */
        /* If panels are on the right, label should be on the LEFT of content to be accessible from player */
        /* But user said "first only ny buton click" and "use vertical title to expand/collapse" */
      }
    }

    .player-panel {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .clip-loading {
      padding: 1rem;
      color: var(--color-muted);
      font-size: .85rem;
    }

    .empty-player {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-muted);
      font-size: .9rem;
    }

    @media (max-width: 1024px) {
      .sidebar-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
    }
    .proposal-banner {
      display: flex;
      align-items: center;
      gap: .75rem;
      padding: .5rem 1.25rem;
      background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
      border-bottom: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
      font-size: .85rem;
    }
    .banner-btn {
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: .25rem .7rem;
      cursor: pointer;
      font-size: .82rem;
    }
    .banner-dismiss {
      margin-left: auto;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-muted);
      font-size: 1rem;
    }
    .review-panel-wrapper {
      flex-shrink: 0;
      overflow-y: auto;
      border-left: 1px solid var(--color-border);
    }
    .notes-wrapper {
      width: 300px;
      flex-shrink: 0;
      border-left: 1px solid var(--color-border);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
  `]
})
export class StudioComponent implements OnInit {
  readonly activeClipId = signal<string | null>(null);
  readonly activeClip = computed(() =>
    this.clipService.clips().find((c) => c.id === this.activeClipId()) ?? null
  );
  readonly isSidebarOpen = signal(true);
  readonly isLoadingClips = signal(true);
  readonly pendingProposal = signal<StoryProposal | null>(null);
  readonly showReviewPanel = signal(false);
  readonly showExportPanel = signal(false);
  readonly showPluginsPanel = signal(false);
  readonly showVisionPanel = signal(false);
  readonly showNotificationsPanel = signal(false);
  readonly notifications = inject(NotificationService);

  readonly visionObjects = signal<DetectedObject[]>([]);
  readonly visionTrackedRange = signal<TrackedRange | null>(null);

  onVisionObjectsChange(objects: DetectedObject[]): void {
    this.visionObjects.set(objects);
  }

  onVisionTrackedRangeChange(range: TrackedRange | null): void {
    this.visionTrackedRange.set(range);
  }

  onFocusSuggestion(wordId: string): void {
    const clip = this.activeClip();
    if (!clip) return;
    for (const seg of clip.segments) {
      const word = seg.words.find((w) => w.id === wordId);
      if (word) {
        this.mediaPlayer.seek(word.startTime);
        return;
      }
    }
  }

  readonly pluginsPanelWidth = signal(400);
  readonly notifPanelWidth = signal(320);
  readonly visionPanelWidth = signal(240);
  readonly showSuggestionsPanel = signal(false);
  readonly suggestionsPanelWidth = signal(280);
  readonly playerCurrentTime = signal(0);

  // Resizing signals
  readonly leftSidebarWidth = signal(320);
  readonly rightSidebarWidth = signal(400);
  readonly isResizing = signal(false);
  private isResizingLeft = false;
  private isResizingRight = false;
  private isResizingPlugin = false;
  private isResizingNotif = false;
  private isResizingVision = false;
  private isResizingSuggestions = false;
  private startX = 0;
  private startWidth = 0;

  readonly isRtl = computed(() => {
    // Use URL search params for robustness
    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('lang');
    if (langParam === 'he' || langParam === 'ar') return true;

    // Check project setting
    const projLang = this.projectService.project()?.language;
    if (projLang === 'he' || projLang === 'ar') return true;

    // Fallback to active clip detection
    const active = this.activeClip();
    if (!active || !active.segments.length) return false;
    return active.segments.slice(0, 3).some(seg => 
      /[\u0590-\u05FF\u0600-\u06FF]/.test(seg.text || '')
    );
  });

  private dialog = inject(Dialog);
  private storyApi = inject(StoryApiService);
  private readonly mediaPlayer = inject(MediaPlayerService);
  readonly notebookService = inject(NotebookService);



  readonly segmentTexts = computed((): Record<string, string | undefined> => {
    const texts: Record<string, string | undefined> = {};
    for (const clip of this.clipService.clips()) {
      for (const seg of clip.segments) {
        // Key by compound "clipId:segId" so segments stay distinguishable
        // even when multiple clips share the same segment UUID.
        texts[`${clip.id}:${seg.id}`] = seg.text;
      }
    }
    return texts;
  });

  constructor(
    readonly clipService: ClipService,
    readonly projectService: ProjectService,
    private sseService: SseService,
    private settingsService: SettingsService,
  ) {
    effect(() => {
      const ev = this.sseService.lastEvent();
      if (!ev) return;
      if (ev.type === 'vision:complete' || ev.type === 'vision:error') {
        // Vision events reach studio via SseService broadcast for future consumer use
      }
    });

    effect(() => {
      const ev = this.notebookService.noteJumpEvent();
      if (!ev) return;
      const note = ev.note;
      // Use untracked so changes to clips or activeClipId don't re-trigger this effect
      // and override manual clip selections made after the note jump.
      const clips = untracked(() => this.clipService.clips());
      let targetClipId: string | null = null;

      if (note.attachedToType === 'clip') {
        targetClipId = note.attachedToId;
      } else if (note.attachedToType === 'segment') {
        for (const clip of clips) {
          if (clip.segments.some(s => s.id === note.attachedToId)) {
            targetClipId = clip.id;
            break;
          }
        }
      } else if (note.attachedToType === 'word') {
        for (const clip of clips) {
          for (const seg of clip.segments) {
            if (seg.words.some(w => w.id === note.attachedToId)) {
              targetClipId = clip.id;
              break;
            }
          }
          if (targetClipId) break;
        }
      }

      if (targetClipId && untracked(() => this.activeClipId()) !== targetClipId) {
        this.activeClipId.set(targetClipId);
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    this.sseService.connect();
    // Load settings first so defaultEditMode signal is populated before clips render
    this.settingsService.load().subscribe({ error: () => {} });
    this.projectService.load().subscribe({
      next: (project) => {
        this.checkForProposal(project?.id);
        if (project?.id) {
          this.notebookService.loadAll(project.id).subscribe({
            next: () => {
              if (this.notebookService.notebooks().length === 0) {
                this.notebookService.create('Default', project.id).subscribe();
              }
            },
          });
        }
      },
    });
    this.clipService.loadAll().subscribe({
      next: (clips) => {
        if (clips.length) {
          const firstClipId = clips[0]?.id ?? null;
          this.activeClipId.set(firstClipId);
          if (firstClipId) {
            this.notebookService.selectEntity('clip', firstClipId);
          }
        }
      },
      complete: () => this.isLoadingClips.set(false),
      error: () => this.isLoadingClips.set(false),
    });
  }

  private checkForProposal(projectId: string | undefined): void {
    if (!projectId) return;
    this.storyApi.getProposal(projectId).subscribe({
      next: (proposal) => this.pendingProposal.set(proposal),
      error: () => { /* 404 = no proposal, ignore */ },
    });
  }

  startResizing(side: 'left' | 'right' | 'plugin' | 'notifications' | 'vision' | 'suggestions', event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing.set(true);
    this.startX = event.clientX;

    if (side === 'left') {
      this.isResizingLeft = true;
      this.startWidth = this.leftSidebarWidth();
    } else if (side === 'right') {
      this.isResizingRight = true;
      this.startWidth = this.rightSidebarWidth();
    } else if (side === 'plugin') {
      this.isResizingPlugin = true;
      this.startWidth = this.pluginsPanelWidth();
    } else if (side === 'vision') {
      this.isResizingVision = true;
      this.startWidth = this.visionPanelWidth();
    } else if (side === 'suggestions') {
      this.isResizingSuggestions = true;
      this.startWidth = this.suggestionsPanelWidth();
    } else {
      this.isResizingNotif = true;
      this.startWidth = this.notifPanelWidth();
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  onMouseMove(event: MouseEvent): void {
    if (!this.isResizingLeft && !this.isResizingRight && !this.isResizingPlugin && !this.isResizingNotif && !this.isResizingVision && !this.isResizingSuggestions) return;

    const delta = event.clientX - this.startX;

    if (this.isResizingLeft) {
      // Clips Panel
      if (this.isRtl()) {
        const newWidth = this.startWidth - delta;
        this.leftSidebarWidth.set(Math.max(200, Math.min(newWidth, 800)));
      } else {
        const newWidth = this.startWidth + delta;
        this.leftSidebarWidth.set(Math.max(200, Math.min(newWidth, 800)));
      }
    } else if (this.isResizingRight) {
      // Export Panel
      if (this.isRtl()) {
        const newWidth = this.startWidth - delta;
        this.rightSidebarWidth.set(Math.max(300, Math.min(newWidth, 800)));
      } else {
        const newWidth = this.startWidth - delta;
        this.rightSidebarWidth.set(Math.max(300, Math.min(newWidth, 800)));
      }
    } else if (this.isResizingPlugin) {
      // Plugin Panel: resizer is left of panel in both LTR and RTL layouts.
      // Drag left (delta < 0) → panel grows; drag right (delta > 0) → panel shrinks.
      const newWidth = this.startWidth - delta;
      this.pluginsPanelWidth.set(Math.max(400, Math.min(newWidth, 1000)));
    } else if (this.isResizingNotif) {
      // Notif Panel: now to the right of clips (resizer is on the right edge of panel in LTR)
      if (this.isRtl()) {
        const newWidth = this.startWidth - delta;
        this.notifPanelWidth.set(Math.max(280, Math.min(newWidth, 600)));
      } else {
        const newWidth = this.startWidth + delta;
        this.notifPanelWidth.set(Math.max(280, Math.min(newWidth, 600)));
      }
    } else if (this.isResizingVision) {
      // Vision Panel: resizer is left of panel — drag left grows, drag right shrinks
      const newWidth = this.startWidth - delta;
      this.visionPanelWidth.set(Math.max(200, Math.min(newWidth, 600)));
    } else if (this.isResizingSuggestions) {
      const newWidth = this.startWidth - delta;
      this.suggestionsPanelWidth.set(Math.max(240, Math.min(newWidth, 600)));
    }
  }

  onMouseUp(): void {
    if (this.isResizingLeft || this.isResizingRight || this.isResizingPlugin || this.isResizingNotif || this.isResizingVision || this.isResizingSuggestions) {
      this.isResizingLeft = false;
      this.isResizingRight = false;
      this.isResizingPlugin = false;
      this.isResizingNotif = false;
      this.isResizingVision = false;
      this.isResizingSuggestions = false;
      this.isResizing.set(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }

  openReviewPanel(): void {
    this.showReviewPanel.set(true);
  }



  onCommit(events: StoryEvent[]): void {
    const projectId = this.projectService.project()?.id;
    if (!projectId) return;
    this.storyApi.commit(projectId, events).subscribe({
      next: () => {
        this.pendingProposal.set(null);
        this.showReviewPanel.set(false);
        this.clipService.loadAll().subscribe({
          next: (clips) => {
            if (clips.length) {
              const firstClipId = clips[0]?.id ?? null;
              this.activeClipId.set(firstClipId);
              if (firstClipId) {
                this.notebookService.selectEntity('clip', firstClipId);
              }
            }
          },
        });
      },
    });
  }

  onDiscard(): void {
    const projectId = this.projectService.project()?.id;
    if (!projectId) return;
    this.storyApi.discard(projectId).subscribe({
      next: () => {
        this.pendingProposal.set(null);
        this.showReviewPanel.set(false);
      },
    });
  }

  selectClip(clip: Clip): void {
    this.activeClipId.set(clip?.id ?? null);
    if (clip) {
      this.notebookService.selectEntity('clip', clip.id);
    }
  }

  toggleSidebar(): void {
    this.isSidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }
}
