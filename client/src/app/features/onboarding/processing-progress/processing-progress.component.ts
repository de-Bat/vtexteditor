import { Component, input, computed, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SseEvent } from '../../../core/services/sse.service';
import { PipelineStep } from '../../../core/models/plugin.model';

export type ProcessingStatus = 'idle' | 'running' | 'done' | 'error';
export type StepStatus = 'done' | 'running' | 'pending';

@Component({
  selector: 'app-processing-progress',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="processing-flow">
      <div class="info-header" style="margin-bottom: 1.5rem">
        <span class="step-name">Processing Pipeline</span>
        @if (status() === 'idle') {
          <span class="step-badge" style="background: var(--color-muted)">STANDBY</span>
        } @else if (status() === 'running') {
          <span class="step-badge">ACTIVE</span>
        }
      </div>

      <div class="flow-list">
        @for (step of steps(); track step.pluginId; let i = $index) {
          <div class="flow-step" [class]="getStepStatus(step.pluginId, i)">
            <div class="step-track">
              <div class="step-dot">
                @if (getStepStatus(step.pluginId, i) === 'done') { ✓ }
                @else if (getStepStatus(step.pluginId, i) === 'running') { <span class="spinner-sm"></span> }
                @else { {{ i + 1 }} }
              </div>
              @if (i < steps().length - 1) {
                <div class="step-line"></div>
              }
            </div>
            
            <div class="step-info">
              <div class="info-header">
                <span class="step-name">{{ step.pluginId }}</span>
                <span class="step-badge" *ngIf="getStepStatus(step.pluginId, i) === 'running'">ACTIVE</span>
              </div>
              
              @if (getStepStatus(step.pluginId, i) === 'running') {
                  <div class="progress-details">
                    <div class="bar-row">
                      <div class="bar">
                        <div class="fill" [style.width.%]="progress()"></div>
                      </div>
                      <span class="percent">{{ progress() }}%</span>
                    </div>
                    @if (elapsedTime() > 0) {
                      <div class="time-stats">
                        <span class="time-item">
                          <span class="label">Elapsed:</span>
                          <span class="value">{{ formatTime(elapsedTime()) }}</span>
                        </span>
                        @if (remainingTime() > 0) {
                          <span class="time-divider"></span>
                          <span class="time-item">
                            <span class="label">Remaining:</span>
                            <span class="value">~{{ formatTime(remainingTime()) }}</span>
                          </span>
                        }
                      </div>
                    }
                  </div>
                <p class="msg">{{ message() }}</p>
              }
            </div>
          </div>
        }
      </div>
      
      @if (status() === 'error') {
        <div class="global-error">
          <span class="err-icon">✕</span>
          <div class="err-content">
            <strong>Processing Error</strong>
            <p>{{ message() }}</p>
          </div>
          <button class="btn-retry" (click)="back.emit()">
            <span>&larr;</span> Go Back
          </button>
        </div>
      }

      @if (status() === 'done') {
        <div class="global-success">
          <span class="success-icon">✓</span>
          <div class="success-content">
            <strong>All Stages Complete</strong>
            <p>Your media has been successfully processed.</p>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .processing-flow { padding: 1rem; }
    .flow-list { display: flex; flex-direction: column; }
    
    .flow-step {
      display: flex;
      gap: 1.25rem;
      &.pending { opacity: 0.4; filter: grayscale(1); }
      &.done { color: var(--color-success); .step-dot { border-color: var(--color-success); background: rgba(76,175,130,0.1); } .step-line { background: var(--color-success); } }
      &.running { .step-dot { border-color: var(--color-accent); box-shadow: 0 0 10px rgba(124, 106, 247, 0.4); } }
    }
    
    .step-track {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 24px;
      flex-shrink: 0;
    }
    
    .step-dot {
      width: 24px; height: 24px;
      border-radius: 50%;
      border: 2px solid var(--color-border);
      background: var(--color-bg);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem; font-weight: 800;
      position: relative; z-index: 1;
    }
    
    .step-line {
      width: 2px; flex: 1;
      background: var(--color-border);
      margin: 4px 0;
      min-height: 40px;
    }
    
    .step-info { flex: 1; padding: 0.1rem 0 1.5rem; }
    
    .info-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
    .step-name { font-size: 0.9rem; font-weight: 600; text-transform: capitalize; }
    .step-badge {
      font-size: 0.6rem; font-weight: 800; padding: 0.1rem 0.4rem;
      background: var(--color-accent); color: #fff; border-radius: 4px;
      letter-spacing: 0.05em; animation: flash 1.5s infinite;
    }
    
    @keyframes flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    
    .progress-details { margin-top: 0.6rem; }
    .bar-row { display: flex; align-items: center; gap: 0.75rem; }
    .bar { flex: 1; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; }
    .fill { height: 100%; background: var(--color-accent); transition: width 0.3s ease; }
    .percent { font-size: 0.75rem; font-weight: 800; color: var(--color-accent); width: 35px; text-align: right; }
    
    .time-stats {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.4rem;
      font-size: 0.65rem;
      color: var(--color-muted);
      font-weight: 600;
    }
    .time-item { display: flex; gap: 0.25rem; }
    .time-item .label { opacity: 0.7; font-weight: 500; }
    .time-item .value { color: var(--color-text); }
    .time-divider { width: 1px; height: 10px; background: var(--color-border); opacity: 0.3; }
    
    .msg {
      font-size: 0.75rem; color: var(--color-muted); margin: 0.3rem 0 0;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      background: rgba(0, 0, 0, 0.2);
      padding: 0.5rem;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      
      &::-webkit-scrollbar { width: 4px; }
      &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
    }
    
    .spinner-sm {
      width: 12px; height: 12px; border-radius: 50%;
      border: 2px solid transparent; border-top-color: var(--color-accent);
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    
    .global-error, .global-success {
      margin-top: 1rem; padding: 1rem; border-radius: 8px; display: flex; gap: 1rem; align-items: center;
    }
    .global-error { background: var(--color-error-subtle); border: 1px solid rgba(224, 92, 92, 0.2); color: var(--color-error); }
    .global-success { background: rgba(76, 175, 130, 0.1); border: 1px solid rgba(76, 175, 130, 0.2); color: var(--color-success); }
    
    .err-icon, .success-icon {
      width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem; font-weight: 800; border: 2px solid currentColor;
    }
    
    .err-content strong, .success-content strong { display: block; font-size: 0.9rem; margin-bottom: 0.1rem; }
    .err-content p, .success-content p { margin: 0; font-size: 0.8rem; opacity: 0.8; }
    
    .btn-retry {
      margin-left: auto;
      background: var(--color-error);
      color: white;
      border: none;
      padding: 0.5rem 0.8rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
      white-space: nowrap;
      
      &:hover {
        filter: brightness(1.2);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(224, 92, 92, 0.3);
      }
      &:active { transform: translateY(0); }
    }
  `]
})
export class ProcessingProgressComponent {
  readonly event = input<SseEvent | null>(null);
  readonly steps = input<PipelineStep[]>([]);
  @Output() readonly back = new EventEmitter<void>();

  readonly status = computed<ProcessingStatus>(() => {
    const ev = this.event();
    if (!ev) return 'idle';
    if (ev.type === 'pipeline:complete') return 'done';
    if (ev.type === 'pipeline:error') return 'error';
    return 'running';
  });

  getStepStatus(pluginId: string, index: number): StepStatus {
    const ev = this.event();
    const currentStatus = this.status();
    if (!ev || currentStatus === 'idle') return 'pending';
    if (currentStatus === 'done') return 'done';
    
    const activePlugin = ev.data?.['pluginId'];
    if (activePlugin === pluginId) return 'running';
    
    // Heuristic: if we have an event for a plugin later in the chain,
    // then this one must be done.
    const activeIndex = this.steps().findIndex(s => s.pluginId === activePlugin);
    if (activeIndex > index) return 'done';
    
    return 'pending';
  }

  readonly progress = computed(() => {
    const ev = this.event();
    if (!ev) return 0;
    const p = ev.data?.['progress'];
    return typeof p === 'number' ? p : 0;
  });

  readonly message = computed(() => {
    const ev = this.event();
    return (ev?.data?.['message'] as string) ?? (ev?.data?.['error'] as string) ?? '';
  });

  readonly elapsedTime = computed(() => {
    const ev = this.event();
    return (ev?.data?.['elapsedTime'] as number) ?? 0;
  });

  readonly estimatedTotalTime = computed(() => {
    const ev = this.event();
    return (ev?.data?.['estimatedTotalTime'] as number) ?? 0;
  });

  readonly remainingTime = computed(() => {
    const est = this.estimatedTotalTime();
    const elapsed = this.elapsedTime();
    if (est <= 0 || elapsed <= 0) return 0;
    return Math.max(0, est - elapsed);
  });

  formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
