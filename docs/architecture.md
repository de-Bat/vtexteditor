# VTextStudio — Architecture

## 1. High-Level Overview

```
┌─────────────────┐     HTTP / SSE     ┌──────────────────┐      FS
│   Angular 18    │  ◄──────────────►  │   Express.js     │  ◄────────►  Local Storage
│   (Browser)     │                    │   (Node.js/TS)   │             (media + JSON)
└─────────────────┘                    └────────┬─────────┘
                                                │
                                         ┌──────┴───────┐
                                         │  Plugin Sys  │
                                         └──────┬───────┘
                                                │
                                    ┌───────────┼───────────┐
                                    ▼           ▼           ▼
                                Whisper     Groq API     FFmpeg
                                Server
```

- **Frontend**: Angular 18 SPA with standalone components and signals-based state.
- **Backend**: Express.js REST API with SSE for real-time progress.
- **Storage**: Local filesystem — uploaded media in `storage/uploads/`, project state as JSON in `storage/projects/`.
- **Media Processing**: FFmpeg/ffprobe for metadata, streaming, and export rendering.
- **Plugin System**: Server-side plugin registry with a defined interface; plugins can optionally provide Angular UI components.

---

## 2. Backend Architecture

### 2.1 Directory Structure

```
server/
├── src/
│   ├── main.ts                         # Bootstrap Express app
│   ├── config.ts                       # Paths, ports, allowed file types
│   ├── routes/
│   │   ├── media.routes.ts             # POST /api/media, GET /api/media/:id/stream, GET /api/media/:id/info
│   │   ├── project.routes.ts           # GET /api/project, PUT /api/project
│   │   ├── clips.routes.ts             # GET /api/clips, GET /api/clips/:id, GET /api/clips/:id/stream, PUT /api/clips/:id/words
│   │   ├── plugins.routes.ts           # GET /api/plugins, POST /api/pipeline/run
│   │   ├── export.routes.ts            # POST /api/export, GET /api/export/:id/status, GET /api/export/:id/download
│   │   └── sse.routes.ts               # GET /api/events
│   ├── services/
│   │   ├── media.service.ts            # File save (multer), metadata extraction (ffprobe)
│   │   ├── project.service.ts          # Read/write project JSON
│   │   ├── clip.service.ts             # Clip CRUD, word removal state persistence
│   │   ├── pipeline.service.ts         # Orchestrate plugin chain, emit progress via SSE
│   │   ├── export.service.ts           # Build FFmpeg concat filter for jump-cut export
│   │   └── sse.service.ts              # EventEmitter-based SSE broadcast
│   ├── plugins/
│   │   ├── plugin.interface.ts         # IPlugin interface definition
│   │   ├── plugin-registry.ts          # Auto-discover and register plugins
│   │   ├── transcription/
│   │   │   ├── whisper.plugin.ts       # Local Whisper server HTTP integration
│   │   │   ├── groq.plugin.ts          # Groq API integration
│   │   │   └── srt-import.plugin.ts    # Parse SRT → segments/words
│   │   ├── diarization/
│   │   │   └── speaker-diarization.plugin.ts
│   │   ├── detection/
│   │   │   └── silence-detection.plugin.ts
│   │   ├── narrative/
│   │   │   └── narrative-restructure.plugin.ts
│   │   └── translation/
│   │       └── translation.plugin.ts
│   ├── models/
│   │   ├── project.model.ts
│   │   ├── clip.model.ts
│   │   ├── segment.model.ts
│   │   └── word.model.ts
│   └── utils/
│       ├── ffmpeg.util.ts              # fluent-ffmpeg / ffprobe wrappers
│       ├── time.util.ts                # Time formatting, SRT parsing helpers
│       └── file.util.ts                # File path/extension utilities
├── storage/
│   ├── uploads/                        # Uploaded media files
│   └── projects/                       # Project JSON files
├── package.json
└── tsconfig.json
```

### 2.2 Key Services

#### MediaService
- Handles file upload via multer middleware
- Saves files as `storage/uploads/{uuid}.{originalExtension}`
- Extracts metadata via `ffprobe`: duration, format, codecs, resolution, bitrate
- Supports HTTP range requests for streaming (partial content, 206 responses)

#### PipelineService
- Accepts a `PipelineStep[]` configuration and a `PipelineContext`
- Iterates steps in order, invoking each plugin's `execute(ctx)` method
- After each step, emits progress events via `SseService`
- Returns the final `PipelineContext` with populated clips/segments/words

#### SseService
- Node.js `EventEmitter` wrapper
- Maintains a set of active SSE connections
- Broadcasts typed events: `pipeline:progress`, `pipeline:complete`, `pipeline:error`, `export:progress`, `export:complete`

