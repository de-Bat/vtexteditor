# Smart Video Editing — Session Progress Notes

**Date:** 2026-05-09
**Feature:** Object detection, object removal, magic mask on video

---

## What Was Decided (Brainstorming)

| Decision | Choice |
|---|---|
| Backend | Local Python FastAPI microservice (port 3001) — YOLOv8 + SAM2 |
| Detection | YOLO auto-scans frame → user picks which objects to mask |
| Removal types | Blur / Inpaint (cv2) / Fill — per object, user picks |
| Tracking | SAM2 bidirectional from keyframe, stops when object leaves frame |
| UI | Right-side Vision Panel (collapsible, same pattern as plugin panels) |
| Rendering | Preview single frame → export full masked video |

---

## Specs & Plans (all committed to main)

| File | Description |
|---|---|
| `docs/superpowers/specs/2026-05-09-smart-video-editing-design.md` | Full design spec |
| `docs/superpowers/plans/2026-05-09-smart-video-editing-python-service.md` | Plan A: Python FastAPI service (6 tasks) |
| `docs/superpowers/plans/2026-05-09-smart-video-editing-integration.md` | Plan B: Express proxy + Angular UI (8 tasks) |

---

## Implementation Progress

### Plan A — Python Vision Service

| Task | Status | Commit |
|---|---|---|
| A1: Bootstrap FastAPI + health endpoint | ✅ DONE | `09ddd8c` |
| A2: YOLO detect endpoint | ⏳ pending |  |
| A3: Frame extraction + SAM2 singleton | ⏳ pending |  |
| A4: SAM2 track endpoint (SSE) | ⏳ pending |  |
| A5: Effect utilities + preview endpoint | ⏳ pending |  |
| A6: Masked video export (SSE) | ⏳ pending |  |

### Plan B — Express + Angular Integration

| Task | Status | Commit |
|---|---|---|
| B1: TypeScript vision models | ⏳ pending |  |
| B2: Express VisionService + Python spawn | ⏳ pending |  |
| B3: Express vision routes (proxy + download) | ⏳ pending |  |
| B4: Wire vision into main.ts | ⏳ pending |  |
| B5: Angular VisionService | ⏳ pending |  |
| B6: VisionOverlayComponent (canvas) | ⏳ pending |  |
| B7: VisionPanelComponent | ⏳ pending |  |
| B8: Studio + V2 player integration | ⏳ pending |  |

---

## Key Architecture Notes

### Path resolution
Python reads `STORAGE_ROOT` env var (set by Express on spawn). Request bodies use `projectId` + `maskSessionId` (+ `exportId` for export) — **never absolute paths**. Python builds paths as:
```
{STORAGE_ROOT}/projects/{projectId}/vision/{maskSessionId}/masks/{objId}.npz
{STORAGE_ROOT}/projects/{projectId}/exports/{exportId}-masked.mp4
```

### SSE streaming
Track and export endpoints return `text/event-stream` responses. Angular uses `fetch()` + `ReadableStream` (not EventSource, since POST). Express proxies SSE streams transparently via `http-proxy-middleware`.

### Vision Panel states
`offline` → `idle` → `detecting` → `detected` → `tracking` → `preview` → `exporting` → `export-done`

### File locations
- Python service: `vision-service/` (project root)
- Server models: `server/src/models/vision.model.ts`
- Server service: `server/src/services/vision.service.ts`
- Server routes: `server/src/routes/vision.routes.ts`
- Client models: `client/src/app/core/models/vision.model.ts`
- Client service: `client/src/app/core/services/vision.service.ts`
- Overlay: `client/src/app/features/studio/txt-media-player-v2/vision-overlay.component.ts`
- Panel: `client/src/app/features/studio/vision-panel/vision-panel.component.ts`

---

## How to Continue

Next step: run subagent-driven development starting from Task A2.

Invoke skill: `superpowers:subagent-driven-development`

Then dispatch implementer for Task A2 (YOLO detect endpoint). Full task text is in `docs/superpowers/plans/2026-05-09-smart-video-editing-python-service.md` under "## Task 2".

Base SHA for A2 review: `09ddd8c67d21d129d49a669f611f223cd0e4edb8`

Plan A tasks are sequential (A2 and A3 can start in parallel — they're independent of each other).
Plan B tasks B1 and B2/B3 can start independently from Plan A.
