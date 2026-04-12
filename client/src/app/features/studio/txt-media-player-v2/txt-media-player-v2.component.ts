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
import { EditHistoryService } from '../txt-media-player/edit-history.service';
import { CutRegionService, CutHistoryEntry } from '../txt-media-player/cut-region.service';
import { EffectPlayerService } from '../txt-media-player/effect-player.service';
import { CutRegion, EffectType } from '../../../core/models/cut-region.model';
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
const INLINE_TIME_INTERVAL_SEC = 5;
const INLINE_SILENCE_THRESHOLD_SEC = 0.3;

/* ── Interfaces ─────────────────────────────────────────────── */

interface SegmentViewItem {
  segment: Segment;
  index: number;
  colorIndex: number;
  top: number;
  bottom: number;
  silenceAfter: { durationText: string; midTime: number } | null;
}

/** Items rendered inside the word-flow: a word, a time marker, or a silence chip. */
type FlowItem =
  | { kind: 'word'; word: Word }
  | { kind: 'time'; label: string; time: number; id: string }
  | { kind: 'silence'; label: string; midTime: number; gapStart: number; gapEnd: number; duration: number; id: string };

interface TrackItem {
  kind: 'segment' | 'gap';
  widthPercent: number;
  colorIndex: number;
}

/* ── Filler Words ───────────────────────────────────────────── */
const FILLER_WORDS_EN = ['um', 'uh', 'like', 'you know', 'so', 'basically', 'actually', 'literally', 'right', 'okay', 'well', 'anyway'];
const FILLER_WORDS_HE = ['אממ', 'אה', 'יעני', 'בעצם', 'כאילו', 'נכון', 'אוקיי', 'טוב', 'ברור', 'שניה', 'רגע'];

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
            [style.opacity]="effectPlayer.videoOpacity()"
            [style.filter]="effectPlayer.videoFilter()"
          ></video>
        } @else {
          <audio #mediaEl [src]="mediaUrl()" preload="metadata"></audio>
          <div class="audio-placeholder"
            [style.opacity]="effectPlayer.videoOpacity()"
            [style.filter]="effectPlayer.videoFilter()">
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
        <div class="ruler">
          @for (mark of rulerMarks(); track mark.percent) {
            <span class="ruler-tick" [style.left.%]="mark.percent">
              <span class="ruler-label">{{ mark.label }}</span>
            </span>
          }
        </div>
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
          <!-- Cut region overlays -->
          @for (overlay of cutRegionOverlays(); track overlay.regionId) {
            <div class="cut-region-overlay cut-region-overlay--{{ overlay.effectType }}"
              [style.left.%]="overlay.leftPercent"
              [style.width.%]="overlay.widthPercent"
              [title]="overlay.effectType"
              aria-hidden="true">
            </div>
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

    <!-- Vertical side label -->
    <div class="transcript-side-label"><span>TRANSCRIPT</span></div>

    <div class="transcript-content-wrapper">

    <!-- Header -->
    <div class="transcript-header">
      <!-- Row 1: title + edit group + selection group + auto-follow + export -->
      <div class="header-row1">
        <div class="hdr-group">
          <div class="auto-badge-icon" title="Auto-Generated Transcript">
            <span class="material-symbols-outlined">psychology</span>
          </div>
        </div>
        <div class="spacer"></div>
        <!-- Edit group -->
        <div class="hdr-group" role="group" aria-label="Edit history">
          <button class="hdr-btn" (click)="restoreAll()" title="Restore all removed words">
            <span class="material-symbols-outlined">settings_backup_restore</span>
          </button>
          <button class="hdr-btn" (click)="undo()" [disabled]="!canUndo()" title="Undo (Ctrl+Z)">
            <span class="material-symbols-outlined">undo</span>
          </button>
          <button class="hdr-btn" (click)="redo()" [disabled]="!canRedo()" title="Redo (Ctrl+Shift+Z)">
            <span class="material-symbols-outlined">redo</span>
          </button>
        </div>
        <!-- Selection group -->
        <div class="hdr-group hdr-divider" role="group" aria-label="Selection actions">
          <button class="hdr-btn" (click)="removeSelected()" [disabled]="!selectedCount()" title="Cut selected">
            <span class="material-symbols-outlined">content_cut</span>
          </button>
          <button class="hdr-btn" (click)="restoreSelected()" [disabled]="!selectedCount()" title="Restore selected">
            <span class="material-symbols-outlined">healing</span>
          </button>
          <button class="hdr-btn" [class.active]="jumpCutMode()" (click)="jumpCutMode.set(!jumpCutMode())" title="Jump-cut preview">
            <span class="material-symbols-outlined">auto_awesome</span>
          </button>
        </div>
        <!-- Auto-follow -->
        <div class="hdr-group hdr-divider">
          <button class="hdr-btn" [class.active]="autoFollow()" [attr.aria-pressed]="autoFollow()"
            [title]="autoFollow() ? 'Auto-follow on' : 'Auto-follow paused'"
            (click)="autoFollow() ? pauseFollow() : returnToCurrentWord()">
            <span class="material-symbols-outlined">{{ autoFollow() ? 'my_location' : 'location_disabled' }}</span>
          </button>
        </div>
      </div>

      <!-- Row 2: search + silence interval + Smart Cut dropdown -->
      <div class="header-row2">
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
        <div class="silence-interval-wrap">
          <span class="material-symbols-outlined si-icon">timer</span>
          <input type="number" class="si-input" min="0.1" max="5" step="0.1"
            [value]="silenceIntervalSec()"
            (change)="silenceIntervalSec.set(+$any($event.target).value)"
            title="Min silence interval (sec)"
          />
          <span class="si-unit">s</span>
        </div>
        <!-- Smart Cut dropdown -->
        <div class="smart-cut-wrap">
          <button class="smart-cut-trigger" (click)="smartCutOpen.set(!smartCutOpen())" [class.open]="smartCutOpen()" title="Smart Cut">
            <span class="material-symbols-outlined">content_cut</span>
            Smart Cut
            <span class="material-symbols-outlined sc-caret">expand_more</span>
          </button>
          @if (smartCutOpen()) {
            <div class="smart-cut-dropdown" role="dialog" aria-label="Smart Cut options">
              <div class="sc-section-title">Filler Words — EN</div>
              <div class="sc-chips">
                @for (fw of FILLER_WORDS_EN; track fw) {
                  <button class="sc-chip" [class.selected]="selectedFillers().has(fw)" (click)="toggleFiller(fw)">{{ fw }}</button>
                }
              </div>
              <div class="sc-section-title sc-section-he">Filler Words — עב</div>
              <div class="sc-chips">
                @for (fw of FILLER_WORDS_HE; track fw) {
                  <button class="sc-chip sc-chip-he" [class.selected]="selectedFillers().has(fw)" (click)="toggleFiller(fw)">{{ fw }}</button>
                }
              </div>
              <div class="sc-toggles">
                <button class="sc-toggle" [class.active]="highlightFillers()" (click)="highlightFillers.set(!highlightFillers())" title="Highlight fillers">
                  <span class="material-symbols-outlined">visibility</span>
                  Fillers
                </button>
                <button class="sc-toggle" [class.active]="highlightSilence()" (click)="highlightSilence.set(!highlightSilence())" title="Highlight silence-adjacent words">
                  <span class="material-symbols-outlined">hourglass_empty</span>
                  Silence
                </button>
              </div>
              <button class="sc-apply-btn" (click)="applySmartCut()">Apply Smart Cut</button>
            </div>
          }
        </div>
        <!-- Effect type selector for new cuts -->
        <div class="effect-pills-wrap" role="group" aria-label="Default cut effect type">
          <button class="effect-pill" [class.active]="defaultEffectType() === 'hard-cut'"
            (click)="setDefaultEffect('hard-cut')" title="Hard Cut — instant remove">
            <span class="material-symbols-outlined" style="font-size:1rem">content_cut</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'fade'"
            (click)="setDefaultEffect('fade')" title="Fade — audio/video fade at cut boundary">
            <span class="material-symbols-outlined" style="font-size:1rem">blur_on</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'cross-cut'"
            (click)="setDefaultEffect('cross-cut')" title="Cross-Cut — audio crossfade (preview ≈ export)">
            <span class="material-symbols-outlined" style="font-size:1rem">shuffle</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Scrollable Transcript -->
    <div class="transcript-body" #transcriptEl (scroll)="onTranscriptScroll()" (click)="clearSelection($event)">
      <!-- Scrollbar playback indicator -->
      <div class="scroll-indicator" [style.top.%]="scrollIndicatorPercent()"></div>
      @if (shouldVirtualize()) {
        <div class="v-spacer" [style.height.px]="virtualPaddingTop()"></div>
      }

      @for (item of renderedItems(); track item.segment.id) {
        @let seg = item.segment;
        @let segIdx = item.index;
        @let active = seg.id === activeSegmentId();
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
              @for (fi of buildFlowItems(seg); track fi.kind === 'word' ? fi.word.id : fi.id) {
                @if (fi.kind === 'time') {
                  <span class="inline-time" (click)="seekToTime(fi.time)">{{ fi.label }}</span>
                } @else if (fi.kind === 'silence') {
                  <span class="inline-silence"
                    [class.silence-playing]="activeSilence()?.id === fi.id"
                    [class.silence-hl]="highlightSilence() && fi.duration >= silenceIntervalSec()"
                    [class.compact]="fi.duration < 0.5"
                    [style.--sil-prog]="activeSilence()?.id === fi.id ? activeSilence()!.progress : 0"
                    [style.width.px]="silenceChipWidth(fi.duration)"
                    [title]="fi.label"
                    (click)="seekToTime(fi.midTime)">
                    <span class="material-symbols-outlined">hourglass_empty</span>
                    @if (fi.duration >= 0.5) { {{ fi.label }} }
                  </span>
                } @else if (fi.word.isRemoved) {
                  @let region = wordIdToRegion().get(fi.word.id);
                  <span class="filler-badge"
                    [class.selected]="selectedWordIdSet().has(fi.word.id)"
                    [class.popover-open]="effectPopoverWordId() === fi.word.id"
                    (click)="onRemovedWordClick(fi.word, $event)"
                    (dblclick)="toggleRemove(fi.word)">

                    @if (region?.effectTypeOverridden && region?.effectType !== 'hard-cut') {
                      <span class="effect-dot effect-dot--{{ region!.effectType }}" aria-hidden="true"></span>
                    }

                    <span class="filler-text"
                      [attr.contenteditable]="editMode() ? 'plaintext-only' : 'false'" spellcheck="false"
                      (click)="$event.stopPropagation()"
                    >{{ fi.word.text }}</span>
                    <button class="filler-x" (click)="toggleRemove(fi.word); $event.stopPropagation()" aria-label="Restore word">
                      <span class="material-symbols-outlined">close</span>
                    </button>

                    @if (effectPopoverWordId() === fi.word.id && region) {
                      <div class="effect-popover" role="dialog" aria-label="Cut effect options" (click)="$event.stopPropagation()">
                        <div class="ep-row">
                          <div class="ep-pills" role="group" aria-label="Effect type">
                            <button class="ep-pill" [class.active]="region.effectType === 'hard-cut'"
                              (click)="setRegionEffect(region.id, 'hard-cut')">Hard Cut</button>
                            <button class="ep-pill" [class.active]="region.effectType === 'fade'"
                              (click)="setRegionEffect(region.id, 'fade')">Fade</button>
                            <button class="ep-pill" [class.active]="region.effectType === 'cross-cut'"
                              (click)="setRegionEffect(region.id, 'cross-cut')">Cross</button>
                          </div>
                        </div>
                        @if (region.effectType !== 'hard-cut') {
                          <div class="ep-row ep-dur-row">
                            <span class="ep-dur-label">Duration</span>
                            @if (durationEditRegionId() === region.id) {
                              <input type="number" class="ep-dur-input" min="150" max="500"
                                [value]="region.effectDuration"
                                (change)="setRegionDuration(region.id, +$any($event.target).value)"
                                (keydown.enter)="durationEditRegionId.set(null)"
                                (blur)="durationEditRegionId.set(null)"
                              />
                            } @else {
                              <button class="ep-dur-chip" [class.fixed]="region.durationFixed"
                                (click)="durationEditRegionId.set(region.id)"
                                [title]="region.durationFixed ? 'Pinned — click to edit' : 'Auto — click to pin'">
                                {{ region.effectDuration }}ms {{ region.durationFixed ? '·pin' : '·auto' }}
                              </button>
                            }
                          </div>
                        }
                        @if (region.effectTypeOverridden || region.durationFixed) {
                          <button class="ep-reset" (click)="resetRegionEffect(region.id)">Reset to default</button>
                        }
                      </div>
                    }
                  </span>
                } @else {
                  <span class="word"
                    [class.highlighted]="fi.word.id === highlightedWordId()"
                    [class.selected]="selectedWordIdSet().has(fi.word.id)"
                    [class.search-match]="searchMatchIds().has(fi.word.id)"
                    [class.filler-hl]="isFillerWord(fi.word)"
                    (click)="onWordClick(fi.word, $event)"
                    (dblclick)="toggleRemove(fi.word)"
                    [title]="'Double-click to remove'"
                  >{{ fi.word.text }}</span>
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

    <!-- Status Bar (replaces action footer) -->
    <div class="status-bar">
      @if (selectedCount()) {
        <span class="status-chip">
          <span class="material-symbols-outlined">select_all</span>
          {{ selectedCount() }} selected
        </span>
      }
      @if (removedCount()) {
        <span class="status-chip status-removed">
          <span class="material-symbols-outlined">content_cut</span>
          {{ removedCount() }} removed
        </span>
      }
      @if (jumpCutMode()) {
        <span class="status-chip status-mode">
          <span class="material-symbols-outlined">auto_awesome</span>
          Jump Cut
        </span>
      }
      @if (highlightFillers()) {
        <span class="status-chip status-filler">
          <span class="material-symbols-outlined">visibility</span>
          Fillers
        </span>
      }
      @if (highlightSilence()) {
        <span class="status-chip status-silence">
          <span class="material-symbols-outlined">hourglass_empty</span>
          Silence
        </span>
      }
    </div>

    </div><!-- /.transcript-content-wrapper -->
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
  readonly FILLER_WORDS_EN = FILLER_WORDS_EN;
  readonly FILLER_WORDS_HE = FILLER_WORDS_HE;

  /* ── Signals (media delegated from service) ──────────── */
  readonly playing;
  readonly currentTime;
  readonly duration;
  readonly playbackRate;
  readonly volume;

  /* ── Local Signals ───────────────────────────────────── */
  readonly autoFollow = signal(true);
  readonly editMode = signal(false);
  readonly jumpCutMode = signal(false);
  readonly showOverlay = signal(false);
  readonly searchQuery = signal('');
  readonly selectedWordIds = signal<string[]>([]);
  readonly selectionAnchorWordId = signal<string | null>(null);
  readonly transcriptScrollTop = signal(0);
  readonly transcriptViewportHeight = signal(0);
  readonly playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  private readonly editVersion = signal(0);

  /* ── Smart-Cut Signals ────────────────────────────────── */
  /** Minimum silence gap (seconds) for smart-cut detection */
  readonly silenceIntervalSec = signal(0.3);
  /** Show filler-word highlight overlays (orange underline) */
  readonly highlightFillers = signal(false);
  /** Show silence-gap highlight overlays (blue underline) */
  readonly highlightSilence = signal(false);
  /** Whether Smart Cut dropdown is open */
  readonly smartCutOpen = signal(false);
  /** Whether the search input is expanded */
  readonly searchExpanded = signal(false);
  /** Whether the silence-interval popover is open */
  readonly silenceControlOpen = signal(false);
  /** wordId of the removed word whose effect popover is open; null = closed */
  readonly effectPopoverWordId = signal<string | null>(null);
  /** regionId being edited in the duration input */
  readonly durationEditRegionId = signal<string | null>(null);
  /** Filler words selected for cutting */
  readonly selectedFillers = signal<Set<string>>(new Set());

  /** Global default effect type — new regions inherit this. */
  readonly defaultEffectType = signal<EffectType>('hard-cut');

  /** Map wordId → CutRegion for O(1) lookup in template. */
  readonly wordIdToRegion = computed(() => {
    this.editVersion(); // reactive dependency
    const map = new Map<string, CutRegion>();
    for (const region of this.clip().cutRegions ?? []) {
      for (const wid of region.wordIds) map.set(wid, region);
    }
    return map;
  });

  /** Pending cut-region save timer (mirrors existing saveTimer pattern). */
  private cutRegionSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /* ── Undo / Redo availability ─────────────────────────── */
  readonly canUndo = computed(() => {
    this.editVersion(); // track version changes
    return this.editHistory.canUndo;
  });
  readonly canRedo = computed(() => {
    this.editVersion();
    return this.editHistory.canRedo;
  });

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

  /**
   * Find the word under the playhead, with gap-bridging:
   * when the time falls between two words, snap to the nearest one
   * so the highlight never blinks off during micro-gaps.
   */
  readonly currentWord = computed(() => {
    const t = this.currentTime();
    const segments = this.clip().segments;
    let lastBefore: Word | null = null;
    for (const seg of segments) {
      for (const w of seg.words) {
        if (w.isRemoved) continue;
        if (t >= w.startTime && t < w.endTime) return w;
        if (w.endTime <= t) lastBefore = w;
        if (w.startTime > t) {
          // We're in a gap — pick whichever neighbor is closer
          if (lastBefore && (t - lastBefore.endTime) <= (w.startTime - t)) return lastBefore;
          return w;
        }
      }
    }
    return lastBefore; // past the last word — keep it highlighted
  });

  readonly highlightedWordId = computed(() =>
    this.activeSilence() ? null : this.currentWord()?.id ?? null
  );

  /**
   * When playback is inside an inline silence gap, returns the chip id and
   * a 0–1 fill progress so the chip can animate a progress bar.
   */
  readonly activeSilence = computed<{ id: string; progress: number } | null>(() => {
    const t = this.currentTime();
    for (const seg of this.clip().segments) {
      const words = seg.words;
      for (let i = 1; i < words.length; i++) {
        const gapStart = words[i - 1].endTime;
        const gapEnd = words[i].startTime;
        const gap = gapEnd - gapStart;
        if (gap >= INLINE_SILENCE_THRESHOLD_SEC && t >= gapStart && t < gapEnd) {
          return {
            id: `sil-${seg.id}-${i}`,
            progress: (t - gapStart) / gap,
          };
        }
      }
    }
    return null;
  });

  readonly activeSegmentId = computed(() => {
    const w = this.currentWord();
    if (!w) return null;
    for (const seg of this.clip().segments) {
      if (seg.id === w.segmentId) return seg.id;
    }
    return null;
  });

  readonly selectedWordIdSet = computed(() => new Set(this.selectedWordIds()));

  readonly activeSegmentLabel = computed(() => {
    const segId = this.activeSegmentId();
    if (!segId) return '';
    const segs = this.clip().segments;
    const seg = segs.find(s => s.id === segId);
    if (!seg) return '';
    const idx = segs.indexOf(seg);
    return seg.tags.length ? seg.tags[0] : `Segment ${idx + 1}`;
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

  /* ── Computed: Cut Region Overlays ──────────────────── */
  readonly cutRegionOverlays = computed(() => {
    this.editVersion();
    const clip = this.clip();
    const dur = this.duration();
    if (!dur || !clip.cutRegions?.length) return [];

    const wordMap = new Map<string, Word>();
    for (const seg of clip.segments) {
      for (const w of seg.words) wordMap.set(w.id, w);
    }

    return clip.cutRegions
      .map((region) => {
        const words = region.wordIds.map((id) => wordMap.get(id)).filter((w): w is Word => !!w);
        if (!words.length) return null;
        const start = Math.min(...words.map((w) => w.startTime));
        const end = Math.max(...words.map((w) => w.endTime));
        return {
          regionId: region.id,
          leftPercent: (start / dur) * 100,
          widthPercent: ((end - start) / dur) * 100,
          effectType: region.effectType,
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
  });

  /* ── Computed: Timeline Ruler Marks ──────────────────── */
  readonly rulerMarks = computed<Array<{ percent: number; label: string }>>(() => {
    const dur = this.duration();
    if (dur <= 0) return [];
    // Adaptive interval: aim for 8–15 marks
    let interval: number;
    if (dur <= 60) interval = 5;
    else if (dur <= 300) interval = 15;
    else if (dur <= 1200) interval = 60;
    else interval = 300;
    const marks: Array<{ percent: number; label: string }> = [];
    for (let t = 0; t <= dur; t += interval) {
      marks.push({ percent: (t / dur) * 100, label: this.formatTimeShort(t) });
    }
    return marks;
  });

  /* ── Computed: Scrollbar Playback Indicator ──────────── */
  readonly scrollIndicatorPercent = computed(() => {
    if (!this.transcriptElRef) return 0;
    const el = this.transcriptElRef.nativeElement;
    const scrollHeight = el.scrollHeight - el.clientHeight;
    if (scrollHeight <= 0) return 0;
    // Estimate: progress through media ≈ progress through transcript
    return this.progress();
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
  private readonly effectInProgress = signal(false);
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
    private cutRegionService: CutRegionService,
    readonly effectPlayer: EffectPlayerService,
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
      this.effectPlayer.attachElement(this.mediaElRef.nativeElement);
    }
    this.measureTranscriptViewport();
    this.detachKeyboard = this.keyboardShortcuts.bindWindowKeydown(this.handleKeydown);
    window.addEventListener('resize', this.handleResize);
  }

  ngOnDestroy(): void {
    this.effectPlayer.resetAll();
    if (this.cutRegionSaveTimer) clearTimeout(this.cutRegionSaveTimer);
    this.mediaPlayer.detachElement();
    this.playbackWatch.destroy();
    this.detachKeyboard?.();
    this.detachKeyboard = null;
    window.removeEventListener('resize', this.handleResize);
  }

  /* ── Public Methods (template) ───────────────────────── */
  togglePlay(): void {
    this.effectPlayer.resumeAudioContext();
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
    this.effectPlayer.resetAll();
    this.effectInProgress.set(false);
    this.mediaPlayer.seek(ratio * this.duration());
  }

  seekToTime(time: number): void {
    this.effectPlayer.resetAll();
    this.effectInProgress.set(false);
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
    return this.selectedWordIdSet().has(wordId);
  }

  /** @deprecated — use highlightedWordId() in template; kept for imperative code */
  isHighlighted(word: Word): boolean {
    return word.id === this.highlightedWordId();
  }

  isSearchMatch(word: Word): boolean {
    return this.searchMatchIds().has(word.id);
  }

  /** @deprecated — use activeSegmentId() in template; kept for imperative code */
  isActiveSegment(seg: Segment): boolean {
    return seg.id === this.activeSegmentId();
  }

  /** Build inline flow items for a segment: words interleaved with time markers and silence chips. */
  buildFlowItems(seg: Segment): FlowItem[] {
    const words = seg.words;
    if (!words.length) return [];
    const items: FlowItem[] = [];
    let nextTimeMark = Math.ceil(words[0].startTime / INLINE_TIME_INTERVAL_SEC) * INLINE_TIME_INTERVAL_SEC;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];

      // Time marker — when this word crosses a time-interval boundary
      if (w.startTime >= nextTimeMark) {
        items.push({
          kind: 'time',
          label: this.formatTimeShort(nextTimeMark),
          time: nextTimeMark,
          id: `t-${seg.id}-${nextTimeMark}`,
        });
        nextTimeMark += INLINE_TIME_INTERVAL_SEC;
        // Skip any additional boundaries this word may cross
        while (nextTimeMark <= w.startTime) nextTimeMark += INLINE_TIME_INTERVAL_SEC;
      }

      // Silence chip — gap between previous word's end and this word's start
      if (i > 0) {
        const gapStart = words[i - 1].endTime;
        const gapEnd = w.startTime;
        const gap = gapEnd - gapStart;
        if (gap >= INLINE_SILENCE_THRESHOLD_SEC) {
          items.push({
            kind: 'silence',
            label: gap >= 10 ? Math.round(gap) + 's' : gap.toFixed(1) + 's',
            midTime: gapStart + gap / 2,
            gapStart,
            gapEnd,
            duration: gap,
            id: `sil-${seg.id}-${i}`,
          });
        }
      }

      items.push({ kind: 'word', word: w });
    }
    return items;
  }

  toggleRemove(word: Word): void {
    if (this.editMode()) return;
    if (word.isRemoved) {
      this.applyCutRegionChange(this.cutRegionService.restore(this.clip(), [word.id]));
    } else {
      this.applyCutRegionChange(this.cutRegionService.cut(this.clip(), [word.id], this.defaultEffectType()));
    }
  }

  removeSelected(): void {
    if (!this.selectedWordIds().length) return;
    this.applyCutRegionChange(
      this.cutRegionService.cut(this.clip(), this.selectedWordIds(), this.defaultEffectType())
    );
    this.selectedWordIds.set([]);
  }

  restoreSelected(): void {
    if (!this.selectedWordIds().length) return;
    this.applyCutRegionChange(
      this.cutRegionService.restore(this.clip(), this.selectedWordIds())
    );
    this.selectedWordIds.set([]);
  }

  restoreAll(): void {
    const allRemoved = this.clip().segments.flatMap(s => s.words).filter(w => w.isRemoved).map(w => w.id);
    if (!allRemoved.length) return;
    if (allRemoved.length > 10 && !confirm(`Restore all ${allRemoved.length} removed words?`)) return;
    this.applyCutRegionChange(this.cutRegionService.restore(this.clip(), allRemoved));
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

  /** Return pixel width for a silence chip — sqrt scale for proportional sizing, clamped to [24, 120]. */
  silenceChipWidth(duration: number): number {
    return Math.min(120, Math.max(24, Math.round(Math.sqrt(duration) * 55)));
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
  undo(): void {
    const entry = this.editHistory.undo();
    if (!entry) return;
    const newClip = this.cutRegionService.applyUndo(this.clip(), entry);
    this.clipService.applyLocalUpdate(newClip);
    this.editVersion.update((v) => v + 1);
    this.scheduleCutRegionSave();
  }

  redo(): void {
    const entry = this.editHistory.redo();
    if (!entry) return;
    const newClip = this.cutRegionService.applyRedo(this.clip(), entry);
    this.clipService.applyLocalUpdate(newClip);
    this.editVersion.update((v) => v + 1);
    this.scheduleCutRegionSave();
  }

  toggleFiller(word: string): void {
    this.selectedFillers.update(set => {
      const next = new Set(set);
      next.has(word) ? next.delete(word) : next.add(word);
      return next;
    });
  }

  onRemovedWordClick(word: Word, event: MouseEvent): void {
    event.stopPropagation();
    if (this.editMode()) return;
    this.effectPopoverWordId.update((current) => (current === word.id ? null : word.id));
    this.durationEditRegionId.set(null);
  }

  closeEffectPopover(): void {
    this.effectPopoverWordId.set(null);
    this.durationEditRegionId.set(null);
  }

  setDefaultEffect(type: EffectType): void {
    this.defaultEffectType.set(type);
    const updated = this.cutRegionService.applyDefaultEffectType(this.clip(), type);
    this.clipService.applyLocalUpdate(updated);
    this.editVersion.update((v) => v + 1);
    this.scheduleCutRegionSave();
  }

  setRegionEffect(regionId: string, type: EffectType): void {
    this.applyCutRegionChange(this.cutRegionService.setEffectType(this.clip(), regionId, type));
  }

  setRegionDuration(regionId: string, ms: number): void {
    this.applyCutRegionChange(this.cutRegionService.setDuration(this.clip(), regionId, ms));
    this.durationEditRegionId.set(null);
  }

  resetRegionEffect(regionId: string): void {
    this.applyCutRegionChange(
      this.cutRegionService.resetEffectType(this.clip(), regionId, this.defaultEffectType())
    );
    const { clip: c2 } = this.cutRegionService.resetDuration(this.clip(), regionId);
    this.clipService.applyLocalUpdate(c2);
    this.editVersion.update((v) => v + 1);
    this.scheduleCutRegionSave();
    this.closeEffectPopover();
  }

  clearSelection(event: MouseEvent): void {
    if (this.editMode()) return;
    const target = event.target as HTMLElement;
    if (!target.closest('.filler-badge')) {
      this.closeEffectPopover();
    }
    if (target.classList.contains('transcript-body') ||
        target.classList.contains('word-flow') ||
        target.classList.contains('seg-content')) {
      this.selectedWordIds.set([]);
      this.selectionAnchorWordId.set(null);
    }
  }

  applySmartCut(): void {
    const fillers = this.selectedFillers();
    const interval = this.silenceIntervalSec();
    const wordIds: string[] = [];
    for (const seg of this.clip().segments) {
      for (let i = 0; i < seg.words.length; i++) {
        const w = seg.words[i];
        if (w.isRemoved) continue;
        if (fillers.size && fillers.has(w.text.toLowerCase())) { wordIds.push(w.id); continue; }
        if (i < seg.words.length - 1) {
          const gap = seg.words[i + 1].startTime - w.endTime;
          if (gap >= interval) wordIds.push(w.id);
        }
      }
    }
    if (wordIds.length) {
      this.applyCutRegionChange(this.cutRegionService.cut(this.clip(), wordIds, this.defaultEffectType()));
    }
    this.smartCutOpen.set(false);
  }

  isFillerWord(word: Word): boolean {
    if (!this.highlightFillers()) return false;
    return this.selectedFillers().has(word.text.toLowerCase());
  }

  private applyCutRegionChange({ clip, entry }: { clip: Clip; entry: CutHistoryEntry }): void {
    this.clipService.applyLocalUpdate(clip);
    this.editHistory.record(entry);
    this.editVersion.update((v) => v + 1);
    this.scheduleCutRegionSave();
  }

  private scheduleCutRegionSave(): void {
    if (this.cutRegionSaveTimer) clearTimeout(this.cutRegionSaveTimer);
    this.cutRegionSaveTimer = setTimeout(() => {
      const c = this.clip();
      this.clipService.updateCutRegions(c.id, c.cutRegions ?? []).subscribe({ error: console.error });
      this.cutRegionSaveTimer = null;
    }, 800);
  }

  private applyJumpCut(currentTime: number): void {
    if (this.effectInProgress()) return;

    const segments = this.clip().segments;
    let startIdx = Math.max(0, this.lastActiveSegmentIdx);
    if (startIdx < segments.length && currentTime < segments[startIdx].startTime) startIdx = 0;

    const EPSILON = 0.08;

    for (let i = startIdx; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startTime > currentTime + 1) break;

      for (const word of seg.words) {
        if (!word.isRemoved) continue;
        if (currentTime < word.startTime - EPSILON || currentTime >= word.endTime - EPSILON) continue;

        const nextStart = this.findNextActiveWordStart(word.endTime);
        if (nextStart === null) { this.enforceSegmentBounds(currentTime); return; }
        if (Math.abs(nextStart - currentTime) <= EPSILON) return;

        const region = this.wordIdToRegion().get(word.id);
        const effectType = region?.effectType ?? 'hard-cut';
        const effectDuration = region?.effectDuration ?? 200;
        const halfMs = effectDuration / 2;

        if (effectType === 'hard-cut') {
          this.mediaPlayer.seek(nextStart);
        } else if (effectType === 'fade') {
          this.effectInProgress.set(true);
          this.effectPlayer.startFadeOut(halfMs);
          setTimeout(() => {
            this.mediaPlayer.seek(nextStart);
            this.effectPlayer.startFadeIn(halfMs);
            setTimeout(() => this.effectInProgress.set(false), halfMs + 50);
          }, halfMs);
        } else if (effectType === 'cross-cut') {
          this.effectInProgress.set(true);
          this.effectPlayer.triggerCrossCutFlash();
          this.mediaPlayer.seek(nextStart);
          this.effectPlayer.startAudioCrossfade(effectDuration);
          setTimeout(() => this.effectInProgress.set(false), effectDuration + 50);
        }
        return;
      }
    }
  }

  private enforceSegmentBounds(currentTime: number): void {
    const segments = this.clip().segments;
    if (!segments.length) return;
    const last = segments[segments.length - 1];
    if (currentTime >= last.endTime) this.mediaPlayer.pause();
  }

  private get lastActiveSegmentIdx(): number {
    const id = this.activeSegmentId();
    if (!id) return 0;
    return Math.max(0, this.clip().segments.findIndex(s => s.id === id));
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
    const id = this.activeSegmentId();
    if (!id) return -1;
    return this.clip().segments.findIndex(s => s.id === id);
  }

  private scrollToCurrentWord(): void {
    if (!this.autoFollow()) return;
    if (!this.transcriptElRef) return;
    const container = this.transcriptElRef.nativeElement;
    this.measureTranscriptViewport();

    this.suppressScrollDetection = true;
    setTimeout(() => { this.suppressScrollDetection = false; }, 600);

    // If playback is in a silence gap, scroll to the silence chip
    const silence = this.activeSilence();
    if (silence) {
      const silenceEl = container.querySelector(`.inline-silence[id="${silence.id}"]`) as HTMLElement | null
        || Array.from(container.querySelectorAll('.inline-silence')).find((el: any) => el.title === silence.id) as HTMLElement | null;
      if (silenceEl) {
        const cRect = container.getBoundingClientRect();
        const eRect = silenceEl.getBoundingClientRect();
        if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
          silenceEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return;
      }
    }

    // Otherwise, scroll to the highlighted word
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

}


function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
