import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { Segment } from '../../../core/models/segment.model';
import { ClipService } from '../../../core/services/clip.service';

interface WordState {
  word: Word;
  segId: string;
  highlighted: boolean;
}

@Component({
  selector: 'app-txt-media-player',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="txt-player">
      <!-- Media element (hidden for audio-only) -->
      <div class="media-area">
        @if (isVideo()) {
          <video
            #mediaEl
            class="video-el"
            [src]="mediaUrl()"
            preload="metadata"
            (timeupdate)="onTimeUpdate()"
            (loadedmetadata)="onLoaded()"
            (ended)="playing.set(false)"
          ></video>
        } @else {
          <audio
            #mediaEl
            [src]="mediaUrl()"
            preload="metadata"
            (timeupdate)="onTimeUpdate()"
            (loadedmetadata)="onLoaded()"
            (ended)="playing.set(false)"
          ></audio>
          <div class="audio-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"/>
            </svg>
            <span>Audio</span>
          </div>
        }
      </div>

      <!-- Transport controls -->
      <div class="controls">
        <button class="ctrl-btn" (click)="togglePlay()" [title]="playing() ? 'Pause' : 'Play'">
          @if (playing()) {
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>
          } @else {
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>
          }
        </button>
        <span class="time-display">{{ formatTime(currentTime()) }} / {{ formatTime(duration()) }}</span>
        <div class="progress-bar" (click)="seek($event)">
          <div class="progress-fill" [style.width.%]="progress()"></div>
        </div>
        <span class="jump-cut-badge" [class.active]="jumpCutMode()">Jump&nbsp;Cut</span>
        <button class="ctrl-btn" (click)="jumpCutMode.set(!jumpCutMode())" title="Toggle Jump-Cut Preview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
            <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/>
          </svg>
        </button>
      </div>

      <!-- Transcript -->
      <div class="transcript" #transcriptEl>
        @for (seg of clip().segments; track seg.id) {
          <div class="segment" [class.jump-cut-hidden]="isSegmentRemoved(seg)">
            <div class="seg-words">
              @for (word of seg.words; track word.id) {
                <span
                  class="word"
                  [class.highlighted]="isHighlighted(word)"
                  [class.removed]="word.isRemoved"
                  [class.jump-cut-hidden]="jumpCutMode() && word.isRemoved"
                  (click)="seekToWord(word)"
                  (dblclick)="toggleRemove(word)"
                  [title]="word.isRemoved ? 'Double-click to restore' : 'Double-click to mark removed'"
                >{{ word.text }}</span>
              }
            </div>
          </div>
        }
      </div>

      <!-- Action bar -->
      <div class="action-bar">
        <span class="removed-count">{{ removedCount() }} words removed</span>
        <button class="btn-secondary" (click)="restoreAll()">Restore All</button>
      </div>
    </div>
  `,
  styles: [`
    .txt-player {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-bg);
    }

    /* Media area */
    .media-area {
      position: relative;
      background: #000;
      flex-shrink: 0;
    }
    .video-el {
      width: 100%;
      max-height: 260px;
      display: block;
      object-fit: contain;
    }
    .audio-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100px;
      color: var(--color-muted);
      gap: .5rem;
      font-size: .8rem;
    }
    audio { display: none; }

    /* Controls */
    .controls {
      display: flex;
      align-items: center;
      gap: .6rem;
      padding: .5rem .75rem;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .ctrl-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--color-text);
      display: flex;
      align-items: center;
      padding: .2rem;
      border-radius: 4px;
      &:hover { background: var(--color-border); }
    }
    .time-display { font-size: .75rem; color: var(--color-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .progress-bar {
      flex: 1;
      height: 4px;
      background: var(--color-border);
      border-radius: 2px;
      cursor: pointer;
      position: relative;
    }
    .progress-fill { height: 100%; background: var(--color-accent); border-radius: 2px; pointer-events: none; }
    .jump-cut-badge {
      font-size: .65rem;
      padding: .15rem .45rem;
      border-radius: 999px;
      background: var(--color-border);
      color: var(--color-muted);
      &.active { background: var(--color-accent); color: #fff; }
    }

    /* Transcript */
    .transcript {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: .75rem;
    }
    .segment {
      &.jump-cut-hidden { display: none; }
    }
    .seg-words {
      display: flex;
      flex-wrap: wrap;
      gap: .15rem .2rem;
      line-height: 1.8;
    }
    .word {
      cursor: pointer;
      padding: .1rem .2rem;
      border-radius: 3px;
      font-size: .9rem;
      transition: background .1s;
      user-select: none;

      &:hover { background: var(--color-surface-alt); }
      &.highlighted {
        background: var(--color-accent);
        color: #fff;
        border-radius: 3px;
      }
      &.removed {
        text-decoration: line-through;
        color: var(--color-muted);
        opacity: .5;
      }
      &.jump-cut-hidden { display: none; }
    }

    /* Action bar */
    .action-bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: .75rem;
      padding: .6rem 1rem;
      border-top: 1px solid var(--color-border);
      background: var(--color-surface);
      flex-shrink: 0;
      font-size: .8rem;
    }
    .removed-count { color: var(--color-muted); }
    .btn-secondary {
      padding: .3rem .7rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: transparent;
      color: var(--color-text);
      font-size: .8rem;
      cursor: pointer;
      &:hover { border-color: var(--color-accent); color: var(--color-accent); }
    }
  `]
})
export class TxtMediaPlayerComponent implements OnInit, OnDestroy {
  @ViewChild('mediaEl') mediaElRef!: ElementRef<HTMLVideoElement | HTMLAudioElement>;
  @ViewChild('transcriptEl') transcriptElRef!: ElementRef<HTMLDivElement>;

  readonly clip = input.required<Clip>();

  readonly playing = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly jumpCutMode = signal(false);

  readonly progress = computed(() =>
    this.duration() > 0 ? (this.currentTime() / this.duration()) * 100 : 0
  );

  readonly mediaUrl = computed(() => `/api/clips/${this.clip().id}/stream`);
  readonly isVideo = computed(() => {
    // inferred from file extension in the URL: if it's audio only, show placeholder
    return true; // default to video; could derive from project mediaType
  });

  readonly removedCount = computed(() =>
    this.clip().segments.flatMap((s) => s.words).filter((w) => w.isRemoved).length
  );

  private pendingWordUpdates = new Map<string, boolean>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private clipService: ClipService) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flushWordUpdates();
  }

  get media(): HTMLVideoElement | HTMLAudioElement | null {
    return this.mediaElRef?.nativeElement ?? null;
  }

  togglePlay(): void {
    if (!this.media) return;
    if (this.playing()) {
      this.media.pause();
      this.playing.set(false);
    } else {
      // In jump-cut mode, skip removed words during playback by scheduling skips
      this.media.play().then(() => this.playing.set(true)).catch(() => {});
    }
  }

  onTimeUpdate(): void {
    if (!this.media) return;
    const t = this.media.currentTime;
    this.currentTime.set(t);

    // Jump-cut: skip over removed words
    if (this.jumpCutMode() && this.playing()) {
      this.applyJumpCut(t);
    }

    // Auto-scroll transcript to highlighted word
    this.scrollTranscriptToCurrentWord();
  }

  onLoaded(): void {
    if (this.media) this.duration.set(this.media.duration || 0);
  }

  seek(e: MouseEvent): void {
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    if (this.media) {
      this.media.currentTime = ratio * this.duration();
    }
  }

  seekToWord(word: Word): void {
    if (this.media && !word.isRemoved) {
      this.media.currentTime = word.startTime;
    }
  }

  isHighlighted(word: Word): boolean {
    const t = this.currentTime();
    return t >= word.startTime && t < word.endTime;
  }

  isSegmentRemoved(seg: Segment): boolean {
    return this.jumpCutMode() && seg.words.every((w) => w.isRemoved);
  }

  toggleRemove(word: Word): void {
    // Mutate in-place for immediate UI feedback; batch-save to server
    (word as { isRemoved: boolean }).isRemoved = !word.isRemoved;
    this.pendingWordUpdates.set(word.id, word.isRemoved);
    this.scheduleSave();
  }

  restoreAll(): void {
    for (const seg of this.clip().segments) {
      for (const w of seg.words) {
        if (w.isRemoved) {
          (w as { isRemoved: boolean }).isRemoved = false;
          this.pendingWordUpdates.set(w.id, false);
        }
      }
    }
    this.scheduleSave();
  }

  formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  private applyJumpCut(currentTime: number): void {
    // Find the next active (non-removed) word boundary after current time
    for (const seg of this.clip().segments) {
      for (const word of seg.words) {
        if (word.isRemoved && currentTime >= word.startTime && currentTime < word.endTime) {
          // Skip to end of removed word
          const nextActive = this.findNextActiveWordStart(word.endTime);
          if (this.media && nextActive !== null) {
            this.media.currentTime = nextActive;
          }
          return;
        }
      }
    }
  }

  private findNextActiveWordStart(afterTime: number): number | null {
    for (const seg of this.clip().segments) {
      for (const word of seg.words) {
        if (!word.isRemoved && word.startTime >= afterTime) return word.startTime;
      }
    }
    return null;
  }

  private scrollTranscriptToCurrentWord(): void {
    if (!this.transcriptElRef) return;
    const t = this.currentTime();
    const container = this.transcriptElRef.nativeElement;
    const highlighted = container.querySelector('.word.highlighted') as HTMLElement | null;
    if (highlighted) {
      const containerRect = container.getBoundingClientRect();
      const elRect = highlighted.getBoundingClientRect();
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        highlighted.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushWordUpdates(), 800);
  }

  private flushWordUpdates(): void {
    if (!this.pendingWordUpdates.size) return;
    const updates = Array.from(this.pendingWordUpdates.entries()).map(([id, isRemoved]) => ({ id, isRemoved }));
    this.pendingWordUpdates.clear();
    this.clipService.updateWordStates(this.clip().id, updates).subscribe({ error: console.error });
  }
}
