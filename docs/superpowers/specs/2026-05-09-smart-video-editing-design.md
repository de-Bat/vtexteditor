# Smart Video Editing — Design Spec

**Date:** 2026-05-09
**Status:** Draft

## Overview

Smart Video Editing adds object-aware visual editing directly on the video: YOLO-powered object detection, SAM2-based mask tracking across frames, and per-object removal effects (blur, inpaint, fill). A collapsible Vision Panel in the studio provides the UI. Processing runs in a local Python FastAPI microservice.

---

## 1. Architecture

```
Angular client
    │
    ▼
Express (Node.js)          ←── proxies /api/vision/* ──→   Python FastAPI :3001
    │                                                            │
    ├── vision.routes.ts                                    ├── /detect   (YOLOv8)
    ├── vision.service.ts  (proxy + health check)           ├── /track    (SAM2)
    └── SSE: vision:* events                                ├── /preview  (cv2)
                                                            └── /export-masked (cv2 + ffmpeg)
```

Python service spawned by `server/src/main.ts` at startup via `child_process.spawn`. Degrades gracefully if Python is unavailable — Vision Panel shows "Vision service offline."

---

## 2. Python Microservice

### 2.1 Directory structure

```
vision-service/
├── main.py                  # FastAPI app, port 3001
├── routers/
│   ├── detect.py            # POST /detect
│   ├── track.py             # POST /track
│   ├── preview.py           # POST /preview
│   └── export.py            # POST /export-masked
├── models/
│   ├── yolo_model.py        # YOLOv8 singleton (lazy-loaded)
│   └── sam2_model.py        # SAM2 predictor singleton (lazy-loaded)
└── requirements.txt         # ultralytics, sam2, fastapi, uvicorn, opencv-python
```

### 2.2 Endpoints

| Method | Path | Input | Output |
|--------|------|-------|--------|
| GET | `/health` | — | `{ status: "ok" }` |
| POST | `/detect` | `{ mediaPath, frameTime }` | `DetectedObject[]` |
| POST | `/track` | `{ mediaPath, frameTime, objects }` | `{ maskDataPath }` + SSE progress |
| POST | `/preview` | `{ mediaPath, frameTime, objects, maskDataPath }` | `{ previewPng: base64 }` |
| POST | `/export-masked` | `{ projectId, clipId, objects, maskDataPath }` | SSE progress → output file path |

### 2.3 Processing flows

**Detect:**
1. Extract frame at `frameTime` via OpenCV
2. Run YOLOv8 inference → return bounding boxes, labels, confidence scores

**Track:**
1. Load SAM2 predictor with video context
2. Set prompts from selected object bboxes at keyframe
3. Propagate masks forward and backward until object leaves frame
4. Write binary mask data to `storage/projects/{id}/vision/{sessionId}/masks/`
5. Stream SSE `vision:tracking { progress, framesProcessed, totalFrames }`

**Preview:**
1. Extract single frame
2. Apply effects per object using tracked mask:
   - `blur`: `cv2.GaussianBlur` over mask region (kernel 51×51)
   - `fill`: `cv2` solid rectangle fill with specified hex color
   - `inpaint`: LaMa inpainting if available, fallback to `cv2.inpaint`
3. Return frame as base64 PNG

**Export:**
1. Process video frame-by-frame applying effects using tracked masks
2. Write output to `storage/projects/{id}/exports/{exportId}-masked.mp4`
3. Stream SSE `vision:export-progress { percent }`

---

## 3. Express Layer

### 3.1 New files

- `server/src/routes/vision.routes.ts` — HTTP proxy to Python `:3001`, wires SSE events
- `server/src/services/vision.service.ts` — health check on startup, proxy helpers

### 3.2 SSE events added to `SseService`

```typescript
'vision:detecting'
'vision:tracking'          // { progress, framesProcessed, totalFrames }
'vision:preview-ready'
'vision:export-progress'   // { percent }
'vision:complete'
'vision:error'             // { message }
```

---

## 4. Data Models

### 4.1 `server/src/models/vision.model.ts` (new)

