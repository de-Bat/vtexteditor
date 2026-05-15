import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  animate,
  animateChild,
  query,
  stagger,
  style,
  transition,
  trigger,
} from '@angular/animations';
import { SuggestionService } from '../suggestions/suggestion.service';
import { SuggestOptions } from '../../../core/models/suggestion.model';

const cardAnim = trigger('cardAnim', [
  transition(':enter', [
    style({ opacity: 0, transform: 'translateY(12px)' }),
    animate('220ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
  ]),
  transition(':leave', [
    style({ overflow: 'hidden', height: '*' }),
    animate('200ms ease-in', style({
      opacity: 0,
      height: '0',
      paddingTop: '0',
      paddingBottom: '0',
      marginBottom: '0',
    })),
  ]),
]);

const listAnim = trigger('listAnim', [
  transition('* => *', [
    query(':enter', stagger(40, animateChild()), { optional: true }),
  ]),
]);

@Component({
  selector: 'app-suggestions-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [listAnim, cardAnim],
  template: `
    <div class="suggestions-panel" role="complementary" aria-label="Cut suggestions">

      <!-- Trigger header -->
      <div class="panel-header">
        <div class="header-row">
          <span class="panel-label">SUGGESTIONS</span>
          @if (svc.status() === 'running') {
            <span class="status-badge status-badge--running">Analysing…</span>
          } @else if (svc.status() === 'done') {
            <span class="status-badge">{{ svc.suggestions().length }} found</span>
          }
        </div>

        <!-- Settings -->
        <div class="settings-row">
          <label class="setting-label">
            <input type="checkbox" [checked]="ollamaEnabled()" (change)="setOllamaEnabled($event)" />
            Use Ollama
          </label>
          <label class="setting-label">
            <input type="checkbox" [checked]="useHebrew()" (change)="setUseHebrew($event)" />
            Hebrew fillers
          </label>
        </div>

        <button
          class="btn-run"
          [disabled]="!clipId() || svc.status() === 'running'"
          (click)="runAnalysis()"
          aria-label="Run cut suggestion analysis"
        >
          ✦ Suggest Cuts
        </button>

        @if (svc.status() === 'error') {
          <p class="error-msg" role="alert">{{ svc.error() }}</p>
        }
      </div>

      <!-- Bulk actions -->
      @if (svc.suggestions().length > 0) {
        <div class="bulk-row">
          <button class="btn-bulk btn-accept-high" (click)="svc.acceptHighConfidence(0.8)">
            Accept ≥80%
          </button>
          <button class="btn-bulk" (click)="svc.acceptAll()">Accept All</button>
          <button class="btn-bulk btn-dismiss" (click)="svc.dismissAll()">Dismiss All</button>
        </div>
      }

      <!-- Suggestion list -->
      @if (svc.suggestions().length === 0 && svc.status() !== 'running') {
        <p class="empty-msg">
          @if (svc.status() === 'idle') {
            No suggestions yet. Click "Suggest Cuts" to analyse this clip.
          } @else {
            No suggestions found.
          }
        </p>
      }

      <div class="suggestion-list" [@listAnim]="svc.suggestions().length" [@.disabled]="prefersReducedMotion()">
        @for (s of svc.suggestions(); track s.id) {
          <div
            class="suggestion-card"
            [@cardAnim]
            [class.suggestion-card--silence]="s.reason === 'silence'"
            [class.suggestion-card--llm]="s.source === 'llm' || s.source === 'both'"
            (click)="onCardClick(s)"
            role="button"
            [attr.aria-label]="'Suggestion: ' + s.text"
            tabindex="0"
            (keydown.enter)="onCardClick(s)"
          >
            <div class="card-top">
              <span class="card-text" dir="auto">{{ s.text }}</span>
              <span
                class="card-confidence"
                [class.conf-high]="s.confidence >= 0.8"
                [class.conf-med]="s.confidence >= 0.6 && s.confidence < 0.8"
                [class.conf-low]="s.confidence < 0.6"
              >{{ (s.confidence * 100).toFixed(0) }}%</span>
            </div>
            <div class="card-reason">{{ s.reasonLabel }}</div>
            <div class="card-actions">
              <button
                class="btn-accept"
                (click)="$event.stopPropagation(); svc.accept(s.id)"
                aria-label="Accept suggestion"
              >✓ Accept</button>
              <button
                class="btn-reject"
                (click)="$event.stopPropagation(); svc.reject(s.id)"
                aria-label="Reject suggestion"
              >✗ Reject</button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .suggestions-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-size: 0.8rem;
    }
    .panel-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-muted);
    }
    .status-badge {
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 8px;
      background: var(--color-surface-alt);
      color: var(--color-muted);
      border: 1px solid var(--color-border);
    }
    .status-badge--running {
      color: var(--color-accent);
      border-color: var(--color-accent);
      background: color-mix(in srgb, var(--color-accent) 10%, transparent);
      animation: badge-pulse 1.2s ease-in-out infinite;
    }
    @keyframes badge-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
    @media (prefers-reduced-motion: reduce) {
      .status-badge--running {
        animation: none;
      }
    }
    .settings-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .setting-label {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.72rem;
      color: var(--color-text-secondary);
      cursor: pointer;
      input { cursor: pointer; accent-color: var(--color-accent); }
    }
    .btn-run {
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 5px 12px;
      font-size: 0.78rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      &:disabled { opacity: 0.4; cursor: default; }
      &:not(:disabled):hover { opacity: 0.85; }
    }
    .error-msg {
      color: var(--color-error, #e05c5c);
      font-size: 0.72rem;
      margin: 0;
    }
    .bulk-row {
      display: flex;
      gap: 5px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .btn-bulk {
      font-size: 0.68rem;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--color-border);
      background: var(--color-surface-alt);
      color: var(--color-text-secondary);
      cursor: pointer;
      font-family: inherit;
      &:hover { color: var(--color-text); border-color: var(--color-accent); }
    }
    .btn-accept-high {
      background: color-mix(in srgb, #22c55e 10%, transparent);
      color: #22c55e;
      border-color: color-mix(in srgb, #22c55e 30%, transparent);
    }
    .btn-dismiss { color: var(--color-muted); }
    .empty-msg {
      padding: 1rem;
      color: var(--color-muted);
      text-align: center;
      line-height: 1.5;
    }
    .suggestion-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0;
    }
    .suggestion-card {
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-border);
      border-left: 3px solid #f59e0b;
      cursor: pointer;
      &:hover { background: var(--color-surface-alt); }
      &:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
    }
    .suggestion-card--silence { border-left-color: #3b82f6; }
    .suggestion-card--llm { border-left-color: #a78bfa; }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
      margin-bottom: 2px;
    }
    .card-text {
      font-size: 0.78rem;
      color: var(--color-text);
      font-style: italic;
      flex: 1;
    }
    .card-confidence {
      font-size: 0.7rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .conf-high { color: #22c55e; }
    .conf-med  { color: #f59e0b; }
    .conf-low  { color: var(--color-muted); }
    .card-reason {
      font-size: 0.65rem;
      color: var(--color-muted);
      margin-bottom: 6px;
    }
    .card-actions {
      display: flex;
      gap: 5px;
    }
    .btn-accept, .btn-reject {
      font-size: 0.65rem;
      padding: 2px 7px;
      border-radius: 3px;
      border: 1px solid;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-accept {
      background: color-mix(in srgb, #22c55e 12%, transparent);
      color: #22c55e;
      border-color: color-mix(in srgb, #22c55e 30%, transparent);
      &:hover { background: color-mix(in srgb, #22c55e 25%, transparent); }
    }
    .btn-reject {
      background: color-mix(in srgb, #ef4444 12%, transparent);
      color: #ef4444;
      border-color: color-mix(in srgb, #ef4444 30%, transparent);
      &:hover { background: color-mix(in srgb, #ef4444 25%, transparent); }
    }
  `],
})
export class SuggestionsPanelComponent {
  readonly svc = inject(SuggestionService);

  readonly focusSuggestion = output<string>();
  readonly clipId = input<string | null>(null);
  readonly ollamaEnabled = signal(true);
  readonly useHebrew = signal(true);
  readonly prefersReducedMotion = signal(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );

  runAnalysis(): void {
    const id = this.clipId();
    if (!id) return;
    const langs = ['en'];
    if (this.useHebrew()) langs.push('he');
    const opts: SuggestOptions = {
      fillerLangs: langs,
      ollamaEnabled: this.ollamaEnabled(),
    };
    this.svc.runAnalysis(id, opts);
  }

  onCardClick(s: { wordIds: string[] }): void {
    const firstId = s.wordIds[0];
    if (firstId) this.focusSuggestion.emit(firstId);
  }

  setOllamaEnabled(event: Event): void {
    this.ollamaEnabled.set((event.target as HTMLInputElement).checked);
  }

  setUseHebrew(event: Event): void {
    this.useHebrew.set((event.target as HTMLInputElement).checked);
  }
}
