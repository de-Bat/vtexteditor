import { Injectable, OnDestroy, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class EffectPlayerService implements OnDestroy {
  /** 0–1; drives video/audio element opacity via template binding */
  readonly videoOpacity = signal(1);
  /** CSS filter string; drives brightness flash on cross-cut */
  readonly videoFilter = signal('none');

  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Call once in ngAfterViewInit, after the media element is ready.
   * Safe to call multiple times — idempotent when same element.
   */
  attachElement(el: HTMLMediaElement): void {
    if (this.mediaSource) return;
    try {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.mediaSource = this.audioCtx.createMediaElementSource(el);
      this.mediaSource.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    } catch (err) {
      // CORS or browser restriction — effects degrade gracefully (visual only)
      console.warn('[EffectPlayerService] Web Audio init failed, continuing without audio effects:', err);
    }
  }

  /**
   * Must be called from a user-gesture handler (play button click) to satisfy
   * browser autoplay policy. Safe to call when already running.
   */
  resumeAudioContext(): void {
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /** Ramp gain to 0 + start opacity CSS transition to 0. */
  startFadeOut(durationMs: number): void {
    const dur = Math.max(50, durationMs) / 1000;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + dur);
    }
    this.videoOpacity.set(0);
  }

  /** Ramp gain from 0 to 1 + start opacity CSS transition to 1. */
  startFadeIn(durationMs: number): void {
    const dur = Math.max(50, durationMs) / 1000;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(1, now + dur);
    }
    this.videoOpacity.set(1);
  }

  /** For cross-cut: brief brightness spike (80 ms). */
  triggerCrossCutFlash(): void {
    this.videoFilter.set('brightness(1.4)');
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.videoFilter.set('none');
      this.flashTimer = null;
    }, 80);
  }

  /** For cross-cut: audio crossfade (gain 0→1 over durationMs). Seek first, then call this. */
  startAudioCrossfade(durationMs: number): void {
    const dur = Math.max(50, durationMs) / 1000;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(1, now + dur);
    }
  }

  /** Reset all effects immediately (called on pause, seek by user, clip change). */
  resetAll(): void {
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(1, now);
    }
    this.videoOpacity.set(1);
    this.videoFilter.set('none');
    if (this.flashTimer) { clearTimeout(this.flashTimer); this.flashTimer = null; }
  }

  detach(): void {
    this.resetAll();
    this.mediaSource?.disconnect();
    this.gainNode?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.mediaSource = null;
    this.gainNode = null;
    this.audioCtx = null;
  }

  ngOnDestroy(): void {
    this.detach();
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }
}
