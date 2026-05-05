import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
  DestroyRef,
  Injector,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Clip, SceneType } from '../../../core/models/clip.model';
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
import { SettingsService } from '../../../core/services/settings.service';
import { PendingEditsService } from '../txt-media-player/pending-edits.service';
import { NotebookService } from '../../../core/services/notebook.service';
import { SmartCutQueueService } from '../txt-media-player/smart-cut-queue.service';
import { SmartCutCacheService } from '../txt-media-player/smart-cut-cache.service';
import { SMART_CUT_PREVIEW_PREROLL_MS, SMART_CUT_PREVIEW_POSTROLL_MS } from '../txt-media-player/smart-cut.constants';

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
  silenceAfter: { id: string; duration: number; durationText: string; midTime: number; gapStart: number; gapEnd: number } | null;
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

/* ── Cut Effect Options ─────────────────────────────────────── */
interface CutOption { type: EffectType; label: string; icon: string; description: string; }
const CUT_OPTIONS: CutOption[] = [
  { type: 'clear-cut',  label: 'Clear Cut',   icon: 'content_cut',  description: 'Hard cut — no transition. Precise and clean, no audio bleed.' },
  { type: 'fade-in',    label: 'Fade In',     icon: 'blur_on',      description: 'Audio fades in after the cut. Softens abrupt silence edges.' },
  { type: 'cross-cut',  label: 'Cross-Cut',   icon: 'shuffle',      description: 'Overlaps outgoing and incoming audio with a smooth crossfade.' },
  { type: 'smart',      label: 'Smart',       icon: 'auto_awesome', description: 'Auto-selects the best transition based on surrounding audio context.' },
  { type: 'smart-cut',  label: 'Frame Match', icon: 'auto_fix_high',description: 'Finds the best matching video frame for a seamless visual cut. Falls back to cross-cut if no match found.' },
];

/* ── Component ──────────────────────────────────────────────── */