#### ExportService
- Builds an FFmpeg filter chain from non-removed time ranges
- Uses `fluent-ffmpeg` to concatenate segments and render output file
- Supports video (re-mux or re-encode) and audio-only export
- Generates adjusted SRT and plain TXT transcripts

#### ProjectService
- Reads/writes `storage/projects/{id}/project.json`
- Atomic write: write to temp file, then rename (prevents corruption)
- Contains full project state: media reference, pipeline config, clips, edit history

### 2.3 API Endpoints

| Method | Endpoint | Service | Description |
|--------|----------|---------|-------------|
| POST | `/api/media` | MediaService | Upload media file (multipart/form-data) |
| GET | `/api/media/:id/info` | MediaService | Return media metadata JSON |
| GET | `/api/media/:id/stream` | MediaService | Stream media with range-request support |
| GET | `/api/project` | ProjectService | Get current project state |
| PUT | `/api/project` | ProjectService | Update project state |
| GET | `/api/plugins` | PluginRegistry | List available plugins with config schemas |
| POST | `/api/pipeline/run` | PipelineService | Execute plugin pipeline |
| GET | `/api/clips` | ClipService | List all clips with segments and words |
| GET | `/api/clips/:id` | ClipService | Get single clip detail |
| GET | `/api/clips/:id/stream` | MediaService | Stream clip media range |
| PUT | `/api/clips/:id/words` | ClipService | Update word isRemoved states |
| POST | `/api/export` | ExportService | Start export job |
| GET | `/api/export/:id/status` | ExportService | Check export progress |
| GET | `/api/export/:id/download` | ExportService | Download exported file |
| GET | `/api/events` | SseService | SSE event stream |

---

## 3. Plugin Architecture

### 3.1 Plugin Interface

```typescript
interface IPlugin {
  id: string;                              // Unique identifier, e.g. "whisper-transcription"
  name: string;                            // Display name
  description: string;                     // User-facing description
  type: 'transcription' | 'diarization' | 'detection' | 'narrative' | 'translation';
  configSchema: object;                    // JSON Schema defining configuration options
  hasUI: boolean;                          // Whether this plugin provides an Angular UI component
  execute(input: PipelineContext): Promise<PipelineContext>;
}
```

### 3.2 Pipeline Context

```typescript
interface PipelineContext {
  projectId: string;
  mediaPath: string;                       // Absolute path to uploaded media
  mediaInfo: MediaInfo;                    // Duration, format, codecs
  clips: Clip[];                           // Accumulated clips (grows as plugins run)
  metadata: Record<string, any>;           // Arbitrary metadata passed between plugins
}
```

### 3.3 Plugin Registry

- On server startup, scans `server/src/plugins/` subdirectories
- Each plugin directory exports a default `IPlugin` implementation
- Registry exposes:
  - `getAll(): IPlugin[]` — list all registered plugins
  - `getById(id: string): IPlugin` — get a specific plugin
- `GET /api/plugins` returns plugin metadata (id, name, type, configSchema, hasUI) — not the execute function

### 3.4 Plugin UI Loading

- Plugins with `hasUI: true` ship an Angular standalone component
- On the frontend, `PluginOptionsPanel` uses dynamic component loading (`ViewContainerRef.createComponent()`) to render plugin-specific UI
- Fallback: if no custom UI, auto-generate a form from `configSchema` using JSON Schema → Angular reactive form mapping

---

## 4. Data Models

### 4.1 Core Models

```typescript
interface Project {
  id: string;
  name: string;
  mediaPath: string;                       // Relative path within storage/uploads/
  mediaType: 'video' | 'audio';
  mediaDuration: number;                   // Seconds
  mediaFormat: string;                     // e.g. "mp4", "mp3"
  clips: Clip[];
  pipelineConfig: PipelineStep[];
  editHistory: EditAction[];               // Undo/redo stack
  createdAt: string;                       // ISO 8601
  updatedAt: string;                       // ISO 8601
}

interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;                       // Seconds (float)
  endTime: number;
  segments: Segment[];
}

interface Segment {
  id: string;
  clipId: string;
  startTime: number;
  endTime: number;
  text: string;                            // Full segment text (reconstructed from words)
  words: Word[];
  tags: string[];                          // Flat string tags: ["speaker:Alice", "topic:intro"]
}

interface Word {
  id: string;
  segmentId: string;
  text: string;
  startTime: number;
  endTime: number;
  isRemoved: boolean;
}

interface PipelineStep {
  pluginId: string;
  config: Record<string, any>;
  order: number;
}

interface EditAction {
  type: 'remove' | 'restore';
  wordIds: string[];
  timestamp: string;                       // ISO 8601
}
```

### 4.2 Storage Schema

