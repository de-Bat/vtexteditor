import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ClipService } from '../../core/services/clip.service';
import { ProjectService } from '../../core/services/project.service';
import { SseService } from '../../core/services/sse.service';
import { ClipListComponent } from './clip-list/clip-list.component';
import { TxtMediaPlayerComponent } from './txt-media-player/txt-media-player.component';
import { Clip } from '../../core/models/clip.model';

@Component({
  selector: 'app-studio',
  standalone: true,
  imports: [CommonModule, RouterLink, ClipListComponent, TxtMediaPlayerComponent],
  template: `
    <div class="studio-layout">
      <header class="studio-header">
        <div class="logo">
          <span class="logo-icon">✦</span>
          <span class="logo-text">VTextStudio</span>
        </div>
        <h1 class="project-name">{{ (projectService.project()?.name) ?? 'Untitled Project' }}</h1>
        <nav class="studio-nav">
          <a routerLink="/" class="nav-link">← New Project</a>
        </nav>
      </header>

      <main class="studio-body">
        <aside class="clip-panel">
          <app-clip-list
            [clips]="clipService.clips()"
            [activeClipId]="activeClip()?.id ?? null"
            (clipSelected)="selectClip($event)"
          />
        </aside>

        <section class="player-panel">
          @if (activeClip()) {
            <app-txt-media-player [clip]="activeClip()!" />
          } @else {
            <div class="empty-player">
              <p>Select a clip from the list to start editing</p>
            </div>
          }
        </section>
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
  `]
})
export class StudioComponent implements OnInit {
  readonly activeClip = signal<Clip | null>(null);

  constructor(
    readonly clipService: ClipService,
    readonly projectService: ProjectService,
    private sseService: SseService,
  ) {}

  ngOnInit(): void {
    this.sseService.connect();
    this.projectService.load().subscribe();
    this.clipService.loadAll().subscribe((clips) => {
      if (clips.length) this.activeClip.set(clips[0]);
    });
  }

  selectClip(clip: Clip): void {
    this.activeClip.set(clip);
  }
}
