import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ConfirmService {
  readonly isOpen = signal(false);
  readonly options = signal<ConfirmOptions | null>(null);
  
  private resolve: ((value: boolean) => void) | null = null;

  /**
   * Opens a confirmation dialog and returns a promise that resolves to true (confirm) or false (cancel).
   */
  confirm(options: ConfirmOptions): Promise<boolean> {
    if (this.isOpen()) return Promise.resolve(false);

    this.options.set({
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      isDestructive: false,
      ...options
    });
    this.isOpen.set(true);

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  handleAction(confirmed: boolean): void {
    this.isOpen.set(false);
    this.options.set(null);
    if (this.resolve) {
      this.resolve(confirmed);
      this.resolve = null;
    }
  }
}
