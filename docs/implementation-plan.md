# VTextStudio — Implementation Plan

## Overview

12 phases, ordered by dependency. Phases that can run in parallel are noted. Each phase ends with a verification checkpoint.

---

## Phase 1: Project Scaffolding

**Dependencies**: None  
**Estimated scope**: Foundation for all subsequent phases

| # | Task | Details |
|---|------|---------|
| 1.1 | Initialize git repository | `git init`, create `.gitignore` (node_modules, dist, storage/uploads, storage/projects) |
| 1.2 | Create monorepo structure | Root directory with `server/` and `client/` subdirectories |
| 1.3 | Scaffold backend | `npm init` in `server/`, install Express, TypeScript, cors, multer, fluent-ffmpeg, uuid; configure `tsconfig.json` with strict mode |
| 1.4 | Scaffold frontend | `ng new client --style=scss --routing --standalone` with Angular 18; configure proxy to backend (:3000) |
| 1.5 | Define shared models | Create TypeScript interfaces in `server/src/models/` and `client/src/app/core/models/` for Project, Clip, Segment, Word, PipelineStep, PipelineContext |
| 1.6 | Dev tooling | ESLint + Prettier configs; `concurrently` in root `package.json` for `npm run dev` (starts both servers) |

**Verification**:
- `npm run dev` starts both servers without errors
- Angular serves on `:4200`, Express on `:3000`
- Proxy forwards `/api/*` from Angular to Express

---

## Phase 2: Media Upload & Streaming

**Dependencies**: Phase 1

| # | Task | Details |
|---|------|---------|
| 2.1 | Storage setup | Create `storage/uploads/` and `storage/projects/` directories; implement `file.util.ts` (ensureDir, generatePath) |
| 2.2 | Media upload endpoint | `POST /api/media` — multer middleware with file type validation; save as `storage/uploads/{uuid}.{ext}`; return media ID and path |
| 2.3 | Media metadata extraction | `ffmpeg.util.ts` wrapping ffprobe; `GET /api/media/:id/info` returns duration, format, codecs, resolution/bitrate |
| 2.4 | Media streaming | `GET /api/media/:id/stream` — parse `Range` header, return 206 Partial Content; support seeking in video/audio |
| 2.5 | Project state service | `ProjectService` — read/write `project.json`; atomic write (temp file + rename); `GET /api/project`, `PUT /api/project` |

**Verification**:
- Upload a video via curl: `curl -F "file=@test.mp4" http://localhost:3000/api/media`
- Verify metadata response: duration, codecs, resolution
- Verify streaming: open `http://localhost:3000/api/media/{id}/stream` in a browser `<video>` tag, confirm seeking works

---

## Phase 3: Plugin Architecture

**Dependencies**: Phase 1  
**Parallel with**: Phase 2

| # | Task | Details |
|---|------|---------|
| 3.1 | Plugin interface | Define `IPlugin` in `server/src/plugins/plugin.interface.ts`: id, name, description, type, configSchema, hasUI, execute(ctx) |
| 3.2 | Plugin registry | `plugin-registry.ts` — scan plugin subdirectories, register instances; expose `getAll()` and `getById()`; `GET /api/plugins` returns plugin metadata (without execute functions) |
| 3.3 | Pipeline service | `pipeline.service.ts` — accept `PipelineStep[]`, iterate in order, call `plugin.execute(ctx)` passing and accumulating `PipelineContext`, emit progress after each step |
| 3.4 | SSE service | `sse.service.ts` — EventEmitter-backed; maintain active connections set; `GET /api/events` endpoint with `text/event-stream` content type; typed events: `pipeline:progress`, `pipeline:complete`, `pipeline:error`, `export:progress`, `export:complete` |
| 3.5 | Pipeline endpoint | `POST /api/pipeline/run` — validate pipeline config, create PipelineContext, execute asynchronously, return immediately with job ID, emit progress via SSE |
| 3.6 | SRT import plugin | First plugin to validate the full pipeline: parse `.srt` file → extract segments → estimate word-level timestamps from segment timing → return populated `PipelineContext.clips[]` |

**Verification**:
- `GET /api/plugins` returns list including `srt-import`
- `POST /api/pipeline/run` with SRT import config → SSE events received (progress, complete)
- Project JSON contains clips with segments and words after pipeline completion

---

## Phase 4: Onboarding Frontend

**Dependencies**: Phases 2 and 3

