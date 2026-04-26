import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  input,
  output,
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
import { SegmentMetadataPanelComponent } from '../segment-metadata-panel/segment-metadata-panel.component';

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
  silenceAfter: { id: string; duration: number; durationText: string; midTime: number } | null;
}

/** Items rendered inside the word-flow: a word, a time marker, or a silence chip. */
type FlowItem =
  | { kind: 'word'; word: Word }
  | { kind: 'time'; label: string; time: number; id: string }
  | { kind: 'silence'; label: string; midTime: number; gapStart: number; gapEnd: number; duration: number; id: string };

interface TrackItem {
  kind: 'segment' | 'gap';
  leftPercent: number;
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
  imports: [
    CommonModule, 
    SegmentMetadataPanelComponent
  ],
  template: `
<div class="player-v2" [class.rtl]="isRtl()">
  
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
                <span class="timecode-lg">{{ formatTimeLong(relativeTime()) }} / {{ formatTimeLong(clipDuration()) }}</span>
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
          <div class="word-caption" [class.is-edited]="cw.isEdited">{{ cw.text }}</div>
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
      <div class="timeline-track-container">
        <div class="ruler">
          @for (mark of rulerMarks(); track mark.percent) {
            <span class="ruler-tick" [style.left.%]="mark.percent">
              <span class="ruler-label">{{ mark.label }}</span>
            </span>
          }
        </div>
        <div class="timeline-track" (click)="onTimelineClick($event)">
        <div class="track-blocks">
          @for (item of trackItems(); track $index) {
            @if (item.kind === 'segment') {
              <div class="track-block"
                [style.left.%]="item.leftPercent"
                [style.width.%]="item.widthPercent"
                [style.background]="SEGMENT_PALETTE[item.colorIndex % SEGMENT_PALETTE.length].track"
                [style.border-left-color]="SEGMENT_PALETTE[item.colorIndex % SEGMENT_PALETTE.length].border"
              ></div>
            } @else {
              <div class="track-gap"
                [style.left.%]="item.leftPercent"
                [style.width.%]="item.widthPercent"></div>
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
    </div>
  </section>

  <!-- Metadata Panel Section (Column 2) - Positions between player and transcript -->
  <div class="metadata-panel-side" [class.opened]="metadataPanelOpen()">
    <div class="side-label" (click)="metadataPanelToggle.emit()"><span>METADATA</span></div>
    <div class="panel-content">
      @if (metadataPanelOpen()) {
        <app-segment-metadata-panel
          [segmentId]="selectedSegmentId()"
          [clips]="[clip()]"
        />
      }
    </div>
  </div>

  <!-- ═══════════ Right: Transcript Panel ═══════════ -->
  <section class="transcript-section" 
    [class.opened]="isTranscriptOpen()"
    [class.metadata-mode]="metadataPanelOpen()">

    <!-- Vertical side label -->
    <div class="side-label" (click)="isTranscriptOpen.set(!isTranscriptOpen())"><span>TRANSCRIPT</span></div>

    <!-- Linkage Indicator (The visual bridge) -->
    @if (selectedSegmentLinkage(); as linkage) {
      <div class="linkage-indicator"
        [class.visible]="linkage.isVisible"
        [style.transform]="'translateY(' + linkage.top + 'px)'"
        [style.height.px]="linkage.height"
        [style.--link-color]="linkage.color">
        <div class="linkage-beam"></div>
        <div class="linkage-arrow"></div>
      </div>
    }

    <div class="transcript-content-wrapper">

    <!-- Header -->
    <div class="transcript-header">
      <!-- Row 1: Search + Standard Tools -->
      <div class="header-row1">
        <!-- Collapsible search + Match iteration -->
        <div class="search-wrap" [class.expanded]="searchExpanded()">
          <button class="hdr-btn search-trigger" (click)="toggleSearch()" title="Search">
            <span class="material-symbols-outlined">search</span>
          </button>
          <div class="search-input-group">
            <input
              type="text"
              class="search-input"
              placeholder="Search transcript..."
              [value]="searchQuery()"
              (input)="searchQuery.set($any($event.target).value)"
              (keydown.enter)="$event.preventDefault(); nextSearchMatch()"
              (keydown.shift.enter)="$event.preventDefault(); prevSearchMatch()"
            />
            @if (searchExpanded() && searchQuery() && searchMatchIds().length > 0) {
              <div class="search-nav">
                <span class="search-counts">{{ currentMatchIndex() + 1 }} / {{ searchMatchIds().length }}</span>
                <button class="nav-btn" (click)="prevSearchMatch()" title="Previous match">
                  <span class="material-symbols-outlined">keyboard_arrow_up</span>
                </button>
                <button class="nav-btn" (click)="nextSearchMatch()" title="Next match">
                  <span class="material-symbols-outlined">keyboard_arrow_down</span>
                </button>
              </div>
            }
          </div>
        </div>

        <div class="spacer"></div>

        @if (!searchExpanded()) {
          <!-- Tools visible when search is NOT expanded -->
          <div class="hdr-group">
            <!-- Mode control -->
            <button class="hdr-btn" [class.active]="editMode()" (click)="editMode.set(!editMode())" [disabled]="metadataPanelOpen()" title="Toggle Edit Mode (E)">
              <span class="material-symbols-outlined">{{ editMode() ? 'edit_off' : 'edit' }}</span>
            </button>

            <!-- Smart Cut -->
            <div class="smart-cut-wrap">
              <button class="hdr-btn" [class.active]="smartCutOpen()" (click)="toggleMenu('smartCut')" [disabled]="metadataPanelOpen()" title="Smart Cut">
                <span class="material-symbols-outlined">auto_fix_high</span>
              </button>
              @if (smartCutOpen()) {
                <div class="smart-cut-dropdown popover">
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
                    <button class="sc-toggle" [class.active]="highlightFillers()" (click)="highlightFillers.set(!highlightFillers())">
                      <span class="material-symbols-outlined">visibility</span>
                      Fillers
                    </button>
                    <button class="sc-toggle" [class.active]="highlightSilence()" (click)="highlightSilence.set(!highlightSilence())">
                      <span class="material-symbols-outlined">hourglass_empty</span>
                      Silence
                    </button>
                  </div>
                  <button class="sc-apply-btn" (click)="applySmartCut()">Apply Smart Cut</button>
                </div>
              }
            </div>

            <!-- Interval (Silence) -->
            <div class="silence-control-wrap">
              <button class="hdr-btn" [class.active]="silenceControlOpen()" (click)="toggleMenu('silence')" [disabled]="metadataPanelOpen()" title="Min silence interval">
                <span class="material-symbols-outlined">timer</span>
              </button>
              @if (silenceControlOpen()) {
                <div class="silence-dropdown popover">
                  <div class="si-header">
                    <span class="si-label">Min Gap</span>
                    <div class="si-value">
                      <input type="number" class="si-input" min="0.1" max="5" step="0.1"
                        [value]="silenceIntervalSec()"
                        (change)="silenceIntervalSec.set(+$any($event.target).value)"
                      />
                      <span class="si-unit">s</span>
                    </div>
                  </div>
                  <input type="range" class="si-slider" min="0.1" max="5" step="0.1"
                    [value]="silenceIntervalSec()"
                    (input)="silenceIntervalSec.set(+$any($event.target).value)"
                  />
                </div>
              }
            </div>
          </div>

          <!-- Edit History -->
          <div class="hdr-group hdr-divider">
            <button class="hdr-btn" (click)="restoreAll()" [disabled]="removedCount() === 0 || metadataPanelOpen()" title="Restore all removals">
              <span class="material-symbols-outlined">settings_backup_restore</span>
            </button>
            <button class="hdr-btn" (click)="undo()" [disabled]="!canUndo() || metadataPanelOpen()" title="Undo (Control+Z)">
              <span class="material-symbols-outlined">undo</span>
            </button>
            <button class="hdr-btn" (click)="redo()" [disabled]="!canRedo() || metadataPanelOpen()" title="Redo (Control+Shift+Z)">
              <span class="material-symbols-outlined">redo</span>
            </button>
          </div>
        } @else {
          <!-- Search is expanded -> Collapse ALL tools into more menu -->
          <div class="more-menu-wrap">
            <button class="hdr-btn" [class.active]="moreMenuOpen()" (click)="toggleMenu('more')" title="More tools">
              <span class="material-symbols-outlined">more_horiz</span>
            </button>
            @if (moreMenuOpen()) {
              <div class="more-menu-dropdown popover">
                <div class="menu-item-group">
                  <span class="menu-label">Editor Mode</span>
                  <button class="hdr-btn w-full" [class.active]="editMode()" (click)="editMode.set(!editMode())" [disabled]="metadataPanelOpen()" style="justify-content:flex-start; width:100%; gap:8px; padding:0 8px">
                    <span class="material-symbols-outlined">{{ editMode() ? 'edit_off' : 'edit' }}</span>
                    <span>{{ editMode() ? 'Disable Edit Mode' : 'Enable Edit Mode' }}</span>
                  </button>
                </div>

                <div class="menu-item-group">
                  <span class="menu-label">Smart Cut</span>
                  <div class="sc-toggles">
                    <button class="sc-toggle" [class.active]="highlightFillers()" (click)="highlightFillers.set(!highlightFillers())" [disabled]="metadataPanelOpen()">
                      <span class="material-symbols-outlined">visibility</span>
                      Fillers
                    </button>
                    <button class="sc-toggle" [class.active]="highlightSilence()" (click)="highlightSilence.set(!highlightSilence())" [disabled]="metadataPanelOpen()">
                      <span class="material-symbols-outlined">hourglass_empty</span>
                      Silence
                    </button>
                  </div>
                  <button class="sc-apply-btn" (click)="applySmartCut()" [disabled]="metadataPanelOpen()" style="margin-top:4px">Apply Smart Cut</button>
                </div>

                <div class="menu-item-group">
                  <span class="menu-label">Min Silence Gap</span>
                  <div class="si-row">
                    <input type="range" class="si-slider" min="0.1" max="5" step="0.1"
                      [value]="silenceIntervalSec()"
                      (input)="silenceIntervalSec.set(+$any($event.target).value)"
                    />
                    <span class="si-val-text">{{ silenceIntervalSec() }}s</span>
                  </div>
                </div>

                <div class="menu-item-group">
                  <span class="menu-label">History</span>
                  <div class="hdr-group">
                    <button class="hdr-btn" (click)="restoreAll()" [disabled]="removedCount() === 0 || metadataPanelOpen()" title="Restore all">
                      <span class="material-symbols-outlined">settings_backup_restore</span>
                    </button>
                    <button class="hdr-btn" (click)="undo()" [disabled]="!canUndo() || metadataPanelOpen()" title="Undo">
                      <span class="material-symbols-outlined">undo</span>
                    </button>
                    <button class="hdr-btn" (click)="redo()" [disabled]="!canRedo() || metadataPanelOpen()" title="Redo">
                      <span class="material-symbols-outlined">redo</span>
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Row 2: Selection Actions (Only shown on selection) -->
      <div class="header-row2 selection-toolbar" [class.visible]="selectedCount() > 0 && !metadataPanelOpen()">
        <div class="hdr-group">
          <button class="hdr-btn" (click)="removeSelected()" [disabled]="metadataPanelOpen()" title="Cut selected">
            <span class="material-symbols-outlined">content_cut</span>
          </button>
          <button class="hdr-btn" (click)="restoreSelected()" title="Healing restore selected">
            <span class="material-symbols-outlined">healing</span>
          </button>
          <button class="hdr-btn" [class.active]="jumpCutMode()" (click)="jumpCutMode.set(!jumpCutMode())" title="Jump-cut preview">
            <span class="material-symbols-outlined">auto_awesome</span>
          </button>
        </div>

        <div class="spacer"></div>

        <!-- Effect Pills (Default selection effect) -->
        <div class="effect-pills-wrap">
          <button class="effect-pill" [class.active]="defaultEffectType() === 'hard-cut'"
            (click)="setDefaultEffect('hard-cut')" title="Hard Cut">
            <span class="material-symbols-outlined" style="font-size:1rem">content_cut</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'fade'"
            (click)="setDefaultEffect('fade')" title="Fade">
            <span class="material-symbols-outlined" style="font-size:1rem">blur_on</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'cross-cut'"
            (click)="setDefaultEffect('cross-cut')" title="Cross-Cut">
            <span class="material-symbols-outlined" style="font-size:1rem">shuffle</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Scrollable Transcript -->
    <div class="transcript-body" #transcriptEl
      [class.drag-selecting]="isDragSelecting()"
      (scroll)="onTranscriptScroll()"
      (click)="clearSelection($event)">
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

        <div class="seg-block" 
          [class.active]="active"
          [class.selected-for-meta]="seg.id === selectedSegmentId()"
          (click)="onSegmentClick(seg.id); $event.stopPropagation()">
          
          <!-- Segment progress trail -->
          <div class="segment-trail" [style.width.%]="getSegmentTrail(seg)"></div>

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
              @if (hasMetadata(seg)) {
                <span class="material-symbols-outlined segment-metadata-indicator" title="Segment has metadata">description</span>
              }
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
                    [class.is-edited]="fi.word.isEdited"
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
                      (blur)="onWordTextBlur(fi.word, $event)"
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
                  <span class="word" [attr.id]="fi.word.id"
                    [class.is-edited]="fi.word.isEdited"
                    [class.highlighted]="fi.word.id === highlightedWordId()"
                    [class.selected]="selectedWordIdSet().has(fi.word.id)"
                    [class.search-match]="searchMatchIdSet().has(fi.word.id)"
                    [class.search-match-active]="fi.word.id === activeSearchMatchId()"
                    [class.filler-hl]="isFillerWord(fi.word)"
                    (mousedown)="onWordMouseDown(fi.word, $event)"
                    (mouseenter)="onWordMouseEnter(fi.word)"
                    (click)="onWordClick(fi.word, $event)"
                    (dblclick)="toggleRemove(fi.word)"
                    (blur)="onWordTextBlur(fi.word, $event)"
                    [attr.contenteditable]="editMode() ? 'plaintext-only' : 'false'"
                    [title]="editMode() ? 'Click to edit' : 'Double-click to remove'"
                  >{{ fi.word.text }}</span>
                }
              }
            </div>
          </div>
        </div>

        <!-- Silence marker (Always visible if exists) -->
        @if (item.silenceAfter; as sil) {
          <div class="silence-row" [class.silence-playing]="activeSilence()?.id === sil.id">
            <div class="silence-line"></div>
            <div class="silence-pill"
              [class.silence-playing]="activeSilence()?.id === sil.id"
              [class.silence-hl]="highlightSilence() && sil.duration >= silenceIntervalSec()"
              [style.--sil-prog]="activeSilence()?.id === sil.id ? activeSilence()!.progress : 0"
              (click)="seekToTime(sil.midTime)">
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
      <!-- AI Indicator (Reflects Edited state) -->
      <span class="status-chip status-indicator" 
        [class.is-edited-badge]="isTranscriptEdited()"
        [title]="isTranscriptEdited() ? 'AI Generated (User Edited)' : 'Auto-Generated Transcript'">
        <span class="material-symbols-outlined">psychology</span>
        @if (isTranscriptEdited()) {
          <span class="chip-label">Edited</span>
        }
      </span>

      @if (selectedCount()) {
        <span class="status-chip" [title]="selectedCount() + ' selected'">
          <span class="material-symbols-outlined">select_all</span>
          <span class="chip-count">{{ selectedCount() }}</span>
        </span>
      }
      @if (removedCount()) {
        <span class="status-chip status-removed" [title]="removedCount() + ' removed'">
          <span class="material-symbols-outlined">content_cut</span>
          <span class="chip-count">{{ removedCount() }}</span>
        </span>
      }
      
      <div class="spacer"></div>

      <!-- Auto-follow toggle (moved from header) -->
      <button class="status-chip status-interactive" [class.active]="autoFollow()"
        [title]="autoFollow() ? 'Auto-follow active' : 'Auto-follow paused'"
        (click)="autoFollow() ? pauseFollow() : returnToCurrentWord()">
        <span class="material-symbols-outlined">track_changes</span>
      </button>

      @if (highlightFillers()) {
        <span class="status-chip status-indicator filler-hl-indicator" title="Filler Words Highlighted">
          <span class="material-symbols-outlined" style="font-size:1rem;color:#f59e0b">visibility</span>
          <span class="chip-label">Fillers</span>
        </span>
      }
      @if (highlightSilence()) {
        <span class="status-chip status-indicator silence-hl-indicator" title="Silence Gaps Highlighted">
          <span class="material-symbols-outlined" style="font-size:1rem;color:#3b82f6">hourglass_empty</span>
          <span class="chip-label">Silence</span>
        </span>
      }

      @if (jumpCutMode()) {
        <span class="status-chip status-mode" title="Jump Cut Mode Active">
          <span class="chip-label">Preview: Jump Cut</span>
        </span>
      }
    </div>

      @if (shouldVirtualize()) {
        <div class="v-spacer" [style.height.px]="virtualPaddingBottom()"></div>
      }
    </div>
  </section>
  
  <!-- Export Panel Section -->
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
  readonly metadataPanelOpen = input(false);
  readonly metadataPanelToggle = output<void>();
  readonly isRtl = input(false);

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
  readonly currentMatchIndex = signal(0);
  readonly selectedWordIds = signal<string[]>([]);
  readonly selectionAnchorWordId = signal<string | null>(null);
  readonly isDragSelecting = signal(false);
  readonly transcriptScrollTop = signal(0);
  readonly transcriptViewportHeight = signal(0);
  /* ── Direction Input ── */

  readonly selectedSegmentId = signal<string | null>(null);
  private dragSelectAnchorId: string | null = null;
  private dragSelectBaselineIds: string[] = [];
  private isDragAppendMode = false;
  readonly playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  private readonly editVersion = signal(0);

  private readonly searchResetWatch = effect(() => {
    this.searchQuery();
    this.currentMatchIndex.set(0);
  }, { allowSignalWrites: true });

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

  /** Whether the responsive "More" menu is open; mutual exclusion with silence/smart-cut */
  readonly moreMenuOpen = signal(false);
  readonly isTranscriptOpen = signal(true);

  /** Checks if any word in the clip has been manually text-edited */
  readonly isTranscriptEdited = computed(() => {
    this.editVersion(); // track manual text edits
    return this.clip().segments.some(seg => seg.words.some(w => w.isEdited));
  });

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
  readonly clipDuration = computed(() => Math.max(0.1, this.clip().endTime - this.clip().startTime));
  readonly relativeTime = computed(() => Math.max(0, this.currentTime() - this.clip().startTime));

  readonly progress = computed(() => {
    return Math.max(0, Math.min(100, (this.relativeTime() / this.clipDuration()) * 100));
  });

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
    this.editVersion(); // track manual text edits
    const t = this.currentTime();
    const segments = this.clip().segments;
    
    for (const seg of segments) {
      for (const w of seg.words) {
        if (w.isRemoved) continue;
        // Strict boundary check — no snapping to nearest word in gaps
        if (t >= w.startTime && t < w.endTime) return w;
      }
    }
    return null; 
  });

  /** Precise vertical geometry of the selected segment for the linkage indicator. */
  readonly selectedSegmentLinkage = computed(() => {
    const id = this.selectedSegmentId();
    if (!id || !this.metadataPanelOpen()) return null;
    
    const items = this.segmentViewItems();
    const item = items.find(i => i.segment.id === id);
    if (!item) return null;

    const viewportTop = item.top - this.transcriptScrollTop();
    const height = item.bottom - item.top;
    const color = SEGMENT_PALETTE[item.colorIndex % SEGMENT_PALETTE.length].border;

    // Visibility check (is it within the scrollable viewport?)
    const isVisible = viewportTop + height > -10 && viewportTop < this.transcriptViewportHeight() + 10;

    return { top: viewportTop, height, color, isVisible };
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
    const segments = this.clip().segments;
    
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const words = seg.words.filter(w => !w.isRemoved);
      
      // 1. Check inner-segment gaps (between words)
      for (let j = 1; j < words.length; j++) {
        const gapStart = words[j - 1].endTime;
        const gapEnd = words[j].startTime;
        const gap = gapEnd - gapStart;
        if (gap >= INLINE_SILENCE_THRESHOLD_SEC && t >= gapStart && t < gapEnd) {
          return {
            id: `sil-${seg.id}-${j}`,
            progress: (t - gapStart) / gap,
          };
        }
      }

      // 2. Check inter-segment gap (after this segment, before the next)
      if (i < segments.length - 1) {
        const nextStart = segments[i + 1].startTime;
        const gapStart = seg.endTime;
        const gapEnd = nextStart;
        const gap = gapEnd - gapStart;
        
        if (gap >= SILENCE_THRESHOLD_SEC && t >= gapStart && t < gapEnd) {
          return {
            id: `sil-after-${seg.id}`,
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
    if (!q || q.length < 2) return [];
    
    // Subsequence fuzzy match (e.g. "abc" matches "apple berry cherry")
    /**
     * Smarter fuzzy match: matches subsequence and prioritizes starts-with.
     */
    const isFuzzyMatch = (text: string, query: string) => {
      const t = text.toLowerCase();
      const q = query.toLowerCase();
      if (t.includes(q)) return true; // Direct match
      
      let qIdx = 0;
      for (let i = 0; i < t.length && qIdx < q.length; i++) {
        if (t[i] === q[qIdx]) qIdx++;
      }
      return qIdx === q.length;
    };

    const ids: string[] = [];
    for (const seg of this.clip().segments) {
      for (const w of seg.words) {
        if (isFuzzyMatch(w.text, q)) ids.push(w.id);
      }
    }
    return ids;
  });

  readonly searchMatchIdSet = computed(() => new Set(this.searchMatchIds()));

  /** The ID of the currently active/focused search match. */
  readonly activeSearchMatchId = computed(() => {
    const matches = this.searchMatchIds();
    return matches.length > 0 ? matches[this.currentMatchIndex()] : null;
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
    const clipStart = this.clip().startTime;
    const dur = this.clipDuration();
    if (!segments.length || dur <= 0) return [];
    
    const items: TrackItem[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const ci = this.segColorIndex(seg, i);
      
      // Gap BEFORE segment (inter-segment gap)
      if (i === 0) {
        const firstGap = seg.startTime - clipStart;
        if (firstGap > 0.05) {
          items.push({
            kind: 'gap',
            leftPercent: 0,
            widthPercent: (firstGap / dur) * 100,
            colorIndex: 0
          });
        }
      } else {
        const gap = seg.startTime - segments[i - 1].endTime;
        if (gap > 0.05) {
          items.push({
            kind: 'gap',
            leftPercent: ((segments[i - 1].endTime - clipStart) / dur) * 100,
            widthPercent: (gap / dur) * 100,
            colorIndex: ci
          });
        }
      }

      // Render the segment based on its verbatim start/end
      items.push({
        kind: 'segment',
        leftPercent: ((seg.startTime - clipStart) / dur) * 100,
        widthPercent: ((seg.endTime - seg.startTime) / dur) * 100,
        colorIndex: ci
      });
    }
    return items;
  });

  /* ── Computed: Cut Region Overlays ──────────────────── */
  readonly cutRegionOverlays = computed(() => {
    this.editVersion();
    const clip = this.clip();
    const dur = this.clipDuration();
    const clipStart = clip.startTime;
    if (!dur || !clip.cutRegions?.length) return [];

    const wordMap = new Map<string, Word>();
    for (const seg of clip.segments) {
      for (const w of seg.words) wordMap.set(w.id, w);
    }

    return clip.cutRegions
      .map((region) => {
        let start: number;
        let end: number;

        if (region.startTime !== undefined && region.endTime !== undefined) {
          // Time-based region (gaps)
          start = region.startTime;
          end = region.endTime;
        } else {
          // Word-based region
          const words = region.wordIds.map((id) => wordMap.get(id)).filter((w): w is Word => !!w);
          if (!words.length) return null;
          start = Math.min(...words.map((w) => w.startTime));
          end = Math.max(...words.map((w) => w.endTime));
        }

        return {
          regionId: region.id,
          leftPercent: ((start - clipStart) / dur) * 100,
          widthPercent: ((end - start) / dur) * 100,
          effectType: region.effectType,
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
  });

  /* ── Computed: Timeline Ruler Marks ──────────────────── */
  readonly rulerMarks = computed<Array<{ percent: number; label: string }>>(() => {
    const dur = this.clipDuration();
    if (dur <= 0) return [];
    
    // Proportional interval targeting ~8-12 marks
    const targetMarks = 10;
    const rawInterval = dur / targetMarks;
    
    // Snap interval to nice clear numbers: 1, 2, 5, 10, 15, 30, 60, 120, etc.
    const niceSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let interval = niceSteps[niceSteps.length - 1];
    for (const step of niceSteps) {
      if (rawInterval <= step * 1.5) {
        interval = step;
        break;
      }
    }

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
    this.editVersion();
    const clip = this.clip();
    const segments = clip.segments;
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
        const nextStart = segments[index + 1].startTime;
        const gap = nextStart - segment.endTime;
        if (gap >= SILENCE_THRESHOLD_SEC) {
          item.silenceAfter = {
            id: `sil-after-${segment.id}`,
            duration: gap,
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
    this.editVersion();
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
  private readonly handleDragEnd = () => this.endDragSelect();
  private detachKeyboard: (() => void) | null = null;
  private previousVolume = 1;
  /** Set synchronously in endDragSelect; consumed in onWordClick to prevent the
   *  follow-up click from collapsing the drag selection to a single word. */
  private justCompletedDrag = false;

  private readonly playbackWatch = effect(() => {
    const t = this.currentTime();
    const clip = this.clip();

    // Bounds enforcement: if playing and we reach or exceed the clip end, pause.
    if (this.playing() && t >= clip.endTime) {
      this.mediaPlayer.pause();
      this.mediaPlayer.seek(clip.endTime);
    }

    if (this.jumpCutMode() && this.playing()) this.applyJumpCut(t);
    this.scrollToCurrentWord();
  });

  /** Sync player position to clip bounds when the clip object changes. */
  private readonly clipSyncWatch = effect(() => {
    const clip = this.clip();
    const t = this.currentTime();
    // Use a small 0.1s buffer to avoid aggressive snapping during transients
    if (t < clip.startTime - 0.1 || t > clip.endTime + 0.1) {
      this.mediaPlayer.seek(clip.startTime);
    }
  }, { allowSignalWrites: true });

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
      removeSelection: () => { if (!this.metadataPanelOpen()) this.removeSelected(); },
      undo: () => { if (!this.metadataPanelOpen()) this.undo(); },
      redo: () => { if (!this.metadataPanelOpen()) this.redo(); },
      toggleMetadata: () => this.metadataPanelToggle.emit(),
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
    document.addEventListener('mouseup', this.handleDragEnd);
  }

  ngOnDestroy(): void {
    this.effectPlayer.resetAll();
    if (this.cutRegionSaveTimer) clearTimeout(this.cutRegionSaveTimer);
    this.mediaPlayer.detachElement();
    this.playbackWatch.destroy();
    this.detachKeyboard?.();
    this.detachKeyboard = null;
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('mouseup', this.handleDragEnd);
  }

  /* ── Public Methods (template) ───────────────────────── */
  togglePlay(): void {
    this.effectPlayer.resumeAudioContext();
    this.playing() ? this.mediaPlayer.pause() : this.mediaPlayer.play().catch(() => {});
  }

  toggleSearch(): void {
    const newState = !this.searchExpanded();
    this.searchExpanded.set(newState);
    if (!newState) {
      this.searchQuery.set('');
    }
  }

  toggleMetadataPanel(): void {
    const opening = !this.metadataPanelOpen();
    if (opening) {
      // Clear word selection when entering metadata mode
      this.selectedWordIds.set([]);
      this.selectionAnchorWordId.set(null);
    }
    this.metadataPanelToggle.emit();
    if (!this.metadataPanelOpen() && !this.selectedSegmentId()) {
      this.selectedSegmentId.set(this.activeSegmentId());
    }
    this.moreMenuOpen.set(false);
  }

  onSegmentClick(segId: string): void {
    this.selectedSegmentId.set(segId);
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
    this.mediaPlayer.seek(this.clip().startTime + ratio * this.clipDuration());
  }

  seekToTime(time: number): void {
    this.effectPlayer.resetAll();
    this.effectInProgress.set(false);
    this.mediaPlayer.seek(time);
  }

  onWordClick(word: Word, event: MouseEvent): void {
    // Drag just finished — the click that fires after mouseup must not collapse selection
    if (this.justCompletedDrag) {
      this.justCompletedDrag = false;
      return;
    }
    if (this.editMode() || this.metadataPanelOpen()) return;
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
    if (!word.isRemoved) this.mediaPlayer.seek(word.startTime);
  }

  onWordMouseDown(word: Word, event: MouseEvent): void {
    if (this.editMode() || this.metadataPanelOpen()) return;
    if (event.button !== 0) return; // left button only
    this.dragSelectAnchorId = word.id;
    this.isDragAppendMode = event.ctrlKey || event.metaKey;
    this.dragSelectBaselineIds = this.isDragAppendMode ? [...this.selectedWordIds()] : [];
    // Don't set isDragSelecting yet — wait until the pointer actually moves to a different word
  }

  onWordMouseEnter(word: Word): void {
    if (this.editMode() || this.metadataPanelOpen()) return;
    if (!this.dragSelectAnchorId) return;
    if (word.id === this.dragSelectAnchorId) return;
    // First time we enter a different word — commit to drag-select mode
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
      // Seek to first selected word so playhead jumps to the selection start
      const firstId = this.selectedWordIds()[0];
      if (firstId) {
        const word = this.findWordById(firstId);
        if (word && !word.isRemoved) this.mediaPlayer.seek(word.startTime);
      }
      // Flag consumed by onWordClick to block the click that fires right after mouseup
      this.justCompletedDrag = true;
      // Safety: reset flag after a short delay if it wasn't swallowed by onWordClick
      setTimeout(() => this.justCompletedDrag = false, 100);
    }
    this.dragSelectAnchorId = null;
    this.isDragSelecting.set(false);
  }

  isSelected(wordId: string): boolean {
    return this.selectedWordIdSet().has(wordId);
  }

  /** @deprecated — use highlightedWordId() in template; kept for imperative code */
  isHighlighted(word: Word): boolean {
    return word.id === this.highlightedWordId();
  }

  isSearchMatch(word: Word): boolean {
    return this.searchMatchIdSet().has(word.id);
  }

  nextSearchMatch(): void {
    const matches = this.searchMatchIds();
    if (!matches.length) return;
    const nextIdx = (this.currentMatchIndex() + 1) % matches.length;
    this.currentMatchIndex.set(nextIdx);
    this.scrollToWordById(matches[nextIdx]);
  }

  prevSearchMatch(): void {
    const matches = this.searchMatchIds();
    if (!matches.length) return;
    const prevIdx = (this.currentMatchIndex() - 1 + matches.length) % matches.length;
    this.currentMatchIndex.set(prevIdx);
    this.scrollToWordById(matches[prevIdx]);
  }

  private scrollToWordById(wordId: string): void {
    const segments = this.clip().segments;
    let segIdx = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].words.some(w => w.id === wordId)) {
        segIdx = i;
        break;
      }
    }
    if (segIdx === -1) return;
    const viewItem = this.segmentViewItems()[segIdx];
    if (viewItem && this.transcriptElRef) {
      const container = this.transcriptElRef.nativeElement;

      // 1. First scroll to segment to ensure it's rendered by virtualization
      container.scrollTo({ top: viewItem.top, behavior: 'auto' });

      // 2. Then precisely scroll the word into the center of the viewport
      setTimeout(() => {
        const wordEl = container.querySelector(`[id="${wordId}"]`) as HTMLElement;
        if (wordEl) {
          wordEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 40);
    }
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

  /**
   * Universal menu toggler to enforce mutual exclusion.
   * menuName can be 'silence', 'smartCut', or 'more'.
   */
  toggleMenu(menuName: 'silence' | 'smartCut' | 'more'): void {
    // Current states
    const sil = this.silenceControlOpen();
    const sc = this.smartCutOpen();
    const more = this.moreMenuOpen();

    // Reset all
    this.silenceControlOpen.set(false);
    this.smartCutOpen.set(false);
    this.moreMenuOpen.set(false);

    // Toggle target
    if (menuName === 'silence') this.silenceControlOpen.set(!sil);
    if (menuName === 'smartCut') this.smartCutOpen.set(!sc);
    if (menuName === 'more') this.moreMenuOpen.set(!more);
  }

  onWordTextBlur(word: Word, event: FocusEvent): void {
    const el = event.target as HTMLElement;
    const newText = el.innerText.trim();
    if (newText !== word.text) {
      word.text = newText;
      word.isEdited = true;
      this.editVersion.update(v => v + 1);
      // We don't have a specific "text edit" save yet, but this triggers the periodic cutRegionSave
      // which actually saves the whole clip segments if implemented that way.
      // In this app, it seems we might need to call updateSegments if it exists.
      this.scheduleCutRegionSave();
    }
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
    if (this.isDragSelecting() || this.justCompletedDrag) return; 
    const target = event.target as HTMLElement;
    if (!target.closest('.filler-badge')) {
      this.closeEffectPopover();
    }
    if (target.classList.contains('transcript-body') ||
        target.classList.contains('word-flow') ||
        target.classList.contains('seg-content')) {
      this.selectedWordIds.set([]);
      this.selectionAnchorWordId.set(null);
      this.selectedSegmentId.set(null);
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
      
      // Save cut regions
      this.clipService.updateCutRegions(c.id, c.cutRegions ?? []).subscribe({ error: console.error });
      
      // Save edited word texts
      const editedWordUpdates = c.segments.flatMap(s => 
        s.words.filter(w => w.isEdited).map(w => ({ id: w.id, text: w.text, isEdited: true }))
      );
      if (editedWordUpdates.length > 0) {
        this.clipService.updateWordStates(c.id, editedWordUpdates).subscribe({ error: console.error });
      }

      this.cutRegionSaveTimer = null;
    }, 800);
  }

  private applyJumpCut(currentTime: number): void {
    if (this.effectInProgress()) return;

    const clip = this.clip();
    const segments = clip.segments;
    const EPSILON = 0.08;

    // 1. Check time-based cut regions (gaps without words)
    for (const region of clip.cutRegions || []) {
      if (region.startTime !== undefined && region.endTime !== undefined) {
        if (currentTime >= region.startTime - EPSILON && currentTime < region.endTime - EPSILON) {
          this.performJump(region.endTime, region);
          return;
        }
      }
    }

    // 2. Check word-based cut regions (as before)
    let startIdx = Math.max(0, this.lastActiveSegmentIdx);
    if (startIdx < segments.length && currentTime < segments[startIdx].startTime) startIdx = 0;

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
        this.performJump(nextStart, region);
        return;
      }
    }
  }

  private performJump(targetTime: number, region?: CutRegion): void {
    const effectType = region?.effectType ?? 'hard-cut';
    const effectDuration = region?.effectDuration ?? 200;
    const halfMs = effectDuration / 2;

    if (effectType === 'hard-cut') {
      this.mediaPlayer.seek(targetTime);
    } else if (effectType === 'fade') {
      this.effectInProgress.set(true);
      this.effectPlayer.startFadeOut(halfMs);
      setTimeout(() => {
        this.mediaPlayer.seek(targetTime);
        this.effectPlayer.startFadeIn(halfMs);
        setTimeout(() => this.effectInProgress.set(false), halfMs + 50);
      }, halfMs);
    } else if (effectType === 'cross-cut') {
      this.effectInProgress.set(true);
      this.effectPlayer.triggerCrossCutFlash();
      this.mediaPlayer.seek(targetTime);
      this.effectPlayer.startAudioCrossfade(effectDuration);
      setTimeout(() => this.effectInProgress.set(false), effectDuration + 50);
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

  hasMetadata(seg: Segment): boolean {
    if (!seg.metadata) return false;
    return Object.values(seg.metadata).some(entries => entries && entries.length > 0);
  }

  getSegmentTrail(seg: Segment): number {
    const ct = this.currentTime();
    if (ct < seg.startTime) return 0;
    if (ct > seg.endTime) return 100;
    const dur = seg.endTime - seg.startTime;
    if (dur <= 0) return 0;
    return ((ct - seg.startTime) / dur) * 100;
  }
}


function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