@Component({
  selector: 'app-txt-media-player-v2',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, 
    SegmentMetadataPanelComponent
  ],
  host: {
    '(window:mousemove)': 'onMouseMove($event)',
    '(window:mouseup)': 'onMouseUp()',
    '(window:click)': 'onWindowClick($event)',
    '(window:keydown.escape)': 'closeContextMenu()',
  },
  template: `
<div class="player-v2" [class.rtl]="isRtl()" [class.resizing]="isResizing()">
  
  <!-- ═══════════ Left/Right: Transcript Panel ═══════════ -->
  <section class="transcript-section" 
    [class.opened]="isTranscriptOpen()"
    [class.metadata-mode]="metadataPanelOpen()"
    [style.width.px]="isTranscriptOpen() ? transcriptWidth() : 36">

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
            <button class="hdr-btn" [class.active]="textEditMode()" (click)="textEditMode.set(!textEditMode())" [disabled]="metadataPanelOpen()" title="Toggle Edit Mode (E)">
              <span class="material-symbols-outlined">{{ textEditMode() ? 'edit_off' : 'edit' }}</span>
            </button>

            <!-- Auto Clean -->
            <div class="auto-clean-wrap">
              <button class="hdr-btn" [class.active]="autoCleanOpen()" (click)="toggleMenu('autoClean')" [disabled]="metadataPanelOpen()" title="Auto Clean">
                <span class="material-symbols-outlined">auto_fix_high</span>
              </button>
              @if (autoCleanOpen()) {
                <div class="auto-clean-dropdown popover">
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
                  <div class="sc-section-title">Smart Cut Scene Style</div>
                  <div class="sc-chips">
                    <button class="sc-chip" 
                      [class.selected]="(clip().sceneType ?? 'talking-head') === 'talking-head'"
                      (click)="setClipSceneType('talking-head')">
                      <span class="material-symbols-outlined">person</span>
                      Solo
                    </button>
                    <button class="sc-chip" 
                      [class.selected]="clip().sceneType === 'two-shot'"
                      (click)="setClipSceneType('two-shot')">
                      <span class="material-symbols-outlined">group</span>
                      Two Shot
                    </button>
                  </div>
                  <button class="sc-apply-btn" (click)="applyAutoClean()">Apply Auto Clean</button>
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
                  <button class="hdr-btn w-full" [class.active]="textEditMode()" (click)="textEditMode.set(!textEditMode())" [disabled]="metadataPanelOpen()" style="justify-content:flex-start; width:100%; gap:8px; padding:0 8px">
                    <span class="material-symbols-outlined">{{ textEditMode() ? 'edit_off' : 'edit' }}</span>
                    <span>{{ textEditMode() ? 'Disable Edit Mode' : 'Enable Edit Mode' }}</span>
                  </button>
                </div>

                <div class="menu-item-group">
                  <span class="menu-label">Auto Clean</span>
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
                  <button class="sc-apply-btn" (click)="applyAutoClean()" [disabled]="metadataPanelOpen()" style="margin-top:4px">Apply Auto Clean</button>
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

            <!-- Segment toolbar: tab selector + context badge + scene type -->
            @if (seg.id === selectedSegmentId() && metadataPanelOpen()) {
              <div class="seg-toolbar" (click)="$event.stopPropagation()">
                <div class="seg-tab-sel" role="tablist" aria-label="Metadata panel view">
                  <button class="seg-tab-btn" role="tab" [class.active]="metadataTab() === 'clip'"
                    (click)="metadataTab.set('clip')" title="Clip">
                    <span class="material-symbols-outlined">movie</span>
                  </button>
                  <button class="seg-tab-btn" role="tab" [class.active]="metadataTab() === 'segment'"
                    (click)="metadataTab.set('segment')" title="Segment">
                    <span class="material-symbols-outlined">segment</span>
                  </button>
                  <button class="seg-tab-btn" role="tab" [class.active]="metadataTab() === 'notes'"
                    (click)="metadataTab.set('notes')" title="Notes">
                    <span class="material-symbols-outlined">notes</span>
                  </button>
                </div>
                @if (metadataTab() === 'clip') {
                  <span class="seg-ctx-badge seg-ctx-badge--clip">{{ clip().name }}</span>
                  <div class="seg-scene-type" role="group" aria-label="Scene type">
                    <button class="seg-scene-btn" [class.active]="(clip().sceneType ?? 'talking-head') === 'talking-head'"
                      (click)="setClipSceneType('talking-head')" title="Solo — single person, face-centered">
                      <span class="material-symbols-outlined">person</span>
                    </button>
                    <button class="seg-scene-btn" [class.active]="clip().sceneType === 'two-shot'"
                      (click)="setClipSceneType('two-shot')" title="Two Shot — wider frame">
                      <span class="material-symbols-outlined">group</span>
                    </button>
                  </div>
                } @else if (metadataTab() === 'segment') {
                  <span class="seg-ctx-badge">{{ formatTimeShort(seg.startTime) }}&ndash;{{ formatTimeShort(seg.endTime) }}</span>
                }
              </div>
            }

            <div class="word-flow">
              @for (fi of buildFlowItems(seg); track fi.kind === 'word' ? fi.word.id : fi.id) {
                @if (fi.kind === 'time') {
                  <span class="inline-time" (click)="seekToTime(fi.time)">{{ fi.label }}</span>
                } @else if (fi.kind === 'silence') {
                  @if (!highlightSilence() || fi.duration >= silenceIntervalSec()) {
                    @let silCut = getSilenceCutForGap(fi.gapStart, fi.gapEnd);
                    @let silTrim = silenceTrims().get(fi.id);
                    @let remainingDur = fi.duration - (silTrim?.trimStart || 0) - (silTrim?.trimEnd || 0);
                    <span class="inline-silence"
                      [class.silence-playing]="activeSilence()?.id === fi.id"
                      [class.silence-hl]="highlightSilence() && fi.duration >= silenceIntervalSec()"
                      [class.compact]="remainingDur < 0.5"
                      [class.silence-cut]="!!silCut"
                      [class.silence-trimmed]="!!silTrim && (silTrim.trimStart > 0 || silTrim.trimEnd > 0)"
                      [style.--sil-prog]="activeSilence()?.id === fi.id ? activeSilence()!.progress : 0"
                      [style.width.px]="silenceChipWidth(remainingDur)"
                      [title]="remainingDur.toFixed(1) + 's' + (silCut ? ' · Cut' : ' · Click scissors to cut')"
                      (click)="seekToTime(fi.midTime)">
                      <!-- Left resize handle -->
                      <span class="sil-handle sil-handle--start"
                        (mousedown)="onSilenceHandleMouseDown(fi, 'start', $event)"
                        title="Drag to trim silence start"></span>
                      <span class="material-symbols-outlined">hourglass_empty</span>
                      @if (remainingDur >= 0.5) { {{ remainingDur.toFixed(1) + 's' }} }
                      <!-- Cut/restore toggle -->
                      @if (fi.duration >= 0.3) {
                        <button class="sil-cut-btn" (click)="toggleSilenceCut(fi); $event.stopPropagation()"
                          [title]="silCut ? 'Restore silence gap' : 'Cut this silence gap'">
                          <span class="material-symbols-outlined">{{ silCut ? 'content_paste' : 'content_cut' }}</span>
                        </button>
                      }
                      <!-- Right resize handle -->
                      <span class="sil-handle sil-handle--end"
                        (mousedown)="onSilenceHandleMouseDown(fi, 'end', $event)"
                        title="Drag to trim silence end"></span>
                      <!-- Edited indicator -->
                      @if (silCut) {
                        <span class="sil-edited-dot" [title]="'Silence cut — ' + effectTypeLabel(silCut.effectType)"></span>
                      }
                    </span>
                  }
                } @else if (fi.word.isRemoved) {
                  @let region = wordIdToRegion().get(fi.word.id);
                  <span class="filler-badge"
                    [class.is-edited]="fi.word.isEdited"
                    [class.selected]="selectedWordIdSet().has(fi.word.id)"
                    [class.popover-open]="effectPopoverWordId() === fi.word.id"
                    [class.pending-add]="region?.pending && region?.pendingKind === 'add'"
                    (mousedown)="onWordMouseDown(fi.word, $event)"
                    (mouseenter)="onWordMouseEnter(fi.word)"
                    (click)="onRemovedWordClick(fi.word, $event)"
                    (dblclick)="toggleRemove(fi.word)"
                    (contextmenu)="onWordContextMenu(fi.word, $event)">

                    @if (region && (region.effectType !== 'smart-cut' && region.effectType !== 'smart' || getSmartCutStatus(region.id) === 'done' || !getSmartCutStatus(region.id))) {
                      <span class="effect-dot effect-dot--{{ region.effectType }}"
                        [class.sc-done]="getSmartCutStatus(region.id) === 'done'"
                        [title]="effectTypeLabel(region.effectType)"></span>
                    }

                    <span class="filler-text"
                      [attr.contenteditable]="textEditMode() ? 'plaintext-only' : 'false'" spellcheck="false"
                      (click)="$event.stopPropagation()"
                      (blur)="onWordTextBlur(fi.word, $event)"
                    >{{ fi.word.text }}</span>
                    <button class="filler-x" (click)="toggleRemove(fi.word); $event.stopPropagation()" aria-label="Restore word">
                      <span class="material-symbols-outlined">close</span>
                    </button>

                    @if (region && getSmartCutStatus(region.id); as scStatus) {
                      @if (scStatus !== 'done') {
                        <span
                          class="sc-status-dot sc-status-dot--{{ scStatus }}"
                          [attr.aria-label]="'Smart cut: ' + scStatus"
                          [title]="'Smart cut: ' + scStatus"
                          (mouseenter)="loadSmartCutThumbs(region.id, clip().id, getRegionTBefore(region), getRegionTAfterCenter(region))">
                          @if (smartCutThumbs()[region.id]; as thumbs) {
                            <span class="sc-thumb-popover">
                              <img [src]="thumbs.pre" alt="Pre-cut frame" width="160" height="90">
                              <span class="sc-thumb-arrow">→</span>
                              <img [src]="thumbs.post" alt="Post-cut frame" width="160" height="90">
                            </span>
                          }
                        </span>
                      }
                    }


                    @if (effectPopoverWordId() === fi.word.id && region) {
                      <div class="effect-popover" role="dialog" aria-label="Cut effect options" (click)="$event.stopPropagation()">
                        <div class="ep-row">
                          <div class="ep-pills" role="group" aria-label="Effect type">
                            @for (opt of CUT_OPTIONS; track opt.type) {
                              <button class="ep-pill" [class.active]="region.effectType === opt.type"
                                (click)="setWordEffect(fi.word.id, opt.type)"
                                [title]="opt.description">
                                {{ opt.label }}
                              </button>
                            }
                          </div>
                        </div>
                        @if (region.effectType === 'smart-cut' || region.effectType === 'smart') {
                          <div class="ep-row ep-scene-row">
                            <span class="ep-dur-label">Scene</span>
                            <div class="ep-scene-pills" role="group">
                              <button class="ep-pill"
                                [class.active]="(region.sceneType ?? clip().sceneType ?? 'talking-head') === 'talking-head'"
                                (click)="setRegionSceneType(region.id, 'talking-head')"
                                title="Single person, face-centered matching">
                                Solo
                              </button>
                              <button class="ep-pill"
                                [class.active]="(region.sceneType ?? clip().sceneType ?? 'talking-head') === 'two-shot'"
                                (click)="setRegionSceneType(region.id, 'two-shot')"
                                title="Two people, wider frame matching">
                                Two Shot
                              </button>
                            </div>
                          </div>
                        }
                        @if (region.effectType !== 'clear-cut') {
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
                        @if (region.effectTypeOverridden || region.durationFixed || region.sceneType) {
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
                    [class.pending-text]="!!fi.word.pendingText"
                    (mousedown)="onWordMouseDown(fi.word, $event)"
                    (mouseenter)="onWordMouseEnter(fi.word)"
                    (click)="onWordClick(fi.word, $event)"
                    (dblclick)="toggleRemove(fi.word)"
                    (contextmenu)="onWordContextMenu(fi.word, $event)"
                    (blur)="onWordTextBlur(fi.word, $event)"
                    [attr.contenteditable]="textEditMode() ? 'plaintext-only' : 'false'"
                    [title]="fi.word.pendingText ? 'Original: ' + fi.word.text : (textEditMode() ? 'Click to edit' : 'Double-click to remove')"
                  >{{ fi.word.pendingText ?? fi.word.text }}</span>
                }
              }
            </div>
          </div>
        </div>

        <!-- Silence marker (hidden below threshold when highlight mode active) -->
        @if (item.silenceAfter; as sil) {
          @if (!highlightSilence() || sil.duration >= silenceIntervalSec()) {
            @let silTrim = silenceTrims().get(sil.id);
            <div class="silence-row" [class.silence-playing]="activeSilence()?.id === sil.id">
              <div class="silence-line"></div>
              <div class="silence-pill"
                [class.silence-playing]="activeSilence()?.id === sil.id"
                [class.silence-hl]="highlightSilence() && sil.duration >= silenceIntervalSec()"
                [class.silence-trimmed]="!!silTrim && (silTrim.trimStart > 0 || silTrim.trimEnd > 0)"
                [style.--sil-prog]="activeSilence()?.id === sil.id ? activeSilence()!.progress : 0"
                (click)="seekToTime(sil.midTime)">
                <span class="sil-handle sil-handle--start"
                  (mousedown)="onSilenceHandleMouseDown(sil, 'start', $event)"
                  title="Drag to trim silence start"></span>
                <span class="material-symbols-outlined">timer</span>
                <span class="silence-text">{{ (sil.duration - (silTrim?.trimStart || 0) - (silTrim?.trimEnd || 0)).toFixed(1) }}s Silence</span>
                <span class="sil-handle sil-handle--end"
                  (mousedown)="onSilenceHandleMouseDown(sil, 'end', $event)"
                  title="Drag to trim silence end"></span>
              </div>
              <div class="silence-line"></div>
            </div>
          }
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

      <!-- Live / Apply mode toggle -->
      <div class="edit-mode-toggle edit-mode-toggle--compact" role="group" aria-label="Editing mode">
        <button class="mode-pill mode-pill--icon"
          [class.active]="editingMode() === 'live'"
          (click)="setEditingMode('live')"
          title="Live — changes apply immediately to the timeline">
          <span class="material-symbols-outlined">bolt</span>
        </button>
        <button class="mode-pill mode-pill--icon"
          [class.active]="editingMode() === 'apply'"
          (click)="setEditingMode('apply')"
          title="Apply — changes are staged until you confirm">
          <span class="material-symbols-outlined">pending_actions</span>
        </button>
      </div>

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
    </div>

    <!-- Floating Selection Toolbar -->
    @if (selectedCount() > 0 && !metadataPanelOpen()) {
      <div class="floating-sel-toolbar" role="toolbar" aria-label="Selection actions">
        <!-- Cut split button -->
        <div class="cut-split-wrap">
          <button class="cut-action-btn"
            (click)="removeSelected()"
            [title]="'Cut ' + selectedCount() + ' selected words using ' + effectTypeLabel(defaultEffectType())">
            <span class="material-symbols-outlined">{{ effectTypeIcon(defaultEffectType()) }}</span>
            <span class="cut-label">{{ effectTypeLabel(defaultEffectType()) }}</span>
          </button>
          <button class="cut-chevron-btn"
            (click)="cutDropdownOpen.set(!cutDropdownOpen()); $event.stopPropagation()"
            aria-label="Change cut effect type"
            [class.open]="cutDropdownOpen()">
            <span class="material-symbols-outlined">arrow_drop_down</span>
          </button>
          @if (cutDropdownOpen()) {
            <div class="cut-dropdown" role="menu" (click)="$event.stopPropagation()">
              @for (opt of CUT_OPTIONS; track opt.type) {
                <button class="cut-dropdown-item"
                  [class.active]="defaultEffectType() === opt.type"
                  (click)="setDefaultEffect(opt.type); cutDropdownOpen.set(false)"
                  role="menuitem">
                  <span class="material-symbols-outlined cut-opt-icon">{{ opt.icon }}</span>
                  <div class="cut-opt-text">
                    <span class="cut-opt-name">{{ opt.label }}</span>
                    <span class="cut-opt-desc">{{ opt.description }}</span>
                  </div>
                  @if (defaultEffectType() === opt.type) {
                    <span class="material-symbols-outlined cut-opt-check">check</span>
                  }
                </button>
              }
            </div>
          }
        </div>

        <!-- Restore -->
        <button class="sel-action-btn" (click)="restoreSelected()" title="Restore selected words">
          <span class="material-symbols-outlined">healing</span>
          <span class="cut-label">Restore</span>
        </button>

        <span class="sel-count-badge">{{ selectedCount() }}</span>
      </div>
    }

    <!-- Context Menu (right-click on word) -->
    @if (selectionContextMenu(); as cmPos) {
      <div class="sel-context-menu"
        role="menu"
        [style.left.px]="cmPos.x"
        [style.top.px]="cmPos.y"
        (click)="$event.stopPropagation()">
        <button class="ctx-item" (click)="removeSelected(); closeContextMenu()" role="menuitem">
          <span class="material-symbols-outlined">{{ effectTypeIcon(defaultEffectType()) }}</span>
          Cut {{ selectedCount() > 1 ? selectedCount() + ' words' : 'word' }} — {{ effectTypeLabel(defaultEffectType()) }}
        </button>
        <button class="ctx-item" (click)="restoreSelected(); closeContextMenu()" role="menuitem">
          <span class="material-symbols-outlined">healing</span>
          Restore selected
        </button>
        <div class="ctx-divider"></div>
        <div class="ctx-submenu-label">Change cut effect</div>
        @for (opt of CUT_OPTIONS; track opt.type) {
          <button class="ctx-item ctx-item--sub" [class.active]="defaultEffectType() === opt.type"
            (click)="setDefaultEffect(opt.type)" role="menuitem">
            <span class="material-symbols-outlined">{{ opt.icon }}</span>
            {{ opt.label }}
          </button>
        }
      </div>
    }

    <!-- Floating Apply Pill (Apply mode with pending edits) -->
    @if (editingMode() === 'apply' && pendingEdits.hasPending(clip())) {
      <div class="apply-pill-wrap" [class.apply-menu-open]="applyMenuOpen()">
        <div class="apply-pill" [class.pulse]="pendingEdits.hasPending(clip())"
          (click)="applyMenuOpen.set(!applyMenuOpen())">
          <span class="material-symbols-outlined">pending_actions</span>
          <span>{{ pendingEdits.pendingCount(clip()).total }} pending</span>
        </div>
        @if (applyMenuOpen()) {
          <div class="apply-menu popover" (click)="$event.stopPropagation()">
            <div class="apply-menu-title">Staged Edits</div>
            <button class="apply-menu-btn apply-all" (click)="applyPending()">
              <span class="material-symbols-outlined">check_circle</span>
              Apply All
            </button>
            @if (selectedCount() > 0) {
              <button class="apply-menu-btn" (click)="applySelected()">
                <span class="material-symbols-outlined">check</span>
                Apply Selected ({{ selectedCount() }})
              </button>
              <button class="apply-menu-btn discard-btn" (click)="discardSelected()">
                <span class="material-symbols-outlined">remove_done</span>
                Discard Selected
              </button>
            }
            <button class="apply-menu-btn discard-btn" (click)="discardPending()">
              <span class="material-symbols-outlined">cancel</span>
              Discard All
            </button>
          </div>
        }
      </div>
    }
    </div>
  </section>

  <!-- Transcript Resizer -->
  @if (isTranscriptOpen()) {
    <div class="resizer transcript-resizer" (mousedown)="startResizing('transcript', $event)"></div>
  }

  <!-- Metadata Panel Section (Column 2) - Positions between player and transcript -->
  <div class="metadata-panel-side" 
    [class.opened]="metadataPanelOpen()"
    [style.width.px]="metadataPanelOpen() ? metadataWidth() : 36">
    <div class="side-label" (click)="toggleMetadataPanel()"><span>METADATA</span></div>
    <div class="panel-content">
      @if (metadataPanelOpen()) {
        <app-segment-metadata-panel
          [segmentId]="selectedSegmentId()"
          [clips]="[clip()]"
          [activeTab]="metadataTab()"
          (tabChange)="metadataTab.set($event)"
        />
      }
    </div>
  </div>

  <!-- Metadata Resizer -->
  @if (metadataPanelOpen()) {
    <div class="resizer metadata-resizer" (mousedown)="startResizing('metadata', $event)"></div>
  }

  <!-- ═══════════ Right/Left: Video Preview + Timeline ═══════════ -->
  <section class="preview-section">

    <!-- Video Frame -->
    <div class="preview-area">
      <div class="video-frame"
        #videoFrameEl
        (mouseenter)="showOverlay.set(true)"
        (mouseleave)="showOverlay.set(false)">

        @if (isVideo()) {
          <div style="position:relative; width:100%; height:100%;">
            <video
              #mediaEl
              class="video-el"
              [src]="mediaUrl()"
              preload="metadata"
              [style.opacity]="effectPlayer.videoOpacity()"
              [style.filter]="effectPlayer.videoFilter()"
            ></video>
            <!-- Overlay canvas for smart-cut freeze-frame -->
            <canvas #overlayCanvas class="smart-cut-overlay" aria-hidden="true"></canvas>
          </div>
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
        <div class="timeline-track" #timelineTrackEl (click)="onTimelineClick($event)">
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
          <!-- Silence gap markers -->
          @for (sil of silenceGapOverlays(); track sil.id) {
            <div class="silence-gap-marker"
              [class.silence-gap-marker--cut]="sil.isCut"
              [style.left.%]="sil.leftPercent"
              [style.width.%]="sil.widthPercent"
              [title]="sil.isCut ? 'Silence cut — drag handles to trim' : 'Silence gap — drag to cut'"
              (click)="toggleSilenceCut({id: sil.id, gapStart: sil.gapStart, gapEnd: sil.gapEnd, duration: sil.gapEnd - sil.gapStart}); $event.stopPropagation()">
              <span class="tl-sil-handle tl-sil-handle--start"
                (mousedown)="onSilenceTimelineHandleMouseDown(sil, 'start', $event)"
                aria-label="Trim silence start"></span>
              <span class="tl-sil-handle tl-sil-handle--end"
                (mousedown)="onSilenceTimelineHandleMouseDown(sil, 'end', $event)"
                aria-label="Trim silence end"></span>
            </div>
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
</div>
  `,
  styleUrl: './txt-media-player-v2.component.scss'
})
export class TxtMediaPlayerV2Component implements AfterViewInit, OnDestroy {

