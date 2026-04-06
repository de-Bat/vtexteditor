import { Injectable, OnDestroy, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MediaPlayerService implements OnDestroy {
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly isPlaying = signal(false);
  readonly playbackRate = signal(1);
  readonly volume = signal(1);

  private mediaEl: HTMLMediaElement | null = null;

  private readonly handleLoadedMetadata = () => this.syncFromMedia();
  private readonly handleDurationChange = () => this.syncFromMedia();
  private readonly handleTimeUpdate = () => this.syncFromMedia();
  private readonly handlePlay = () => this.isPlaying.set(true);
  private readonly handlePause = () => this.isPlaying.set(false);
  private readonly handleEnded = () => this.isPlaying.set(false);
  private readonly handleRateChange = () => {
    if (!this.mediaEl) return;
    this.playbackRate.set(this.mediaEl.playbackRate || 1);
  };
  private readonly handleVolumeChange = () => {
    if (!this.mediaEl) return;
    this.volume.set(this.mediaEl.volume ?? 1);
  };

  attachElement(el: HTMLMediaElement): void {
    if (this.mediaEl === el) return;
    this.detachElement();
    this.mediaEl = el;

    el.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    el.addEventListener('durationchange', this.handleDurationChange);
    el.addEventListener('timeupdate', this.handleTimeUpdate);
    el.addEventListener('play', this.handlePlay);
    el.addEventListener('pause', this.handlePause);
    el.addEventListener('ended', this.handleEnded);
    el.addEventListener('ratechange', this.handleRateChange);
    el.addEventListener('volumechange', this.handleVolumeChange);

    this.syncFromMedia();
  }

  detachElement(): void {
    if (!this.mediaEl) return;

    this.mediaEl.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.mediaEl.removeEventListener('durationchange', this.handleDurationChange);
    this.mediaEl.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.mediaEl.removeEventListener('play', this.handlePlay);
    this.mediaEl.removeEventListener('pause', this.handlePause);
    this.mediaEl.removeEventListener('ended', this.handleEnded);
    this.mediaEl.removeEventListener('ratechange', this.handleRateChange);
    this.mediaEl.removeEventListener('volumechange', this.handleVolumeChange);
    this.mediaEl = null;
    this.isPlaying.set(false);
  }

  async play(): Promise<void> {
    if (!this.mediaEl) return;
    await this.mediaEl.play();
  }

  pause(): void {
    if (!this.mediaEl) return;
    this.mediaEl.pause();
  }

  seek(time: number): void {
    if (!this.mediaEl) return;
    const clamped = Math.max(0, Math.min(time, this.duration() || Number.POSITIVE_INFINITY));
    this.mediaEl.currentTime = clamped;
    this.currentTime.set(clamped);
  }

  setRate(rate: number): void {
    if (!this.mediaEl) return;
    const clamped = Math.max(0.5, Math.min(rate, 2));
    this.mediaEl.playbackRate = clamped;
    this.playbackRate.set(clamped);
  }

  setVolume(volume: number): void {
    if (!this.mediaEl) return;
    const clamped = Math.max(0, Math.min(volume, 1));
    this.mediaEl.volume = clamped;
    this.volume.set(clamped);
  }

  ngOnDestroy(): void {
    this.detachElement();
  }

  private syncFromMedia(): void {
    if (!this.mediaEl) return;
    this.currentTime.set(this.mediaEl.currentTime || 0);
    this.duration.set(this.mediaEl.duration || 0);
    this.playbackRate.set(this.mediaEl.playbackRate || 1);
    this.volume.set(this.mediaEl.volume ?? 1);
    this.isPlaying.set(!this.mediaEl.paused && !this.mediaEl.ended);
  }
}