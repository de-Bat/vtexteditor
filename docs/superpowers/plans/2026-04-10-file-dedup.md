# File Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip the HTTP upload entirely when the server has already seen a file, by computing a SHA-256 hash client-side and checking an in-memory server cache before uploading.

**Architecture:** The client computes a SHA-256 hash via Web Crypto API, calls `GET /api/media/check/:hash`, and on a hit calls `POST /api/media/from-cache` instead of uploading. On a miss, the client uploads normally and sends the hash as a FormData field so the server can register it. The server cache is a module-level `Map<string, string>` (hash → absolute file path).

**Tech Stack:** Express 5, multer, Vitest (server tests), Angular 21 with TestBed + `ng test` (client tests), Web Crypto API (`crypto.subtle.digest`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `server/src/services/file-hash-cache.ts` | In-memory hash → filePath map |
| Create | `server/src/services/file-hash-cache.test.ts` | Vitest unit tests for cache |
| Modify | `server/src/routes/media.routes.ts` | Add GET /check/:hash, POST /from-cache; register hash on upload |
| Create | `client/src/app/core/services/file-hash.service.ts` | computeHash + checkCache |
| Create | `client/src/app/core/services/file-hash.service.spec.ts` | Angular unit tests |
| Modify | `client/src/app/features/onboarding/media-uploader/media-uploader.component.ts` | Wire two-step hash-check flow |

---

## Task 1: Server — file-hash-cache service

**Files:**
- Create: `server/src/services/file-hash-cache.ts`
- Create: `server/src/services/file-hash-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/file-hash-cache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { lookupHash, registerHash, clearCache } from './file-hash-cache';

describe('file-hash-cache', () => {
  beforeEach(() => clearCache());

  it('returns undefined for unknown hash', () => {
    expect(lookupHash('abc123')).toBeUndefined();
  });

  it('returns filePath after registering a hash', () => {
    registerHash('abc123', '/storage/uploads/file.mp4');
    expect(lookupHash('abc123')).toBe('/storage/uploads/file.mp4');
  });

  it('overwrites an existing entry on re-register', () => {
    registerHash('abc123', '/storage/uploads/old.mp4');
    registerHash('abc123', '/storage/uploads/new.mp4');
    expect(lookupHash('abc123')).toBe('/storage/uploads/new.mp4');
  });

  it('isolates entries by hash', () => {
    registerHash('hash-a', '/a.mp4');
    registerHash('hash-b', '/b.mp4');
    expect(lookupHash('hash-a')).toBe('/a.mp4');
    expect(lookupHash('hash-b')).toBe('/b.mp4');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npx vitest run src/services/file-hash-cache.test.ts
```

Expected: FAIL — `Cannot find module './file-hash-cache'`

- [ ] **Step 3: Implement the cache module**

Create `server/src/services/file-hash-cache.ts`:

```ts
const cache = new Map<string, string>();

export function lookupHash(hash: string): string | undefined {
  return cache.get(hash);
}

export function registerHash(hash: string, filePath: string): void {
  cache.set(hash, filePath);
}

/** Only for use in tests — clears all entries. */
export function clearCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npx vitest run src/services/file-hash-cache.test.ts
```

Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add server/src/services/file-hash-cache.ts server/src/services/file-hash-cache.test.ts
git commit -m "feat: file-hash-cache in-memory service"
```

---

## Task 2: Server — check and from-cache routes

**Files:**
- Modify: `server/src/routes/media.routes.ts`

The full updated file is shown below. Changes from the original:
1. Import `lookupHash`, `registerHash` from `file-hash-cache`
2. Add `GET /check/:hash` route (before `GET /:id/info`)
3. Add `POST /from-cache` route (after the existing `POST /`)
4. In the existing `POST /` handler, read `req.body?.hash` and call `registerHash` after saving

- [ ] **Step 1: Write the updated `media.routes.ts`**

Replace the full content of `server/src/routes/media.routes.ts`:

```ts
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getUploadPath, fileExists } from '../utils/file.util';
import { getMediaInfo } from '../utils/ffmpeg.util';
import { projectService } from '../services/project.service';
import { lookupHash, registerHash } from '../services/file-hash-cache';
import fs from 'fs';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.storage.uploads),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (config.allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB max
});

export const mediaRoutes = Router();

/** GET /api/media/check/:hash — check if a file hash is in the cache */
mediaRoutes.get('/check/:hash', (req: Request, res: Response) => {
  const hash = String(req.params['hash']);
  const filePath = lookupHash(hash);
  if (filePath) {
    res.json({ exists: true, filePath });
  } else {
    res.json({ exists: false });
  }
});

/** POST /api/media — upload a media file, create project */
mediaRoutes.post('/', upload.single('media'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const mediaId = path.basename(req.file.filename, path.extname(req.file.filename));
  const filePath = req.file.path;
  const ext = path.extname(req.file.filename);
  const mediaType = ['.mp4', '.webm', '.mkv'].includes(ext) ? 'video' : 'audio';

  // Register hash if client provided one (enables future deduplication)
  const hash = req.body?.hash as string | undefined;
  if (hash) registerHash(hash, filePath);

  let mediaInfo = null;
  try { mediaInfo = await getMediaInfo(filePath); } catch { /* best effort */ }

  const project = projectService.create({
    name: path.basename(req.file.originalname, ext),
    mediaPath: filePath,
    mediaType,
    mediaInfo,
  });

  res.status(201).json({ mediaId, project });
});