  /* ── Refs ────────────────────────────────────────────── */
  @ViewChild('mediaEl') mediaElRef!: ElementRef<HTMLVideoElement | HTMLAudioElement>;
  @ViewChild('transcriptEl') transcriptElRef!: ElementRef<HTMLDivElement>;
  @ViewChild('videoFrameEl') videoFrameRef!: ElementRef<HTMLDivElement>;
  @ViewChild('overlayCanvas') private overlayCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('timelineTrackEl') private timelineTrackRef?: ElementRef<HTMLDivElement>;

  /* ── Inputs ──────────────────────────────────────────── */
  readonly clip = input.required<Clip>();
  readonly metadataPanelOpen = signal(false);
  readonly metadataTab = signal<'clip' | 'segment' | 'notes'>('segment');
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
  readonly textEditMode = signal(false);
  readonly jumpCutMode = signal(false);
  readonly cutDropdownOpen = signal(false);
  readonly selectionContextMenu = signal<{ x: number; y: number } | null>(null);
  readonly CUT_OPTIONS = CUT_OPTIONS;
  readonly silenceEditId = signal<string | null>(null);
  readonly silenceTrims = signal<Map<string, { trimStart: number; trimEnd: number }>>(new Map());
  private silenceResizeDrag: { id: string; side: 'start' | 'end'; startX: number; gapStart: number; gapEnd: number; origTrimStart: number; origTrimEnd: number } | null = null;
  private silenceTimelineDrag: { id: string; side: 'start' | 'end'; gapStart: number; gapEnd: number; origTrimStart: number; origTrimEnd: number; trackRect: DOMRect } | null = null;
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

