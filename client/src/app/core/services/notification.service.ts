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