```typescript
interface DetectedObject {
  id: string;
  label: string;              // "person", "car", etc.
  confidence: number;         // 0–1
  bbox: [x: number, y: number, w: number, h: number];  // normalized 0–1
  maskEnabled: boolean;       // user toggled on/off
  effect: 'blur' | 'inpaint' | 'fill';
  fillColor?: string;         // hex, only for 'fill'
  trackingId?: string;        // SAM2 object ID after tracking
}

interface VisionSession {
  projectId: string;
  clipId: string;
  frameTime: number;           // keyframe seconds
  detectedObjects: DetectedObject[];
  trackingComplete: boolean;
  maskDataPath?: string;       // path to mask files on disk
  previewFrameUrl?: string;    // base64 PNG data URL
}
```

`VisionSession` is client-only — never persisted to `project.json`.

---

## 5. Frontend

### 5.1 New components

```
client/src/app/features/studio/
├── vision-panel/
│   ├── vision-panel.component.ts
│   ├── vision-panel.component.html
│   └── vision-panel.component.scss
└── txt-media-player-v2/
    └── vision-overlay.component.ts   # <canvas> over <video>
```

### 5.2 `VisionPanelComponent`

Collapsible right-side panel, same pattern as notifications/plugin panels.

**Signals:**
```typescript
readonly session = signal<VisionSession | null>(null);
readonly detecting = signal(false);
readonly tracking = signal(false);
readonly trackingProgress = signal(0);
readonly previewPng = signal<string | null>(null);
readonly exporting = signal(false);
readonly exportProgress = signal(0);
```

**Panel states:**

1. **Idle** — "Detect Objects" button. Disabled if Vision service offline.
2. **Detected** — Object list. Each row: label, confidence %, enable checkbox, effect pill group (blur/inpaint/fill), fill color swatch (fill only). "Apply Mask →" button.
3. **Tracking** — Progress bar with `framesProcessed/totalFrames`. Non-cancellable in v1.
4. **Preview ready** — Preview frame image + "↺ Re-preview" + "Export with Masks →" button.
5. **Exporting** — Progress bar. On complete: direct download link served from `GET /api/vision/download/{exportId}` (vision service returns the masked file path; Express streams it via `res.download`).
6. **Offline** — "Vision service offline" message with setup instructions.

### 5.3 `VisionOverlayComponent`

`<canvas>` absolutely positioned over `<video>` in V2 player template.

- Draws YOLO bounding boxes + label + confidence when `session.detectedObjects` is non-empty
- Enabled objects: colored border (blur=`#6366f1`, inpaint=`#a78bfa`, fill=`#f59e0b`)
- Disabled objects: dim `#444` border
- Hides boxes outside tracked time range (compares `currentTime` against SAM2 track bounds)
- Display-only — no click interaction on canvas

### 5.4 Studio integration

- `studio.component.ts` adds Vision Panel alongside existing panels
- Toggle button added to V2 player toolbar: `visibility` / `visibility_off` Material icon
- Vision Panel fixed width: 240px
- SSE `vision:*` events wired via `SseService` → update panel signals

---

## 6. Error Handling

| Scenario | Behavior |
|----------|----------|
| Python service not running | Health check on studio load → panel shows "Vision service offline" |
| YOLO finds no objects | Panel shows "No objects detected — try a different frame" |
| SAM2 loses object mid-track | Partial track returned, warning shown: "Tracked N/M frames" |
| Inpainting model missing | Falls back to `cv2.inpaint`; panel shows fallback notice |
| Export fails | SSE `vision:error` → inline panel error; existing export unaffected |

---

## 7. Scope

### In scope (v1)

- Python FastAPI microservice: YOLO detect, SAM2 track, preview frame, export masked video
- Vision Panel: collapsible right-side panel, object list, per-object effect picker
- Canvas overlay: bounding boxes displayed on video
- Effects: blur, fill, inpaint (LaMa or cv2 fallback)
- Smart tracking: SAM2 forward+backward from keyframe until object leaves frame
- SSE progress for tracking and export
- Graceful degradation when Python service is unavailable

### Out of scope (v1)

- Multiple detection sessions per clip (one active session at a time)
- Object class filtering (e.g. "detect faces only")
- Real-time live preview during playback scrub
- Undo/redo for vision edits
- Persisting `VisionSession` to `project.json`
- Audio-aware masking (muting speaker when face is masked)
- Mobile / small-screen layout for Vision Panel