| # | Task | Details |
|---|------|---------|
| 4.1 | Onboarding route + component | Root route `/` → `OnboardingComponent`; full-page centered layout, max-width 720px |
| 4.2 | MediaUploader component | Drag-and-drop zone with `(drop)` and `(dragover)` events; file input fallback; call `POST /api/media` with FormData; show upload progress via `HttpClient` `reportProgress` |
| 4.3 | FileInfoPanel component | Fetch metadata from `GET /api/media/:id/info`; display filename, duration (pipe), format, resolution |
| 4.4 | PipelineConfigurator component | Fetch `GET /api/plugins`; render available plugins as selectable cards; horizontal layout with `[+]` button; Angular CDK `cdkDrag` for reorder; `×` button to remove steps |
| 4.5 | PluginOptionsPanel component | Read selected plugin's `configSchema`; dynamically generate Angular reactive form (text → input, enum → select, boolean → toggle, number → number input); bind to pipeline step config |
| 4.6 | ProcessingProgress component | Subscribe to SSE via `SseService`; render multi-step progress bar showing current step label, step count, and percentage |
| 4.7 | Navigation trigger | On `pipeline:complete` SSE event → `Router.navigate(['/studio'])` |

**Verification**:
- Full onboarding flow in browser: upload file → see metadata → configure pipeline → click Process → see progress → auto-navigate to `/studio`

---

## Phase 5: Core Transcription Plugins

**Dependencies**: Phase 3  
**Parallel with**: Phase 4

| # | Task | Details |
|---|------|---------|
| 5.1 | Whisper plugin | `whisper.plugin.ts` — HTTP POST to local Whisper server (configurable URL); send audio file; parse JSON response into segments and words with start/end timestamps; config: language, model, server URL |
| 5.2 | Groq plugin | `groq.plugin.ts` — Groq API call with audio file; parse transcription response; config: API key, language, model |
| 5.3 | Word timestamp alignment | Utility function: if a transcription source provides only segment-level text (no word timestamps), estimate word times by dividing segment duration proportionally by word character count |

**Verification**:
- Upload a test audio file, run pipeline with Whisper plugin → clips contain words with accurate timestamps
- Same with Groq plugin
- SRT import (from Phase 3.6) produces word-level timestamps via the alignment utility

---

## Phase 6: Studio View & Clip Management

**Dependencies**: Phase 4

| # | Task | Details |
|---|------|---------|
| 6.1 | Clips API endpoints | `GET /api/clips` — return all clips from project with nested segments/words; `GET /api/clips/:id` — single clip; `GET /api/clips/:id/stream` — proxy to media stream with clip time range |
| 6.2 | ClipService (frontend) | Angular service with signals: `clips` (all), `selectedClip` (current), `selectedClipWords` (flat word array for binary search); fetch from API on studio load |
| 6.3 | Studio layout component | Route `/studio` → `StudioComponent`; CSS Grid layout: sidebar (240px fixed) + main (flex); bottom transport bar (fixed) |
| 6.4 | ClipList component | Scrollable list in sidebar; each item: clip name, time range (`DurationPipe`), segment count; click to select (updates `ClipService.selectedClip` signal); active clip: blue left border, highlighted background |
| 6.5 | Routing wiring | Onboarding navigates to `/studio` after pipeline complete; studio redirects to `/` if no project loaded |

**Verification**:
- Navigate to Studio → clip list loads from backend
- Click different clips → `selectedClip` signal updates
- Studio layout matches the specified grid structure

---

## Phase 7: txtMediaPlayer — Playback & Transcript

**Dependencies**: Phase 6  
**This is the core feature phase**

| # | Task | Details |
|---|------|---------|
| 7.1 | TxtMediaPlayer shell | Container component receiving `Clip` as input; vertical stack layout: media player (top) → transcript (middle, scrollable) → timeline (bottom) |
| 7.2 | HTML5 media element | `<video>` or `<audio>` element determined by `project.mediaType`; `[src]` bound to `GET /api/clips/:id/stream`; `ViewChild` reference for programmatic control |
| 7.3 | MediaControls component | Play/pause toggle button; seek range input synchronized with `currentTime`; volume slider; playback speed dropdown (0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×); current time / total duration display |
| 7.4 | MediaPlayerService | Signal-based shared state: `currentTime` (updated on `timeupdate`), `isPlaying`, `duration`, `playbackRate`; methods: `play()`, `pause()`, `seek(time)`, `setRate(rate)` |
| 7.5 | TranscriptView component | Render `clip.segments` as visually distinct cards; segment header shows tags (e.g., "Speaker A") with a colored dot; words rendered as `<span>` elements with `[class.active]`, `[class.removed]`, `(click)` bindings |
| 7.6 | Word highlighting | On `timeupdate` signal change → binary search `selectedClipWords` (sorted by startTime) → find word where `startTime <= currentTime < endTime` → set `activeWordId` signal → TranscriptView applies `.active` class via `[class.active]="word.id === activeWordId()"` |
| 7.7 | Word click → seek | `(click)` handler on word `<span>`: call `MediaPlayerService.seek(word.startTime)` |
| 7.8 | Auto-scroll | `effect()` watching `activeWordId` → use `Element.scrollIntoView({ behavior: 'smooth', block: 'center' })` on the active word element |

