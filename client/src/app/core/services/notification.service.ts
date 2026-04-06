import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  type: 'error' | 'info' | 'success';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly messages = signal<ToastMessage[]>([]);
  private nextId = 1;

  push(type: ToastMessage['type'], text: string, durationMs = 4000): void {
    const id = this.nextId++;
    this.messages.update((list) => [...list, { id, type, text }]);

    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  error(text: string): void {
    this.push('error', text, 5000);
  }

  dismiss(id: number): void {
    this.messages.update((list) => list.filter((msg) => msg.id !== id));
  }
}
