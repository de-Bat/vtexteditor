# Notifications Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ephemeral toast popups with a persistent notifications panel sidebar in the Studio that shows all active (non-dismissed) notifications.

**Architecture:** Extend `NotificationService` with a persistent `history` signal and `clearAll()` method, removing auto-dismiss timers. Remove `ToastStackComponent` entirely. Add a new `NotificationsPanelComponent` as a studio sidebar (same pattern as export/plugin panels) with a toggle button and unread badge in the studio header.

**Tech Stack:** Angular 20+, signals, standalone components, `ChangeDetectionStrategy.OnPush`, inline styles/template.

---

## File Map

| File | Action |
|------|--------|
| `client/src/app/core/services/notification.service.ts` | Modify — add `timestamp`, rename to `history`, add `clearAll()`, remove auto-dismiss |
| `client/src/app/shared/components/toast-stack.component.ts` | Delete |
| `client/src/app/app.ts` | Modify — remove `ToastStackComponent` |
| `client/src/app/features/studio/notifications-panel/notifications-panel.component.ts` | Create |
| `client/src/app/features/studio/studio.component.ts` | Modify — add panel, toggle button, badge, resizer |

---

### Task 1: Update NotificationService

**Files:**
- Modify: `client/src/app/core/services/notification.service.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/app/core/services/notification.service.spec.ts`:

```typescript
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  it('push() adds to history with timestamp', () => {
    service.push('success', 'hello');
    expect(service.history().length).toBe(1);
    expect(service.history()[0].text).toBe('hello');
    expect(service.history()[0].type).toBe('success');
    expect(service.history()[0].timestamp).toBeInstanceOf(Date);
  });

  it('push() does NOT auto-dismiss', fakeAsync(() => {
    service.push('info', 'stay');
    tick(10000);
    expect(service.history().length).toBe(1);
  }));

  it('dismiss() removes by id', () => {
    service.push('error', 'err');
    const id = service.history()[0].id;
    service.dismiss(id);
    expect(service.history().length).toBe(0);
  });

  it('clearAll() empties history', () => {
    service.push('success', 'a');
    service.push('error', 'b');
    service.clearAll();
    expect(service.history().length).toBe(0);
  });

  it('messages() is alias for history()', () => {
    service.push('info', 'x');
    expect(service.messages()).toEqual(service.history());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd client && npx ng test --include="**/notification.service.spec.ts" --watch=false
```

Expected: FAIL — `history` not defined, `clearAll` not defined, `timestamp` missing.

- [ ] **Step 3: Rewrite notification.service.ts**

Replace entire file content:

```typescript
import { Injectable, computed, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  type: 'error' | 'info' | 'success';
  text: string;
  timestamp: Date;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly history = signal<ToastMessage[]>([]);
  readonly messages = computed(() => this.history());
  private nextId = 1;

  push(type: ToastMessage['type'], text: string): void {
    const id = this.nextId++;
    this.history.update((list) => [...list, { id, type, text, timestamp: new Date() }]);
  }

  error(text: string): void {
    this.push('error', text);
  }

  dismiss(id: number): void {
    this.history.update((list) => list.filter((msg) => msg.id !== id));
  }

  clearAll(): void {
    this.history.set([]);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx ng test --include="**/notification.service.spec.ts" --watch=false
```

Expected: 5 specs, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/core/services/notification.service.ts client/src/app/core/services/notification.service.spec.ts
git commit -m "feat(notifications): add persistent history, clearAll, timestamp; remove auto-dismiss"
```

---

### Task 2: Remove ToastStackComponent

**Files:**
- Delete: `client/src/app/shared/components/toast-stack.component.ts`
- Modify: `client/src/app/app.ts`

- [ ] **Step 1: Remove toast-stack from app.ts**

Replace `client/src/app/app.ts` with:

```typescript
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogComponent } from './shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ConfirmDialogComponent],
  template: `
    <router-outlet />
    <app-confirm-dialog />
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class App {}
```

- [ ] **Step 2: Delete the toast-stack file**

```bash
rm client/src/app/shared/components/toast-stack.component.ts
```

- [ ] **Step 3: Run app spec to verify it still passes**

```bash
cd client && npx ng test --include="**/app.spec.ts" --watch=false
```

