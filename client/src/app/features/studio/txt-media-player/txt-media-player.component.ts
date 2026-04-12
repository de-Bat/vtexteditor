import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Clip } from '../../../core/models/clip.model';
import { Word } from '../../../core/models/word.model';
import { Segment } from '../../../core/models/segment.model';
import { ClipService } from '../../../core/services/clip.service';
import { ProjectService } from '../../../core/services/project.service';
import { MediaPlayerService } from './media-player.service';
import { SegmentTimelineComponent } from './segment-timeline.component';
import { EditHistoryService } from './edit-history.service';
import { KeyboardShortcutsService } from './keyboard-shortcuts.service';

interface SegmentViewportItem {
  segment: Segment;
  index: number;
  top: number;
  bottom: number;
}

@Component({
  selector: 'app-txt-media-player',
  standalone: true,
  imports: [CommonModule, SegmentTimelineComponent],
  template: `
    <div class="txt-player">
      <div class="media-area">
        @if (isVideo()) {
          <video
            #mediaEl
            class="video-el"
            [src]="mediaUrl()"
            preload="metadata"
          ></video>
        } @else {
          <audio
            #mediaEl
            [src]="mediaUrl()"
            preload="metadata"
          ></audio>
          <div class="audio-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"/>
            </svg>
            <span>Audio</span>
          </div>
        }
      </div>

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
        <label class="ctrl-inline">
          <span>Vol</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            [value]="volume()"
            (input)="setVolume($any($event.target).value)"
          />
        </label>
        <label class="ctrl-inline">
          <span>Speed</span>
          <select [value]="playbackRate()" (change)="setPlaybackRate($any($event.target).value)">
            @for (rate of playbackRates; track rate) {
              <option [value]="rate">{{ rate }}x</option>
            }
          </select>
        </label>
        <span class="jump-cut-badge" [class.active]="jumpCutMode()">Jump&nbsp;Cut</span>
        <button class="ctrl-btn" (click)="jumpCutMode.set(!jumpCutMode())" title="Toggle Jump-Cut Preview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
            <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"/>
          </svg>
        </button>
      </div>

      <div class="transcript" #transcriptEl 
        [class.drag-selecting]="isDragSelecting()"
        (scroll)="onTranscriptScroll()" 
        (click)="clearSelection($event)">
        @if (shouldVirtualizeTranscript()) {
          <div class="virtual-spacer" [style.height.px]="virtualPaddingTop()"></div>
        }
        @for (item of renderedSegmentItems(); track item.segment.id) {
          @let seg = item.segment;
          <div class="segment" [class.jump-cut-hidden]="isSegmentRemoved(seg)">
            <div class="seg-words">
              @for (word of seg.words; track word.id) {
                <span
                  class="word"
                  [class.highlighted]="isHighlighted(word)"
                  [class.removed]="word.isRemoved"
                  [class.selected]="isSelected(word.id)"
                  [class.jump-cut-hidden]="jumpCutMode() && word.isRemoved"
                  (mousedown)="onWordMouseDown(word, $event)"
                  (mouseenter)="onWordMouseEnter(word)"
                  (click)="onWordClick(word, $event)"
                  (dblclick)="toggleRemove(word)"
                  [attr.contenteditable]="editMode() ? 'plaintext-only' : 'false'"
                  spellcheck="false"
                  (blur)="onWordEdit(word, $event)"
                  (keydown.enter)="$event.preventDefault(); onWordEdit(word, $event)"
                  [title]="word.isRemoved ? 'Double-click to restore' : 'Double-click to mark removed'"
                >{{ word.text }}</span>
              }
            </div>
          </div>
        }
        @if (shouldVirtualizeTranscript()) {
          <div class="virtual-spacer" [style.height.px]="virtualPaddingBottom()"></div>
        }
      </div>

      <app-segment-timeline
        [segments]="clip().segments"
        [duration]="duration()"
        [currentTime]="currentTime()"
        (seekRequested)="onTimelineSeek($event)"
      />

      <div class="action-bar">
        <div class="footer-status">
          <span class="status-chip chip-follow" [class.active]="autoFollow()" (click)="autoFollow.set(!autoFollow())" 
            [title]="autoFollow() ? 'Auto-follow active' : 'Auto-follow paused'">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
            </svg>
          </span>
          @if (editMode()) {
            <span class="status-chip chip-edit" title="Edit mode active">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
            </span>
          }
        </div>
        <button class="btn-edit" [class.active]="editMode()" (click)="editMode.set(!editMode())" title="Toggle Edit Mode">
          {{ editMode() ? 'Exit Edit' : 'Edit Transcript' }}
        </button>
        <button class="btn-secondary" (click)="removeSelected()" [disabled]="!selectedCount() || editMode()">Remove Selected</button>
        <button class="btn-secondary" (click)="restoreSelected()" [disabled]="!selectedCount() || editMode()">Restore Selected</button>
        <span class="selected-count">{{ selectedCount() }} selected</span>
        <span class="removed-count">{{ removedCount() }} words removed</span>
        <button class="btn-secondary" (click)="restoreAll()" [disabled]="editMode()">Restore All</button>
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
    .ctrl-inline {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      font-size: .72rem;
      color: var(--color-muted);
      white-space: nowrap;
    }
    .ctrl-inline input[type='range'] { width: 86px; accent-color: var(--color-accent); }
    .ctrl-inline select {
      border: 1px solid var(--color-border);
      background: var(--color-bg);
      color: var(--color-text);
      border-radius: 6px;
      font-size: .72rem;
      padding: .1rem .35rem;
    }
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

    .transcript {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.25rem;
      display: block;

      &.drag-selecting {
        cursor: crosshair;
        user-select: none;
        .word { cursor: crosshair; }
      }
    }
    .segment {
      margin-bottom: .75rem;
      &.jump-cut-hidden { display: none; }
    }
    .virtual-spacer {
      width: 100%;
      pointer-events: none;
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

      &[contenteditable="plaintext-only"] {
        cursor: text;
        user-select: text;
      }

      &:focus {
        outline: none;
        background: var(--color-surface-alt);
      }
      
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
      &.selected {
        outline: 1px solid color-mix(in srgb, var(--color-accent) 65%, white);
        background: color-mix(in srgb, var(--color-accent) 25%, transparent);
      }
      &.jump-cut-hidden { display: none; }
    }

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

    .footer-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-right: auto;
    }

    .status-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: var(--color-border);
      color: var(--color-muted);
      cursor: default;
      transition: all 0.2s;
      
      &.chip-follow {
        cursor: pointer;
        &:hover { background: var(--color-muted); color: #fff; }
        &.active { background: var(--color-accent); color: #fff; }
      }
      
      &.chip-edit {
        background: #f59e0b;
        color: #fff;
        animation: pulse 2s infinite;
      }
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4); }
      70% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
      100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
    }

    .btn-edit {
      padding: .3rem .7rem;
      border: 1px solid var(--color-accent);
      border-radius: 6px;
      background: transparent;
      color: var(--color-accent);
      font-size: .8rem;
      cursor: pointer;
      transition: all 0.2s;
      
      &.active {
        background: var(--color-accent);
        color: #fff;
      }
      
      &:hover {
        background: var(--color-accent);
        color: #fff;
      }
    }
    .removed-count { color: var(--color-muted); }
    .selected-count { color: var(--color-muted); }
    .btn-secondary {
      padding: .3rem .7rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: transparent;
      color: var(--color-text);
      font-size: .8rem;
      cursor: pointer;
      &:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      &:hover { border-color: var(--color-accent); color: var(--color-accent); }
    }
  `]
})
export class TxtMediaPlayerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mediaEl') mediaElRef!: ElementRef<HTMLVideoElement | HTMLAudioElement>;
  @ViewChild('transcriptEl') transcriptElRef!: ElementRef<HTMLDivElement>;

  readonly clip = input.required<Clip>();

  readonly playing;
  readonly currentTime;
  readonly duration;
  readonly playbackRate;
  readonly volume;
  readonly jumpCutMode = signal(false);
  readonly editMode = signal(false);
  readonly autoFollow = signal(true);
  readonly playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  readonly selectedWordIds = signal<string[]>([]);
  readonly selectionAnchorWordId = signal<string | null>(null);
  readonly isDragSelecting = signal(false);
  private dragSelectAnchorId: string | null = null;
  private dragSelectBaselineIds: string[] = [];
  private isDragAppendMode = false;
  private justCompletedDrag = false;
  readonly transcriptScrollTop = signal(0);
  readonly transcriptViewportHeight = signal(0);

  readonly progress = computed(() =>
    this.duration() > 0 ? (this.currentTime() / this.duration()) * 100 : 0
  );

  readonly mediaUrl = computed(() => `/api/clips/${this.clip().id}/stream`);

  readonly isVideo = computed(() => {
    return this.projectService.project()?.mediaType !== 'audio';
  });

  readonly removedCount = computed(() =>
    this.clip().segments.flatMap((s) => s.words).filter((w) => w.isRemoved).length
  );

  readonly selectedCount = computed(() => this.selectedWordIds().length);
  readonly totalWordCount = computed(() =>
    this.clip().segments.reduce((total, segment) => total + segment.words.length, 0)
  );
  readonly shouldVirtualizeTranscript = computed(() => this.totalWordCount() >= 1200);
  readonly segmentViewportItems = computed<SegmentViewportItem[]>(() => {
    let offset = 0;
    return this.clip().segments.map((segment, index) => {
      const estimatedLines = Math.max(1, Math.ceil(segment.words.length / 10));
      const estimatedHeight = 16 + estimatedLines * 28;
      const item: SegmentViewportItem = {
        segment,
        index,
        top: offset,
        bottom: offset + estimatedHeight,
      };
      offset += estimatedHeight;
      return item;
    });
  });
  readonly transcriptTotalHeight = computed(() => {
    const items = this.segmentViewportItems();
    return items.length ? items[items.length - 1].bottom : 0;
  });
  readonly renderedSegmentItems = computed(() => {
    const items = this.segmentViewportItems();
    if (!this.shouldVirtualizeTranscript()) return items;
    if (!items.length) return [];

    const overscanPx = 700;
    const viewportStart = Math.max(0, this.transcriptScrollTop() - overscanPx);
    const viewportEnd = this.transcriptScrollTop() + this.transcriptViewportHeight() + overscanPx;

    let startIndex = items.findIndex((item) => item.bottom >= viewportStart);
    if (startIndex < 0) startIndex = 0;
    let endIndex = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].top <= viewportEnd) {
        endIndex = i;
        break;
      }
    }
    if (endIndex < 0) endIndex = items.length - 1;

    const activeSegmentIndex = this.findActiveSegmentIndex();
    if (activeSegmentIndex >= 0) {
      startIndex = Math.min(startIndex, activeSegmentIndex);
      endIndex = Math.max(endIndex, activeSegmentIndex);
    }

    return items.slice(startIndex, endIndex + 1);
  });
  readonly virtualPaddingTop = computed(() => {
    if (!this.shouldVirtualizeTranscript()) return 0;
    return this.renderedSegmentItems()[0]?.top ?? 0;
  });
  readonly virtualPaddingBottom = computed(() => {
    if (!this.shouldVirtualizeTranscript()) return 0;
    const rendered = this.renderedSegmentItems();
    const lastBottom = rendered.length ? rendered[rendered.length - 1].bottom : 0;
    return Math.max(0, this.transcriptTotalHeight() - lastBottom);
  });

  private pendingWordUpdates = new Map<string, { isRemoved?: boolean; text?: string }>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handleTranscriptResize = () => this.measureTranscriptViewport();
  private readonly handleDragEnd = () => this.endDragSelect();
  private readonly handleKeydown: (event: KeyboardEvent) => void;
  private detachKeyboardListener: (() => void) | null = null;

  private readonly playbackWatch = effect(() => {
    const t = this.currentTime();

    if (this.jumpCutMode() && this.playing()) {
      this.applyJumpCut(t);
    }

    this.scrollTranscriptToCurrentWord();
  });

  constructor(
    private clipService: ClipService,
    readonly projectService: ProjectService,
    private mediaPlayer: MediaPlayerService,
    private editHistory: EditHistoryService,
    private keyboardShortcuts: KeyboardShortcutsService,
  ) {
    this.playing = this.mediaPlayer.isPlaying;
    this.currentTime = this.mediaPlayer.currentTime;
    this.duration = this.mediaPlayer.duration;
    this.playbackRate = this.mediaPlayer.playbackRate;
    this.volume = this.mediaPlayer.volume;
    this.handleKeydown = this.keyboardShortcuts.createPlayerHandler({
      togglePlay: () => this.togglePlay(),
      seekRelative: (seconds) => this.mediaPlayer.seek(Math.max(0, this.currentTime() + seconds)),
      removeSelection: () => this.removeSelected(),
      undo: () => this.undo(),
      redo: () => this.redo(),
    });
  }

  ngAfterViewInit(): void {
    if (this.mediaElRef?.nativeElement) {
      this.mediaPlayer.attachElement(this.mediaElRef.nativeElement);
    }
    this.measureTranscriptViewport();
    this.detachKeyboardListener = this.keyboardShortcuts.bindWindowKeydown(this.handleKeydown);
    window.addEventListener('resize', this.handleTranscriptResize);
    document.addEventListener('mouseup', this.handleDragEnd);
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flushWordUpdates();
    this.mediaPlayer.detachElement();
    this.playbackWatch.destroy();
    this.detachKeyboardListener?.();
    this.detachKeyboardListener = null;
    window.removeEventListener('resize', this.handleTranscriptResize);
    document.removeEventListener('mouseup', this.handleDragEnd);
  }

  togglePlay(): void {
    if (this.playing()) {
      this.mediaPlayer.pause();
    } else {
      this.mediaPlayer.play().catch(() => {});
    }
  }

  seek(e: MouseEvent): void {
    const bar = e.currentTarget as HTMLElement;
    const rect = bar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    this.mediaPlayer.seek(ratio * this.duration());
  }

  seekToWord(word: Word): void {
    if (!word.isRemoved) {
      this.mediaPlayer.seek(word.startTime);
    }
  }

  onWordClick(word: Word, event: MouseEvent): void {
    if (this.justCompletedDrag) {
      this.justCompletedDrag = false;
      return;
    }
    if (this.editMode()) return;
    if (event.shiftKey && this.selectionAnchorWordId()) {
      const range = this.getWordRange(this.selectionAnchorWordId()!, word.id);
      this.selectedWordIds.set(range);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      this.selectionAnchorWordId.set(word.id);
      const currentSet = new Set(this.selectedWordIds());
      if (currentSet.has(word.id)) {
        currentSet.delete(word.id);
      } else {
        currentSet.add(word.id);
      }
      this.selectedWordIds.set(Array.from(currentSet));
      return;
    }

    this.selectionAnchorWordId.set(word.id);
    this.selectedWordIds.set([word.id]);
    this.seekToWord(word);
  }

  onWordMouseDown(word: Word, event: MouseEvent): void {
    if (this.editMode()) return;
    if (event.button !== 0) return;
    this.dragSelectAnchorId = word.id;
    this.isDragAppendMode = event.ctrlKey || event.metaKey;
    this.dragSelectBaselineIds = this.isDragAppendMode ? [...this.selectedWordIds()] : [];
  }

  onWordMouseEnter(word: Word): void {
    if (this.editMode()) return;
    if (!this.dragSelectAnchorId) return;
    if (word.id === this.dragSelectAnchorId) return;

    if (!this.isDragSelecting()) {
      this.isDragSelecting.set(true);
      this.selectionAnchorWordId.set(this.dragSelectAnchorId);
    }
    const range = this.getWordRange(this.dragSelectAnchorId, word.id);
    if (this.isDragAppendMode) {
      const combined = new Set([...this.dragSelectBaselineIds, ...range]);
      this.selectedWordIds.set(Array.from(combined));
    } else {
      this.selectedWordIds.set(range);
    }
  }

  private endDragSelect(): void {
    if (this.isDragSelecting()) {
      const firstId = this.selectedWordIds()[0];
      if (firstId) {
        const word = this.findWordById(firstId);
        if (word && !word.isRemoved) this.mediaPlayer.seek(word.startTime);
      }
      this.justCompletedDrag = true;
      setTimeout(() => this.justCompletedDrag = false, 100);
    }
    this.dragSelectAnchorId = null;
    this.isDragSelecting.set(false);
  }

  isSelected(wordId: string): boolean {
    return this.selectedWordIds().includes(wordId);
  }

  removeSelected(): void {
    const updates = this.selectedWordIds().map((wordId) => ({ id: wordId, isRemoved: true }));
    this.applyWordUpdates(updates, true);
  }

  restoreSelected(): void {
    const updates = this.selectedWordIds().map((wordId) => ({ id: wordId, isRemoved: false }));
    this.applyWordUpdates(updates, true);
  }

  onTimelineSeek(time: number): void {
    this.mediaPlayer.seek(time);
  }

  onTranscriptScroll(): void {
    if (!this.transcriptElRef) return;
    this.transcriptScrollTop.set(this.transcriptElRef.nativeElement.scrollTop);
    if (!this.transcriptViewportHeight()) {
      this.measureTranscriptViewport();
    }
  }

  clearSelection(event: MouseEvent): void {
    if (this.editMode()) return;
    if (this.isDragSelecting() || this.justCompletedDrag) return;
    const target = event.target as HTMLElement;
    if (target.classList.contains('transcript') || 
        target.classList.contains('segment') || 
        target.classList.contains('seg-words')) {
      this.selectedWordIds.set([]);
      this.selectionAnchorWordId.set(null);
    }
  }

  onWordEdit(word: Word, event: Event): void {
    const target = event.target as HTMLElement;
    const newText = target.textContent?.trim() || '';
    if (newText !== word.text) {
      this.applyWordUpdates([{ id: word.id, text: newText }], false);
    }
  }

  setPlaybackRate(value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      this.mediaPlayer.setRate(parsed);
    }
  }

  setVolume(value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      this.mediaPlayer.setVolume(parsed);
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
    if (this.editMode()) return;
    this.applyWordUpdates([{ id: word.id, isRemoved: !word.isRemoved }], true);
  }

  restoreAll(): void {
    const updates = this.clip().segments
      .flatMap((seg) => seg.words)
      .filter((word) => word.isRemoved)
      .map((word) => ({ id: word.id, isRemoved: false }));
    this.applyWordUpdates(updates, true);
  }

  formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  private applyJumpCut(currentTime: number): void {
    for (const seg of this.clip().segments) {
      for (const word of seg.words) {
        if (word.isRemoved && currentTime >= word.startTime && currentTime < word.endTime) {
          const nextActive = this.findNextActiveWordStart(word.endTime);
          if (nextActive !== null) {
            this.mediaPlayer.seek(nextActive);
          } else {
            this.mediaPlayer.pause();
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

  private findWordById(wordId: string): Word | null {
    for (const segment of this.clip().segments) {
      for (const word of segment.words) {
        if (word.id === wordId) return word;
      }
    }
    return null;
  }

  private getWordRange(anchorWordId: string, targetWordId: string): string[] {
    const orderedWordIds = this.clip().segments.flatMap((segment) => segment.words.map((word) => word.id));
    const startIndex = orderedWordIds.indexOf(anchorWordId);
    const endIndex = orderedWordIds.indexOf(targetWordId);
    if (startIndex === -1 || endIndex === -1) return [targetWordId];
    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);
    return orderedWordIds.slice(from, to + 1);
  }

  private undo(): void {
    // V1 undo is a no-op; V2 player handles undo via CutRegionService
  }

  private redo(): void {
    // V1 redo is a no-op; V2 player handles redo via CutRegionService
  }

  private applyWordUpdates(updates: Array<{ id: string; isRemoved?: boolean; text?: string }>, _recordHistory: boolean): void {
    if (!updates.length) return;

    for (const update of updates) {
      const word = this.findWordById(update.id);
      if (!word) continue;

      const isStateChange = update.isRemoved !== undefined && word.isRemoved !== update.isRemoved;
      const isTextChange = update.text !== undefined && word.text !== update.text;

      if (!isStateChange && !isTextChange) continue;

      if (isStateChange) {
        (word as { isRemoved: boolean }).isRemoved = update.isRemoved!;
        const pending = this.pendingWordUpdates.get(word.id) || {};
        pending.isRemoved = update.isRemoved!;
        this.pendingWordUpdates.set(word.id, pending);
      }

      if (isTextChange) {
        (word as { text: string }).text = update.text!;
        const pending = this.pendingWordUpdates.get(word.id) || {};
        pending.text = update.text!;
        this.pendingWordUpdates.set(word.id, pending);
      }
    }

    this.scheduleSave();
  }

  private scrollTranscriptToCurrentWord(): void {
    if (!this.transcriptElRef || !this.autoFollow()) return;
    const container = this.transcriptElRef.nativeElement;
    this.measureTranscriptViewport();
    const highlighted = container.querySelector('.word.highlighted') as HTMLElement | null;
    if (highlighted) {
      const containerRect = container.getBoundingClientRect();
      const elRect = highlighted.getBoundingClientRect();
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        highlighted.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }

    if (!this.shouldVirtualizeTranscript()) return;
    const activeSegmentIndex = this.findActiveSegmentIndex();
    if (activeSegmentIndex < 0) return;
    const item = this.segmentViewportItems()[activeSegmentIndex];
    if (!item) return;

    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (item.top < viewTop || item.bottom > viewBottom) {
      const nextTop = Math.max(0, item.top - container.clientHeight * 0.4);
      container.scrollTo({ top: nextTop, behavior: 'smooth' });
      this.transcriptScrollTop.set(nextTop);
    }
  }

  private findActiveSegmentIndex(): number {
    const t = this.currentTime();
    return this.clip().segments.findIndex((segment) =>
      segment.words.some((word) => t >= word.startTime && t < word.endTime)
    );
  }

  private measureTranscriptViewport(): void {
    if (!this.transcriptElRef) return;
    const container = this.transcriptElRef.nativeElement;
    this.transcriptViewportHeight.set(container.clientHeight);
    this.transcriptScrollTop.set(container.scrollTop);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushWordUpdates(), 800);
  }

  private flushWordUpdates(): void {
    if (!this.pendingWordUpdates.size) return;
    const updates = Array.from(this.pendingWordUpdates.entries()).map(([id, partial]) => ({ id, ...partial }));
    this.pendingWordUpdates.clear();
    this.clipService.updateWordStates(this.clip().id, updates as any).subscribe({ error: console.error });
  }
}
