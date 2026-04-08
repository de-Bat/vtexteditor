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
import { MediaPlayerService } from '../txt-media-player/media-player.service';
import { EditHistoryService, WordEditChange } from '../txt-media-player/edit-history.service';
import { KeyboardShortcutsService } from '../txt-media-player/keyboard-shortcuts.service';

/* ── Palette & Constants ────────────────────────────────────── */

const SEGMENT_PALETTE = [
  { bar: 'rgba(139,92,246,0.6)',  track: 'rgba(139,92,246,0.4)',  border: '#a78bfa', glow: 'rgba(139,92,246,0.4)' },
  { bar: 'rgba(16,185,129,0.6)',  track: 'rgba(16,185,129,0.4)',  border: '#34d399', glow: 'rgba(16,185,129,0.4)' },
  { bar: 'rgba(245,158,11,0.6)', track: 'rgba(245,158,11,0.4)',  border: '#fbbf24', glow: 'rgba(245,158,11,0.4)' },
  { bar: 'rgba(244,63,94,0.6)',  track: 'rgba(244,63,94,0.4)',   border: '#fb7185', glow: 'rgba(244,63,94,0.4)' },
  { bar: 'rgba(14,165,233,0.6)', track: 'rgba(14,165,233,0.4)',  border: '#38bdf8', glow: 'rgba(14,165,233,0.4)' },
  { bar: 'rgba(217,70,239,0.6)', track: 'rgba(217,70,239,0.4)',  border: '#e879f9', glow: 'rgba(217,70,239,0.4)' },
];

const SILENCE_THRESHOLD_SEC = 0.5;

/* ── Interfaces ─────────────────────────────────────────────── */

interface SegmentViewItem {
  segment: Segment;
  index: number;
  colorIndex: number;
  top: number;
  bottom: number;
  silenceAfter: { durationText: string; midTime: number } | null;
}

interface TrackItem {
  kind: 'segment' | 'gap';
  widthPercent: number;
  colorIndex: number;
}

/* ── Component ──────────────────────────────────────────────── */

