import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SseEvent } from '../../../core/services/sse.service';

export type ProcessingStatus = 'idle' | 'running' | 'done' | 'error';

@Component({
  selector: 'app-processing-progress',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="progress-panel" [attr.data-status]="status()">
      <div class="progress-header">
        <span class="status-icon">
          @if (status() === 'running') { <span class="spinner"></span> }
          @else if (status() === 'done') { ✓ }
          @else if (status() === 'error') { ✕ }
        </span>
        <span class="status-label">{{ label() }}</span>
      </div>

      @if (status() === 'running') {
        <div class="progress-bar-track">
          <div class="progress-bar-fill" [style.width.%]="progress()"></div>
        </div>
        <p class="progress-message">{{ message() }}</p>
      }

      @if (status() === 'error') {
        <p class="error-message">{{ message() }}</p>
      }
    </div>
  `,
  styles: [`
    .progress-panel {
      padding: 1rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      background: var(--color-surface);
      &[data-status="running"] { border-color: var(--color-accent); }
      &[data-status="done"] { border-color: var(--color-success); }
      &[data-status="error"] { border-color: var(--color-error); }
    }
    .progress-header { display: flex; align-items: center; gap: .6rem; margin-bottom: .6rem; }
    .status-icon {
      width: 20px; height: 20px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1rem;
    }
    .status-label { font-weight: 600; font-size: .9rem; }
    .spinner {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid var(--color-border);
      border-top-color: var(--color-accent);
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-bar-track {
      height: 4px; border-radius: 2px;
      background: var(--color-border);
      margin-bottom: .5rem;
    }
    .progress-bar-fill {
      height: 100%;
      background: var(--color-accent);
      border-radius: 2px;
      transition: width .3s ease;
    }
    .progress-message, .error-message { font-size: .8rem; margin: 0; }
    .error-message { color: var(--color-error); }
  `]
})
export class ProcessingProgressComponent {
  readonly event = input<SseEvent | null>(null);

  readonly status = computed<ProcessingStatus>(() => {
    const ev = this.event();
    if (!ev) return 'idle';
    if (ev.type === 'pipeline:complete') return 'done';
    if (ev.type === 'pipeline:error') return 'error';
    return 'running';
  });

  readonly label = computed(() => {
    const s = this.status();
    if (s === 'idle') return 'Ready';
    if (s === 'done') return 'Processing complete';
    if (s === 'error') return 'Processing failed';
    return `Plugin: ${this.event()?.data?.['pluginId'] ?? '…'}`;
  });

  readonly progress = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const p = ev.data?.['progress'];
    return typeof p === 'number' ? p : 50;
  });

  readonly message = computed(() => {
    const ev = this.event();
    return (ev?.data?.['message'] as string) ?? (ev?.data?.['error'] as string) ?? '';
  });
}
