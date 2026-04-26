import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
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
import { StoryApiService } from './story-review-panel/story-api.service';
import { Clip } from '../../core/models/clip.model';
import { StoryEvent, StoryProposal } from '../../core/models/story-proposal.model';

@Component({
  selector: 'app-studio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterLink,
    ClipListComponent,
    TxtMediaPlayerV2Component,
    ExportPanelComponent,
    StoryReviewPanelComponent,
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
            [class.active]="showMetadataPanel()"
            (click)="showMetadataPanel.update(v => !v)"
            title="Toggle Metadata Panel (M)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span>Metadata</span>
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


        </nav>
      </header>

      @if (pendingProposal()) {
        <div class="proposal-banner" role="alert">
          <span>A story reconstruction is ready for your review.</span>
          <button class="banner-btn" (click)="openReviewPanel()">Review Story</button>
          <button class="banner-dismiss" (click)="pendingProposal.set(null)" aria-label="Dismiss banner">×</button>
        </div>
      }

      <main class="studio-body" [class.rtl-layout]="isRtl()">
        
        <!-- Sidebar: Clips (Order 1 in LTR, 2 in RTL) -->
        <aside class="side-panel-wrapper clips-wrapper" 
          [class.opened]="isSidebarOpen()"
          [style.order]="isRtl() ? 2 : 1">
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

        <!-- Player Panel (Order 2 in LTR, 3 in RTL) -->
        <section class="player-panel" [style.order]="isRtl() ? 3 : 2">
          @if (activeClip()) {
            <app-txt-media-player-v2 
              [clip]="activeClip()!" 
              [isRtl]="isRtl()"
              [metadataPanelOpen]="showMetadataPanel()"
              (metadataPanelToggle)="showMetadataPanel.update(v => !v)"
            />
          } @else {
            <div class="empty-player">
              <p>Select a clip from the list to start editing</p>
            </div>
          }
        </section>

        <!-- Export Panel (Order 3 in LTR, 1 in RTL) -->
        @if (projectService.project(); as proj) {
          <aside class="side-panel-wrapper export-wrapper" 
            [class.opened]="showExportPanel()"
            [style.order]="isRtl() ? 1 : 3">
            <div class="side-label" (click)="showExportPanel.set(!showExportPanel())"><span>EXPORT</span></div>
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
        &.opened { width: 400px; }
      }
      
      .panel-content {
        /* Matching the premium scrollbar from transcript */
        &::-webkit-scrollbar { width: 4px; }
        &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
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
  readonly showMetadataPanel = signal(false);
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
  ) {}

  ngOnInit(): void {
    this.sseService.connect();
    this.projectService.load().subscribe({
      next: (project) => this.checkForProposal(project?.id),
    });
    this.clipService.loadAll().subscribe({
      next: (clips) => {
        if (clips.length) this.activeClipId.set(clips[0]?.id ?? null);
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
            if (clips.length) this.activeClipId.set(clips[0]?.id ?? null);
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
    this.closeSidebar();
  }

  toggleSidebar(): void {
    this.isSidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }
}
