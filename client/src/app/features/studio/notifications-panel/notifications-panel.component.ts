import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-notifications-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="np-panel">

      <!-- Header -->
      <div class="np-header">
        <span class="np-title">Notifications</span>
        <div class="np-header-actions">
          @if (notifications.history().length > 0) {
            <button type="button" class="btn-clear" (click)="notifications.clearAll()" aria-label="Clear all notifications">
              Clear all
            </button>
          }
          <button type="button" class="btn-close" (click)="close.emit()" aria-label="Close notifications panel">×</button>
        </div>
      </div>

      <!-- List -->
      <div class="np-scroll-area" role="log" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
        @if (notifications.history().length === 0) {
          <div class="np-empty">No notifications</div>
        } @else {
          @for (msg of notifications.history(); track msg.id) {
            <div class="np-row" [attr.data-type]="msg.type">
              <div class="np-row-icon" aria-hidden="true">
                @if (msg.type === 'success') {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                } @else if (msg.type === 'error') {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                } @else {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                }
              </div>
              <div class="np-row-body">
                <span class="np-row-text">{{ msg.text }}</span>
                <span class="np-row-time">{{ formatTime(msg.timestamp) }}</span>
              </div>
              <button
                type="button"
                class="btn-dismiss"
                (click)="notifications.dismiss(msg.id)"
                aria-label="Dismiss notification"
              >×</button>
            </div>
          }
        }
      </div>

    </div>
  `,
  styles: [`
    .np-panel {
      display: flex;
      flex-direction: column;
      background: var(--color-surface);
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    /* Header */
    .np-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .6rem .75rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
      min-height: 48px;
      gap: .5rem;
    }
    .np-title {
      font-size: .62rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .07em;
      color: var(--color-muted);
    }
    .np-header-actions {
      display: flex;
      align-items: center;
      gap: .4rem;
    }
    .btn-clear {
      background: none;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      color: var(--color-muted);
      font-size: .62rem;
      font-weight: 600;
      padding: .2rem .5rem;
      cursor: pointer;
      &:hover { background: var(--color-surface-alt); color: var(--color-text); }
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

    /* Scroll area */
    .np-scroll-area {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: .35rem;
      padding: .6rem .75rem;
    }

    /* Empty state */
    .np-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: .7rem;
      color: var(--color-muted);
      font-style: italic;
      padding: 2rem;
    }

    /* Notification row */
    .np-row {
      display: flex;
      align-items: flex-start;
      gap: .5rem;
      padding: .5rem .6rem;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-left-width: 3px;
      border-radius: 0 6px 6px 0;
      &[data-type="success"] { border-left-color: var(--color-success); }
      &[data-type="error"]   { border-left-color: var(--color-error); }
      &[data-type="info"]    { border-left-color: var(--color-muted); }
    }
    .np-row-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 1px;
    }
    .np-row[data-type="success"] .np-row-icon { color: var(--color-success); background: rgba(76,175,130,.12); }
    .np-row[data-type="error"]   .np-row-icon { color: var(--color-error);   background: var(--color-error-subtle); }
    .np-row[data-type="info"]    .np-row-icon { color: var(--color-muted);   background: var(--color-surface-alt); }
    .np-row-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .np-row-text {
      font-size: .72rem;
      color: var(--color-text);
      line-height: 1.4;
      word-break: break-word;
    }
    .np-row-time {
      font-size: .58rem;
      color: var(--color-muted);
      font-family: 'JetBrains Mono', monospace;
    }
    .btn-dismiss {
      background: none;
      border: none;
      color: var(--color-muted);
      font-size: .9rem;
      cursor: pointer;
      padding: 0 .15rem;
      line-height: 1;
      flex-shrink: 0;
      border-radius: 3px;
      &:hover { background: var(--color-surface-alt); color: var(--color-text); }
    }
  `]
})
export class NotificationsPanelComponent {
  readonly close = output<void>();
  readonly notifications = inject(NotificationService);

  formatTime(date: Date): string {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    const s = date.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
}