**Verification**:
- Play a clip → words highlight in real-time sync with audio/video
- Click any word → playhead jumps to that word's time
- Transcript auto-scrolls as playback progresses
- All playback controls (play, pause, seek, volume, speed) work correctly

---

## Phase 8: Segment Timeline

**Dependencies**: Phase 7.4 (MediaPlayerService)  
**Parallel with**: Phase 7.5–7.8

| # | Task | Details |
|---|------|---------|
| 8.1 | SegmentTimeline component | Horizontal bar; each segment rendered as a `<div>` with `[style.width.%]` calculated as `(segment.duration / clip.duration) * 100`; background color keyed on segment's primary tag value (rotating palette) |
| 8.2 | Playhead indicator | Absolute-positioned vertical line; left position calculated as `(currentTime / duration) * 100%`; updates reactively via `MediaPlayerService.currentTime` signal |
| 8.3 | Click-to-seek on timeline | `(click)` handler on timeline container: calculate time from click position (`event.offsetX / element.clientWidth * duration`) → `MediaPlayerService.seek(time)` |
| 8.4 | Segment tooltips | `(mouseenter)` / `(mouseleave)` on segment blocks → show tooltip with: segment text preview (first 50 chars), duration, tag labels |

**Verification**:
- Timeline segments are proportional to their duration
- Playhead moves smoothly during playback
- Click on timeline → player seeks to correct time
- Hover over segment → tooltip with correct info

---

## Phase 9: Text-Based Editing (Word Removal)

**Dependencies**: Phase 7  
**Core editing feature**

| # | Task | Details |
|---|------|---------|
| 9.1 | Word selection UI | Track `lastClickedWordId` for Shift+click range selection; on Shift+click: select all words between `lastClickedWordId` and clicked word; alternatively detect browser Selection API range → map to word IDs; add `.selected` class to selected words |
| 9.2 | Removal action | Floating toolbar component: appears above selection anchor; "Remove" button for normal words, "Restore" for removed words; Delete key shortcut; calls `ClipService.removeWords(ids)` |
| 9.3 | Visual indicators | CSS classes: `.removed { text-decoration: line-through; opacity: 0.35; background: rgba(239,68,68,0.1); }` applied via `[class.removed]="word.isRemoved"` |
| 9.4 | Jump-cut playback | In the `timeupdate` handler: after finding current word, check if it's removed; if so, scan forward to find the next non-removed word; `MediaPlayerService.seek(nextNonRemovedWord.startTime)`; edge case: if all remaining words are removed, pause playback |
| 9.5 | Restore action | Click on a removed word (or select removed words) → floating toolbar shows "Restore" → `ClipService.restoreWords(ids)` |
| 9.6 | EditHistoryService | Maintain undo stack and redo stack of `EditAction` objects; `removeWords()` and `restoreWords()` push to undo stack and clear redo; `undo()` pops from undo, pushes to redo, reverses the action; `redo()` vice versa; keyboard listeners: Ctrl+Z, Ctrl+Shift+Z |
| 9.7 | Persist edits | `PUT /api/clips/:id/words` — send updated word states to backend; backend persists to `project.json`; call on every edit (debounced 500ms) |

**Verification**:
- Select words → Remove → words show strikethrough + dimmed
- Play through a removal → playback seamlessly jumps past removed words
- Undo (Ctrl+Z) → words restored; Redo (Ctrl+Shift+Z) → removed again
- Refresh page → removed words persist from server

---

## Phase 10: Export

**Dependencies**: Phases 7 and 9

| # | Task | Details |
|---|------|---------|
| 10.1 | Export service (backend) | `export.service.ts` — analyze clip words to build list of non-removed time ranges; construct FFmpeg concat/trim filter: for each contiguous non-removed range, create a trim segment; concatenate all segments into output file |
| 10.2 | SRT export | Generate `.srt` file from non-removed words; recalculate timecodes: accumulate duration of non-removed ranges, map each word/segment to adjusted timestamps |
| 10.3 | TXT export | Concatenate non-removed word texts with spaces and paragraph breaks at segment boundaries |
| 10.4 | Export endpoints | `POST /api/export` — accept format (media/srt/txt) and clip ID; start async FFmpeg job for media (or synchronous generation for text); emit progress via SSE; `GET /api/export/:id/download` — serve completed file |
| 10.5 | ExportPanel component | Modal/drawer triggered from Studio toolbar "Export ▾" button; radio/select for format (Video/Audio, SRT, TXT); "Start Export" button; progress bar (SSE); download link on completion |

