// client/src/app/features/studio/txt-media-player/effect-player.service.ts
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Observable, of, timer, from } from 'rxjs';
import { map, tap, switchMap } from 'rxjs/operators';
import { CutRegion } from '../../../core/models/cut-region.model';
import { Clip } from '../../../core/models/clip.model';
import { SmartEffectService, ResolvedEffect } from './smart-effect.service';
import {
  SMART_CUT_AUDIO_FADEOUT_MS,
  SMART_CUT_AUDIO_FADEIN_MS,
  SMART_CUT_OVERLAY_FADE_MS,
  SMART_CUT_SEEK_TIMEOUT_MS,
  SMART_CUT_MAX_USABLE,
  CUT_MICRO_FADE_MS,
} from './smart-cut.constants';

@Injectable({ providedIn: 'root' })
export class EffectPlayerService implements OnDestroy {
  readonly videoOpacity = signal(1);
  readonly videoFilter = signal('none');

  private readonly smartEffect: SmartEffectService;
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private mediaEl: HTMLMediaElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(smartEffectOverride?: SmartEffectService) {
    this.smartEffect = smartEffectOverride ?? inject(SmartEffectService);
  }

  /**
   * Call once in ngAfterViewInit, after the media element is ready.
   * Safe to call multiple times — idempotent when same element.
   */
  attachElement(el: HTMLMediaElement): void {
    this.mediaEl = el;
    if (this.mediaSource) return;
    try {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.mediaSource = this.audioCtx.createMediaElementSource(el);
      this.mediaSource.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    } catch (err) {
      console.warn('[EffectPlayerService] Web Audio init failed, continuing without audio effects:', err);
    }
  }

  attachOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d');
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
    this.clearOverlay();
  }

  detach(): void {
    this.resetAll();
    this.mediaSource?.disconnect();
    this.gainNode?.disconnect();
    this.audioCtx?.close().catch(() => {});
    this.mediaSource = null;
    this.gainNode = null;
    this.audioCtx = null;
    this.mediaEl = null;
  }

  ngOnDestroy(): void {
    this.detach();
    if (this.flashTimer) clearTimeout(this.flashTimer);
  }

  /**
   * Play the cut effect. Returns an Observable<number> that emits the
   * final seek target (seconds) when the effect is complete.
   * Caller (applyJumpCut) seeks to this value.
   */
  playEffect(region: CutRegion, clip?: Clip, regionEnd = 0): Observable<number> {
    if (region.effectType === 'smart' || region.effectType === 'smart-cut') {
      if (!clip) return of(regionEnd);
      return from(this.smartEffect.resolve(clip, region)).pipe(
        switchMap(resolved => {
          region.resolvedEffectType = resolved.effectType as Exclude<typeof region.effectType, 'smart'>;
          return this.playResolvedEffect(resolved, regionEnd);
        })
      );
    }
    const resolved: ResolvedEffect = {
      effectType: region.effectType as Exclude<typeof region.effectType, 'smart' | 'smart-cut'>,
      durationMs: region.effectDuration ?? 300,
    };
    return this.playResolvedEffect(resolved, regionEnd);
  }

  private playResolvedEffect(resolved: ResolvedEffect, regionEnd: number): Observable<number> {
    if (resolved.effectType === 'clear-cut') {
      this.applyMicroFadeIn();
      return of(regionEnd);
    }
    if (resolved.effectType === 'fade-in') {
      this.startFadeOut(resolved.durationMs);
      return timer(resolved.durationMs).pipe(
        tap(() => {
          this.videoOpacity.set(1);
          this.videoFilter.set('none');
          this.applyMicroFadeIn();
        }),
        map(() => regionEnd)
      );
    }
    if (resolved.effectType === 'cross-cut') {
      this.triggerCrossCutFlash();
      this.startAudioCrossfade(resolved.durationMs);
      return timer(resolved.durationMs).pipe(map(() => regionEnd));
    }
    if ((resolved.effectType as string) === 'smart-cut') {
      return this.playSmartCut(regionEnd, resolved.resumeOffsetMs ?? 0, resolved.score ?? 0);
    }
    return of(regionEnd);
  }

  private playSmartCut(regionEnd: number, resumeOffsetMs: number, score = 0): Observable<number> {
    // resumeOffsetMs is in seconds. Clamp so we never seek back inside the cut region.
    const resumeTarget = Math.max(regionEnd, regionEnd + resumeOffsetMs);
    // Scale overlay fade by match quality: perfect (score=0) → 150ms, rough (score=24) → 400ms
    const overlayFadeMs = Math.round(150 + (score / SMART_CUT_MAX_USABLE) * 250);

    return new Observable<number>(observer => {
      // 1. Capture current frame to overlay
      this.captureToOverlay();

      // 2. Ramp audio to 0
      const fadeOutSec = SMART_CUT_AUDIO_FADEOUT_MS / 1000;
      if (this.gainNode && this.audioCtx) {
        const now = this.audioCtx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + fadeOutSec);
      }

      // 3. Seek video to resumeTarget; wait for seeked event or timeout
      let seekSettled = false;
      const seekTimeout = setTimeout(() => {
        if (seekSettled) return;
        seekSettled = true;
        this.afterSeek(resumeTarget, overlayFadeMs, observer);
      }, SMART_CUT_SEEK_TIMEOUT_MS);

      const onSeeked = () => {
        if (seekSettled) return;
        seekSettled = true;
        clearTimeout(seekTimeout);
        this.mediaEl!.removeEventListener('seeked', onSeeked);
        // Wait for browser to actually paint the new frame before fading overlay.
        // requestVideoFrameCallback fires after the frame is composited — eliminates
        // the flash that occurs when seeked fires before GPU presents the frame.
        if (this.mediaEl && 'requestVideoFrameCallback' in this.mediaEl) {
          (this.mediaEl as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): void })
            .requestVideoFrameCallback(() => this.afterSeek(resumeTarget, overlayFadeMs, observer));
        } else {
          this.afterSeek(resumeTarget, overlayFadeMs, observer);
        }
      };

      if (this.mediaEl) {
        this.mediaEl.addEventListener('seeked', onSeeked);
        this.mediaEl.currentTime = resumeTarget;
      } else {
        clearTimeout(seekTimeout);
        this.afterSeek(resumeTarget, overlayFadeMs, observer);
      }
    });
  }

  private afterSeek(resumeTarget: number, overlayFadeMs: number, observer: { next: (v: number) => void; complete: () => void }): void {
    // 4. Ramp audio back to 1 — match fade duration to overlay for rough cuts
    const fadeInMs = Math.max(SMART_CUT_AUDIO_FADEIN_MS, overlayFadeMs);
    const fadeInSec = fadeInMs / 1000;
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(1, now + fadeInSec);
    }

    // 5. Fade overlay out
    this.scheduleOverlayClear(overlayFadeMs);

    // 6. Complete after overlay fades
    setTimeout(() => {
      observer.next(resumeTarget);
      observer.complete();
    }, Math.max(fadeInMs, overlayFadeMs));
  }

  private captureToOverlay(): void {
    if (!this.overlayCtx || !this.overlayCanvas || !this.mediaEl) return;
    const { width, height } = this.overlayCanvas;
    this.overlayCtx.drawImage(this.mediaEl as unknown as CanvasImageSource, 0, 0, width, height);
    if (this.overlayCanvas.style) this.overlayCanvas.style.opacity = '1';
  }

  private scheduleOverlayClear(ms: number): void {
    if (!this.overlayCanvas) return;
    if (this.overlayCanvas.style) {
      this.overlayCanvas.style.transition = `opacity ${ms}ms ease`;
      this.overlayCanvas.style.opacity = '0';
    }
  }

  private clearOverlay(): void {
    if (!this.overlayCanvas) return;
    if (this.overlayCanvas.style) {
      this.overlayCanvas.style.transition = '';
      this.overlayCanvas.style.opacity = '0';
    }
  }

  private applyMicroFadeIn(): void {
    if (!this.gainNode || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(1, now + CUT_MICRO_FADE_MS / 1000);
  }
}
