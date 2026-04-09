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
        </nav>
      </header>

      @if (pendingProposal()) {
        <div class="proposal-banner" role="alert">
          <span>A story reconstruction is ready for your review.</span>
          <button class="banner-btn" (click)="openReviewPanel()">Review Story</button>
          <button class="banner-dismiss" (click)="pendingProposal.set(null)" aria-label="Dismiss banner">×</button>
        </div>
      }

      <main class="studio-body">
        <aside class="clip-panel" [class.open]="isSidebarOpen()">
          @if (isLoadingClips()) {
            <div class="clip-loading">Loading clips...</div>
          } @else {
            <app-clip-list
              [clips]="clipService.clips()"
              [activeClipId]="activeClip()?.id ?? null"
              (clipSelected)="selectClip($event)"
            />
          }
        </aside>
        <div class="clip-backdrop" [class.visible]="isSidebarOpen()" (click)="closeSidebar()"></div>

        <section class="player-panel">
          @if (activeClip()) {
            <app-txt-media-player-v2 [clip]="activeClip()!" />
          } @else {
            <div class="empty-player">
              <p>Select a clip from the list to start editing</p>
            </div>
          }
        </section>

        @if (projectService.project(); as proj) {
          <aside class="export-panel-wrapper">
            <app-export-panel [projectId]="proj.id" />
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
    .nav-link { color: var(--color-muted); font-size: .8rem; text-decoration: none; &:hover { color: var(--color-accent); } }
    .studio-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .clip-panel {
      width: 280px;
      flex-shrink: 0;
      border-right: 1px solid var(--color-border);
      overflow-y: auto;
      background: var(--color-surface);
    }
    .clip-loading {
      color: var(--color-muted);
      font-size: .85rem;
      padding: 1rem;
    }
    .clip-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
      z-index: 20;
    }
    .clip-backdrop.visible {
      display: block;
    }
    .player-panel {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .empty-player {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--color-muted);
      font-size: .9rem;
    }
    .export-panel-wrapper {
      flex-shrink: 0;
      overflow-y: auto;
    }
    @media (max-width: 1024px) {
      .sidebar-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .clip-panel {
        position: fixed;
        top: 49px;
        left: 0;
        bottom: 0;
        width: min(82vw, 320px);
        transform: translateX(-101%);
        transition: transform 180ms ease;
        z-index: 30;
      }
      .clip-panel.open {
        transform: translateX(0);
      }
      .export-panel-wrapper {
        display: none;
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
  readonly activeClip = signal<Clip | null>(null);
  readonly isSidebarOpen = signal(false);
  readonly isLoadingClips = signal(true);
  readonly pendingProposal = signal<StoryProposal | null>(null);
  readonly showReviewPanel = signal(false);

  private storyApi = inject(StoryApiService);

  readonly segmentTexts = computed(() => {
    const texts: Record<string, string> = {};
    for (const clip of this.clipService.clips()) {
      for (const seg of clip.segments) {
        texts[seg.id] = seg.text;
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
        if (clips.length) this.activeClip.set(clips[0]);
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
            if (clips.length) this.activeClip.set(clips[0]);
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
    this.activeClip.set(clip);
    this.closeSidebar();
  }

  toggleSidebar(): void {
    this.isSidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }
}