@Component({
  selector: 'app-txt-media-player-v2',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="player-v2">

  <!-- ═══════════ Left: Video Preview + Timeline ═══════════ -->
  <section class="preview-section">

    <!-- Video Frame -->
    <div class="preview-area">
      <div class="video-frame"
        #videoFrameEl
        (mouseenter)="showOverlay.set(true)"
        (mouseleave)="showOverlay.set(false)">

        @if (isVideo()) {
          <video
            #mediaEl
            class="video-el"
            [src]="mediaUrl()"
            preload="metadata"
          ></video>
        } @else {
          <audio #mediaEl [src]="mediaUrl()" preload="metadata"></audio>
          <div class="audio-placeholder">
            <span class="material-symbols-outlined audio-icon">headphones</span>
            <span class="audio-label">Audio Only</span>
          </div>
        }

        <!-- Hover overlay -->
        <div class="video-overlay" [class.visible]="showOverlay()">
          <div class="overlay-row">
            <div class="overlay-left">
              <button class="overlay-play" (click)="togglePlay()">
                <span class="material-symbols-outlined"
                  style="font-variation-settings:'FILL' 1; font-size:2.25rem">
                  {{ playing() ? 'pause' : 'play_arrow' }}
                </span>
              </button>
              <div class="overlay-time">
                <span class="timecode-lg">{{ formatTimeLong(currentTime()) }} / {{ formatTimeLong(duration()) }}</span>
                <span class="scene-label">{{ activeSegmentLabel() }}</span>
              </div>
            </div>
            <div class="overlay-right">
              <button class="overlay-icon-btn" (click)="toggleMute()" [title]="volume() === 0 ? 'Unmute' : 'Mute'">
                <span class="material-symbols-outlined">{{ volumeIcon() }}</span>
              </button>
              <button class="overlay-icon-btn" (click)="toggleFullscreen()" title="Fullscreen">
                <span class="material-symbols-outlined">fullscreen</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Current word caption -->
        @if (currentWord(); as cw) {
          <div class="word-caption">{{ cw.text }}</div>
        }
      </div>
    </div>

    <!-- Timeline Panel -->
    <div class="timeline-panel">
      <div class="timeline-header">
        <div class="timeline-header-left">
          <span class="material-symbols-outlined tl-icon">reorder</span>
          <span class="tl-label">Timeline</span>
        </div>
        <div class="timeline-header-right">
          <span class="tl-meta">{{ mediaInfoLabel() }}</span>
          @if (jumpCutMode()) {
            <div class="rec-indicator">
              <div class="rec-dot"></div>
              <span class="rec-text">Jump Cut</span>
            </div>
          }
          <select class="speed-select" [value]="playbackRate()" (change)="setPlaybackRate($any($event.target).value)">
            @for (rate of playbackRates; track rate) {
              <option [value]="rate">{{ rate }}x</option>
            }
          </select>
        </div>
      </div>
      <div class="timeline-track" (click)="onTimelineClick($event)">
        <div class="track-blocks">
          @for (item of trackItems(); track $index) {
            @if (item.kind === 'segment') {
              <div class="track-block"
                [style.width.%]="item.widthPercent"
                [style.background]="SEGMENT_PALETTE[item.colorIndex % SEGMENT_PALETTE.length].track"
                [style.border-left-color]="SEGMENT_PALETTE[item.colorIndex % SEGMENT_PALETTE.length].border"
              ></div>
            } @else {
              <div class="track-gap" [style.width.%]="item.widthPercent"></div>
            }
          }
        </div>
        <div class="playhead" [style.left.%]="progress()">
          <div class="playhead-dot"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- ═══════════ Right: Transcript Panel ═══════════ -->
  <section class="transcript-section">

    <!-- Header -->
    <div class="transcript-header">
      <div class="header-row">
        <div class="header-left">
          <h2 class="transcript-title">Transcript</h2>
          <span class="auto-badge">AUTO-GEN</span>
        </div>
        <div class="header-right">
          @if (!autoFollow()) {
            <button class="return-btn" (click)="returnToCurrentWord()" title="Return to current word">
              <span class="material-symbols-outlined">keyboard_return</span>
              Return
            </button>
          }
          <button
            class="follow-btn"
            [class.active]="autoFollow()"
            [attr.aria-pressed]="autoFollow()"
            [title]="autoFollow() ? 'Auto-follow on — click to pause' : 'Auto-follow paused — click to resume'"
            (click)="autoFollow() ? pauseFollow() : returnToCurrentWord()"
          >
            <span class="material-symbols-outlined">
              {{ autoFollow() ? 'my_location' : 'location_disabled' }}
            </span>
            {{ autoFollow() ? 'Following' : 'Paused' }}
          </button>
          <button class="clean-all-btn" (click)="restoreAll()" title="Restore all removed words">
            <span class="material-symbols-outlined">delete_sweep</span>
            Clean All
          </button>
        </div>
      </div>
      <div class="search-wrap">
        <span class="material-symbols-outlined search-icon">search</span>
        <input
          type="text"
          class="search-input"
          placeholder="Search transcript..."
          [value]="searchQuery()"
          (input)="searchQuery.set($any($event.target).value)"
        />
      </div>
    </div>

    <!-- Scrollable Transcript -->
    <div class="transcript-body" #transcriptEl (scroll)="onTranscriptScroll()">
      @if (shouldVirtualize()) {
        <div class="v-spacer" [style.height.px]="virtualPaddingTop()"></div>
      }

      @for (item of renderedItems(); track item.segment.id) {
        @let seg = item.segment;
        @let segIdx = item.index;
        @let active = isActiveSegment(seg);
        @let palette = SEGMENT_PALETTE[segColorIndex(seg, segIdx) % SEGMENT_PALETTE.length];

        <div class="seg-block" [class.active]="active">
          <!-- Drag handle -->
          <div class="drag-ind">
            <span class="material-symbols-outlined drag-handle">drag_indicator</span>
          </div>

          <!-- Color bar -->
          <div class="color-bar"
            [style.background]="active ? palette.border : palette.bar"
            [style.box-shadow]="active ? '0 0 12px ' + palette.glow : 'none'"
          ></div>

          <!-- Content -->
          <div class="seg-content">
            <div class="seg-head">
              <span class="seg-time" [class.active]="active">
                {{ formatTimeShort(seg.startTime) }} - {{ active ? 'CURRENT' : formatTimeShort(seg.endTime) }}
              </span>
              <span class="material-symbols-outlined seg-more">more_horiz</span>
            </div>

            <div class="word-flow">
              @for (word of seg.words; track word.id) {
                @if (word.isRemoved) {
                  <span class="filler-badge"
                    (click)="onWordClick(word, $event)"
                    (dblclick)="toggleRemove(word)">
                    <span class="filler-text">{{ word.text }}</span>
                    <button class="filler-x" (click)="toggleRemove(word); $event.stopPropagation()">
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </span>
                } @else {
                  <span class="word"
                    [class.highlighted]="isHighlighted(word)"
                    [class.selected]="isSelected(word.id)"
                    [class.search-match]="isSearchMatch(word)"
                    (click)="onWordClick(word, $event)"
                    (dblclick)="toggleRemove(word)"
                    [title]="'Double-click to remove'"
                  >{{ word.text }}</span>
                }
              }
            </div>
          </div>
        </div>

        <!-- Silence marker -->
        @if (clip().showSilenceMarkers && item.silenceAfter; as sil) {
          <div class="silence-row">
            <div class="silence-line"></div>
            <div class="silence-pill" (click)="seekToTime(sil.midTime)">
              <span class="material-symbols-outlined">timer</span>
              <span class="silence-text">{{ sil.durationText }} Silence</span>
              <span class="material-symbols-outlined silence-x">close</span>
            </div>
            <div class="silence-line"></div>
          </div>
        }
      }

      @if (shouldVirtualize()) {
        <div class="v-spacer" [style.height.px]="virtualPaddingBottom()"></div>
      }
    </div>

    <!-- Floating Action Footer -->
    <div class="action-footer">
      <div class="action-left">
        <button class="action-icon" (click)="removeSelected()" [disabled]="!selectedCount()" title="Cut selected words">
          <span class="material-symbols-outlined">content_cut</span>
        </button>
        <button class="action-icon" [class.active]="jumpCutMode()" (click)="jumpCutMode.set(!jumpCutMode())" title="Toggle jump-cut preview">
          <span class="material-symbols-outlined">auto_awesome</span>
        </button>
        <button class="action-icon" (click)="restoreSelected()" [disabled]="!selectedCount()" title="Restore selected words">
          <span class="material-symbols-outlined">settings_backup_restore</span>
        </button>
      </div>
      <div class="action-meta">
        @if (selectedCount()) {
          <span class="meta-chip">{{ selectedCount() }} selected</span>
        }
        @if (removedCount()) {
          <span class="meta-chip removed">{{ removedCount() }} removed</span>
        }
      </div>
      <button class="smart-cut-btn" (click)="removeSelected()" [disabled]="!selectedCount()">Smart Cut</button>
    </div>

  </section>
</div>
  `,
  styleUrl: './txt-media-player-v2.component.scss'
})
export class TxtMediaPlayerV2Component implements AfterViewInit, OnDestroy {

  /* ── Refs ────────────────────────────────────────────── */
  @ViewChild('mediaEl') mediaElRef!: ElementRef<HTMLVideoElement | HTMLAudioElement>;
  @ViewChild('transcriptEl') transcriptElRef!: ElementRef<HTMLDivElement>;
  @ViewChild('videoFrameEl') videoFrameRef!: ElementRef<HTMLDivElement>;

  /* ── Inputs ──────────────────────────────────────────── */
  readonly clip = input.required<Clip>();

  /* ── Palette (exposed for template) ──────────────────── */
  readonly SEGMENT_PALETTE = SEGMENT_PALETTE;

  /* ── Signals (media delegated from service) ──────────── */
  readonly playing;
  readonly currentTime;
  readonly duration;
  readonly playbackRate;
  readonly volume;

  /* ── Local Signals ───────────────────────────────────── */
  readonly autoFollow = signal(true);
  readonly jumpCutMode = signal(false);
  readonly showOverlay = signal(false);
  readonly searchQuery = signal('');
  readonly selectedWordIds = signal<string[]>([]);
  readonly selectionAnchorWordId = signal<string | null>(null);
  readonly transcriptScrollTop = signal(0);
  readonly transcriptViewportHeight = signal(0);
  readonly playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  private readonly editVersion = signal(0);

  /* ── Computed: Media ─────────────────────────────────── */
  readonly progress = computed(() =>
    this.duration() > 0 ? (this.currentTime() / this.duration()) * 100 : 0
  );

  readonly mediaUrl = computed(() => `/api/clips/${this.clip().id}/stream`);

  readonly isVideo = computed(() =>
    this.projectService.project()?.mediaType !== 'audio'
  );

  readonly volumeIcon = computed(() => {
    const v = this.volume();
    if (v === 0) return 'volume_off';
    return v < 0.5 ? 'volume_down' : 'volume_up';
  });

  readonly currentWord = computed(() => {
    const t = this.currentTime();
    for (const seg of this.clip().segments) {
      for (const w of seg.words) {
        if (!w.isRemoved && t >= w.startTime && t < w.endTime) return w;
      }
    }
    return null;
  });

  readonly activeSegmentLabel = computed(() => {
    const t = this.currentTime();
    const segs = this.clip().segments;
    const idx = segs.findIndex(s => s.words.some(w => t >= w.startTime && t < w.endTime));
    if (idx < 0) return '';
    const tags = segs[idx].tags;
    return tags.length ? tags[0] : `Segment ${idx + 1}`;
  });

  readonly mediaInfoLabel = computed(() => {
    const info = this.projectService.project()?.mediaInfo;
    if (!info) return '';
    const parts: string[] = [];
    if (info.height) parts.push(`${info.height}p`);
    if (info.format) parts.push(info.format.toUpperCase());
    return parts.join(' | ');
  });

  /* ── Computed: Word Counts ───────────────────────────── */
  readonly removedCount = computed(() => {
    this.editVersion();
    return this.clip().segments.flatMap(s => s.words).filter(w => w.isRemoved).length;
  });

  readonly selectedCount = computed(() => this.selectedWordIds().length);

  readonly totalWordCount = computed(() =>
    this.clip().segments.reduce((t, s) => t + s.words.length, 0)
  );

  readonly searchMatchIds = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return new Set<string>();
    const ids = new Set<string>();
    for (const seg of this.clip().segments) {
      for (const w of seg.words) {
        if (w.text.toLowerCase().includes(q)) ids.add(w.id);
      }
    }
    return ids;
  });

  /* ── Computed: Tag → Palette mapping ─────────────────── */
  readonly tagColorMap = computed(() => {
    const map = new Map<string, number>();
    let nextIdx = 0;
    for (const seg of this.clip().segments) {
      const tag = seg.tags[0] ?? null;
      if (tag && !map.has(tag)) map.set(tag, nextIdx++);
    }
    return map;
  });

  /** Palette index for a segment — segments sharing the same first tag share a color. */
  segColorIndex(seg: Segment, fallbackIndex: number): number {
    const tag = seg.tags[0] ?? null;
    if (tag) return this.tagColorMap().get(tag) ?? fallbackIndex;
    return this.tagColorMap().size + fallbackIndex;
  }

  /* ── Computed: Timeline Track Items ──────────────────── */
  readonly trackItems = computed<TrackItem[]>(() => {
    const segments = this.clip().segments;
    const dur = this.duration();
    if (!segments.length || dur <= 0) return [];
    const items: TrackItem[] = [];
    for (let i = 0; i < segments.length; i++) {
      const ci = this.segColorIndex(segments[i], i);
      if (i > 0) {
        const gap = segments[i].startTime - segments[i - 1].endTime;
        if (gap > 0.1) {
          items.push({ kind: 'gap', widthPercent: (gap / dur) * 100, colorIndex: ci });
        }
      }
      const segDur = segments[i].endTime - segments[i].startTime;
      items.push({ kind: 'segment', widthPercent: Math.max(0.3, (segDur / dur) * 100), colorIndex: ci });
    }
    return items;
  });

  /* ── Computed: Virtual Scrolling ─────────────────────── */
  readonly shouldVirtualize = computed(() => this.totalWordCount() >= 1200);

  readonly segmentViewItems = computed<SegmentViewItem[]>(() => {
    const segments = this.clip().segments;
    let offset = 0;
    return segments.map((segment, index) => {
      const estimatedLines = Math.max(1, Math.ceil(segment.words.length / 10));
      const estimatedHeight = 16 + estimatedLines * 28;
      const item: SegmentViewItem = {
        segment,
        index,
        colorIndex: this.segColorIndex(segment, index),
        top: offset,
        bottom: offset + estimatedHeight,
        silenceAfter: null,
      };
      // Compute silence after this segment
      if (index < segments.length - 1) {
        const gap = segments[index + 1].startTime - segment.endTime;
        if (gap >= SILENCE_THRESHOLD_SEC) {
          item.silenceAfter = {
            durationText: gap.toFixed(1) + 's',
            midTime: segment.endTime + gap / 2,
          };
        }
      }
      offset += estimatedHeight + (item.silenceAfter ? 40 : 0);
      return item;
    });
  });

  readonly transcriptTotalHeight = computed(() => {
    const items = this.segmentViewItems();
    return items.length ? items[items.length - 1].bottom : 0;
  });

  readonly renderedItems = computed(() => {
    const items = this.segmentViewItems();
    if (!this.shouldVirtualize()) return items;
    if (!items.length) return [];
    const overscan = 700;
    const vStart = Math.max(0, this.transcriptScrollTop() - overscan);
    const vEnd = this.transcriptScrollTop() + this.transcriptViewportHeight() + overscan;
    let start = items.findIndex(i => i.bottom >= vStart);
    if (start < 0) start = 0;
    let end = -1;
    for (let j = items.length - 1; j >= 0; j--) {
      if (items[j].top <= vEnd) { end = j; break; }
    }
    if (end < 0) end = items.length - 1;
    const activeSeg = this.findActiveSegmentIndex();
    if (activeSeg >= 0) {
      start = Math.min(start, activeSeg);
      end = Math.max(end, activeSeg);
    }
    return items.slice(start, end + 1);
  });

  readonly virtualPaddingTop = computed(() => {
    if (!this.shouldVirtualize()) return 0;
    return this.renderedItems()[0]?.top ?? 0;
  });

  readonly virtualPaddingBottom = computed(() => {
    if (!this.shouldVirtualize()) return 0;
    const rendered = this.renderedItems();
    const lastBottom = rendered.length ? rendered[rendered.length - 1].bottom : 0;
    return Math.max(0, this.transcriptTotalHeight() - lastBottom);
  });

  /* ── Private State ───────────────────────────────────── */
  private suppressScrollDetection = false;
  private pendingWordUpdates = new Map<string, boolean>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handleResize = () => this.measureTranscriptViewport();
  private readonly handleKeydown: (event: KeyboardEvent) => void;
  private detachKeyboard: (() => void) | null = null;
  private previousVolume = 1;

  private readonly playbackWatch = effect(() => {
    const t = this.currentTime();
    if (this.jumpCutMode() && this.playing()) this.applyJumpCut(t);
    this.scrollToCurrentWord();
  });

  /* ── Constructor ─────────────────────────────────────── */
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
      seekRelative: (s) => this.mediaPlayer.seek(Math.max(0, this.currentTime() + s)),
      removeSelection: () => this.removeSelected(),
      undo: () => this.undo(),
      redo: () => this.redo(),
    });
  }

  /* ── Lifecycle ───────────────────────────────────────── */
  ngAfterViewInit(): void {
    if (this.mediaElRef?.nativeElement) {
      this.mediaPlayer.attachElement(this.mediaElRef.nativeElement);
    }
    this.measureTranscriptViewport();
    this.detachKeyboard = this.keyboardShortcuts.bindWindowKeydown(this.handleKeydown);
    window.addEventListener('resize', this.handleResize);
  }

  ngOnDestroy(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flushWordUpdates();
    this.mediaPlayer.detachElement();
    this.playbackWatch.destroy();
    this.detachKeyboard?.();
    this.detachKeyboard = null;
    window.removeEventListener('resize', this.handleResize);
  }

  /* ── Public Methods (template) ───────────────────────── */
  togglePlay(): void {
    this.playing() ? this.mediaPlayer.pause() : this.mediaPlayer.play().catch(() => {});
  }

  toggleMute(): void {
    if (this.volume() > 0) {
      this.previousVolume = this.volume();
      this.mediaPlayer.setVolume(0);
    } else {
      this.mediaPlayer.setVolume(this.previousVolume || 1);
    }
  }

  toggleFullscreen(): void {
    const frame = this.videoFrameRef?.nativeElement;
    if (!frame) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      frame.requestFullscreen?.();
    }
  }

  setPlaybackRate(value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) this.mediaPlayer.setRate(parsed);
  }

  onTimelineClick(event: MouseEvent): void {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    this.mediaPlayer.seek(ratio * this.duration());
  }

  seekToTime(time: number): void {
    this.mediaPlayer.seek(time);
  }

  onWordClick(word: Word, event: MouseEvent): void {
    if (event.shiftKey && this.selectionAnchorWordId()) {
      const range = this.getWordRange(this.selectionAnchorWordId()!, word.id);
      this.selectedWordIds.set(range);
      return;
    }
    this.selectionAnchorWordId.set(word.id);
    this.selectedWordIds.set([word.id]);
    if (!word.isRemoved) this.mediaPlayer.seek(word.startTime);
  }

  isSelected(wordId: string): boolean {
    return this.selectedWordIds().includes(wordId);
  }

  isHighlighted(word: Word): boolean {
    const t = this.currentTime();
    return t >= word.startTime && t < word.endTime;
  }

  isSearchMatch(word: Word): boolean {
    return this.searchMatchIds().has(word.id);
  }

  isActiveSegment(seg: Segment): boolean {
    const t = this.currentTime();
    return seg.words.some(w => t >= w.startTime && t < w.endTime);
  }

  toggleRemove(word: Word): void {
    this.applyWordUpdates([{ id: word.id, isRemoved: !word.isRemoved }], true);
  }

  removeSelected(): void {
    this.applyWordUpdates(
      this.selectedWordIds().map(id => ({ id, isRemoved: true })),
      true,
    );
  }

  restoreSelected(): void {
    this.applyWordUpdates(
      this.selectedWordIds().map(id => ({ id, isRemoved: false })),
      true,
    );
  }

  restoreAll(): void {
    const updates = this.clip().segments
      .flatMap(s => s.words)
      .filter(w => w.isRemoved)
      .map(w => ({ id: w.id, isRemoved: false }));
    this.applyWordUpdates(updates, true);
  }

  onTranscriptScroll(): void {
    if (!this.transcriptElRef) return;
    this.transcriptScrollTop.set(this.transcriptElRef.nativeElement.scrollTop);
    if (!this.transcriptViewportHeight()) this.measureTranscriptViewport();
    if (!this.suppressScrollDetection) {
      this.autoFollow.set(false);
    }
  }

  returnToCurrentWord(): void {
    this.autoFollow.set(true);
    this.scrollToCurrentWord();
  }

  pauseFollow(): void {
    this.autoFollow.set(false);
  }

  /* ── Time Formatting ─────────────────────────────────── */
  formatTimeLong(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  formatTimeShort(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${pad(m)}:${pad(s)}`;
  }

  /* ── Private ─────────────────────────────────────────── */
  private undo(): void {
    this.editHistory.undo(updates => this.applyWordUpdates(updates, false));
  }

  private redo(): void {
    this.editHistory.redo(updates => this.applyWordUpdates(updates, false));
  }

  private applyWordUpdates(updates: Array<{ id: string; isRemoved: boolean }>, recordHistory: boolean): void {
    if (!updates.length) return;
    const changed: WordEditChange[] = [];
    for (const update of updates) {
      const word = this.findWordById(update.id);
      if (!word || word.isRemoved === update.isRemoved) continue;
      changed.push({ id: update.id, previousIsRemoved: word.isRemoved, nextIsRemoved: update.isRemoved });
      (word as { isRemoved: boolean }).isRemoved = update.isRemoved;
      this.pendingWordUpdates.set(word.id, update.isRemoved);
    }
    if (!changed.length) return;
    if (recordHistory) this.editHistory.record(changed);
    this.editVersion.update(v => v + 1);
    this.scheduleSave();
  }

  private applyJumpCut(currentTime: number): void {
    for (const seg of this.clip().segments) {
      for (const word of seg.words) {
        if (word.isRemoved && currentTime >= word.startTime && currentTime < word.endTime) {
          const next = this.findNextActiveWordStart(word.endTime);
          if (next !== null) {
            this.mediaPlayer.seek(next);
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
    for (const seg of this.clip().segments) {
      for (const word of seg.words) {
        if (word.id === wordId) return word;
      }
    }
    return null;
  }

  private getWordRange(anchorId: string, targetId: string): string[] {
    const ids = this.clip().segments.flatMap(s => s.words.map(w => w.id));
    const a = ids.indexOf(anchorId);
    const b = ids.indexOf(targetId);
    if (a === -1 || b === -1) return [targetId];
    return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  private findActiveSegmentIndex(): number {
    const t = this.currentTime();
    return this.clip().segments.findIndex(seg =>
      seg.words.some(w => t >= w.startTime && t < w.endTime)
    );
  }

  private scrollToCurrentWord(): void {
    if (!this.autoFollow()) return;
    if (!this.transcriptElRef) return;
    const container = this.transcriptElRef.nativeElement;
    this.measureTranscriptViewport();

    this.suppressScrollDetection = true;
    setTimeout(() => { this.suppressScrollDetection = false; }, 600);

    const highlighted = container.querySelector('.word.highlighted') as HTMLElement | null;
    if (highlighted) {
      const cRect = container.getBoundingClientRect();
      const eRect = highlighted.getBoundingClientRect();
      if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
        highlighted.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    if (!this.shouldVirtualize()) return;
    const idx = this.findActiveSegmentIndex();
    if (idx < 0) return;
    const item = this.segmentViewItems()[idx];
    if (!item) return;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (item.top < viewTop || item.bottom > viewBottom) {
      const nextTop = Math.max(0, item.top - container.clientHeight * 0.4);
      container.scrollTo({ top: nextTop, behavior: 'smooth' });
      this.transcriptScrollTop.set(nextTop);
    }
  }

  private measureTranscriptViewport(): void {
    if (!this.transcriptElRef) return;
    const el = this.transcriptElRef.nativeElement;
    this.transcriptViewportHeight.set(el.clientHeight);
    this.transcriptScrollTop.set(el.scrollTop);
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

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
