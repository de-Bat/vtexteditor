# Waveform Timeline — Design Spec

**Date:** 2026-05-15
**Status:** Approved
**Scope:** `server/`, `client/src/app/features/studio/txt-media-player/`, `client/src/app/core/services/`

---

## Problem

The segment timeline is a 26px color bar with no audio information. Users cannot visually identify silence gaps, loud sections, or cut region audio context without playing the clip.

---

## Goals

1. Display audio amplitude waveform below the existing segment timeline bar.
2. Overlay cut regions (red tint) and silence zones (dim) on the waveform.
3. Clicking the waveform seeks the player to that time position.
4. Server pre-computes peak data; client renders via canvas.

---

## Non-Goals

- V1 player (`txt-media-player`) changes.
- Zoom/scroll on waveform.
- Real-time waveform update during recording.
- Waveform editing (drag to trim).

---

## Architecture

```
clip load
  → GET /api/clips/:clipId/waveform      (Node server)
      WaveformService (server)
        ffmpeg astats filter → RMS per 50ms chunk → normalize [0,1]
        cache: Map<clipId, WaveformData> (memory, invalidated on clip save)
      → { peaks: number[], durationMs: number, chunkMs: 50 }
  → WaveformService (client, providedIn: root)
      Map<clipId, WaveformData> cache
      signal: waveformData()
  → WaveformTimelineComponent
      canvas renders: bars + cut overlays + silence + playhead
      (click) → seekTo output (ms)
  → txt-media-player-v2.component.ts
      mediaEl.currentTime = seekTo / 1000
```

---

## Server

### Endpoint

`GET /api/clips/:clipId/waveform`

**Response:**
```typescript
interface WaveformData {
  peaks: number[];     // normalized [0,1], one per chunkMs
  durationMs: number;
  chunkMs: 50;
}
```

**Processing:**
- ffmpeg command: `ffmpeg -i <mediaPath> -af astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level -f null -`
- Parse RMS dB values per chunk → convert dB to linear → normalize to [0, 1]
- No audio track → return `{ peaks: [], durationMs, chunkMs: 50 }`
- ffmpeg error → HTTP 500

**Caching:** `Map<clipId, WaveformData>` in `WaveformService`. Invalidated when clip is saved (existing save route calls `waveformService.invalidate(clipId)`).

### Files

- **Create** `server/src/routes/waveform.routes.ts` — GET handler
- **Create** `server/src/services/waveform.service.ts` — ffmpeg processing + cache
- **Modify** `server/src/main.ts` — register `/api/clips/:clipId/waveform` route

---

## Client

### WaveformService

`client/src/app/core/services/waveform.service.ts`

- `providedIn: 'root'`
- `fetch(clipId: string): Observable<WaveformData>` — GET endpoint, caches per clipId
- `invalidate(clipId: string)` — clear cache entry on clip save

### WaveformTimelineComponent

`client/src/app/features/studio/txt-media-player/waveform-timeline.component.ts`

**Inputs:**
```typescript
readonly peaks = input.required<number[]>();
readonly durationMs = input.required<number>();
readonly currentTimeMs = input<number>(0);
readonly cutRegions = input<CutRegion[]>([]);
readonly silenceThreshold = input<number>(0.02);
```

**Output:**
```typescript
readonly seekTo = output<number>(); // ms
```

**Canvas rendering (48px tall):**

| Layer | Color | Condition |
|-------|-------|-----------|
| Background | `var(--color-surface)` | always |
| Waveform bars | `var(--color-accent)` at 70% opacity | peak ≥ silenceThreshold |
| Silence bars | `var(--color-accent)` at 20% opacity | peak < silenceThreshold |
| Cut region overlay | red `#e74c3c` at 25% opacity | time within CutRegion span |
| Playhead | white, 2px | always |

- Bars centered vertically, height = `peak * 48px`
- One bar per peak value, width = `canvasWidth / peaks.length`
- Redraws via `effect()` on `peaks`, `cutRegions`, `currentTimeMs` changes
- `ResizeObserver` triggers redraw on container width change

**Interaction:**
- `(click)` on canvas → compute `clickX / canvasWidth * durationMs` → emit `seekTo`

**Loading / empty states:**
- No data yet: render shimmer placeholder (CSS animation, same 48px height)
- `peaks.length === 0` (no audio): render flat dim line at center

### Integration

**Modify** `txt-media-player-v2.component.ts`:
- On clip load: call `waveformService.fetch(clipId)` → store in `waveformData` signal
- Add `<app-waveform-timeline>` below existing `<app-segment-timeline>` in template
- Handle `(seekTo)` → `mediaEl.currentTime = $event / 1000`
- Pass `currentTimeMs` from existing playhead signal (convert from seconds)

---

## File Map

| Action | Path |
|--------|------|
| Create | `server/src/routes/waveform.routes.ts` |
| Create | `server/src/services/waveform.service.ts` |
| Create | `client/src/app/core/services/waveform.service.ts` |
| Create | `client/src/app/features/studio/txt-media-player/waveform-timeline.component.ts` |
| Modify | `server/src/main.ts` |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` |

---

## Testing

- **Server unit test** (`waveform.service.spec.ts`): mock ffmpeg stdout, assert peak normalization and empty-audio fallback.
- **Client**: no canvas unit tests — manual verification only.
- **Manual checklist:**
  - Waveform appears on clip load
  - Cut regions show red overlay aligned with segment bar
  - Silence zones visually dimmer
  - Click seeks to correct time
  - Resize redraws correctly
  - No audio clip shows flat line
  - ffmpeg failure hides waveform row gracefully