```
storage/
├── uploads/
│   └── {uuid}.{ext}                      # Raw media files
└── projects/
    └── {projectId}/
        ├── project.json                   # Full Project object
        └── exports/
            └── {exportId}.{ext}           # Exported files
```

---

## 5. Frontend Architecture

### 5.1 Directory Structure

```
client/
├── src/
│   ├── main.ts
│   ├── app/
│   │   ├── app.component.ts
│   │   ├── app.routes.ts                  # '/' → Onboarding, '/studio' → Studio
│   │   ├── app.config.ts
│   │   ├── core/
│   │   │   ├── services/
│   │   │   │   ├── api.service.ts         # HttpClient wrapper, base URL config
│   │   │   │   ├── project.service.ts     # Project state (signal-based)
│   │   │   │   ├── clip.service.ts        # Clips, segments, words (signal-based)
│   │   │   │   ├── media-player.service.ts# Shared player state: currentTime, isPlaying, duration
│   │   │   │   ├── sse.service.ts         # EventSource wrapper, typed event observables
│   │   │   │   └── edit-history.service.ts# Undo/redo stack management
│   │   │   └── models/
│   │   │       ├── clip.model.ts
│   │   │       ├── segment.model.ts
│   │   │       ├── word.model.ts
│   │   │       └── plugin.model.ts
│   │   ├── features/
│   │   │   ├── onboarding/
│   │   │   │   ├── onboarding.component.ts
│   │   │   │   ├── media-uploader/
│   │   │   │   ├── pipeline-configurator/
│   │   │   │   ├── plugin-options/
│   │   │   │   └── processing-progress/
│   │   │   ├── studio/
│   │   │   │   ├── studio.component.ts
│   │   │   │   ├── clip-list/
│   │   │   │   └── export-panel/
│   │   │   └── txt-media-player/
│   │   │       ├── txt-media-player.component.ts
│   │   │       ├── media-controls/
│   │   │       ├── transcript-view/
│   │   │       └── segment-timeline/
│   │   └── shared/
│   │       ├── components/
│   │       │   └── progress-bar/
│   │       └── pipes/
│   │           ├── duration.pipe.ts
│   │           └── time-format.pipe.ts
│   ├── assets/
│   └── styles/
│       ├── _variables.scss
│       └── styles.scss
├── angular.json
├── package.json
└── tsconfig.json
```

### 5.2 State Management

Angular signals (no external state library):

| Service | Signals | Purpose |
|---------|---------|---------|
| `ProjectService` | `project`, `isLoading` | Current project state |
| `ClipService` | `clips`, `selectedClip`, `selectedClipWords` | Clip data and selection |
| `MediaPlayerService` | `currentTime`, `isPlaying`, `duration`, `playbackRate` | Shared player state |
| `EditHistoryService` | `canUndo`, `canRedo` | Edit stack state |

### 5.3 Communication

- **HTTP**: Angular `HttpClient` for all REST API calls
- **SSE**: Native `EventSource` wrapped in an Angular service, exposed as RxJS observables for pipeline/export progress
- **Proxy**: Angular dev server proxies `/api/*` to the Express backend (configured in `angular.json` or `proxy.conf.json`)

---

## 6. Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| JSON file storage (no DB) | Single-user app; simplest persistence; can migrate to SQLite later |
| SSE over WebSocket | One-way progress events only; SSE is simpler and auto-reconnects |
| Angular signals (no NgRx) | App state is modest; signals + services are sufficient |
| FFmpeg for export | Industry-standard for reliable media concatenation |
| Plugin configSchema as JSON Schema | Well-tooled standard; enables dynamic form generation |
| Flat string tags on segments | Maximum flexibility with no schema overhead |
| Segment-level timeline (not word-level) | Cleaner overview UX; word detail lives in the transcript panel |
| Monorepo (server/ + client/) | Simple structure; no monorepo tooling overhead |
| Models duplicated (not shared package) | Loose coupling; avoids shared build complexity |

---

## 7. External Dependencies

### Backend

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `cors` | Cross-origin support (dev) |
| `multer` | Multipart file upload |
| `fluent-ffmpeg` | FFmpeg/ffprobe Node.js wrapper |
| `uuid` | Generate unique IDs |
| `typescript` | Language |
| `tsx` / `ts-node` | TypeScript execution |

### Frontend

| Package | Purpose |
|---------|---------|
| `@angular/core` (v18) | Framework |
| `@angular/router` | Routing |
| `@angular/forms` | Reactive forms (plugin config) |
| `@angular/cdk` | Virtual scrolling, drag-and-drop |

### System

| Tool | Purpose |
|------|---------|
| `ffmpeg` | Media processing, export rendering |
| `ffprobe` | Media metadata extraction |
| Node.js 20+ | Runtime |
