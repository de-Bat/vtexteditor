import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-toast-stack',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="true">
      @for (msg of notificationService.messages(); track msg.id) {
        <div class="toast" [class.error]="msg.type === 'error'" [class.success]="msg.type === 'success'">
          <span>{{ msg.text }}</span>
          <button type="button" (click)="notificationService.dismiss(msg.id)" aria-label="Dismiss">x</button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-stack {
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: min(420px, calc(100vw - 24px));
      }

      .toast {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid #f2b8b5;
        background: #fff5f4;
        color: #7f1d1d;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
        font-size: 13px;
        line-height: 1.35;
      }

      .toast.success {
        border-color: #9ad9b0;
        background: #f1fbf4;
        color: #14532d;
      }

      .toast button {
        border: 0;
        background: transparent;
        cursor: pointer;
        color: inherit;
        padding: 0;
        line-height: 1;
        font-size: 15px;
      }
    `,
  ],
})
export class ToastStackComponent {
  constructor(readonly notificationService: NotificationService) {}
}
