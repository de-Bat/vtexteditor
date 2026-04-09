# VTextStudio — Architecture

## 1. High-Level Overview

```
┌─────────────────┐     HTTP / SSE     ┌──────────────────┐      FS
│   Angular 20+   │  ◄──────────────►  │   Express.js     │  ◄────────►  Local Storage
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
                                (OpenAI)
```

- **Frontend**: Angular 20+ SPA with standalone components (default, no `standalone: true` needed) and signals-based state.
- **Backend**: Express.js REST API with SSE for real-time progress. Singleton service instances (no DI framework).
- **Storage**: Local filesystem — uploaded media in `storage/uploads/`, project state as JSON in `storage/projects/{id}/project.json`, app settings in `storage/settings.json`.
- **Media Processing**: FFmpeg/ffprobe for metadata, streaming, and export rendering.
- **Plugin System**: Server-side plugin registry with a defined interface; plugins can optionally provide Angular UI components.
- **Design System**: "Editorial Timeline" — dark theme (#0e0e10 base), tri-font (Manrope/Inter/Space Grotesk), no-line rule, glass & gradient buttons.

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
│   │   ├── project.routes.ts           # GET /api/project, PUT /api/project (current project)
│   │   ├── projects.routes.ts          # GET /api/projects, POST /api/projects/:id/open, DELETE /api/projects/:id
│   │   ├── clip.routes.ts              # GET /api/clips, GET /api/clips/:id, GET /api/clips/:id/stream, PUT /api/clips/:id/words
│   │   ├── plugin.routes.ts            # GET /api/plugins, POST /api/plugins/pipeline/run
│   │   ├── export.routes.ts            # POST /api/export, GET /api/export/:id/status, GET /api/export/:id/download
│   │   ├── settings.routes.ts          # GET /api/settings, PUT /api/settings
│   │   └── sse.routes.ts               # GET /api/events
│   ├── services/
│   │   ├── project.service.ts          # Multi-project CRUD, current project tracking, atomic JSON writes
│   │   ├── clip.service.ts             # Clip CRUD, word removal state persistence
│   │   ├── pipeline.service.ts         # Orchestrate plugin chain, emit progress via SSE
│   │   ├── export.service.ts           # Build FFmpeg concat filter for jump-cut export, SRT/TXT generation
│   │   ├── settings.service.ts         # App-wide settings persistence (API keys, whisper config, etc.)
│   │   └── sse.service.ts              # EventEmitter-based SSE broadcast
│   ├── plugins/
│   │   ├── plugin.interface.ts         # IPlugin interface definition
│   │   ├── plugin-registry.ts          # Register plugins; expose getAll()/getById()
│   │   ├── transcription/
│   │   │   ├── whisper-openai.plugin.ts # OpenAI-compatible Whisper API integration
│   │   │   ├── groq-whisper.plugin.ts  # Groq API integration
│   │   │   └── srt-import.plugin.ts    # Parse SRT → segments/words
│   │   ├── diarization/                # (placeholder)
│   │   ├── detection/                  # (placeholder)
│   │   ├── narrative/                  # (placeholder)
│   │   └── translation/               # (placeholder)
│   ├── models/
│   │   ├── project.model.ts            # Project, ProjectSummary, MediaInfo, EditAction
│   │   ├── clip.model.ts               # Clip (with showSilenceMarkers flag)
│   │   ├── segment.model.ts            # Segment with flat string tags
│   │   ├── word.model.ts               # Word with isRemoved flag
│   │   ├── plugin.model.ts             # PluginMeta, PluginType, PipelineStep (with settingsMap)
│   │   └── pipeline-context.model.ts   # PipelineContext passed between plugins
│   └── utils/
│       ├── ffmpeg.util.ts              # fluent-ffmpeg / ffprobe wrappers
│       ├── time.util.ts                # Time formatting, SRT parsing helpers
│       └── file.util.ts                # File path/extension utilities, atomic JSON writes
├── storage/
│   ├── uploads/                        # Uploaded media files
│   └── projects/                       # Project JSON files ({id}/project.json)
├── package.json
└── tsconfig.json
```

### 2.2 Key Services

#### MediaService
- No separate service — media handling is done inline in `media.routes.ts`
- Handles file upload via multer middleware
- Saves files as `storage/uploads/{uuid}.{originalExtension}`
- Extracts metadata via `ffprobe`: duration, format, codecs, resolution, bitrate
- Supports HTTP range requests for streaming (partial content, 206 responses)

#### ProjectService
- Manages multi-project lifecycle: create, get, update, delete, list, open
- Tracks current active project via `currentProjectId`
- Reads/writes `storage/projects/{id}/project.json`
- Atomic write: write to temp file, then rename (prevents corruption)
- Contains full project state: media reference, pipeline config, clips, edit history
- `list()` returns `ProjectSummary[]` sorted by last updated

#### PipelineService
- Accepts pipeline params (projectId, mediaPath, mediaInfo, steps, metadata)
- Iterates steps in order, invoking each plugin's `execute(ctx)` method
- After each step, emits progress events via `SseService`
- Persists resulting clips into the project on completion

#### SseService
- Node.js `EventEmitter` wrapper
- Maintains a set of active SSE connections
- Broadcasts typed events: `pipeline:progress`, `pipeline:complete`, `pipeline:error`, `export:progress`, `export:complete`, `export:error`
- Heartbeat every 30s to keep connections alive

#### ExportService
- Builds an FFmpeg filter chain from non-removed time ranges
- Uses `fluent-ffmpeg` to concatenate segments and render output file
- Supports video (re-encode with libx264/aac) export
- Generates SRT (with adjusted timecodes) and plain TXT transcripts
- Reports progress via SSE during FFmpeg processing

#### SettingsService
- Persists app-wide settings to `storage/settings.json`
- Manages known settings: API keys, Whisper config, Groq key, silence markers
- Redacts secret values (API keys) in responses — only shows last 4 chars
- Merge-based updates: empty string removes a key

### 2.3 API Endpoints

| Method | Endpoint | Service | Description |
|--------|----------|---------|-------------|
| POST | `/api/media` | media.routes | Upload media file (multipart/form-data) |
| GET | `/api/media/:id/info` | media.routes | Return media metadata JSON |
| GET | `/api/media/:id/stream` | media.routes | Stream media with range-request support |
| GET | `/api/project` | ProjectService | Get current project state |
| PUT | `/api/project` | ProjectService | Update current project state |
| GET | `/api/projects` | ProjectService | List all projects as ProjectSummary[] |
| POST | `/api/projects/:id/open` | ProjectService | Set project as current and return it |
| DELETE | `/api/projects/:id` | ProjectService | Delete a project and its data |
| GET | `/api/plugins` | PluginRegistry | List available plugins with config schemas (settings pre-filled) |
| POST | `/api/plugins/pipeline/run` | PipelineService | Execute plugin pipeline |
| GET | `/api/clips` | ClipService | List all clips with segments and words |
| GET | `/api/clips/:id` | ClipService | Get single clip detail |
| GET | `/api/clips/:id/stream` | media.routes | Stream clip media range |
| PUT | `/api/clips/:id/words` | ClipService | Update word isRemoved states |
| POST | `/api/export` | ExportService | Start export job |
| GET | `/api/export/:id/status` | ExportService | Check export progress |
| GET | `/api/export/:id/download` | ExportService | Download exported file |
| GET | `/api/settings` | SettingsService | Get app settings (secrets redacted) |
| PUT | `/api/settings` | SettingsService | Update app settings |
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
  metadata: Record<string, unknown>;       // Arbitrary metadata; plugin configs merged by ID key
}
```

### 3.3 Plugin Registry

- Plugins are manually registered in `plugin-registry.ts` constructor
- Currently registered: `srt-import`, `whisper-openai`, `groq-whisper`
- Registry exposes:
  - `getAll(): IPlugin[]` — list all registered plugins
  - `getById(id: string): IPlugin` — get a specific plugin
- `GET /api/plugins` returns plugin metadata with `settingsMap` used to pre-fill config defaults from app settings

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
  mediaInfo: MediaInfo | null;
  clips: Clip[];
  pipelineConfig: PipelineStep[];
  editHistory: EditAction[];               // Undo/redo stack
  createdAt: string;                       // ISO 8601
  updatedAt: string;                       // ISO 8601
}

