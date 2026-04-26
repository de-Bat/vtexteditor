import { Component, computed, input, output, signal, effect, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Clip } from '../../../core/models/clip.model';
import { ApiService } from '../../../core/services/api.service';
import { SseService } from '../../../core/services/sse.service';
import {
  ClipTransition,
  TransitionEffect,
  TRANSITION_EFFECTS,
  TRANSITION_LABELS,
} from '../../../core/models/clip-transition.model';

type ExportFormat = 'video' | 'text-plain' | 'text-srt';
type ExportScope = 'current' | 'selected' | 'all';
type ExportStatus = 'idle' | 'pending' | 'done' | 'error';
type ExportTab = 'simple' | 'smart';

@Component({
  selector: 'app-export-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="export-panel" [class.tab-smart]="activeTab() === 'smart'">
      <!-- Vertical side label -->
      <div class="export-side-label"><span>EXPORT</span></div>

      <div class="export-content-wrapper">
        <!-- ── Header ── -->
        <div class="ep-header">
          <div class="ep-status-row">
            @if (status() === 'done') {
              <span class="ep-status-chip done">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Ready
              </span>
            } @else if (status() === 'pending') {
              <span class="ep-status-chip running">Processing</span>
            } @else if (status() === 'error') {
              <span class="ep-status-chip error">Error</span>
            }
          </div>
          <div class="ep-header-actions">
            <button
              class="btn-export"
              [disabled]="status() === 'pending' || (activeTab() === 'smart' && availableClips().length < 2)"
              (click)="startExport()"
            >
              @if (status() === 'pending') {
                <span class="btn-spinner"></span>
                <span>Running…</span>
              } @else {
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
                <span>{{ activeTab() === 'smart' ? 'Export Video' : 'Start' }}</span>
              }
            </button>
            <button class="btn-close" (click)="close.emit()" aria-label="Close Export Panel">×</button>
          </div>
        </div>

        <!-- ── Tabs ── -->
        <div class="ep-tabs">
          <button 
            class="tab-btn" 
            [class.active]="activeTab() === 'simple'" 
            (click)="activeTab.set('simple')"
          >
            Simple
          </button>
          <button 
            class="tab-btn" 
            [class.active]="activeTab() === 'smart'" 
            (click)="activeTab.set('smart')"
          >
            Smart Edit
          </button>
        </div>

        <!-- ── Middle Content (Scrollable) ── -->
        <div class="ep-scroll-area">

          @if (activeTab() === 'simple') {
            <!-- ── Simple Export Tab Content ── -->
            <div class="tab-content fade-in">
              <!-- ── Range Selection (Scope) ── -->
              <div class="ep-section">
                <div class="ep-section-label">Source Range</div>
                <div class="scope-grid">
                  @for (s of scopes; track s.value) {
                    <button
                      class="scope-btn"
                      [class.active]="exportScope() === s.value"
                      [disabled]="status() === 'pending'"
                      (click)="exportScope.set(s.value)"
                    >
                      <span class="sb-icon" [innerHTML]="getTrustedIconForScope(s.value)"></span>
                      <span class="sb-label">{{ s.label }}</span>
                    </button>
                  }
                </div>

                @if (exportScope() === 'selected') {
                  <div class="clip-selector fade-in">
                    @for (clip of availableClips(); track clip.id) {
                      <label class="clip-checkbox-row">
                        <input
                          type="checkbox"
                          [checked]="selectedClipIds().has(clip.id)"
                          (change)="toggleClipSelection(clip.id)"
                          [disabled]="status() === 'pending'"
                        />
                        <span class="ccr-label">{{ clip.name }}</span>
                        <span class="ccr-meta">{{ (clip.endTime - clip.startTime).toFixed(0) }}s</span>
                      </label>
                    }
                    @if (availableClips().length === 0) {
                      <div class="empty-selection">No clips found</div>
                    }
                  </div>
                }
              </div>

              <!-- ── Format selector ── -->
              <div class="ep-section">
                <div class="ep-section-label">Output Format</div>
                <div class="format-grid">
                  @for (opt of formats; track opt.value) {
                    <button
                      class="format-card"
                      [class.selected]="selectedFormat() === opt.value"
                      [disabled]="status() === 'pending'"
                      (click)="selectedFormat.set(opt.value)"
                      [attr.aria-pressed]="selectedFormat() === opt.value"
                      [attr.data-format]="opt.value"
                    >
                      <span class="fc-icon" [innerHTML]="getTrustedIcon(opt.value)"></span>
                      <div class="fc-content">
                        <span class="fc-label">{{ opt.label }}</span>
                        <span class="fc-desc">{{ opt.desc }}</span>
                      </div>
                    </button>
                  }
                </div>
              </div>
            </div>
          } @else {
            <!-- ── Smart Edit Tab Content ── -->
            <div class="tab-content fade-in">
              <div class="ep-section">
                <div class="ep-section-label">Sequence & Transitions</div>
                <div class="se-list">
                  @for (clip of availableClips(); track clip.id; let i = $index) {
                    <div class="se-clip-row">
                      <span class="se-clip-name">{{ clip.name }}</span>
                      <span class="se-clip-duration">{{ formatDuration(clipDurations()[i] * 1000) }}</span>
                    </div>

                    @if (i < availableClips().length - 1) {
                      <div class="se-transition-row">
                        <div class="se-transition-line"></div>
                        <div class="se-transition-controls">
                          <label class="se-field">
                            <span class="se-field-label">Effect</span>
                            <select
                              [value]="transitions()[i].effect"
                              (change)="updateTransition(i, 'effect', $any($event.target).value)"
                              [disabled]="status() === 'pending'"
                            >
                              @for (eff of effects; track eff) {
                                <option [value]="eff">{{ effectLabels[eff] }}</option>
                              }
                            </select>
                          </label>

                          @if (transitions()[i].effect !== 'hard-cut') {
                            <div class="se-field-group">
                              <label class="se-field">
                                <span class="se-field-label">Dur (ms)</span>
                                <input
                                  type="number"
                                  [value]="transitions()[i].durationMs"
                                  (input)="updateTransition(i, 'durationMs', clamp($any($event.target).valueAsNumber))"
                                  min="0" max="10000" step="100"
                                  [disabled]="status() === 'pending'"
                                />
                              </label>

                              @if (transitions()[i].effect !== 'cross-dissolve') {
                                <label class="se-field">
                                  <span class="se-field-label">Pause (ms)</span>
                                  <input
                                    type="number"
                                    [value]="transitions()[i].pauseMs"
                                    (input)="updateTransition(i, 'pauseMs', clamp($any($event.target).valueAsNumber))"
                                    min="0" max="10000" step="100"
                                    [disabled]="status() === 'pending'"
                                  />
                                </label>
                              }

                              @if (transitions()[i].effect === 'dip-to-color') {
                                <label class="se-field">
                                  <span class="se-field-label">Color</span>
                                  <input
                                    type="color"
                                    [value]="transitions()[i].color ?? '#000000'"
                                    (input)="updateTransition(i, 'color', $any($event.target).value)"
                                    [disabled]="status() === 'pending'"
                                  />
                                </label>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    }
                  }
                  @if (availableClips().length === 0) {
                    <div class="empty-selection">Add clips to the project first</div>
                  }
                </div>
                <div class="se-summary">
                   <span>Estimated duration: {{ formatDuration(estimatedDuration() * 1000) }}</span>
                </div>
              </div>
            </div>
          }

          <!-- ── Processing flow (Shared) ── -->
          @if (status() !== 'idle') {
            <div class="ep-section ep-flow">
              <div class="ep-section-label">Pipeline</div>
              <div class="flow-steps">
                @for (step of flowSteps; track step.id; let i = $index) {
                  <div class="flow-step" [class]="getStepState(i)">
                    <div class="fs-dot">
                      @if (getStepState(i) === 'done') {
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      } @else if (getStepState(i) === 'active') {
                        <span class="fs-pulse"></span>
                      } @else { {{ i + 1 }} }
                    </div>
                    @if (i < flowSteps.length - 1) {
                      <div class="fs-line"></div>
                    }
                    <div class="fs-label">{{ step.label }}</div>
                  </div>
                }
              </div>
              @if (status() === 'pending') {
                <div class="ep-progress-bar">
                  <div class="ep-progress-fill" [style.width.%]="progress()"></div>
                </div>
                <div class="ep-progress-label">
                  <span class="ep-progress-percent">{{ progress() }}%</span>
                  @if (elapsedTime() > 0) {
                    <span class="ep-progress-time">
                      {{ formatTime(elapsedTime()) }} 
                      @if (remainingTime() > 0) {
                        <span class="time-sep">/</span> ~{{ formatTime(remainingTime()) }} left
                      }
                    </span>
                  }
                </div>
              }
            </div>
          }

        </div><!-- /.ep-scroll-area -->

        <!-- ── Footer: Result / error ── -->
        <div class="ep-footer">
          @if (status() === 'done') {
            <a class="btn-download" [href]="downloadUrl()" target="_blank" download>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download {{ formatLabel() }}
            </a>
          }
          @if (status() === 'error') {
            <p class="ep-error">{{ errorMsg() }}</p>
          }
        </div>

      </div><!-- /.export-content-wrapper -->
    </div>
  `,
  styles: [`
    .export-panel {
      display: flex;
      flex-direction: row; /* Side-by-side with label */
      gap: 0;
      background: var(--color-surface);
      width: 100%;
      height: 100%;
      overflow: hidden;
      transition: width 0.3s ease;
    }

    /* ── Side Label ── */
    .export-side-label {
      width: 32px;
      background: var(--color-surface-alt);
      border-right: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      span {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        font-family: 'Space Grotesk', 'Inter', sans-serif;
        font-size: 10px;
        letter-spacing: 0.3em;
        font-weight: 700;
        color: var(--color-muted);
        opacity: 0.7;
      }
    }

    .export-content-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }

    /* ── Header ── */
    .ep-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .6rem .75rem;
      border-bottom: 1px solid var(--color-border);
      gap: .5rem;
      flex-shrink: 0;
      min-height: 48px;
    }
    .ep-status-row {
      display: flex;
      align-items: center;
      min-width: 0;
    }
    .ep-header-actions {
      display: flex;
      align-items: center;
      gap: .5rem;
    }
    .btn-close {
      background: none;
      border: none;
      color: var(--color-muted);
      font-size: 1.1rem;
      cursor: pointer;
      padding: .2rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      &:hover { background: var(--color-surface-alt); color: var(--color-text); }
    }

    /* ── Tabs ── */
    .ep-tabs {
      display: flex;
      background: var(--color-surface-alt);
      padding: 2px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .tab-btn {
      flex: 1;
      border: none;
      background: none;
      padding: .45rem;
      font-size: .68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: var(--color-muted);
      cursor: pointer;
      border-radius: 4px;
      transition: all .2s;
      &.active {
        background: var(--color-surface);
        color: var(--color-accent);
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      &:hover:not(.active) { color: var(--color-text); }
    }
    
    .ep-status-chip {
      font-size: .62rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .05em;
      padding: .15rem .45rem;
      border-radius: 20px;
      display: inline-flex;
      align-items: center;
      gap: .25rem;
    }
    .ep-status-chip.done    { background: rgba(76,175,130,.1); color: var(--color-success); border: 1px solid rgba(76,175,130,.2); }
    .ep-status-chip.running { background: rgba(124,106,247,.1); color: var(--color-accent); border: 1px solid rgba(124,106,247,.2); }
    .ep-status-chip.error   { background: var(--color-error-subtle); color: var(--color-error); border: 1px solid rgba(224,92,92,.2); }

    /* ── Start button ── */
    .btn-export {
      display: inline-flex;
      align-items: center;
      gap: .35rem;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: .35rem .75rem;
      font-size: .75rem;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;
      transition: all .15s ease;
      box-shadow: 0 2px 6px rgba(124,106,247,.2);
      &:hover:not(:disabled) {
        opacity: .9;
        transform: translateY(-1px);
        box-shadow: 0 4px 10px rgba(124,106,247,.3);
      }
      &:active:not(:disabled) { transform: translateY(0); }
      &:disabled { opacity: .4; cursor: default; box-shadow: none; }
    }
    .btn-spinner {
      display: inline-block;
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.3);
      border-top-color: #fff;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Scroll Area ── */
    .ep-scroll-area {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    /* ── Sections ── */
    .ep-section {
      padding: .85rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .ep-section:last-child { border-bottom: none; }
    
    .ep-section-label {
      font-size: .62rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: var(--color-muted);
      margin-bottom: .6rem;
    }

    /* ── Format grid ── */
    .format-grid {
      display: flex;
      flex-direction: column;
      gap: .35rem;
    }
    .format-card {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      gap: 0 .6rem;
      align-items: center;
      padding: .5rem .65rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      background: var(--color-bg);
      cursor: pointer;
      text-align: left;
      transition: all .2s ease;
      &.selected {
        border-color: var(--color-accent);
        background: var(--color-accent-subtle);
        .fc-label { color: var(--color-accent); }
      }
      &:hover:not(.selected):not(:disabled) {
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
        background: color-mix(in srgb, var(--color-accent) 4%, var(--color-bg));
      }
      &:disabled { opacity: .5; cursor: default; }
    }
    .fc-icon {
      grid-row: 1 / 3;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--color-surface-alt);
      color: var(--color-muted);
      transition: all .24s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .format-card.selected .fc-icon {
      color: #fff;
    }

    .format-card[data-format="video"].selected .fc-icon {
      background: #3b82f6;
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3);
    }
    .format-card[data-format="text-plain"].selected .fc-icon {
      background: #10b981;
      box-shadow: 0 4px 10px rgba(16, 185, 129, 0.3);
    }
    .format-card[data-format="text-srt"].selected .fc-icon {
      background: #f59e0b;
      box-shadow: 0 4px 10px rgba(245, 158, 11, 0.3);
    }

    .fc-content { display: flex; flex-direction: column; gap: 1px; }
    .fc-label { font-size: .75rem; font-weight: 650; color: var(--color-text); line-height: 1.2; }
    .fc-desc { font-size: .65rem; color: var(--color-muted); line-height: 1.2; }

    /* ── Flow steps ── */
    .flow-steps {
      display: flex;
      flex-direction: column;
      gap: 0;
      margin-bottom: .6rem;
    }
    .flow-step {
      display: flex;
      align-items: flex-start;
      gap: .5rem;
      position: relative;
    }
    .fs-dot {
      width: 18px; height: 18px;
      border-radius: 50%;
      border: 1px solid var(--color-border);
      background: var(--color-bg);
      color: var(--color-muted);
      font-size: .6rem;
      font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      position: relative;
      z-index: 1;
      transition: all .3s ease;
    }
    .flow-step.done .fs-dot {
      background: rgba(76,175,130,.15);
      border-color: var(--color-success);
      color: var(--color-success);
    }
    .flow-step.active .fs-dot {
      background: rgba(124,106,247,.15);
      border-color: var(--color-accent);
    }
    .fs-pulse {
      display: block;
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--color-accent);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.4); opacity: .6; }
    }
    .fs-line {
      position: absolute;
      left: 8.5px;
      top: 18px;
      width: 1px;
      height: 18px;
      background: var(--color-border);
    }
    .flow-step.done .fs-line { background: var(--color-success); opacity: .5; }
    .fs-label {
      font-size: .7rem;
      color: var(--color-text-secondary);
      padding-top: .1rem;
      padding-bottom: .45rem;
    }
    .flow-step.done .fs-label { color: var(--color-success); }
    .flow-step.active .fs-label { color: var(--color-accent); font-weight: 600; }

    /* ── Progress bar ── */
    .ep-progress-bar {
      height: 4px;
      background: var(--color-border);
      border-radius: 2px;
      overflow: hidden;
    }
    .ep-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--color-accent), #a78bfa);
      border-radius: 2px;
      transition: width .4s ease;
    }
    .ep-progress-label {
      font-size: .65rem;
      color: var(--color-muted);
      margin-top: .35rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 500;
    }
    .ep-progress-percent { font-weight: 700; color: var(--color-accent); }
    .ep-progress-time { opacity: 0.8; font-family: 'JetBrains Mono', monospace; }

    /* ── Footer / download ── */
    .ep-footer {
      padding: .6rem .85rem .85rem;
      border-top: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .btn-download {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: .4rem;
      padding: .6rem;
      background: rgba(76,175,130,.12);
      color: var(--color-success);
      border: 1px solid rgba(76,175,130,.2);
      border-radius: 8px;
      text-decoration: none;
      font-size: .78rem;
      font-weight: 700;
      transition: all .2s;
      &:hover { background: rgba(76,175,130,.2); transform: translateY(-1px); }
    }

    /* ── Range Selector ── */
    .scope-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: .3rem;
      margin-bottom: .6rem;
    }
    .scope-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: .25rem;
      padding: .45rem .2rem;
      background: var(--color-surface-alt);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      cursor: pointer;
      color: var(--color-text-secondary);
      transition: all .15s;
      &.active {
        border-color: var(--color-accent);
        background: var(--color-accent-subtle);
        color: var(--color-accent);
      }
      &:disabled { opacity: .5; cursor: default; }
      &:hover:not(.active):not(:disabled) {
        background: color-mix(in srgb, var(--color-accent) 5%, var(--color-surface-alt));
        border-color: color-mix(in srgb, var(--color-accent) 20%, var(--color-border));
        color: var(--color-text);
      }
    }
    .sb-icon { line-height: 1; }
    .sb-label { font-size: .62rem; font-weight: 600; text-align: center; }

    .clip-selector {
      margin-top: .5rem;
      max-height: 120px;
      overflow-y: auto;
      background: var(--color-surface-alt);
      border-radius: 6px;
      padding: .2rem;
      display: flex;
      flex-direction: column;
      gap: 1px;
      border: 1px solid var(--color-border);
    }
    .clip-checkbox-row {
      display: flex;
      align-items: center;
      gap: .5rem;
      padding: .35rem .5rem;
      border-radius: 4px;
      cursor: pointer;
      &:hover { background: rgba(0,0,0,0.03); }
      input { cursor: pointer; accent-color: var(--color-accent); }
    }
    .ccr-label { font-size: .7rem; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ccr-meta { font-size: .62rem; color: var(--color-muted); }
    .empty-selection { padding: .7rem; text-align: center; font-size: .68rem; color: var(--color-muted); font-style: italic; }

    /* ── Smart Edit Styles ── */
    .se-list {
      display: flex;
      flex-direction: column;
      gap: .25rem;
    }
    .se-clip-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: .4rem .6rem;
      background: var(--color-surface-alt);
      border-radius: 6px;
      border: 1px solid var(--color-border);
    }
    .se-clip-name { font-size: .72rem; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .se-clip-duration { font-size: .65rem; color: var(--color-muted); font-family: 'JetBrains Mono', monospace; }

    .se-transition-row {
      display: flex;
      gap: .6rem;
      padding-left: .75rem;
    }
    .se-transition-line {
      width: 2px;
      background: var(--color-border);
      border-radius: 1px;
      opacity: 0.5;
    }
    .se-transition-controls {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: .4rem;
      padding: .4rem 0;
    }
    .se-field-group {
      display: flex;
      flex-wrap: wrap;
      gap: .5rem;
      padding: .4rem;
      background: var(--color-surface-alt);
      border-radius: 6px;
      border: 1px dashed var(--color-border);
    }
    .se-field {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .se-field-label {
      font-size: .55rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--color-muted);
    }
    .se-field select, .se-field input {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 4px;
      padding: .25rem .4rem;
      font-size: .68rem;
      color: var(--color-text);
      &:focus { outline: none; border-color: var(--color-accent); }
    }
    .se-field select { min-width: 110px; }
    .se-field input[type="number"] { width: 65px; }
    .se-field input[type="color"] { width: 28px; height: 24px; padding: 1px; cursor: pointer; }

    .se-summary {
      margin-top: .8rem;
      padding: .5rem;
      background: var(--color-accent-subtle);
      border-radius: 6px;
      font-size: .65rem;
      font-weight: 600;
      color: var(--color-accent);
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
    }

    .fade-in { animation: fadeIn .2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

    .ep-error {
      padding: .45rem .6rem;
      background: var(--color-error-subtle);
      color: var(--color-error);
      border-radius: 6px;
      font-size: .72rem;
      line-height: 1.4;
      margin: 0;
    }
  `]
})
export class ExportPanelComponent {
  readonly projectId = input.required<string>();
  readonly activeClipId = input<string | null>(null);
  readonly availableClips = input<Clip[]>([]);
  readonly close = output<void>();

  readonly activeTab = signal<ExportTab>('simple');

  readonly formats = [
    { value: 'video'      as ExportFormat, label: 'Video (MP4)',    desc: 'Removed words cut from media' },
    { value: 'text-plain' as ExportFormat, label: 'Plain Text',     desc: 'Active words as plain text'   },
    { value: 'text-srt'   as ExportFormat, label: 'SRT Subtitles',  desc: 'Active words as .srt file'    },
  ];

  readonly scopes = [
    { value: 'all'      as ExportScope, label: 'Whole Project', icon: 'project' },
    { value: 'current'  as ExportScope, label: 'Current Clip', icon: 'current' },
    { value: 'selected' as ExportScope, label: 'Selected Clips', icon: 'list' },
  ];

  readonly exportScope = signal<ExportScope>('all');
  readonly selectedClipIds = signal<Set<string>>(new Set());

  // Smart Edit Data
  readonly effects = TRANSITION_EFFECTS;
  readonly effectLabels = TRANSITION_LABELS;
  readonly transitions = signal<ClipTransition[]>([]);

  readonly flowSteps = [
    { id: 'queue',   label: 'Queued'     },
    { id: 'process', label: 'Processing' },
    { id: 'encode',  label: 'Encoding'   },
    { id: 'done',    label: 'Complete'   },
  ];

  readonly selectedFormat = signal<ExportFormat>('video');
  readonly status = signal<ExportStatus>('idle');
  readonly progress = signal(0);
  readonly elapsedTime = signal(0);
  readonly estimatedTotalTime = signal(0);
  readonly errorMsg = signal('');
  readonly downloadUrl = signal('');

  private jobId = '';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sanitizer = inject(DomSanitizer);

  constructor(private api: ApiService, private sse: SseService) {
    // Auto-select current clip ID when scope is 'selected' and it changes
    effect(() => {
      const active = this.activeClipId();
      if (active && this.exportScope() === 'current') {
        this.selectedClipIds.set(new Set([active]));
      }
    });

    // Initialize transitions when availableClips changes
    effect(() => {
      const clips = this.availableClips();
      if (clips.length < 2) {
        this.transitions.set([]);
        return;
      }
      
      this.transitions.update(current => {
        const next: ClipTransition[] = [];
        for (let i = 0; i < clips.length - 1; i++) {
          const fromId = clips[i].id;
          const toId = clips[i+1].id;
          const existing = current.find(t => t.fromClipId === fromId && t.toClipId === toId);
          if (existing) {
            next.push(existing);
          } else {
            next.push({
              id: crypto.randomUUID(),
              fromClipId: fromId,
              toClipId: toId,
              effect: 'hard-cut',
              durationMs: 0,
              pauseMs: 0
            });
          }
        }
        return next;
      });
    }, { allowSignalWrites: true });

    // Listen for SSE events to get real-time progress
    effect(() => {
      const event = this.sse.lastEvent();
      if (!event) return;

      const { type, data } = event;
      // Only handle events for the current job
      if (data['jobId'] !== this.jobId) return;

      if (type === 'export:progress') {
        if (data['progress'] != null) this.progress.set(data['progress'] as number);
        if (data['elapsedTime'] != null) this.elapsedTime.set(data['elapsedTime'] as number);
        if (data['estimatedTotalTime'] != null) this.estimatedTotalTime.set(data['estimatedTotalTime'] as number);
      } else if (type === 'export:complete') {
        this.clearPolling();
        this.progress.set(100);
        this.status.set('done');
        this.downloadUrl.set(`/api/export/${this.jobId}/download`);
      } else if (type === 'export:error') {
        this.clearPolling();
        this.status.set('error');
        this.errorMsg.set((data['error'] as string) ?? 'Unknown export error');
      }
    });
  }

  readonly clipDurations = computed(() =>
    this.availableClips().map(clip => {
      const activeWords = clip.segments.flatMap(s => s.words).filter(w => !w.isRemoved);
      if (!activeWords.length) return 0;
      const sorted = [...activeWords].sort((a, b) => a.startTime - b.startTime);
      return sorted[sorted.length - 1].endTime - sorted[0].startTime;
    })
  );

  readonly estimatedDuration = computed(() => {
    const clipTotal = this.clipDurations().reduce((s, d) => s + d, 0);
    const transTotal = this.transitions().reduce((s, t) => s + t.durationMs + t.pauseMs, 0) / 1000;
    return clipTotal + transTotal;
  });

  updateTransition(index: number, field: string, value: unknown): void {
    this.transitions.update(list => {
      const updated = [...list];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'effect' && value === 'hard-cut') {
        updated[index].durationMs = 0;
        updated[index].pauseMs = 0;
      }
      if (field === 'effect' && value !== 'hard-cut' && updated[index].durationMs === 0) {
        updated[index].durationMs = 1000;
        updated[index].pauseMs = value === 'cross-dissolve' ? 0 : 1000;
      }
      return updated;
    });
  }

  clamp(value: number): number {
    if (isNaN(value)) return 0;
    return Math.max(0, Math.min(10000, value));
  }

  toggleClipSelection(clipId: string): void {
    this.selectedClipIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(clipId)) newSet.delete(clipId);
      else newSet.add(clipId);
      return newSet;
    });
  }

  getTrustedIconForScope(scope: ExportScope): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.getIconForScope(scope));
  }

  getIconForScope(scope: ExportScope): string {
    const size = 16;
    switch (scope) {
      case 'all': // Project/Box icon
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="2" y1="20" x2="22" y2="20"/><line x1="12" y1="20" x2="12" y2="17"/></svg>`;
      case 'current': // Target/Crosshair icon
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`;
      case 'selected': // List/Checklist icon
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
      default: return '';
    }
  }

  getTrustedIcon(format: ExportFormat): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.getIcon(format));
  }

  getIcon(format: ExportFormat): string {
    const size = 20;
    const strokeWidth = 2;
    switch (format) {
      case 'video':
        return `
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 10l5-5v14l-5-5"></path>
            <rect x="2" y="3" width="13" height="18" rx="2" ry="2"></rect>
            <path d="M7 10l3 2-3 2v-4z" fill="currentColor"></path>
          </svg>`;
      case 'text-plain':
        return `
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <line x1="10" y1="9" x2="8" y2="9"></line>
          </svg>`;
      case 'text-srt':
        return `
          <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <path d="M7 8h10"></path>
            <path d="M7 12h10"></path>
          </svg>`;
      default:
        return '';
    }
  }

  formatLabel(): string {
    return this.formats.find(f => f.value === this.selectedFormat())?.label ?? '';
  }

  getStepState(index: number): 'done' | 'active' | 'pending' {
    const p = this.progress();
    const status = this.status();
    if (status === 'done') return 'done';
    if (status !== 'pending') return 'pending';
    // Map progress % to active step
    const thresholds = [0, 30, 70, 100];
    const activeStep = thresholds.findIndex((t, i) =>
      p >= t && (i === thresholds.length - 1 || p < thresholds[i + 1])
    );
    if (index < activeStep) return 'done';
    if (index === activeStep) return 'active';
    return 'pending';
  }

  startExport(): void {
    this.status.set('pending');
    this.progress.set(0);
    this.errorMsg.set('');

    const body: any = {
      projectId: this.projectId(),
      format: this.activeTab() === 'smart' ? 'video' : this.selectedFormat(),
    };

    if (this.activeTab() === 'smart') {
      body.clipIds = this.availableClips().map(c => c.id);
      body.transitions = this.transitions();
    } else {
      body.clipIds = this.getClipIdsForExport();
    }

    this.api.post<{ jobId: string }>('/export', body).subscribe({
      next: ({ jobId }) => {
        this.jobId = jobId;
        this.startPolling();
      },
      error: (err: Error) => {
        this.status.set('error');
        this.errorMsg.set(err.message);
      }
    });
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.api.get<{ status: string; progress?: number; error?: string; elapsedTime?: number; estimatedTotalTime?: number }>(`/export/${this.jobId}/status`).subscribe({
        next: (s) => {
          if (s.progress != null) this.progress.set(s.progress);
          if (s.elapsedTime != null) this.elapsedTime.set(s.elapsedTime);
          if (s.estimatedTotalTime != null) this.estimatedTotalTime.set(s.estimatedTotalTime);
          if (s.status === 'done') {
            this.clearPolling();
            this.progress.set(100);
            this.status.set('done');
            this.downloadUrl.set(`/api/export/${this.jobId}/download`);
          } else if (s.status === 'error') {
            this.clearPolling();
            this.status.set('error');
            this.errorMsg.set(s.error ?? 'Unknown export error');
          }
        },
        error: () => this.clearPolling(),
      });
    }, 1500);
  }

  private clearPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  readonly remainingTime = computed(() => {
    const est = this.estimatedTotalTime();
    const elapsed = this.elapsedTime();
    if (est <= 0 || elapsed <= 0) return 0;
    return Math.max(0, est - elapsed);
  });

  formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private getClipIdsForExport(): string[] | undefined {
    const scope = this.exportScope();
    if (scope === 'all') return undefined; // Server handles undefined as all
    if (scope === 'current') return this.activeClipId() ? [this.activeClipId()!] : undefined;
    if (scope === 'selected') {
      const ids = Array.from(this.selectedClipIds());
      return ids.length > 0 ? ids : undefined;
    }
    return undefined;
  }
}
