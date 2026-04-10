import { Component, ChangeDetectionStrategy, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  imports: [CommonModule],
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
        <div class="upload-progress">
          <div class="spinner"></div>
          <span>{{ statusLabel() }} {{ fileName() }}…</span>
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
    .upload-error { color: var(--color-error); margin-top: .5rem; font-size: .875rem; }
  `]
})
export class MediaUploaderComponent {
  readonly uploaded = output<UploadResult>();

  readonly isDragOver = signal(false);
  readonly uploading = signal(false);
  readonly fileName = signal('');
  readonly error = signal('');
  readonly statusLabel = signal('Uploading');

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

    let hash: string | null = null;
    try {
      hash = await this.fileHashService.computeHash(file);
      const check = await firstValueFrom(this.fileHashService.checkCache(hash));
      if (check.exists) {
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
    } catch {
      // Hash computation or check failed — proceed with normal upload
    }

    this.doUpload(file, hash);
  }

  private doUpload(file: File, hash: string | null): void {
    this.statusLabel.set('Uploading');
    const fd = new FormData();
    fd.append('media', file);
    if (hash) fd.append('hash', hash);

    this.api.uploadFile<UploadResult>('/media', fd).subscribe({
      next: (result) => {
        this.uploading.set(false);
        this.uploaded.emit(result);
      },
      error: (err: Error) => {
        this.uploading.set(false);
        this.error.set(err.message);
      },
    });
  }
}