  private readonly notebookService = inject(NotebookService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly searchResetWatch = effect(() => {
    this.searchQuery();
    this.currentMatchIndex.set(0);
  }, { allowSignalWrites: true });

  /* ── Smart-Cut Signals ────────────────────────────────── */
  /** Minimum silence gap (seconds) for auto-clean detection */
  readonly silenceIntervalSec = signal(0.3);
  /** Show filler-word highlight overlays (orange underline) */
  readonly highlightFillers = signal(false);
  /** Show silence-gap highlight overlays (blue underline) */
  readonly highlightSilence = signal(false);
  /** Whether Auto Clean dropdown is open */
  readonly autoCleanOpen = signal(false);
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
  /** Currently active region ID for keyboard shortcuts */
  readonly activeRegionId = signal<string | null>(null);
  /** Thumbnails for smart-cut preview popover */
  readonly smartCutThumbs = signal<Record<string, { pre: string; post: string }>>({});

  /** Global default effect type — new regions inherit this. */
  readonly defaultEffectType = signal<EffectType>('clear-cut');

  /** Whether the responsive "More" menu is open; mutual exclusion with silence/auto-clean */
  readonly moreMenuOpen = signal(false);
  readonly isTranscriptOpen = signal(true);

  /** Live/Apply mode: null = use settings default. */
  readonly editModeOverride = signal<'live' | 'apply' | null>(null);
  readonly editingMode = computed<'live' | 'apply'>(() =>
    this.editModeOverride() ?? this.settings.defaultEditMode()
  );
  readonly applyMenuOpen = signal(false);
  
  // Resizing signals
  readonly metadataWidth = signal(380);
  readonly transcriptWidth = signal(420);
  readonly isResizing = signal(false);
  private isResizingMetadata = false;
  private isResizingTranscript = false;
  private startX = 0;
  private startWidth = 0;

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

  /**
   * In Live mode, the intervals that must be skipped during playback
   * (all committed/effective cut regions, derived from isRemoved words).
   * Each entry is { start, end } in absolute video seconds.
   */
  readonly liveSkipIntervals = computed<Array<{ start: number; end: number }>>(() => {
    this.editVersion();
    if (this.editingMode() !== 'live') return [];
    const clip = this.clip();
    const intervals: Array<{ start: number; end: number }> = [];
    const trimsMap = this.silenceTrims();

    // Collect gap bounds for all active trims so we can exclude their cutRegions from step 1.
    // Any time-based cutRegion that falls within an active-trim gap is superseded by the drag.
    type TrimmedGap = { gapStart: number; gapEnd: number; trimStart: number; trimEnd: number };
    const trimmedGaps: TrimmedGap[] = [];
    if (trimsMap.size > 0) {
      for (const seg of clip.segments) {
        for (let i = 1; i < seg.words.length; i++) {
          const t = trimsMap.get(`sil-${seg.id}-${i}`);
          if (t) trimmedGaps.push({ gapStart: seg.words[i - 1].endTime, gapEnd: seg.words[i].startTime, trimStart: t.trimStart, trimEnd: t.trimEnd });
        }
      }
      for (let i = 0; i < clip.segments.length - 1; i++) {
        const t = trimsMap.get(`sil-after-${clip.segments[i].id}`);
        if (t) trimmedGaps.push({ gapStart: clip.segments[i].endTime, gapEnd: clip.segments[i + 1].startTime, trimStart: t.trimStart, trimEnd: t.trimEnd });
      }
    }

    // 1. Existing Cut Regions — skip time-based regions superseded by an active trim drag
    for (const region of clip.cutRegions ?? []) {
      if (region.pending && region.pendingKind === 'remove') continue;
      let start: number;
      let end: number;
      if (region.startTime !== undefined && region.endTime !== undefined) {
        start = region.startTime;
        end = region.endTime;
        if (trimmedGaps.some(g => start >= g.gapStart - 0.05 && end <= g.gapEnd + 0.05)) continue;
      } else {
        const wordMap = new Map<string, Word>();
        for (const seg of clip.segments) for (const w of seg.words) wordMap.set(w.id, w);
        const times = region.wordIds.map(id => wordMap.get(id)).filter((w): w is Word => !!w);
        if (!times.length) continue;
        start = Math.min(...times.map(w => w.startTime));
        end = Math.max(...times.map(w => w.endTime));
      }
      if (end > start) intervals.push({ start, end });
    }

    // 2. Active Silence Trims — provide real-time feedback during drag, superseding cutRegions above
    for (const { gapStart, gapEnd, trimStart, trimEnd } of trimmedGaps) {
      const cutStart = gapStart + trimStart;
      const cutEnd = gapEnd - trimEnd;
      if (cutEnd > cutStart + 0.05) intervals.push({ start: cutStart, end: cutEnd });
    }

    return intervals;
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

  /* ── Computed: Silence Gap Overlays for Timeline ──────── */
  readonly silenceGapOverlays = computed(() => {
    this.editVersion();
    const clip = this.clip();
    const dur = this.clipDuration();
    if (dur <= 0) return [];
    const clipStart = clip.startTime;
    const cutTimeRegions = clip.cutRegions.filter(r => r.wordIds.length === 0 && r.startTime !== undefined && r.endTime !== undefined);

    const overlays: Array<{ id: string; leftPercent: number; widthPercent: number; isCut: boolean; gapStart: number; gapEnd: number }> = [];

    for (const seg of clip.segments) {
      for (let i = 1; i < seg.words.length; i++) {
        const gapStart = seg.words[i - 1].endTime;
        const gapEnd = seg.words[i].startTime;
        const gap = gapEnd - gapStart;
        if (gap < INLINE_SILENCE_THRESHOLD_SEC) continue;

        const id = `sil-${seg.id}-${i}`;
        const trims = this.silenceTrims().get(id) ?? { trimStart: 0, trimEnd: 0 };
        const displayStart = gapStart + trims.trimStart;
        const displayEnd = gapEnd - trims.trimEnd;
        const displayGap = Math.max(0, displayEnd - displayStart);

        const isCut = cutTimeRegions.some(r => r.startTime! >= gapStart - 0.1 && r.endTime! <= gapEnd + 0.1);
        overlays.push({
          id,
          leftPercent: ((displayStart - clipStart) / dur) * 100,
          widthPercent: (displayGap / dur) * 100,
          isCut,
          gapStart,
          gapEnd,
        });
      }
    }

    // Inter-segment gaps (silence between segments)
    const segments = clip.segments;
    for (let i = 0; i < segments.length - 1; i++) {
      const gapStart = segments[i].endTime;
      const gapEnd = segments[i + 1].startTime;
      const gap = gapEnd - gapStart;
      if (gap < SILENCE_THRESHOLD_SEC) continue;

      const id = `sil-after-${segments[i].id}`;
      const trims = this.silenceTrims().get(id) ?? { trimStart: 0, trimEnd: 0 };
      const displayStart = gapStart + trims.trimStart;
      const displayEnd = gapEnd - trims.trimEnd;
      const displayGap = Math.max(0, displayEnd - displayStart);

      const isCut = cutTimeRegions.some(r => r.startTime! >= gapStart - 0.1 && r.endTime! <= gapEnd + 0.1);
      overlays.push({
        id,
        leftPercent: ((displayStart - clipStart) / dur) * 100,
        widthPercent: (displayGap / dur) * 100,
        isCut,
        gapStart,
        gapEnd,
      });
    }

    return overlays;
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
            gapStart: segment.endTime,
            gapEnd: nextStart,
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

  /** Debounce word seek so double-click (toggle-remove) doesn't jump the video. */
  private wordSeekTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly playbackWatch = effect(() => {
    const t = this.currentTime();
    const clip = this.clip();

    // Bounds enforcement: if playing and we reach or exceed the clip end, pause.
    if (this.playing() && t >= clip.endTime) {
      this.mediaPlayer.pause();
      this.mediaPlayer.seek(clip.endTime);
    }

    // Live-mode cut skip: instantly jump over any removed region
    if (this.playing() && this.editingMode() === 'live') {
      const intervals = this.liveSkipIntervals();
      for (const { start, end } of intervals) {
        // Hit: playhead is inside a cut region → jump to its end
        if (t >= start && t < end) {
          this.mediaPlayer.seek(end);
          return;
        }
      }
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
    const regions = clip.cutRegions ?? [];
    for (const region of regions) {
      if (region.effectType === 'smart-cut' || region.effectType === 'smart') {
        this.smartCutQueue.enqueue(region, clip);
      }
    }
  }, { allowSignalWrites: true });

  /** Computed so clipSwitchWatch only tracks the ID, not full clip reference. */
  private readonly _clipId = computed(() => this.clip().id);

  /** Reset selection state when the clip SWITCHES (not on cut-region edits). */
  private readonly clipSwitchWatch = effect(() => {
    const _clipId = this._clipId(); // only changes when switching to a different clip
    this.selectedSegmentId.set(null);
    this.selectedWordIds.set([]);
    this.selectionAnchorWordId.set(null);
    this.effectPopoverWordId.set(null);
    this.transcriptScrollTop.set(0);
    if (this.transcriptElRef) {
      this.transcriptElRef.nativeElement.scrollTop = 0;
    }
  }, { allowSignalWrites: true });

  /* ── Private injected services ──────────────────────── */
  readonly settings = inject(SettingsService);
  readonly pendingEdits = inject(PendingEditsService);
  private readonly smartCutQueue = inject(SmartCutQueueService);
  private readonly smartCutCache = inject(SmartCutCacheService);
  private readonly injector = inject(Injector);

  readonly smartCutStatus = this.smartCutQueue.statusSignal;

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
      toggleMetadata: () => this.toggleMetadataPanel(),
      'shift.p': () => {
        const regionId = this.activeRegionId();
        if (regionId) this.previewSmartCut(regionId);
      },
    });

    effect(() => {
      const ev = this.notebookService.noteJumpEvent();
      if (!ev) return;

      const note = ev.note;
      const clip = this.clip(); // Track clip so effect re-runs when clip updates

      // Clip note: seek directly to note timecode; no word traversal needed.
      if (note.attachedToType === 'clip' && note.attachedToId === clip.id) {
        setTimeout(() => {
          this.mediaPlayer.seek(note.timecode || clip.startTime);
          const firstSeg = clip.segments[0];
          if (firstSeg) this.selectedSegmentId.set(firstSeg.id);
          const firstWord = firstSeg?.words.find(w => !w.isRemoved);
          if (firstWord) {
            setTimeout(() => {
              const el = document.getElementById(firstWord.id);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
          }
        }, 0);
        return;
      }

      let targetWord: Word | null = null;
      let targetSegment: Segment | null = null;

      if (note.attachedToType === 'segment') {
        targetSegment = clip.segments.find(s => s.id === note.attachedToId) || null;
        if (targetSegment) {
          targetWord = targetSegment.words[0] || null;
        }
      } else if (note.attachedToType === 'word') {
        for (const seg of clip.segments) {
          targetWord = seg.words.find(w => w.id === note.attachedToId) || null;
          if (targetWord) {
            targetSegment = seg;
            break;
          }
        }
      }

      // If the target entity is not in this clip, do nothing.
      // StudioComponent will change the clip, which will re-trigger this effect.
      if (!targetWord) return;

      // Use a timeout to ensure the DOM is ready if we just switched clips
      setTimeout(() => {
        if (!targetWord!.isRemoved) {
          this.mediaPlayer.seek(targetWord!.startTime);
        }
        if (targetSegment) {
          this.selectedSegmentId.set(targetSegment.id);
        }
        setTimeout(() => {
          const el = document.getElementById(targetWord!.id);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      }, 0);
    });
  }

  /* ── Lifecycle ───────────────────────────────────────── */
  ngAfterViewInit(): void {
    if (this.mediaElRef?.nativeElement) {
      this.mediaPlayer.attachElement(this.mediaElRef.nativeElement);
      this.effectPlayer.attachElement(this.mediaElRef.nativeElement);
    }
    if (this.overlayCanvasRef) {
      this.effectPlayer.attachOverlayCanvas(this.overlayCanvasRef.nativeElement);
    }
    this.measureTranscriptViewport();
    this.detachKeyboard = this.keyboardShortcuts.bindWindowKeydown(this.handleKeydown);
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('mouseup', this.handleDragEnd);
  }

  ngOnDestroy(): void {
    // Auto-apply any pending edits before leaving
    if (this.pendingEdits.hasPending(this.clip())) {
      this.pendingEdits.applyAll(this.clip()).subscribe();
    }
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

  private readonly autoSwitchMetadataTab = effect(() => {
    if (this.metadataTab() === 'notes') return;
    this.metadataTab.set(this.selectedSegmentId() ? 'segment' : 'clip');
  }, { allowSignalWrites: true });

  toggleMetadataPanel(): void {
    const opening = !this.metadataPanelOpen();
    if (opening) {
      this.selectedWordIds.set([]);
      this.selectionAnchorWordId.set(null);
    }
    this.metadataPanelOpen.update(v => !v);
    if (opening && !this.selectedSegmentId()) {
      const activeId = this.activeSegmentId();
      if (activeId) {
        this.selectedSegmentId.set(activeId);
        this.notebookService.selectEntity('segment', activeId);
      }
    }
    this.moreMenuOpen.set(false);
  }

  onSegmentClick(id: string): void {
    this.selectedSegmentId.set(id);
    this.notebookService.selectEntity('segment', id);
  }

  /* ── Resizing Logic ─────────────────────────────────── */

  startResizing(panel: 'metadata' | 'transcript', event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing.set(true);
    this.startX = event.clientX;
    
    if (panel === 'metadata') {
      this.isResizingMetadata = true;
      this.startWidth = this.metadataWidth();
    } else {
      this.isResizingTranscript = true;
      this.startWidth = this.transcriptWidth();
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  onMouseMove(event: MouseEvent): void {
    if (this.silenceResizeDrag) {
      const drag = this.silenceResizeDrag;
      const delta = event.clientX - drag.startX;
      const deltaSec = delta / 60;

      this.silenceTrims.update(m => {
        const next = new Map(m);
        const cur = next.get(drag.id) ?? { trimStart: 0, trimEnd: 0 };
        if (this.isRtl()) {
          // RTL: physical-left (side='start') = temporal END; physical-right (side='end') = temporal START.
          // Drag left (delta<0, deltaSec<0) on left handle → expand chip left → trimEnd must decrease → += deltaSec.
          // Drag right (delta>0, deltaSec>0) on right handle → expand chip right → trimStart must decrease → -= deltaSec.
          if (drag.side === 'start') {
            next.set(drag.id, { ...cur, trimEnd: Math.max(0, drag.origTrimEnd + deltaSec) });
          } else {
            next.set(drag.id, { ...cur, trimStart: Math.max(0, drag.origTrimStart - deltaSec) });
          }
        } else {
          // LTR: left handle = temporal START, right handle = temporal END.
          if (drag.side === 'start') {
            next.set(drag.id, { ...cur, trimStart: Math.max(0, drag.origTrimStart + deltaSec) });
          } else {
            next.set(drag.id, { ...cur, trimEnd: Math.max(0, drag.origTrimEnd - deltaSec) });
          }
        }
        return next;
      });
      return;
    }

    if (this.silenceTimelineDrag) {
      const drag = this.silenceTimelineDrag;
      const dur = this.clipDuration();
      if (dur <= 0) { this.silenceTimelineDrag = null; return; }
      const x = event.clientX - drag.trackRect.left;
      const ratio = Math.max(0, Math.min(1, x / drag.trackRect.width));
      const time = this.clip().startTime + ratio * dur;
      const gapDuration = drag.gapEnd - drag.gapStart;
      this.silenceTrims.update(m => {
        const next = new Map(m);
        const cur = next.get(drag.id) ?? { trimStart: 0, trimEnd: 0 };
        if (drag.side === 'start') {
          const trimStart = Math.max(0, Math.min(gapDuration - 0.1, time - drag.gapStart));
          next.set(drag.id, { ...cur, trimStart });
        } else {
          const trimEnd = Math.max(0, Math.min(gapDuration - 0.1, drag.gapEnd - time));
          next.set(drag.id, { ...cur, trimEnd });
        }
        return next;
      });
      return;
    }

    if (!this.isResizingMetadata && !this.isResizingTranscript) return;

    const delta = event.clientX - this.startX;

    if (this.isResizingTranscript) {
      if (this.isRtl()) {
        const newWidth = this.startWidth - delta;
        this.transcriptWidth.set(Math.max(200, Math.min(newWidth, 800)));
      } else {
        const newWidth = this.startWidth + delta;
        this.transcriptWidth.set(Math.max(200, Math.min(newWidth, 800)));
      }
    } else if (this.isResizingMetadata) {
      if (this.isRtl()) {
        const newWidth = this.startWidth - delta;
        this.metadataWidth.set(Math.max(200, Math.min(newWidth, 800)));
      } else {
        const newWidth = this.startWidth + delta;
        this.metadataWidth.set(Math.max(200, Math.min(newWidth, 800)));
      }
    }
  }

  onMouseUp(): void {
    if (this.silenceResizeDrag) {
      const drag = this.silenceResizeDrag;
      const trims = this.silenceTrims().get(drag.id) ?? { trimStart: 0, trimEnd: 0 };
      if (drag.gapEnd - drag.gapStart - trims.trimStart - trims.trimEnd >= 0.05) {
        this.cutSilenceGap({ id: drag.id, gapStart: drag.gapStart, gapEnd: drag.gapEnd, duration: drag.gapEnd - drag.gapStart }, trims.trimStart, trims.trimEnd);
      }
      this.silenceResizeDrag = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    if (this.silenceTimelineDrag) {
      const drag = this.silenceTimelineDrag;
      const trims = this.silenceTrims().get(drag.id) ?? { trimStart: 0, trimEnd: 0 };
      if (drag.gapEnd - drag.gapStart - trims.trimStart - trims.trimEnd >= 0.05) {
        this.cutSilenceGap({ id: drag.id, gapStart: drag.gapStart, gapEnd: drag.gapEnd, duration: drag.gapEnd - drag.gapStart }, trims.trimStart, trims.trimEnd);
      }
      this.silenceTimelineDrag = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    if (this.isResizingMetadata || this.isResizingTranscript) {
      this.isResizingMetadata = false;
      this.isResizingTranscript = false;
      this.isResizing.set(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
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
    if (this.justCompletedDrag) {
      this.justCompletedDrag = false;
      return;
    }
    if (this.textEditMode()) return;

    if (this.metadataPanelOpen()) {
      // Prevent click from bubbling to seg-block so segment selection isn't overridden.
      event.stopPropagation();
      // Keep metadata panel showing the parent segment.
      const parentSeg = this.clip().segments.find(s => s.words.some(w => w.id === word.id));
      if (parentSeg) this.selectedSegmentId.set(parentSeg.id);
    }

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
    if (!word.isRemoved) {
      // Debounce so a double-click (toggle-remove) doesn't cause a spurious seek
      if (this.wordSeekTimer) clearTimeout(this.wordSeekTimer);
      const seekTarget = word.startTime;
      this.wordSeekTimer = setTimeout(() => {
        this.wordSeekTimer = null;
        this.mediaPlayer.seek(seekTarget);
      }, 220);
    }
    this.effectPopoverWordId.set(null);
    this.notebookService.selectEntity('word', word.id);
  }

  onWordMouseDown(word: Word, event: MouseEvent): void {
    if (this.textEditMode()) return;
    if (event.button !== 0) return;
    this.dragSelectAnchorId = word.id;
    this.isDragAppendMode = event.ctrlKey || event.metaKey;
    this.dragSelectBaselineIds = this.isDragAppendMode ? [...this.selectedWordIds()] : [];
  }

  onWordMouseEnter(word: Word): void {
    if (this.textEditMode()) return;
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
    return this.selectedWordIdSet().has(wordId);
  }

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
      container.scrollTo({ top: viewItem.top, behavior: 'auto' });
      setTimeout(() => {
        const wordEl = container.querySelector(`[id="${wordId}"]`) as HTMLElement;
        if (wordEl) {
          wordEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 40);
    }
  }

  isActiveSegment(seg: Segment): boolean {
    return seg.id === this.activeSegmentId();
  }

  buildFlowItems(seg: Segment): FlowItem[] {
    const words = seg.words;
    if (!words.length) return [];
    const items: FlowItem[] = [];
    let nextTimeMark = Math.ceil(words[0].startTime / INLINE_TIME_INTERVAL_SEC) * INLINE_TIME_INTERVAL_SEC;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];

      if (w.startTime >= nextTimeMark) {
        items.push({
          kind: 'time',
          label: this.formatTimeShort(nextTimeMark),
          time: nextTimeMark,
          id: `t-${seg.id}-${nextTimeMark}`,
        });
        nextTimeMark += INLINE_TIME_INTERVAL_SEC;
        while (nextTimeMark <= w.startTime) nextTimeMark += INLINE_TIME_INTERVAL_SEC;
      }

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
    if (this.textEditMode()) return;
    // Cancel pending seek from the click event(s) that fired before this dblclick
    if (this.wordSeekTimer) { clearTimeout(this.wordSeekTimer); this.wordSeekTimer = null; }
    const pending = this.editingMode() === 'apply';
    if (word.isRemoved) {
      this.applyCutRegionChange(this.cutRegionService.restore(this.clip(), [word.id], pending));
    } else {
      this.applyCutRegionChange(this.cutRegionService.cut(this.clip(), [word.id], this.defaultEffectType(), pending));
    }
    // Word is in DOM (user just clicked it) — scroll it into view without pre-jumping to segment top
    if (this.transcriptElRef) {
      const wordEl = this.transcriptElRef.nativeElement.querySelector(`[id="${word.id}"]`) as HTMLElement | null;
      wordEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  removeSelected(): void {
    if (!this.selectedWordIds().length) return;
    const pending = this.editingMode() === 'apply';
    this.applyCutRegionChange(
      this.cutRegionService.cut(this.clip(), this.selectedWordIds(), this.defaultEffectType(), pending)
    );
    this.selectedWordIds.set([]);
  }

  restoreSelected(): void {
    if (!this.selectedWordIds().length) return;
    const pending = this.editingMode() === 'apply';
    this.applyCutRegionChange(
      this.cutRegionService.restore(this.clip(), this.selectedWordIds(), pending)
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

  silenceChipWidth(duration: number): number {
    return Math.min(120, Math.max(24, Math.round(Math.sqrt(duration) * 55)));
  }

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

  undo(): void {
    const entry = this.editHistory.undo();
    if (!entry) return;
    const newClip = this.cutRegionService.applyUndo(this.clip(), entry);
    this.clipService.applyLocalUpdate(newClip);
    this.editVersion.update(v => v + 1);
  }

  redo(): void {
    const entry = this.editHistory.redo();
    if (!entry) return;
    const newClip = this.cutRegionService.applyRedo(this.clip(), entry);
    this.clipService.applyLocalUpdate(newClip);
    this.editVersion.update(v => v + 1);
  }

  clearSelection(event: MouseEvent): void {
    if (this.textEditMode() || this.metadataPanelOpen()) return;
    this.selectedWordIds.set([]);
    this.selectionAnchorWordId.set(null);
    this.effectPopoverWordId.set(null);
  }

  toggleMenu(menu: 'autoClean' | 'silence' | 'more'): void {
    if (menu === 'autoClean') {
      this.autoCleanOpen.set(!this.autoCleanOpen());
      this.silenceControlOpen.set(false);
      this.moreMenuOpen.set(false);
    } else if (menu === 'silence') {
      this.silenceControlOpen.set(!this.silenceControlOpen());
      this.autoCleanOpen.set(false);
      this.moreMenuOpen.set(false);
    } else {
      this.moreMenuOpen.set(!this.moreMenuOpen());
      this.autoCleanOpen.set(false);
      this.silenceControlOpen.set(false);
    }
  }

  toggleFiller(fw: string): void {
    const current = new Set(this.selectedFillers());
    if (current.has(fw)) current.delete(fw);
    else current.add(fw);
    this.selectedFillers.set(current);
  }

  applyAutoClean(): void {
    const fillers = Array.from(this.selectedFillers()) as string[];
    const minSilence = this.silenceIntervalSec();
    const result = this.cutRegionService.autoClean(this.clip(), fillers, minSilence, this.defaultEffectType());
    this.applyCutRegionChange(result);
    this.autoCleanOpen.set(false);
    this.moreMenuOpen.set(false);
  }

  setDefaultEffect(type: EffectType): void {
    this.defaultEffectType.set(type);
  }

  onRemovedWordClick(word: Word, event: MouseEvent): void {
    event.stopPropagation();
    if (this.textEditMode()) return;

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
    this.effectPopoverWordId.set(this.effectPopoverWordId() === word.id ? null : word.id);
    const r = this.wordIdToRegion().get(word.id);
    if (r) this.activeRegionId.set(r.id);
  }

  setRegionEffect(regionId: string, type: EffectType): void {
    const result = this.cutRegionService.updateRegionEffect(this.clip(), regionId, type);
    this.applyCutRegionChange(result);
  }

  /** Per-word effect: splits the word out of its merged region if needed, then sets effect. */
  setWordEffect(wordId: string, effectType: EffectType): void {
    const clip = this.clip();
    const region = clip.cutRegions.find(r => r.wordIds.includes(wordId));
    if (!region) return;

    if (region.wordIds.length === 1) {
      this.setRegionEffect(region.id, effectType);
      return;
    }

    const allWords = clip.segments.flatMap(s => s.words);
    const w = allWords.find(w => w.id === wordId);
    if (!w) return;

    const updatedRegion: CutRegion = { ...region, wordIds: region.wordIds.filter(id => id !== wordId) };
    const newRegion: CutRegion = {
      id: crypto.randomUUID(),
      wordIds: [wordId],
      effectType,
      effectTypeOverridden: true,
      effectDuration: this.cutRegionService.autoEffectDuration((w.endTime - w.startTime) * 1000),
      durationFixed: false,
    };
    const clipBefore = clip;
    const clipAfter: Clip = {
      ...clip,
      cutRegions: [...clip.cutRegions.filter(r => r.id !== region.id), updatedRegion, newRegion],
    };
    this.applyCutRegionChange({ clip: clipAfter, entry: { kind: 'apply-batch', clipBefore, clipAfter } });
    this.effectPopoverWordId.set(wordId);
  }

  setRegionSceneType(regionId: string, sceneType: SceneType): void {
    const clip = this.clip();
    const clipBefore = clip;
    const clipAfter: Clip = {
      ...clip,
      cutRegions: clip.cutRegions.map(r => r.id === regionId ? { ...r, sceneType } : r),
    };
    this.applyCutRegionChange({ clip: clipAfter, entry: { kind: 'apply-batch', clipBefore, clipAfter } });
    // Re-enqueue smart cut with new scene type
    const updatedRegion = clipAfter.cutRegions.find(r => r.id === regionId);
    if (updatedRegion && (updatedRegion.effectType === 'smart-cut' || updatedRegion.effectType === 'smart')) {
      this.smartCutQueue.invalidate(regionId);
      this.smartCutQueue.enqueue(updatedRegion, clipAfter);
    }
  }

  setClipSceneType(sceneType: SceneType): void {
    const clip = this.clip();
    this.clipService.updateSceneType(clip.id, sceneType);
    
    // Invalidate existing smart cut tasks and re-enqueue with new global scene type
    const regionIds = clip.cutRegions.map(r => r.id);
    this.smartCutQueue.invalidateClip(clip.id, regionIds);
    
    clip.cutRegions.forEach(r => {
      // Only re-enqueue if it's a smart cut
      if (r.effectType === 'smart-cut' || r.effectType === 'smart') {
        this.smartCutQueue.enqueue(r, { ...clip, sceneType });
      }
    });
  }

  onSilenceTimelineHandleMouseDown(sil: { id: string; gapStart: number; gapEnd: number }, side: 'start' | 'end', event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const trackEl = this.timelineTrackRef?.nativeElement;
    if (!trackEl) return;
    const trims = this.silenceTrims().get(sil.id) ?? { trimStart: 0, trimEnd: 0 };
    // Seed the trims map immediately so liveSkipIntervals supersedes the existing cutRegion from drag start
    if (!this.silenceTrims().has(sil.id)) {
      this.silenceTrims.update(m => { const next = new Map(m); next.set(sil.id, trims); return next; });
    }
    this.silenceTimelineDrag = {
      id: sil.id, side,
      gapStart: sil.gapStart, gapEnd: sil.gapEnd,
      origTrimStart: trims.trimStart, origTrimEnd: trims.trimEnd,
      trackRect: trackEl.getBoundingClientRect(),
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  setRegionDuration(regionId: string, duration: number): void {
    const result = this.cutRegionService.updateRegionDuration(this.clip(), regionId, duration);
    this.applyCutRegionChange(result);
  }

  resetRegionEffect(regionId: string): void {
    const result = this.cutRegionService.resetRegionEffect(this.clip(), regionId, this.defaultEffectType());
    this.applyCutRegionChange(result);
  }

  applyPending(): void {
    const clip = this.clip();
    if (!this.pendingEdits.hasPending(clip)) return;
    const clipBefore = clip;
    this.pendingEdits.applyAll(clip).subscribe(appliedClip => {
      this.clipService.applyLocalUpdate(appliedClip);
      this.editHistory.record({ kind: 'apply-batch', clipBefore, clipAfter: appliedClip });
      this.editVersion.update(v => v + 1);
      this.applyMenuOpen.set(false);
      this.effectPopoverWordId.set(null);
    });
  }

  discardPending(): void {
    const clip = this.clip();
    const count = this.pendingEdits.pendingCount(clip).total;
    if (count > 5 && !confirm(`Discard all ${count} pending edits?`)) return;
    const discarded = this.pendingEdits.discardAll(clip);
    this.clipService.applyLocalUpdate(discarded);
    this.editVersion.update(v => v + 1);
    this.applyMenuOpen.set(false);
    this.effectPopoverWordId.set(null);
  }

  applySelected(): void {
    const ids = this.selectedWordIds();
    if (!ids.length) return;
    const clip = this.clip();
    const clipBefore = clip;
    this.pendingEdits.applySelection(clip, ids).subscribe(appliedClip => {
      this.clipService.applyLocalUpdate(appliedClip);
      this.editHistory.record({ kind: 'apply-batch', clipBefore, clipAfter: appliedClip });
      this.editVersion.update(v => v + 1);
      this.applyMenuOpen.set(false);
      this.effectPopoverWordId.set(null);
    });
  }

  discardSelected(): void {
    const ids = this.selectedWordIds();
    if (!ids.length) return;
    const discarded = this.pendingEdits.discardSelection(this.clip(), ids);
    this.clipService.applyLocalUpdate(discarded);
    this.editVersion.update(v => v + 1);
    this.applyMenuOpen.set(false);
    this.effectPopoverWordId.set(null);
  }

  setEditingMode(mode: 'live' | 'apply'): void {
    const current = this.editingMode();
    if (current === mode) return;
    if (current === 'apply' && this.pendingEdits.hasPending(this.clip())) {
      this.applyPending(); // auto-apply then switch
    }
    this.editModeOverride.set(mode);
    // Persist the preference so it survives page refresh
    this.settings.saveDefaultEditMode(mode);
    this.effectPopoverWordId.set(null);
  }

  onWordTextBlur(word: Word, event: FocusEvent): void {
    if (!this.textEditMode()) return;
    const el = event.target as HTMLElement;
    const newText = el.innerText.trim();

    if (this.editingMode() === 'apply') {
      if (newText === word.text || newText === word.pendingText) return;
      const newClip = { ...this.clip() };
      const target = newClip.segments.flatMap(s => s.words).find(w => w.id === word.id);
      if (target) {
        target.pendingText = newText;
        this.clipService.applyLocalUpdate(newClip);
        this.editVersion.update(v => v + 1);
      }
      return;
    }

    // Live mode
    if (newText === word.text) return;
    const newClip = { ...this.clip() };
    const words = newClip.segments.flatMap(s => s.words);
    const target = words.find(w => w.id === word.id);
    if (target) {
      target.text = newText;
      target.isEdited = true;
      this.clipService.applyLocalUpdate(newClip);
      this.editVersion.update(v => v + 1);
      this.clipService.updateWordStates(newClip.id, [{ id: target.id, text: target.text, isEdited: true }]).subscribe();
    }
  }

  private applyCutRegionChange(result: { clip: Clip; entry: CutHistoryEntry }): void {
    this.clipService.applyLocalUpdate(result.clip);
    this.editHistory.record(result.entry);
    this.editVersion.update(v => v + 1);
    if (this.editingMode() === 'live') {
      this.saveCutRegions();
    }
    this.effectPopoverWordId.set(null);

    // Update smart cut queue based on changes
    const entry = result.entry;
    if (entry.kind === 'cut') {
      this.smartCutQueue.invalidate(entry.regionAfter.id);
      if (entry.regionAfter.effectType === 'smart-cut' || entry.regionAfter.effectType === 'smart') {
        this.smartCutQueue.enqueue(entry.regionAfter, result.clip);
      }
    } else if (entry.kind === 'restore') {
      entry.regionsBefore.forEach(r => this.smartCutQueue.invalidate(r.id));
      entry.regionsAfter.forEach(r => {
        if (r.effectType === 'smart-cut' || r.effectType === 'smart') {
          this.smartCutQueue.enqueue(r, result.clip);
        }
      });
    } else if (entry.kind === 'edit-effect') {
      this.smartCutQueue.invalidate(entry.regionId);
      const r = result.clip.cutRegions.find(cr => cr.id === entry.regionId);
      if (r && (r.effectType === 'smart-cut' || r.effectType === 'smart')) {
        this.smartCutQueue.enqueue(r, result.clip);
      }
    } else if (entry.kind === 'apply-batch') {
      for (const r of result.clip.cutRegions) {
        if (r.effectType === 'smart-cut' || r.effectType === 'smart') {
          this.smartCutQueue.invalidate(r.id);
          this.smartCutQueue.enqueue(r, result.clip);
        }
      }
    }
  }

  private saveCutRegions(): void {
    if (this.cutRegionSaveTimer) clearTimeout(this.cutRegionSaveTimer);
    this.cutRegionSaveTimer = setTimeout(() => {
      const clip = this.clip();
      this.clipService.updateCutRegions(clip.id, clip.cutRegions ?? []).subscribe();
    }, 1000);
  }

  public isFillerWord(word: Word): boolean {
    if (!this.highlightFillers()) return false;
    const t = word.text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");
    return FILLER_WORDS_EN.includes(t) || FILLER_WORDS_HE.includes(t);
  }

  private getWordRange(id1: string, id2: string): string[] {
    const words = this.clip().segments.flatMap(s => s.words);
    let idx1 = words.findIndex(w => w.id === id1);
    let idx2 = words.findIndex(w => w.id === id2);
    if (idx1 === -1 || idx2 === -1) return [];
    if (idx1 > idx2) [idx1, idx2] = [idx2, idx1];
    return words.slice(idx1, idx2 + 1).map(w => w.id);
  }

  private findWordById(id: string): Word | null {
    return this.clip().segments.flatMap(s => s.words).find(w => w.id === id) || null;
  }

  private findActiveSegmentIndex(): number {
    const id = this.activeSegmentId();
    if (!id) return -1;
    return this.clip().segments.findIndex(s => s.id === id);
  }

  private applyJumpCut(t: number): void {
    const clip = this.clip();
    const regions = clip.cutRegions ?? [];
    for (const r of regions) {
      const start = r.startTime ?? Math.min(...r.wordIds.map(id => this.findWordById(id)?.startTime ?? 0));
      const end = r.endTime ?? Math.max(...r.wordIds.map(id => this.findWordById(id)?.endTime ?? 0));
      if (t >= start && t < end) {
        if (r.effectType === 'clear-cut') {
          this.mediaPlayer.seek(end);
          return;
        }
        if (!this.effectInProgress()) {
          this.effectInProgress.set(true);
          this.effectPlayer.playEffect(r, this.clip(), end).subscribe({
            next: (seekTo) => {
              this.effectInProgress.set(false);
              // Skip seek if video is already at the target (smart-cut seeks internally).
              // A redundant seek fires a 'seeked' event and may briefly blank the frame.
              if (Math.abs(this.currentTime() - seekTo) > 0.05) {
                this.mediaPlayer.seek(seekTo);
              }
            }
          });
        }
      }
    }
  }

  private scrollToCurrentWord(): void {
    if (!this.autoFollow() || !this.transcriptElRef) return;
    const container = this.transcriptElRef.nativeElement;
    const wordId = this.highlightedWordId();
    if (wordId) {
      const el = container.querySelector(`[id="${wordId}"]`) as HTMLElement;
      if (el) {
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      return;
    }
    const sil = this.activeSilence();
    if (sil) {
      const highlighted = container.querySelector('.silence-playing') as HTMLElement;
      if (highlighted) {
        const cRect = container.getBoundingClientRect();
        const eRect = highlighted.getBoundingClientRect();
        if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
          highlighted.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        return;
      }
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

  getSmartCutStatus(regionId: string) {
    return this.smartCutStatus()[regionId] ?? null;
  }

  async loadSmartCutThumbs(regionId: string, clipId: string, tBefore: number, tAfterCenter: number): Promise<void> {
    const key = `${clipId}|${regionId}|${tBefore.toFixed(4)}|${tAfterCenter.toFixed(4)}`;
    const result = await this.smartCutCache.get(key);
    if (!result) return;
    const pre = URL.createObjectURL(result.preThumb);
    const post = URL.createObjectURL(result.postThumb);
    this.smartCutThumbs.update(m => ({ ...m, [regionId]: { pre, post } }));
  }

  getRegionTBefore(region: CutRegion): number {
    const clip = this.clip();
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionStart = region.startTime ?? Math.min(...region.wordIds.map(id => allWords.find(w => w.id === id)?.startTime ?? Infinity));
    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.endTime <= regionStart);
    return kept.length ? kept[kept.length - 1].endTime : 0;
  }

  getRegionTAfterCenter(region: CutRegion): number {
    const clip = this.clip();
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionEnd = region.endTime ?? Math.max(...region.wordIds.map(id => allWords.find(w => w.id === id)?.endTime ?? -Infinity));
    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.startTime >= regionEnd);
    return kept.length ? kept[0].startTime : 0;
  }

  effectTypeLabel(type: EffectType): string {
    return CUT_OPTIONS.find(o => o.type === type)?.label ?? type;
  }

  effectTypeIcon(type: EffectType): string {
    return CUT_OPTIONS.find(o => o.type === type)?.icon ?? 'content_cut';
  }

  getSilenceCutForGap(gapStart: number, gapEnd: number): CutRegion | undefined {
    return this.clip().cutRegions.find(r =>
      r.wordIds.length === 0 &&
      r.startTime !== undefined &&
      r.endTime !== undefined &&
      r.startTime >= gapStart - 0.05 &&
      r.endTime <= gapEnd + 0.05
    );
  }

  toggleSilenceCut(fi: { id: string; gapStart: number; gapEnd: number; duration: number }): void {
    const existing = this.getSilenceCutForGap(fi.gapStart, fi.gapEnd);
    if (existing) {
      this.restoreSilenceGap(fi.gapStart, fi.gapEnd);
    } else {
      const trims = this.silenceTrims().get(fi.id) ?? { trimStart: 0, trimEnd: 0 };
      this.cutSilenceGap(fi, trims.trimStart, trims.trimEnd);
    }
  }

  cutSilenceGap(fi: { id: string; gapStart: number; gapEnd: number; duration: number }, trimStart: number, trimEnd: number): void {
    const clipBefore = this.clip();
    const existing = this.getSilenceCutForGap(fi.gapStart, fi.gapEnd);
    const regionsWithout = existing ? clipBefore.cutRegions.filter(r => r.id !== existing.id) : clipBefore.cutRegions;
    const cutStart = fi.gapStart + trimStart;
    const cutEnd = fi.gapEnd - trimEnd;
    if (cutEnd - cutStart < 0.05) return;
    const newRegion: CutRegion = {
      id: existing?.id ?? crypto.randomUUID(),
      wordIds: [],
      startTime: cutStart,
      endTime: cutEnd,
      effectType: this.defaultEffectType(),
      effectTypeOverridden: false,
      effectDuration: this.cutRegionService.autoEffectDuration((cutEnd - cutStart) * 1000),
      durationFixed: false,
    };
    const clipAfter: Clip = { ...clipBefore, cutRegions: [...regionsWithout, newRegion] };
    this.applyCutRegionChange({ clip: clipAfter, entry: { kind: 'apply-batch', clipBefore, clipAfter } });
  }

  restoreSilenceGap(gapStart: number, gapEnd: number): void {
    const existing = this.getSilenceCutForGap(gapStart, gapEnd);
    if (!existing) return;
    const clipBefore = this.clip();
    const clipAfter: Clip = { ...clipBefore, cutRegions: clipBefore.cutRegions.filter(r => r.id !== existing.id) };
    this.applyCutRegionChange({ clip: clipAfter, entry: { kind: 'apply-batch', clipBefore, clipAfter } });
  }

  onSilenceHandleMouseDown(fi: { id: string; gapStart: number; gapEnd: number }, side: 'start' | 'end', event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const trims = this.silenceTrims().get(fi.id) ?? { trimStart: 0, trimEnd: 0 };
    // Seed the trims map immediately so liveSkipIntervals supersedes the existing cutRegion from drag start
    if (!this.silenceTrims().has(fi.id)) {
      this.silenceTrims.update(m => { const next = new Map(m); next.set(fi.id, trims); return next; });
    }
    this.silenceResizeDrag = {
      id: fi.id, side,
      startX: event.clientX,
      gapStart: fi.gapStart, gapEnd: fi.gapEnd,
      origTrimStart: trims.trimStart, origTrimEnd: trims.trimEnd,
    };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  onWordContextMenu(word: Word, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.selectedWordIdSet().has(word.id)) {
      this.selectedWordIds.set([word.id]);
      this.selectionAnchorWordId.set(word.id);
    }
    this.selectionContextMenu.set({ x: event.clientX, y: event.clientY });
    this.cutDropdownOpen.set(false);
  }

  closeContextMenu(): void {
    this.selectionContextMenu.set(null);
    this.cutDropdownOpen.set(false);
  }

  onWindowClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.sel-context-menu') && !target.closest('.cut-dropdown')) {
      this.selectionContextMenu.set(null);
      this.cutDropdownOpen.set(false);
    }
  }

  previewSmartCut(regionId: string): void {
    const clip = this.clip();
    const region = clip.cutRegions.find(r => r.id === regionId);
    if (!region) return;

    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionStart = region.startTime ?? Math.min(...region.wordIds.map(id => allWords.find(w => w.id === id)?.startTime ?? 0));

    const previewStart = Math.max(clip.startTime, regionStart - SMART_CUT_PREVIEW_PREROLL_MS / 1000);
    this.mediaPlayer.seek(previewStart);
    this.mediaPlayer.play();

    const regionEnd = region.endTime ?? Math.max(...region.wordIds.map(id => allWords.find(w => w.id === id)?.endTime ?? 0));
    const pauseAt = regionEnd + SMART_CUT_PREVIEW_POSTROLL_MS / 1000;

    const sub = effect(() => {
      if (this.currentTime() >= pauseAt) {
        this.mediaPlayer.pause();
        sub.destroy();
      }
    }, { injector: this.injector });
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
