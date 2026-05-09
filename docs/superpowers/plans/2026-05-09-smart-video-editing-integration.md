# Smart Video Editing — Express + Angular Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Python vision microservice into the Express backend (proxy, health check, Python spawn, download endpoint) and build the Angular Vision Panel + canvas overlay, surfaced as a collapsible right-side panel in the studio.

**Architecture:** Express proxies `/api/vision/*` to Python `:3001` via `http-proxy-middleware`. Express spawns the Python process on startup. Angular `VisionService` calls the proxy endpoints; `VisionPanelComponent` holds all UI state as signals; `VisionOverlayComponent` renders a `<canvas>` over the video element with YOLO bounding boxes.

**Tech Stack:** Node.js/TypeScript, Express, `http-proxy-middleware`, Angular 20+ (signals, standalone components, OnPush), Angular CDK, Material Symbols Outlined icons.

**Prerequisite:** Plan A (Python vision service) complete and passing all tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `server/src/models/vision.model.ts` | Shared TypeScript vision types |
| Create | `server/src/services/vision.service.ts` | Health check, Python process spawn |
| Create | `server/src/routes/vision.routes.ts` | Proxy + download endpoint |
| Modify | `server/src/main.ts` | Register vision routes, spawn Python |
| Create | `client/src/app/core/models/vision.model.ts` | Client-side vision types |
| Create | `client/src/app/core/services/vision.service.ts` | HTTP calls to /api/vision/* |
| Create | `client/src/app/features/studio/txt-media-player-v2/vision-overlay.component.ts` | Canvas bounding-box overlay |
| Create | `client/src/app/features/studio/vision-panel/vision-panel.component.ts` | Right-side panel, all states |
| Create | `client/src/app/features/studio/vision-panel/vision-panel.component.html` | Panel template |
| Create | `client/src/app/features/studio/vision-panel/vision-panel.component.scss` | Panel styles |
| Modify | `client/src/app/features/studio/studio.component.ts` | Add Vision Panel |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` | Add overlay + toggle button |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss` | Canvas positioning styles |

---

## Task 1: TypeScript vision models

**Files:**
- Create: `server/src/models/vision.model.ts`
- Create: `client/src/app/core/models/vision.model.ts`

- [ ] **Step 1: Create server-side model**

```typescript
// server/src/models/vision.model.ts

export interface DetectedObject {
  id: string;
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, w, h] normalized 0-1
  maskEnabled: boolean;
  effect: 'blur' | 'inpaint' | 'fill';
  fillColor?: string;
  trackingId?: string;
}

export interface VisionDetectRequest {
  mediaPath: string;
  frameTime: number;
}

export interface VisionTrackRequest {
  mediaPath: string;
  frameTime: number;
  objects: Array<{ id: string; bbox: [number, number, number, number] }>;
  maskOutputDir: string;
}

export interface VisionPreviewRequest {
  mediaPath: string;
  frameTime: number;
  maskOutputDir: string;
  objects: Array<{ id: string; effect: string; fillColor: string | null }>;
}

export interface VisionExportRequest {
  mediaPath: string;
  outputPath: string;
  maskOutputDir: string;
  objects: Array<{ id: string; effect: string; fillColor: string | null }>;
}
```

- [ ] **Step 2: Create client-side model**

```typescript
// client/src/app/core/models/vision.model.ts

export interface DetectedObject {
  id: string;
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, w, h] normalized 0–1
  maskEnabled: boolean;
  effect: 'blur' | 'inpaint' | 'fill';
  fillColor: string;
}

export interface VisionSession {
  projectId: string;
  clipId: string;
  frameTime: number;
  detectedObjects: DetectedObject[];
  trackingComplete: boolean;
  maskSessionId: string | null; // used to build maskOutputDir on server
  previewFrameUrl: string | null; // base64 data URL
}

export type VisionPanelState =
  | 'offline'
  | 'idle'
  | 'detecting'
  | 'detected'
  | 'tracking'
  | 'preview'
  | 'exporting'
  | 'export-done';

export interface TrackSseEvent {
  type: 'progress' | 'complete' | 'error';
  percent?: number;
  phase?: string;
  maskOutputDir?: string;
  message?: string;
}

export interface ExportSseEvent {
  type: 'progress' | 'complete' | 'error';
  percent?: number;
  outputPath?: string;
  message?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/models/vision.model.ts client/src/app/core/models/vision.model.ts
git commit -m "feat(vision): add TypeScript vision models (server + client)"
```

---

## Task 2: Express VisionService + Python spawn

**Files:**
- Create: `server/src/services/vision.service.ts`

- [ ] **Step 1: Install http-proxy-middleware**

```bash
cd server && npm install http-proxy-middleware
```

Verify `package.json` shows `"http-proxy-middleware"` in dependencies.

- [ ] **Step 2: Create VisionService**

```typescript
// server/src/services/vision.service.ts
import { ChildProcess, spawn } from 'child_process';
import http from 'http';
import path from 'path';

const VISION_PORT = 3001;
const VISION_URL = `http://localhost:${VISION_PORT}`;

let pythonProcess: ChildProcess | null = null;

export const VisionService = {
  spawnPythonService(): void {
    const storageRoot = path.resolve(process.cwd(), '..', 'storage');

    const proc = spawn(
      'uvicorn',
      ['main:app', '--port', String(VISION_PORT), '--host', '127.0.0.1'],
      {
        cwd: process.cwd().replace(/[\\/]server$/, '') + '/vision-service',
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { ...process.env, STORAGE_ROOT: storageRoot },
      }
    );

    proc.stdout?.on('data', (d) => process.stdout.write(`[vision] ${d}`));
    proc.stderr?.on('data', (d) => process.stderr.write(`[vision] ${d}`));
    proc.on('exit', (code) => console.warn(`[vision] Python process exited with code ${code}`));

    pythonProcess = proc;
    console.log(`[vision] Python service spawning on port ${VISION_PORT}`);
  },

  stopPythonService(): void {
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
    }
  },

  async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`${VISION_URL}/health`, { timeout: 3000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  },

  getBaseUrl(): string {
    return VISION_URL;
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add server/src/services/vision.service.ts server/package.json server/package-lock.json
git commit -m "feat(vision): add VisionService — Python process spawn + health check"
```

---

## Task 3: Express vision routes (proxy + download)

**Files:**
- Create: `server/src/routes/vision.routes.ts`

- [ ] **Step 1: Create vision routes**

```typescript
// server/src/routes/vision.routes.ts
import { Router, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import fs from 'fs';
import { VisionService } from '../services/vision.service.js';

const router = Router();

const STORAGE_ROOT = path.resolve(process.cwd(), '..', 'storage');

// Download endpoint — must be before proxy catch-all
router.get('/download/:projectId/:exportId', (req: Request, res: Response) => {
  const { projectId, exportId } = req.params;
  const filePath = path.join(STORAGE_ROOT, 'projects', projectId, 'exports', `${exportId}-masked.mp4`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Export not found' });
    return;
  }
  res.download(filePath, `${exportId}-masked.mp4`);
});

// Proxy everything else to Python (detect, track, preview, export-masked, health)
// Python resolves all paths internally via STORAGE_ROOT env var set on spawn
router.use(
  '/',
  createProxyMiddleware({
    target: VisionService.getBaseUrl(),
    changeOrigin: true,
    on: {
      error: (_err, _req, res) => {
        (res as Response).status(502).json({ error: 'Vision service unavailable' });
      },
    },
  })
);

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/vision.routes.ts
git commit -m "feat(vision): add Express vision proxy routes and download endpoint"
```

---

## Task 4: Wire vision into main.ts

**Files:**
- Modify: `server/src/main.ts`

- [ ] **Step 1: Read current main.ts**

Open `server/src/main.ts` and locate:
1. Where routes are registered (look for `app.use('/api/...')` calls)
2. The server startup block (where `app.listen` is called)

- [ ] **Step 2: Add vision imports and wiring**

Add import at top of main.ts (after existing imports):
```typescript
import visionRoutes from './routes/vision.routes.js';
import { VisionService } from './services/vision.service.js';
```

Add route registration alongside other routes:
```typescript
app.use('/api/vision', visionRoutes);
```

Add Python spawn before `app.listen`:
```typescript
VisionService.spawnPythonService();

process.on('exit', () => VisionService.stopPythonService());
process.on('SIGINT', () => { VisionService.stopPythonService(); process.exit(0); });
process.on('SIGTERM', () => { VisionService.stopPythonService(); process.exit(0); });
```

- [ ] **Step 3: Start the Express server and verify**

```bash
cd server && npm run dev
```

Expected log output includes:
```
[vision] Python service spawning on port 3001
[vision] Application startup complete.
```

Then:
```bash
curl http://localhost:3000/api/vision/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add server/src/main.ts
git commit -m "feat(vision): wire vision routes and Python spawn into Express main"
```

---

## Task 5: Angular VisionService

**Files:**
- Create: `client/src/app/core/services/vision.service.ts`

- [ ] **Step 1: Create VisionService**

```typescript
// client/src/app/core/services/vision.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  DetectedObject,
  TrackSseEvent,
  ExportSseEvent,
} from '../models/vision.model';

@Injectable({ providedIn: 'root' })
export class VisionService {
  private http = inject(HttpClient);

  async checkHealth(): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ status: string }>('/api/vision/health')
      );
      return res.status === 'ok';
    } catch {
      return false;
    }
  }

  async detect(mediaPath: string, frameTime: number): Promise<DetectedObject[]> {
    const raw = await firstValueFrom(
      this.http.post<Array<{ id: string; label: string; confidence: number; bbox: [number, number, number, number] }>>(
        '/api/vision/detect',
        { mediaPath, frameTime }
      )
    );
    return raw.map((obj) => ({
      ...obj,
      maskEnabled: true,
      effect: 'blur' as const,
      fillColor: '#000000',
    }));
  }

  /** Calls /api/vision/track and yields SSE progress events. */
  async *track(
    mediaPath: string,
    frameTime: number,
    objects: Array<{ id: string; bbox: [number, number, number, number] }>,
    maskSessionId: string,
    projectId: string
  ): AsyncGenerator<TrackSseEvent> {
    const response = await fetch('/api/vision/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaPath, frameTime, objects, projectId, maskSessionId }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Track request failed: ${response.status}`);
    }

    yield* this._readSseStream<TrackSseEvent>(response.body);
  }

  async preview(
    mediaPath: string,
    frameTime: number,
    maskSessionId: string,
    projectId: string,
    objects: DetectedObject[]
  ): Promise<string> {
    const res = await firstValueFrom(
      this.http.post<{ previewPng: string }>('/api/vision/preview', {
        mediaPath,
        frameTime,
        projectId,
        maskSessionId,
        objects: objects.map((o) => ({
          id: o.id,
          effect: o.effect,
          fillColor: o.effect === 'fill' ? o.fillColor : null,
        })),
      })
    );
    return `data:image/png;base64,${res.previewPng}`;
  }

  /** Calls /api/vision/export-masked and yields SSE progress events. */
  async *exportMasked(
    mediaPath: string,
    maskSessionId: string,
    projectId: string,
    exportId: string,
    objects: DetectedObject[]
  ): AsyncGenerator<ExportSseEvent> {
    const response = await fetch('/api/vision/export-masked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaPath,
        projectId,
        exportId,
        maskSessionId,
        objects: objects
          .filter((o) => o.maskEnabled)
          .map((o) => ({
            id: o.id,
            effect: o.effect,
            fillColor: o.effect === 'fill' ? o.fillColor : null,
          })),
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Export request failed: ${response.status}`);
    }

    yield* this._readSseStream<ExportSseEvent>(response.body);
  }

  getDownloadUrl(projectId: string, exportId: string): string {
    return `/api/vision/download/${projectId}/${exportId}`;
  }

  private async *_readSseStream<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              yield JSON.parse(line.slice(6)) as T;
            } catch {
              // malformed SSE line — skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors in `core/services/vision.service.ts`

- [ ] **Step 3: Commit**

```bash
git add client/src/app/core/services/vision.service.ts
git commit -m "feat(vision): add Angular VisionService with detect/track/preview/export"
```

---

## Task 6: VisionOverlayComponent

**Files:**
- Create: `client/src/app/features/studio/txt-media-player-v2/vision-overlay.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

- [ ] **Step 1: Create VisionOverlayComponent**

```typescript
// client/src/app/features/studio/txt-media-player-v2/vision-overlay.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  input,
  effect,
  ElementRef,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { DetectedObject } from '../../../core/models/vision.model';

const EFFECT_COLORS: Record<string, string> = {
  blur: '#6366f1',
  inpaint: '#a78bfa',
  fill: '#f59e0b',
};

@Component({
  selector: 'app-vision-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas class="vision-canvas"></canvas>`,
  styles: [`
    .vision-canvas {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
    }
  `],
})
export class VisionOverlayComponent implements OnDestroy {
  objects = input<DetectedObject[]>([]);
  videoWidth = input<number>(0);
  videoHeight = input<number>(0);

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const objs = this.objects();
      const w = this.videoWidth();
      const h = this.videoHeight();
      if (w > 0 && h > 0) {
        this.draw(objs);
      }
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private draw(objects: DetectedObject[]): void {
    const canvasEl = this.canvas().nativeElement;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width;
    canvasEl.height = rect.height;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    for (const obj of objects) {
      const color = obj.maskEnabled
        ? (EFFECT_COLORS[obj.effect] ?? '#6366f1')
        : '#444444';

      const [nx, ny, nw, nh] = obj.bbox;
      const px = nx * canvasEl.width;
      const py = ny * canvasEl.height;
      const pw = nw * canvasEl.width;
      const ph = nh * canvasEl.height;

      ctx.strokeStyle = color;
      ctx.lineWidth = obj.maskEnabled ? 2 : 1;
      ctx.setLineDash(obj.maskEnabled ? [] : [4, 4]);
      ctx.strokeRect(px, py, pw, ph);

      // Label
      ctx.fillStyle = color;
      ctx.font = '11px Inter, sans-serif';
      const label = `${obj.label} ${Math.round(obj.confidence * 100)}%`;
      const textWidth = ctx.measureText(label).width;
      ctx.fillRect(px, py - 16, textWidth + 8, 16);
      ctx.fillStyle = obj.maskEnabled ? '#ffffff' : '#aaaaaa';
      ctx.fillText(label, px + 4, py - 3);
    }
  }
}
```

- [ ] **Step 2: Add canvas positioning to player scss**

Open `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss` and add at the end:

```scss
.video-wrapper {
  position: relative;

  app-vision-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/vision-overlay.component.ts
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss
git commit -m "feat(vision): add VisionOverlayComponent for bounding-box canvas rendering"
```

---

## Task 7: VisionPanelComponent

**Files:**
- Create: `client/src/app/features/studio/vision-panel/vision-panel.component.ts`
- Create: `client/src/app/features/studio/vision-panel/vision-panel.component.html`
- Create: `client/src/app/features/studio/vision-panel/vision-panel.component.scss`

- [ ] **Step 1: Create component class**

```typescript
// client/src/app/features/studio/vision-panel/vision-panel.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VisionService } from '../../../core/services/vision.service';
import {
  DetectedObject,
  VisionPanelState,
  VisionSession,
} from '../../../core/models/vision.model';
import { NotificationService } from '../../../core/services/notification.service';
import { v4 as uuidv4 } from 'uuid';

@Component({
  selector: 'app-vision-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vision-panel.component.html',
  styleUrl: './vision-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisionPanelComponent implements OnInit {
  projectId = input.required<string>();
  clipId = input.required<string>();
  mediaPath = input.required<string>();
  currentTime = input<number>(0);

  objectsChange = output<DetectedObject[]>();

  private visionService = inject(VisionService);
  private notifications = inject(NotificationService);

  readonly panelState = signal<VisionPanelState>('idle');
  readonly objects = signal<DetectedObject[]>([]);
  readonly trackProgress = signal(0);
  readonly exportProgress = signal(0);
  readonly previewUrl = signal<string | null>(null);
  readonly exportId = signal<string | null>(null);
  readonly maskSessionId = signal<string | null>(null);

  readonly enabledObjects = computed(() => this.objects().filter((o) => o.maskEnabled));
  readonly downloadUrl = computed(() => {
    const eid = this.exportId();
    return eid ? this.visionService.getDownloadUrl(this.projectId(), eid) : null;
  });

  async ngOnInit(): Promise<void> {
    const alive = await this.visionService.checkHealth();
    if (!alive) {
      this.panelState.set('offline');
    }
  }

  async detect(): Promise<void> {
    this.panelState.set('detecting');
    try {
      const detected = await this.visionService.detect(
        this.mediaPath(),
        this.currentTime()
      );
      this.objects.set(detected);
      this.objectsChange.emit(detected);
      this.panelState.set(detected.length > 0 ? 'detected' : 'idle');
      if (detected.length === 0) {
        this.notifications.add({ message: 'No objects detected — try a different frame', level: 'info' });
      }
    } catch (err) {
      this.panelState.set('idle');
      this.notifications.add({ message: `Detection failed: ${err}`, level: 'error' });
    }
  }

  toggleObject(objId: string): void {
    this.objects.update((objs) =>
      objs.map((o) => (o.id === objId ? { ...o, maskEnabled: !o.maskEnabled } : o))
    );
    this.objectsChange.emit(this.objects());
  }

  setEffect(objId: string, effect: 'blur' | 'inpaint' | 'fill'): void {
    this.objects.update((objs) =>
      objs.map((o) => (o.id === objId ? { ...o, effect } : o))
    );
  }

  setFillColor(objId: string, color: string): void {
    this.objects.update((objs) =>
      objs.map((o) => (o.id === objId ? { ...o, fillColor: color } : o))
    );
  }

  async applyMask(): Promise<void> {
    const sessionId = uuidv4();
    this.maskSessionId.set(sessionId);
    this.panelState.set('tracking');
    this.trackProgress.set(0);

    const enabledObjs = this.enabledObjects();
    const trackObjects = enabledObjs.map((o) => ({ id: o.id, bbox: o.bbox }));

    try {
      for await (const event of this.visionService.track(
        this.mediaPath(),
        this.currentTime(),
        trackObjects,
        sessionId,
        this.projectId()
      )) {
        if (event.type === 'progress') {
          this.trackProgress.set(event.percent ?? 0);
        } else if (event.type === 'complete') {
          await this.loadPreview();
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      this.panelState.set('detected');
      this.notifications.add({ message: `Tracking failed: ${err}`, level: 'error' });
    }
  }

  async loadPreview(): Promise<void> {
    const sid = this.maskSessionId();
    if (!sid) return;
    try {
      const url = await this.visionService.preview(
        this.mediaPath(),
        this.currentTime(),
        sid,
        this.projectId(),
        this.enabledObjects()
      );
      this.previewUrl.set(url);
      this.panelState.set('preview');
    } catch (err) {
      this.notifications.add({ message: `Preview failed: ${err}`, level: 'error' });
    }
  }

  async exportWithMasks(): Promise<void> {
    const sid = this.maskSessionId();
    if (!sid) return;

    const eid = uuidv4();
    this.exportId.set(eid);
    this.panelState.set('exporting');
    this.exportProgress.set(0);

    try {
      for await (const event of this.visionService.exportMasked(
        this.mediaPath(),
        sid,
        this.projectId(),
        eid,
        this.enabledObjects()
      )) {
        if (event.type === 'progress') {
          this.exportProgress.set(event.percent ?? 0);
        } else if (event.type === 'complete') {
          this.panelState.set('export-done');
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      }
    } catch (err) {
      this.panelState.set('preview');
      this.notifications.add({ message: `Export failed: ${err}`, level: 'error' });
    }
  }
}
```

- [ ] **Step 2: Create template**

```html
<!-- client/src/app/features/studio/vision-panel/vision-panel.component.html -->
<div class="vision-panel">
  <div class="panel-header">
    <span class="material-symbols-outlined">visibility</span>
    <span class="panel-title">Vision</span>
  </div>

  <!-- OFFLINE -->
  @if (panelState() === 'offline') {
    <div class="state-message offline">
      <span class="material-symbols-outlined">warning</span>
      <p>Vision service offline</p>
      <small>Start: <code>cd vision-service && uvicorn main:app --port 3001</code></small>
    </div>
  }

  <!-- IDLE / DETECTING -->
  @if (panelState() === 'idle' || panelState() === 'detecting') {
    <div class="panel-body">
      <button
        class="btn-primary"
        [disabled]="panelState() === 'detecting'"
        (click)="detect()"
      >
        @if (panelState() === 'detecting') {
          <span class="material-symbols-outlined spinning">progress_activity</span>
          Detecting…
        } @else {
          <span class="material-symbols-outlined">manage_search</span>
          Detect Objects
        }
      </button>
    </div>
  }

  <!-- DETECTED / TRACKING / PREVIEW / EXPORTING / EXPORT-DONE -->
  @if (['detected','tracking','preview','exporting','export-done'].includes(panelState())) {
    <div class="panel-body">

      <!-- Object list -->
      <div class="object-list">
        @for (obj of objects(); track obj.id) {
          <div class="object-row" [class.disabled]="!obj.maskEnabled">
            <div class="object-header">
              <input
                type="checkbox"
                [checked]="obj.maskEnabled"
                (change)="toggleObject(obj.id)"
              />
              <span class="obj-label">{{ obj.label }}</span>
              <span class="obj-conf">{{ (obj.confidence * 100).toFixed(0) }}%</span>
            </div>
            @if (obj.maskEnabled) {
              <div class="effect-row">
                @for (eff of ['blur','inpaint','fill']; track eff) {
                  <button
                    class="effect-pill"
                    [class.active]="obj.effect === eff"
                    (click)="setEffect(obj.id, $any(eff))"
                  >{{ eff }}</button>
                }
                @if (obj.effect === 'fill') {
                  <input
                    type="color"
                    [value]="obj.fillColor"
                    (input)="setFillColor(obj.id, $any($event.target).value)"
                    class="color-picker"
                  />
                }
              </div>
            }
          </div>
        }
      </div>

      <!-- Re-detect -->
      <button class="btn-secondary" (click)="detect()" [disabled]="panelState() === 'tracking' || panelState() === 'exporting'">
        ↺ Re-detect
      </button>

      <!-- TRACKING progress -->
      @if (panelState() === 'tracking') {
        <div class="progress-block">
          <div class="progress-label">
            <span>Tracking…</span>
            <span>{{ trackProgress() }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" [style.width.%]="trackProgress()"></div>
          </div>
        </div>
      }

      <!-- Apply Mask button -->
      @if (panelState() === 'detected') {
        <button class="btn-primary" [disabled]="enabledObjects().length === 0" (click)="applyMask()">
          Apply Mask →
        </button>
      }

      <!-- Preview frame -->
      @if (panelState() === 'preview' || panelState() === 'exporting' || panelState() === 'export-done') {
        @if (previewUrl()) {
          <div class="preview-block">
            <img [src]="previewUrl()!" alt="Masked preview frame" class="preview-img" />
            @if (panelState() === 'preview') {
              <button class="btn-ghost" (click)="loadPreview()">↺ Re-preview</button>
            }
          </div>
        }
      }

      <!-- EXPORTING progress -->
      @if (panelState() === 'exporting') {
        <div class="progress-block">
          <div class="progress-label">
            <span>Exporting…</span>
            <span>{{ exportProgress() }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" [style.width.%]="exportProgress()"></div>
          </div>
        </div>
      }

      <!-- Export button -->
      @if (panelState() === 'preview') {
        <button class="btn-primary" (click)="exportWithMasks()">
          Export with Masks →
        </button>
      }

      <!-- Export done: download link -->
      @if (panelState() === 'export-done' && downloadUrl()) {
        <a [href]="downloadUrl()!" class="btn-download" download>
          <span class="material-symbols-outlined">download</span>
          Download Masked Video
        </a>
      }

    </div>
  }
</div>
```

- [ ] **Step 3: Create styles**

```scss
// client/src/app/features/studio/vision-panel/vision-panel.component.scss
.vision-panel {
  width: 240px;
  background: #13131f;
  border-left: 1px solid #2a2a4a;
  display: flex;
  flex-direction: column;
  height: 100%;
  font-size: 13px;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: #1a1a2e;
  border-bottom: 1px solid #2a2a4a;
  color: #a78bfa;
  font-weight: 600;

  .material-symbols-outlined { font-size: 18px; }
}

.panel-title { flex: 1; }

.panel-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  flex: 1;
}

.state-message {
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  color: #888;

  &.offline { color: #f59e0b; }
  .material-symbols-outlined { font-size: 28px; }
  code { font-size: 10px; background: #1a1a2e; padding: 2px 6px; border-radius: 3px; }
}

.object-list { display: flex; flex-direction: column; gap: 6px; }

.object-row {
  background: #1e1e3e;
  border: 1px solid #6366f1;
  border-radius: 6px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;

  &.disabled {
    background: #161616;
    border-color: #333;
    opacity: 0.6;
  }
}

.object-header {
  display: flex;
  align-items: center;
  gap: 6px;

  .obj-label { flex: 1; color: #e2e8f0; font-weight: 500; }
  .obj-conf { color: #888; font-size: 11px; }
}

.effect-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.effect-pill {
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid #333;
  background: #1a1a2e;
  color: #666;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;

  &.active {
    background: #6366f1;
    border-color: #6366f1;
    color: #fff;
  }
}

.color-picker {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #aaa;
}

.progress-bar {
  background: #1a1a2e;
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #6366f1;
  border-radius: 4px;
  transition: width 0.3s;
}

.preview-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-img {
  width: 100%;
  border-radius: 4px;
  border: 1px solid #2a2a4a;
}

.btn-primary {
  width: 100%;
  padding: 8px;
  background: #6366f1;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;

  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:hover:not(:disabled) { background: #4f46e5; }
}

.btn-secondary {
  width: 100%;
  padding: 6px;
  background: transparent;
  color: #a78bfa;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;

  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.btn-ghost {
  background: none;
  border: none;
  color: #6366f1;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
}

.btn-download {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  background: #10b981;
  color: #fff;
  border-radius: 6px;
  text-decoration: none;
  font-size: 13px;

  .material-symbols-outlined { font-size: 16px; }
  &:hover { background: #059669; }
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/vision-panel/
git commit -m "feat(vision): add VisionPanelComponent with all panel states"
```

---

## Task 8: Studio + V2 player integration

**Files:**
- Modify: `client/src/app/features/studio/studio.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

- [ ] **Step 1: Read studio.component.ts**

Open `client/src/app/features/studio/studio.component.ts`. Find:
1. The `imports` array in the `@Component` decorator
2. Where the right-side panels are toggled (look for `showNotifications` or similar boolean signals)
3. The template file or inline template where panels are rendered

- [ ] **Step 2: Add Vision Panel to studio component**

In `studio.component.ts`, add to imports array:
```typescript
import { VisionPanelComponent } from './vision-panel/vision-panel.component';
```

Add to `@Component` `imports`: `VisionPanelComponent`

Add signal alongside other panel toggles:
```typescript
readonly showVisionPanel = signal(false);
```

- [ ] **Step 3: Add Vision Panel to studio template**

In the studio template, alongside other right-side panels, add:

```html
@if (showVisionPanel()) {
  <app-vision-panel
    [projectId]="project()!.id"
    [clipId]="activeClipId()"
    [mediaPath]="project()!.mediaPath"
    [currentTime]="mediaPlayer.currentTime()"
    (objectsChange)="onVisionObjectsChange($event)"
  />
}
```

- [ ] **Step 4: Add vision objects signal to studio component**

```typescript
readonly visionObjects = signal<DetectedObject[]>([]);

onVisionObjectsChange(objects: DetectedObject[]): void {
  this.visionObjects.set(objects);
}
```

Add import: `import { DetectedObject } from '../../core/models/vision.model';`

- [ ] **Step 5: Read txt-media-player-v2.component.ts**

Open `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`. Find:
1. The `imports` array
2. Where the `<video>` element wrapper is in the template
3. Any existing toolbar button group (for adding the Vision toggle button)

- [ ] **Step 6: Add VisionOverlay to V2 player**

In `txt-media-player-v2.component.ts`, add to imports:
```typescript
import { VisionOverlayComponent } from './vision-overlay.component';
```

Add `VisionOverlayComponent` to `@Component` imports array.

Add input for vision objects:
```typescript
visionObjects = input<DetectedObject[]>([]);
```

Add import: `import { DetectedObject } from '../../../core/models/vision.model';`

- [ ] **Step 7: Add overlay to player template**

In the player template, wrap the `<video>` element in a `div.video-wrapper` (if not already wrapped) and add the overlay as a sibling:

```html
<div class="video-wrapper">
  <video #videoEl ...></video>
  <app-vision-overlay
    [objects]="visionObjects()"
    [videoWidth]="mediaPlayer.duration() > 0 ? videoEl.videoWidth : 0"
    [videoHeight]="mediaPlayer.duration() > 0 ? videoEl.videoHeight : 0"
  />
</div>
```

- [ ] **Step 8: Wire visionObjects from studio to player**

In the studio template where `<app-txt-media-player-v2>` is used, add:
```html
<app-txt-media-player-v2
  ...existing bindings...
  [visionObjects]="visionObjects()"
/>
```

- [ ] **Step 9: Add Vision toggle button to studio toolbar**

In the studio toolbar (find where other panel toggle buttons are), add:

```html
<button
  class="toolbar-btn"
  [class.active]="showVisionPanel()"
  (click)="showVisionPanel.update(v => !v)"
  title="Vision panel"
>
  <span class="material-symbols-outlined">
    {{ showVisionPanel() ? 'visibility' : 'visibility_off' }}
  </span>
</button>
```

- [ ] **Step 10: Verify full build compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 11: Start dev server and smoke-test**

```bash
# Terminal 1 — Express + Python spawn
cd server && npm run dev

# Terminal 2 — Angular dev server
cd client && npm start
```

Open http://localhost:4200. Open a project with video. Click the visibility icon in the toolbar → Vision Panel appears. Click "Detect Objects" → should call `/api/vision/detect` (will fail gracefully if Python not running).

- [ ] **Step 12: Commit**

```bash
git add client/src/app/features/studio/studio.component.ts
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss
git commit -m "feat(vision): integrate Vision Panel and overlay into studio layout"
```