/** POST /api/media/from-cache — create project using a previously uploaded file */
mediaRoutes.post('/from-cache', async (req: Request, res: Response) => {
  const { hash, originalName } = req.body as { hash: string; originalName: string };
  if (!hash || !originalName) {
    res.status(400).json({ error: 'hash and originalName are required' });
    return;
  }

  const filePath = lookupHash(hash);
  if (!filePath) {
    res.status(404).json({ error: 'File not in cache' });
    return;
  }

  const ext = path.extname(filePath);
  const mediaType = ['.mp4', '.webm', '.mkv'].includes(ext) ? 'video' : 'audio';
  const mediaId = path.basename(filePath, ext);

  let mediaInfo = null;
  try { mediaInfo = await getMediaInfo(filePath); } catch { /* best effort */ }

  const project = projectService.create({
    name: path.basename(originalName, path.extname(originalName)),
    mediaPath: filePath,
    mediaType,
    mediaInfo,
  });

  res.status(201).json({ mediaId, project });
});

/** GET /api/media/:id/info — get media metadata */
mediaRoutes.get('/:id/info', async (req: Request, res: Response) => {
  const id = String(req.params['id']);
```

> **Note:** After `/:id/info`, keep the rest of the existing file unchanged (the streaming route, etc). Only replace up to and including the new `POST /from-cache` route.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Manual smoke test**

Start the server (`npm run dev` in the server directory). Use curl or a REST client:

```bash
# Should return { exists: false }
curl http://localhost:3000/api/media/check/nonexistent-hash

# Upload a file normally (use any small video/audio file)
curl -F "media=@/path/to/test.mp4" -F "hash=testhash123" http://localhost:3000/api/media

# Should now return { exists: true, filePath: "..." }
curl http://localhost:3000/api/media/check/testhash123

# Should create a new project using cached file
curl -X POST -H "Content-Type: application/json" \
  -d '{"hash":"testhash123","originalName":"test.mp4"}' \
  http://localhost:3000/api/media/from-cache
```

Expected: all responses are valid JSON with correct shapes.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/media.routes.ts
git commit -m "feat: add file hash check and from-cache routes"
```

---

## Task 3: Client — FileHashService

**Files:**
- Create: `client/src/app/core/services/file-hash.service.ts`
- Create: `client/src/app/core/services/file-hash.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `client/src/app/core/services/file-hash.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { FileHashService } from './file-hash.service';

describe('FileHashService', () => {
  let service: FileHashService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FileHashService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('computes SHA-256 hash of a file as a hex string', async () => {
    // 'hello' in UTF-8 bytes
    const bytes = new TextEncoder().encode('hello');
    const file = new File([bytes], 'hello.txt', { type: 'text/plain' });

    const hash = await service.computeHash(file);

    // SHA-256 of 'hello'
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('checkCache returns exists:true with filePath on cache hit', () => {
    let result: { exists: boolean; filePath?: string } | undefined;
    service.checkCache('abc123').subscribe(r => (result = r));

    const req = httpMock.expectOne('/api/media/check/abc123');
    expect(req.request.method).toBe('GET');
    req.flush({ exists: true, filePath: '/storage/uploads/file.mp4' });

    expect(result).toEqual({ exists: true, filePath: '/storage/uploads/file.mp4' });
  });

  it('checkCache returns exists:false on cache miss', () => {
    let result: { exists: boolean } | undefined;
    service.checkCache('deadbeef').subscribe(r => (result = r));

    httpMock.expectOne('/api/media/check/deadbeef').flush({ exists: false });
    expect(result).toEqual({ exists: false });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd client && ng test --include="**/file-hash.service.spec.ts" --watch=false
```

Expected: FAIL — `Cannot find module './file-hash.service'`

- [ ] **Step 3: Implement FileHashService**

Create `client/src/app/core/services/file-hash.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CacheCheckResult {
  exists: boolean;
  filePath?: string;
}

@Injectable({ providedIn: 'root' })
export class FileHashService {
  private readonly api = inject(ApiService);

  async computeHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  checkCache(hash: string): Observable<CacheCheckResult> {
    return this.api.get<CacheCheckResult>(`/media/check/${hash}`);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd client && ng test --include="**/file-hash.service.spec.ts" --watch=false
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add client/src/app/core/services/file-hash.service.ts client/src/app/core/services/file-hash.service.spec.ts
git commit -m "feat: FileHashService — SHA-256 hash + cache check"
```

---

## Task 4: Client — MediaUploaderComponent two-step flow

**Files:**
- Modify: `client/src/app/features/onboarding/media-uploader/media-uploader.component.ts`

The component currently calls `this.api.uploadFile('/media', fd)` directly. We replace the `private upload(file: File)` method with an async two-step flow: hash → check → branch.

- [ ] **Step 1: Update the component**

Replace the full content of `client/src/app/features/onboarding/media-uploader/media-uploader.component.ts`:

```ts
import { Component, output, signal } from '@angular/core';
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
  standalone: true,
  imports: [CommonModule],
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

  constructor(private api: ApiService, private fileHashService: FileHashService) {}

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
```

- [ ] **Step 2: Run existing client tests**

```bash
cd client && ng test --watch=false
```

Expected: all existing tests pass (no regressions)

- [ ] **Step 3: Write component tests**

Create `client/src/app/features/onboarding/media-uploader/media-uploader.component.spec.ts`:

```ts
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MediaUploaderComponent } from './media-uploader.component';
import { FileHashService } from '../../../core/services/file-hash.service';
import { of, throwError } from 'rxjs';

const makeFile = (name = 'video.mp4') =>
  new File(['content'], name, { type: 'video/mp4' });

describe('MediaUploaderComponent', () => {
  let httpMock: HttpTestingController;
  let fakeHashService: jasmine.SpyObj<FileHashService>;

  beforeEach(async () => {
    fakeHashService = jasmine.createSpyObj('FileHashService', ['computeHash', 'checkCache']);
    fakeHashService.computeHash.and.returnValue(Promise.resolve('abc123'));

    await TestBed.configureTestingModule({
      imports: [MediaUploaderComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FileHashService, useValue: fakeHashService },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('calls from-cache endpoint on cache hit', fakeAsync(async () => {
    fakeHashService.checkCache.and.returnValue(
      of({ exists: true, filePath: '/storage/uploads/video.mp4' }),
    );

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    // Trigger upload
    (fixture.componentInstance as any).upload(makeFile());
    await Promise.resolve(); // computeHash
    tick(); // checkCache observable

    const req = httpMock.expectOne('/api/media/from-cache');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ hash: 'abc123', originalName: 'video.mp4' });
    req.flush({ mediaId: 'm1', project: { id: 'p1' } });

    expect(fixture.componentInstance.uploading()).toBeFalse();
  }));

  it('falls back to upload on cache miss', fakeAsync(async () => {
    fakeHashService.checkCache.and.returnValue(of({ exists: false }));

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    (fixture.componentInstance as any).upload(makeFile());
    await Promise.resolve();
    tick();

    const req = httpMock.expectOne('/api/media');
    expect(req.request.method).toBe('POST');
    req.flush({ mediaId: 'm1', project: { id: 'p1' } });

    expect(fixture.componentInstance.uploading()).toBeFalse();
  }));

  it('falls back to upload when hash computation fails', fakeAsync(async () => {
    fakeHashService.computeHash.and.returnValue(Promise.reject(new Error('crypto unavailable')));

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    (fixture.componentInstance as any).upload(makeFile());
    await Promise.resolve();
    tick();

    const req = httpMock.expectOne('/api/media');
    req.flush({ mediaId: 'm1', project: { id: 'p1' } });
    expect(fixture.componentInstance.uploading()).toBeFalse();
  }));

  it('falls back to upload when from-cache returns 404', fakeAsync(async () => {
    fakeHashService.checkCache.and.returnValue(
      of({ exists: true, filePath: '/storage/uploads/video.mp4' }),
    );

    const fixture = TestBed.createComponent(MediaUploaderComponent);
    fixture.detectChanges();

    (fixture.componentInstance as any).upload(makeFile());
    await Promise.resolve();
    tick();

    // from-cache fails (server restart cleared cache)
    const fromCacheReq = httpMock.expectOne('/api/media/from-cache');
    fromCacheReq.flush({ error: 'File not in cache' }, { status: 404, statusText: 'Not Found' });
    tick();

    // Should fall back to normal upload
    const uploadReq = httpMock.expectOne('/api/media');
    uploadReq.flush({ mediaId: 'm1', project: { id: 'p1' } });
    expect(fixture.componentInstance.uploading()).toBeFalse();
  }));
});
```

- [ ] **Step 4: Run all tests including new component tests**

```bash
cd client && ng test --watch=false
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/onboarding/media-uploader/media-uploader.component.ts \
        client/src/app/features/onboarding/media-uploader/media-uploader.component.spec.ts
git commit -m "feat: file deduplication — skip upload on cache hit"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|------------|
| Client computes SHA-256 before upload | Task 3 FileHashService.computeHash |
| `GET /api/media/check/:hash` | Task 2 |
| Cache hit → skip upload, POST from-cache | Task 4 upload() |
| Cache miss → upload normally | Task 4 doUpload() |
| Send hash with upload for registration | Task 4 doUpload() — FormData 'hash' field |
| Server registers hash after saving file | Task 2 — reads req.body.hash |
| `POST /api/media/from-cache` creates project | Task 2 |
| 404 from from-cache falls back to upload | Task 4 error handler |
| In-memory Map, lost on restart | Task 1 file-hash-cache.ts |

All spec requirements are covered. ✅

**Note on spec deviation:** The spec said to send hash as `X-File-Hash` header. The plan uses a FormData field named `hash` instead — this avoids modifying the `ApiService.uploadFile` signature and is simpler. Functionally equivalent.
