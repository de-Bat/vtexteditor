import { Component, inject, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { ConfirmService } from '../../../core/services/confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0 }))
      ])
    ]),
    trigger('scale', [
      transition(':enter', [
        style({ transform: 'scale(0.9) translateY(20px)', opacity: 0 }),
        animate('300ms cubic-bezier(0.34, 1.56, 0.64, 1)', style({ transform: 'scale(1) translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ transform: 'scale(0.95)', opacity: 0 }))
      ])
    ])
  ],
  template: `
    @if (confirmService.isOpen()) {
      <div class="modal-backdrop" (click)="onCancel()" @fade>
        <div class="modal-container" (click)="$event.stopPropagation()" @scale>
          <div class="modal-content" [class.destructive]="options()?.isDestructive">
            <div class="modal-header">
              <h3 class="modal-title">{{ options()?.title || 'Confirmation' }}</h3>
              <button class="close-btn" (click)="onCancel()" aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div class="modal-body">
              <p class="modal-message">{{ options()?.message || 'Are you sure you want to proceed?' }}</p>
            </div>
            
            <div class="modal-footer">
              <button class="btn btn-secondary" (click)="onCancel()">
                {{ options()?.cancelLabel || 'Cancel' }}
              </button>
              <button class="btn btn-primary" [class.btn-danger]="options()?.isDestructive" (click)="onConfirm()">
                {{ options()?.confirmLabel || 'Confirm' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .modal-container {
      width: 100%;
      max-width: 440px;
    }

    .modal-content {
      background: var(--color-surface-alt);
      border: 1px solid var(--color-border);
      border-radius: 20px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .modal-content.destructive {
      border-color: rgba(224, 92, 92, 0.3);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 20px rgba(224, 92, 92, 0.1);
    }

    .modal-header {
      padding: 1.5rem 1.5rem 0.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-text);
      letter-spacing: -0.01em;
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      padding: 0.5rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--color-text);
    }

    .modal-body {
      padding: 0.5rem 1.5rem 1.5rem;
    }

    .modal-message {
      margin: 0;
      color: var(--color-text-secondary);
      line-height: 1.6;
      font-size: 0.95rem;
    }

    .modal-footer {
      padding: 1.25rem 1.5rem;
      background: rgba(0, 0, 0, 0.2);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      border-top: 1px solid var(--color-border);
    }

    .btn {
      padding: 0.625rem 1.25rem;
      border-radius: 10px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      font-family: inherit;
    }

    .btn-secondary {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-secondary:hover {
      background: var(--color-border);
    }

    .btn-primary {
      background: var(--color-accent);
      color: white;
      box-shadow: 0 4px 12px var(--color-accent-subtle);
    }

    .btn-primary:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 6px 15px var(--color-accent-subtle);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-primary.btn-danger {
      background: var(--color-error);
      box-shadow: 0 4px 12px var(--color-error-subtle);
    }

    .btn-primary.btn-danger:hover {
      box-shadow: 0 6px 15px var(--color-error-subtle);
    }
  `]
})
export class ConfirmDialogComponent {
  readonly confirmService = inject(ConfirmService);
  readonly options = this.confirmService.options;

  onConfirm(): void {
    this.confirmService.handleAction(true);
  }

  onCancel(): void {
    this.confirmService.handleAction(false);
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (this.confirmService.isOpen()) {
      this.onCancel();
    }
  }

  @HostListener('window:keydown.enter')
  onEnter(): void {
    if (this.confirmService.isOpen()) {
      this.onConfirm();
    }
  }
}