interface ProjectSummary {
  id: string;
  name: string;
  mediaPath: string;
  mediaType: 'video' | 'audio';
  mediaInfo: MediaInfo | null;
  pipelineConfig: PipelineStep[];
  createdAt: string;
  updatedAt: string;
  clipCount: number;
  segmentCount: number;
  wordCount: number;
  hasTranscription: boolean;
  transcriptionPlugin: string | null;
}

interface MediaInfo {
  duration: number;                        // Seconds
  format: string;                          // e.g. "mp4"
  codec: string;
  videoCodec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
}

interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;                       // Seconds (float)
  endTime: number;
  segments: Segment[];
  showSilenceMarkers?: boolean;            // Toggle inter-segment silence pills
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
  config: Record<string, unknown>;
  order: number;
}

interface PluginMeta {
  id: string;
  name: string;
  description: string;
  type: PluginType;
  configSchema: Record<string, unknown>;   // JSON Schema for config options
  hasUI: boolean;
  settingsMap?: Record<string, string>;    // Maps config props to app setting keys for auto-fill
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
│   ├── index.html
│   ├── styles.scss                        # Global styles
│   ├── app/
│   │   ├── app.ts                         # Root component
│   │   ├── app.html                       # Root template
│   │   ├── app.scss                       # Root styles
│   │   ├── app.routes.ts                  # '/' → Onboarding, '/studio' → Studio
│   │   ├── app.config.ts                  # Providers: router, httpClient, error interceptor
│   │   ├── core/
│   │   │   ├── interceptors/
│   │   │   │   └── http-error.interceptor.ts  # Global HTTP error handler → NotificationService
│   │   │   ├── services/
│   │   │   │   ├── api.service.ts             # HttpClient wrapper with error handling
│   │   │   │   ├── project.service.ts         # Project state (signal), multi-project: load, list, open, delete
│   │   │   │   ├── clip.service.ts            # Clips signal, loadAll, updateWordStates
│   │   │   │   ├── plugin.service.ts          # Plugin list, pipeline execution
│   │   │   │   ├── sse.service.ts             # EventSource wrapper, typed signal-based events
│   │   │   │   ├── notification.service.ts    # Toast notification system (signal-based message queue)
│   │   │   │   └── settings.service.ts        # App settings CRUD (API keys, whisper config)
│   │   │   └── models/
│   │   │       ├── clip.model.ts              # Clip interface (with showSilenceMarkers)
│   │   │       ├── segment.model.ts           # Segment with tags
│   │   │       ├── word.model.ts              # Word with isRemoved
│   │   │       ├── plugin.model.ts            # PluginMeta, PluginType, PipelineStep
│   │   │       └── project.model.ts           # Project, ProjectSummary, MediaInfo, EditAction
│   │   ├── features/
│   │   │   ├── onboarding/
│   │   │   │   ├── onboarding.component.ts    # Dual-mode: project home grid + 3-step wizard
│   │   │   │   └── onboarding.component.html  # External template
│   │   │   └── studio/
│   │   │       ├── studio.component.ts        # Layout: clip-panel + player-panel + export-aside
│   │   │       ├── clip-list/
│   │   │       │   └── clip-list.component.ts # Sidebar clip list
│   │   │       ├── export-panel/
│   │   │       │   └── export-panel.component.ts  # Format selection, export trigger, polling
│   │   │       ├── txt-media-player/
│   │   │       │   ├── media-player.service.ts    # Shared signal-based media element state
│   │   │       │   ├── edit-history.service.ts    # Undo/redo stacks with WordEditChange
│   │   │       │   └── keyboard-shortcuts.service.ts  # Global keyboard handler factory
│   │   │       └── txt-media-player-v2/
│   │   │           ├── txt-media-player-v2.component.ts   # Main player + transcript editor (V2)
│   │   │           └── txt-media-player-v2.component.scss # All V2 styles
│   │   └── shared/
│   │       └── components/                # Shared UI components
│   └── public/                            # Static assets
├── angular.json
├── proxy.conf.json                        # Dev proxy: /api/* → Express :3000
├── package.json
└── tsconfig.json
```

### 5.2 State Management

Angular signals (no external state library):

| Service | Signals | Purpose |
|---------|---------|---------|
| `ProjectService` | `project` | Current project state |
| `ClipService` | `clips` | Clip data |
| `PluginService` | `plugins` | Available plugin metadata |
| `MediaPlayerService` | `currentTime`, `isPlaying`, `duration`, `playbackRate`, `volume` | Shared media element state |
| `SseService` | `lastEvent` | Latest SSE event |
| `NotificationService` | `messages` | Active toast messages |
| `EditHistoryService` | (private stacks) | Undo/redo word edit history |

**Player V2 Local Signals** (in `TxtMediaPlayerV2Component`):
- `autoFollow`, `jumpCutMode`, `showOverlay`, `searchQuery`, `selectedWordIds`, `selectionAnchorWordId`, `transcriptScrollTop`, `transcriptViewportHeight`, `editVersion`

**Player V2 Key Computeds**:
- `progress`, `currentWord` (gap-bridging), `highlightedWordId`, `activeSegmentId`, `removedCount`, `selectedCount`, `totalWordCount`, `searchMatchIds`, `tagColorMap`, `trackItems`, `segmentViewItems`, `renderedItems` (virtual scrolling), `shouldVirtualize` (≥1200 words)

### 5.3 Communication

- **HTTP**: Angular `HttpClient` with global error interceptor → `NotificationService` for toast errors
- **SSE**: Native `EventSource` wrapped in `SseService`, events exposed as a signal (`lastEvent`)
- **Proxy**: Angular dev server proxies `/api/*` to the Express backend (configured in `proxy.conf.json`)

---

## 6. Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| JSON file storage (no DB) | Single-user app; simplest persistence; can migrate to SQLite later |
| SSE over WebSocket | One-way progress events only; SSE is simpler and auto-reconnects |
| Angular signals (no NgRx) | App state is modest; signals + services are sufficient |
| FFmpeg for export | Industry-standard for reliable media concatenation |
| Plugin configSchema as JSON Schema | Well-tooled standard; enables dynamic form generation |
| Plugin settingsMap for auto-fill | Config defaults pre-populated from app settings without client changes |
| Flat string tags on segments | Maximum flexibility with no schema overhead |
| Monorepo (server/ + client/) | Simple structure; no monorepo tooling overhead |
| Models duplicated (not shared package) | Loose coupling; avoids shared build complexity |
| Singleton service instances on server | Simple pattern; no DI framework needed |
| Material Symbols Outlined (not Lucide) | Consistent icon system used throughout frontend |
| Virtual scrolling threshold: 1200 words | Balances DOM performance with smooth experience for shorter transcripts |
| Gap-bridging word highlight | Binary search + gap proximity snapping prevents highlight blinking |
| FlowItems pattern in transcript | Words, timestamps, and silence chips interleaved inline for natural flow |
| Design system: "Editorial Timeline" | Premium dark editorial aesthetic per stitch/DESIGN.md |

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
| `tsx` | TypeScript execution (dev) |

### Frontend

| Package | Purpose |
|---------|---------|
| `@angular/core` (v20+) | Framework (standalone components default) |
| `@angular/router` | Routing |
| `@angular/forms` | Reactive forms (plugin config) |
| `@angular/cdk` | Virtual scrolling, drag-and-drop |

### System

| Tool | Purpose |
|------|---------|
| `ffmpeg` | Media processing, export rendering |
| `ffprobe` | Media metadata extraction |
| Node.js 20+ | Runtime |