Expected: 2 specs, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(notifications): remove ToastStackComponent and toast rendering"
```

---

### Task 3: Create NotificationsPanelComponent

**Files:**
- Create: `client/src/app/features/studio/notifications-panel/notifications-panel.component.ts`

- [ ] **Step 1: Create the component file**

Create `client/src/app/features/studio/notifications-panel/notifications-panel.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { NotificationService, ToastMessage } from '../../../core/services/notification.service';

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
            <button class="btn-clear" (click)="notifications.clearAll()" aria-label="Clear all notifications">
              Clear all
            </button>
          }
          <button class="btn-close" (click)="close.emit()" aria-label="Close notifications panel">×</button>
        </div>
      </div>

      <!-- List -->
      <div class="np-scroll-area" role="log" aria-live="polite" aria-label="Notifications">
        @if (notifications.history().length === 0) {
          <div class="np-empty">No notifications</div>
        } @else {
          @for (msg of notifications.history(); track msg.id) {
            <div class="np-row" [attr.data-type]="msg.type">
              <div class="np-row-icon" [attr.aria-label]="msg.type">
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
      .np-row[data-type="success"] & { color: var(--color-success); background: rgba(76,175,130,.12); }
      .np-row[data-type="error"] &   { color: var(--color-error);   background: var(--color-error-subtle); }
      .np-row[data-type="info"] &    { color: var(--color-muted);   background: var(--color-surface-alt); }
    }
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/features/studio/notifications-panel/notifications-panel.component.ts
git commit -m "feat(notifications): add NotificationsPanelComponent"
```

---

### Task 4: Wire NotificationsPanel into StudioComponent

**Files:**
- Modify: `client/src/app/features/studio/studio.component.ts`

- [ ] **Step 1: Add import and signal**

In `studio.component.ts`, add to the imports array at the top of the file:

```typescript
import { NotificationsPanelComponent } from './notifications-panel/notifications-panel.component';
import { NotificationService } from '../../core/services/notification.service';
```

Add to the `@Component` `imports` array:
```typescript
NotificationsPanelComponent,
```

Add to the class body (after `showPluginsPanel`):
```typescript
readonly showNotificationsPanel = signal(false);
readonly notifications = inject(NotificationService);
```

- [ ] **Step 2: Add toggle button in header nav**

In the template, find the nav section (after the Export button, before closing `</nav>`):

```html
          <button
            class="export-toggle-btn"
            [class.active]="showNotificationsPanel()"
            (click)="showNotificationsPanel.update(v => !v)"
            title="Toggle Notifications Panel"
            [attr.aria-label]="'Toggle notifications panel, ' + notifications.history().length + ' notifications'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span>Notifications</span>
            @if (notifications.history().length > 0) {
              <span class="notif-badge" aria-hidden="true">{{ notifications.history().length }}</span>
            }
          </button>
```

- [ ] **Step 3: Add resizer for notifications panel**

In the template, after the export resizer block (`<!-- Right Resizer (Export) -->`), add:

```html
        <!-- Notifications Panel Resizer -->
        @if (showNotificationsPanel()) {
          <div
            class="resizer notif-resizer"
            [style.order]="6"
            (mousedown)="startResizing('notifications', $event)"
          ></div>
        }
```

- [ ] **Step 4: Add notifications panel aside**

In the template, after the export panel `</aside>` block, add:

```html
        <!-- Notifications Panel -->
        <aside
          class="side-panel-wrapper notif-wrapper"
          [class.opened]="showNotificationsPanel()"
          [style.order]="isRtl() ? 2 : 9"
          [style.width.px]="showNotificationsPanel() ? notifPanelWidth() : 0"
          aria-label="Notifications"
        >
          <div class="panel-content">
            <app-notifications-panel
              (close)="showNotificationsPanel.set(false)"
            />
          </div>
        </aside>
```

- [ ] **Step 5: Add notifPanelWidth signal and resizing logic**

In the class body, add after `pluginsPanelWidth`:
```typescript
readonly notifPanelWidth = signal(320);
```

In `startResizing()`, add `'notifications'` case. The full updated method:

```typescript
startResizing(side: 'left' | 'right' | 'plugin' | 'notifications', event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  this.isResizing.set(true);
  this.startX = event.clientX;

  if (side === 'left') {
    this.isResizingLeft = true;
    this.startWidth = this.leftSidebarWidth();
  } else if (side === 'right') {
    this.isResizingRight = true;
    this.startWidth = this.rightSidebarWidth();
  } else if (side === 'plugin') {
    this.isResizingPlugin = true;
    this.startWidth = this.pluginsPanelWidth();
  } else {
    this.isResizingNotif = true;
    this.startWidth = this.notifPanelWidth();
  }
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}
```

Add private field after `isResizingPlugin`:
```typescript
private isResizingNotif = false;
```

In `onMouseMove()`, add the notifications branch after the plugin branch:

```typescript
} else if (this.isResizingNotif) {
  const newWidth = this.startWidth - delta;
  this.notifPanelWidth.set(Math.max(280, Math.min(newWidth, 600)));
}
```

In `onMouseUp()`, update the condition and reset:

```typescript
@HostListener('window:mouseup')
onMouseUp(): void {
  if (this.isResizingLeft || this.isResizingRight || this.isResizingPlugin || this.isResizingNotif) {
    this.isResizingLeft = false;
    this.isResizingRight = false;
    this.isResizingPlugin = false;
    this.isResizingNotif = false;
    this.isResizing.set(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}
```

- [ ] **Step 6: Add CSS for notif-wrapper and badge**

In the component `styles` array, add inside the existing styles (after `.plugin-wrapper` rules):

```scss
&.notif-wrapper {
  width: 0;
  &.opened { width: 320px; }
}
```

Add badge style after `.export-toggle-btn` rules:

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

- [ ] **Step 7: Verify build and run dev server**

```bash
cd client && npx ng build --configuration=development 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/app/features/studio/studio.component.ts
git commit -m "feat(notifications): wire NotificationsPanel into Studio with toggle, badge, resizer"
```

---

### Task 5: Verify end-to-end in browser

- [ ] **Step 1: Start dev server**

```bash
cd client && npx ng serve --open
```

- [ ] **Step 2: Manual smoke test**

1. Open Studio (navigate to a project)
2. Click "Notifications" button in header — panel opens at right
3. Resize panel by dragging the resizer — width changes
4. Run a plugin pipeline — "Saved to notebook" / error appear in panel with timestamp and colored left border
5. Dismiss one notification with ×
6. Click "Clear all" — panel empties, badge disappears
7. Close panel with × — panel slides closed
8. Re-open — panel shows correctly

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(notifications): address smoke test issues"
```
