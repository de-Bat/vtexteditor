import { Component, ChangeDetectionStrategy, inject, output, signal } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { FileHashService } from '../../../core/services/file-hash.service';
import { Project } from '../../../core/models/project.model';

interface UploadResult {
  mediaId: string;
  project: Project;
}

@Component({
  selector: 'app-media-uploader',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="drop-zone"
      [class.drag-over]="isDragOver()"
      (dragover)="onDragOver($event)"
      (dragleave)="isDragOver.set(false)"
      (drop)="onDrop($event)"
      (click)="fileInput.click()"
    >
      @if (uploading()) {
        <div class="upload-progress-container" style="text-align: left;">
          <div class="info-header" style="justify-content: center; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.75rem;">
            @if (uploadProgress() === 0) {
              <div class="spinner-sm"></div>
            }
            <span class="step-name" style="font-weight: 600; font-size: 0.9rem;">{{ statusLabel() }}</span>
          </div>
          
          @if (uploadProgress() > 0) {
            <div class="progress-details">
              <div class="bar-row">
                <div class="bar">
                  <div class="fill" [style.width.%]="uploadProgress()"></div>
                </div>
                <span class="percent">{{ uploadProgress() }}%</span>
              </div>
              @if (elapsedTime() > 0) {
                <div class="time-stats">
                  <span class="time-item">
                    <span class="label">Elapsed:</span>
                    <span class="value c-blue">{{ formatTime(elapsedTime()) }}</span>
                  </span>
                  @if (remainingTime() > 0) {
                    <span class="time-divider"></span>
                    <span class="time-item">
                      <span class="label">Remaining:</span>
                      <span class="value c-green">~{{ formatTime(remainingTime()) }}</span>
                    </span>
                  }
                </div>
              }
            </div>
            
            <div class="file-name" style="text-align: center; font-size: 0.8rem; color: var(--color-muted); margin-top: 1rem;">
              {{ fileName() }}
            </div>
          } @else {
            <div class="file-name" style="text-align: center; font-size: 0.8rem; color: var(--color-muted); margin-top: 0.5rem;">
              {{ fileName() }}
            </div>
          }
        </div>
      } @else {
        <div class="drop-hint">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6h.1a5 5 0 011 9.9M9 12l3-3m0 0l3 3m-3-3v12"/>
          </svg>
          <p>Drop a video or audio file here, or <strong>click to browse</strong></p>
          <p class="hint-sub">MP4, WebM, MKV, MP3, WAV, FLAC, OGG</p>
        </div>
      }
      <input #fileInput type="file" accept="video/*,audio/*,.srt" (change)="onFileSelect($event)" hidden />
    </div>
    @if (error()) {
      <p class="upload-error">{{ error() }}</p>
    }
  `,
  styles: [`
    .drop-zone {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      border: 2px dashed var(--color-border);
      border-radius: 12px;
      cursor: pointer;
      transition: border-color .2s, background .2s;
      padding: 2rem;
      text-align: center;
      &:hover, &.drag-over {
        border-color: var(--color-accent);
        background: var(--color-accent-subtle);
      }
    }
    .drop-hint svg { color: var(--color-muted); margin-bottom: 1rem; }
    .drop-hint p { margin: .25rem 0; color: var(--color-text); }
    .hint-sub { font-size: .8rem; color: var(--color-muted); }
    .upload-progress { display: flex; align-items: center; gap: 1rem; color: var(--color-text); }
    .spinner {
      width: 24px; height: 24px; border-radius: 50%;
      border: 3px solid var(--color-border);
      border-top-color: var(--color-accent);
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .upload-progress-container {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
      width: 100%;
      max-width: 400px;
    }
    .upload-error { color: var(--color-error); margin-top: .5rem; font-size: .875rem; }
    
    .spinner-sm {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid transparent; border-top-color: var(--color-accent);
      animation: spin 0.8s linear infinite;
    }
    .progress-details { margin-top: 0.6rem; width: 100%; }
    .bar-row { display: flex; align-items: center; gap: 0.75rem; width: 100%; }
    .bar { flex: 1; height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden; }
    .fill { height: 100%; background: var(--color-accent); transition: width 0.3s ease; }
    .percent { font-size: 0.9rem; font-weight: 800; color: var(--color-accent); width: 45px; text-align: right; }
    
    .time-stats {
      display: flex; align-items: center; justify-content: center;
      gap: 0.75rem; margin-top: 1rem; font-size: 0.85rem;
      color: var(--color-muted); font-weight: 600;
      letter-spacing: 0.02em;
    }
    .time-item { display: flex; gap: 0.25rem; align-items: baseline; }
    .time-item .label { opacity: 0.7; font-weight: 500; font-size: 0.65rem; text-transform: uppercase; }
    .time-item .value { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; }
    .time-divider { width: 1px; height: 10px; background: var(--color-border); opacity: 0.3; }
  `]
})
export class MediaUploaderComponent {
  readonly uploaded = output<UploadResult>();

  readonly isDragOver = signal(false);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly fileName = signal('');
  readonly error = signal('');
  readonly statusLabel = signal('Uploading');
  readonly elapsedTime = signal(0);
  readonly remainingTime = signal(0);

  private readonly api = inject(ApiService);
  private readonly fileHashService = inject(FileHashService);

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver.set(true);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragOver.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.upload(file);
  }

  onFileSelect(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
  }

  private async upload(file: File): Promise<void> {
    this.error.set('');
    this.uploading.set(true);
    this.fileName.set(file.name);
    this.statusLabel.set('Checking');

    // For file progress
    (this as any)._uploadStartTime = Date.now();

    let hash: string | null = null;
    try {
      console.log(`[media-uploader] computing hash for ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
      hash = await this.fileHashService.computeHash(file);
      console.log(`[media-uploader] hash=${hash.slice(0, 12)}… — checking server cache`);
    } catch (err) {
      console.warn('[media-uploader] hash computation failed — uploading without dedup:', err);
    }

    if (hash) {
      try {
        const check = await firstValueFrom(this.fileHashService.checkCache(hash));
        if (check.exists) {
          console.log('[media-uploader] cache HIT — skipping upload for', file.name);
          // Cache hit — create project from cached file without uploading
          this.api.post<UploadResult>('/media/from-cache', { hash, originalName: file.name })
            .subscribe({
              next: (result) => {
                this.uploading.set(false);
                this.uploaded.emit(result);
              },
              error: () => {
                // Cache cleared between check and commit (server restart) — fall back to upload
                this.doUpload(file, hash);
              },
            });
          return;
        }
        console.log('[media-uploader] cache MISS — proceeding with upload');
      } catch (err) {
        console.warn('[media-uploader] cache check failed — uploading anyway:', err);
      }
    }

    this.doUpload(file, hash);
  }

  private doUpload(file: File, hash: string | null): void {
    this.statusLabel.set('Uploading');
    this.uploadProgress.set(0);
    const fd = new FormData();
    fd.append('media', file);
    if (hash) fd.append('hash', hash);

    this.api.uploadFile<UploadResult>('/media', fd).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const percent = Math.round(100 * event.loaded / (event.total ?? event.loaded));
          this.uploadProgress.set(percent);
          
          this.statusLabel.set(`Uploading`);
          if (percent > 0) {
            const elapsed = Math.max(0, Date.now() - (this as any)._uploadStartTime);
            const estimatedTotal = Math.round(elapsed / (percent / 100));
            const remaining = Math.max(0, estimatedTotal - elapsed);
            
            this.elapsedTime.set(elapsed);
            this.remainingTime.set(percent === 100 ? 0 : remaining);
          }
        } else if (event.type === HttpEventType.Response) {
          this.uploading.set(false);
          if (event.body) this.uploaded.emit(event.body);
        }
      },
      error: (err: Error) => {
        this.uploading.set(false);
        this.error.set(err.message);
      },
    });
  }

  formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