**Verification**:
- Export a clip with several removed word ranges → download media file → play and verify removed sections are cut
- Export SRT → open in text editor → verify timecodes are adjusted correctly
- Export TXT → verify removed words are not present

---

## Phase 11: Advanced Plugins

**Dependencies**: Phase 3 (plugin architecture)  
**Can start after**: Phase 5

| # | Task | Details |
|---|------|---------|
| 11.1 | Speaker diarization plugin | Integrate with a diarization model or API; process audio → identify speaker segments → assign `speaker:{name}` tags to segments; config: number of speakers (or auto-detect) |
| 11.2 | Silence detection plugin | Use FFmpeg `silencedetect` filter; parse output → identify silent regions; optionally split clips at silence boundaries; config: silence threshold (dB), minimum duration |
| 11.3 | Narrative restructuring plugin | Accept reordering rules or AI-based analysis; reorder segments within a clip to create a narrative flow; produces a new clip with rearranged segments and adjusted timestamps |
| 11.4 | Translation plugin | API-based translation (e.g., Google Translate, DeepL); translate segment text → store as additional field or replace; config: source language, target language, API key |
| 11.5 | Plugin UI loader | Implement dynamic Angular component loading for plugins with `hasUI: true`; use `ViewContainerRef.createComponent()` to render plugin-specific configuration or display components within PluginOptionsPanel or Studio |

**Verification**:
- Run pipeline with diarization → segments tagged with speaker identities
- Run silence detection → clips split at silent gaps
- Run narrative restructuring → segments reordered in output clip
- Run translation → segment text translated
- Plugin with custom UI → component renders correctly in options panel

---

## Phase 12: Polish & Hardening

**Dependencies**: All previous phases  
**Final phase**

| # | Task | Details |
|---|------|---------|
| 12.1 | Error handling | Backend: global Express error handler middleware, typed error responses; Frontend: interceptor for HTTP errors, toast notification service for user-facing errors |
| 12.2 | Large transcript performance | Angular CDK virtual scrolling for TranscriptView when word count > 1000; efficient binary search (pre-sorted word array) for word highlighting |
| 12.3 | Keyboard shortcuts | Global keyboard listener service; Space = play/pause, Ctrl+Z = undo, Ctrl+Shift+Z = redo, Delete = remove selected, Left/Right arrows = seek ±5s |
| 12.4 | Responsive layout | Collapsible sidebar (hamburger toggle); flexible main area; minimum width 1024px; media player resizes proportionally |
| 12.5 | Loading states | Skeleton loaders for: clip list, transcript view, pipeline progress; loading spinners for async operations |
| 12.6 | End-to-end tests | Playwright: full flow — upload media → configure pipeline → process → select clip → play → remove words → export → download |
| 12.7 | Unit tests | Backend: pipeline service (plugin chaining), export service (time range calculation), SRT parser; Frontend: media-player service (word search), edit-history service (undo/redo), duration pipe |

**Verification**:
- All unit tests pass
- E2E test completes the full workflow
- No console errors during normal operation
- Smooth performance with a 45-minute media file

---

## Phase Dependency Graph

```
Phase 1 (Scaffolding)
  ├── Phase 2 (Media Upload)
  │     └── Phase 4 (Onboarding Frontend) ──┐
  │                                          ├── Phase 6 (Studio & Clips)
  ├── Phase 3 (Plugin Arch) ─────────────────┘       │
  │     ├── Phase 5 (Transcription Plugins)           │
  │     │     └── Phase 11 (Advanced Plugins)         │
  │     └── (feeds into Phase 4)                      │
  │                                                   ▼
  │                                          Phase 7 (txtMediaPlayer)
  │                                            ├── Phase 8 (Timeline) [parallel w/ 7.5-7.8]
  │                                            └── Phase 9 (Word Editing)
  │                                                   │
  │                                                   ▼
  │                                          Phase 10 (Export)
  │                                                   │
  └───────────────────────────────────────────────────▼
                                             Phase 12 (Polish)
```

## Summary

| Phase | Name | Depends On | Can Parallel With |
|-------|------|-----------|-------------------|
| 1 | Project Scaffolding | — | — |
| 2 | Media Upload & Streaming | 1 | 3 |
| 3 | Plugin Architecture | 1 | 2 |
| 4 | Onboarding Frontend | 2, 3 | 5 |
| 5 | Transcription Plugins | 3 | 4 |
| 6 | Studio & Clip Management | 4 | — |
| 7 | txtMediaPlayer | 6 | — |
| 8 | Segment Timeline | 7.4 | 7.5–7.8 |
| 9 | Text-Based Editing | 7 | — |
| 10 | Export | 7, 9 | 11 |
| 11 | Advanced Plugins | 3, 5 | 10 |
| 12 | Polish & Hardening | All | — |
