# Notifications Panel — Design Spec
Date: 2026-04-30

## Overview

Replace the existing ephemeral toast system with a persistent notifications panel displayed as a sidebar in the Studio, matching the export and plugins panel pattern.

## Goals

- Show all active (non-dismissed) notifications in a sidebar panel
- No toast popups
- Toggle button in studio header with a badge showing notification count
- User dismisses notifications manually (per-item or clear-all)

## NotificationService Changes

**Interface update** — add `timestamp` field:

```ts
export interface ToastMessage {
  id: number;
  type: 'error' | 'info' | 'success';
  text: string;
  timestamp: Date;
}
```

**Behavior changes:**
- `push()` appends to `history` signal with current timestamp; remove the `setTimeout` auto-dismiss
- `history` signal replaces `messages` signal (rename for clarity; `messages` kept as computed alias for backward compat with existing callers in plugin-panel)
- Add `clearAll()` method that sets history to `[]`
- `dismiss(id)` removes from history (no change in signature)
- Remove `durationMs` parameter behavior (no auto-dismiss timer)

## Remove Toasts

- Remove `<app-toast-stack />` from `app.ts` template and imports array
- `ToastStackComponent` file can be deleted

## NotificationsPanelComponent

File: `client/src/app/features/studio/notifications-panel/notifications-panel.component.ts`

**Structure** (matches export/plugin panel pattern):
- Standalone, `ChangeDetectionStrategy.OnPush`
- Inputs: none (reads `NotificationService` directly via `inject()`)
- Outputs: `close = output<void>()`

**Template layout:**
```
┌─────────────────────────────┐
│ NOTIFICATIONS   [Clear All] [×] │  ← header
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ [✓] Saved to notebook   │ │  ← success row
│ │     12:34:01         [×]│ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ [✗] Export failed       │ │  ← error row
│ │     12:35:10         [×]│ │
│ └─────────────────────────┘ │
│                             │
│   (No notifications)        │  ← empty state
└─────────────────────────────┘
```

**Styling:**
- Type colors: success=`var(--color-success)`, error=`var(--color-error)`, info=`var(--color-muted)`
- Row background: `var(--color-bg)`, border `var(--color-border)`, border-left 3px colored by type
- Timestamp: monospace, muted, small font
- Empty state: centered italic muted text
- Matches `.ep-header`, `.ep-scroll-area`, `.ep-section` visual language from export panel

## StudioComponent Changes

**New signal:**
```ts
readonly showNotificationsPanel = signal(false);
```

**Header nav — new toggle button** (after Export button):
```html
<button class="export-toggle-btn" [class.active]="showNotificationsPanel()"
  (click)="showNotificationsPanel.update(v => !v)">
  <svg><!-- bell icon --></svg>
  <span>Notifications</span>
  @if (notifications.history().length > 0) {
    <span class="notif-badge">{{ notifications.history().length }}</span>
  }
</button>
```

**New sidebar `<aside>`** (after export panel, order 9 in LTR):
- Same `side-panel-wrapper` class pattern
- Width: 320px when open, 0 when closed
- Contains `<app-notifications-panel>`
- Resizer at order 8

**Badge styling** (in studio header):
```scss
.notif-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--color-error);
  color: #fff;
  font-size: .6rem;
  font-weight: 700;
  line-height: 1;
}
```

## Accessibility

- Panel `<aside>` has `aria-label="Notifications"`
- Notification list uses `role="log"` with `aria-live="polite"`
- Each dismiss button has `aria-label="Dismiss notification"`
- Clear-all button has `aria-label="Clear all notifications"`

## Files Changed

| File | Change |
|------|--------|
| `core/services/notification.service.ts` | Add `history`, `clearAll()`, timestamp, remove auto-dismiss |
| `shared/components/toast-stack.component.ts` | Delete |
| `app.ts` | Remove toast-stack import + usage |
| `features/studio/notifications-panel/notifications-panel.component.ts` | New |
| `features/studio/studio.component.ts` | Add panel, toggle button, badge, resizer |
