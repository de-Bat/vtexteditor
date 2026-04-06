# VTextStudio — Software Requirements

## 1. Overview

VTextStudio is a text-based media editor web application. Users upload video or audio, run a chainable plugin pipeline (transcription, diarization, silence detection, narrative restructuring, translation), and edit the result by selecting/removing words from the transcript — producing jump-cut playback and export.

**Tech Stack**: Node.js + Express (TypeScript) backend, Angular 18 frontend.  
**Deployment**: Single-user, local machine.

---

## 2. Functional Requirements

### FR-1 Media Loading

| ID | Requirement |
|----|-------------|
| FR-1.1 | Upload video (MP4, WebM, MKV) or audio (MP3, WAV, FLAC, OGG) via drag-and-drop or file picker |
| FR-1.2 | Store uploaded files on the local server filesystem under `storage/uploads/` |
| FR-1.3 | Extract and display media metadata: duration, format, resolution/bitrate, codec (via ffprobe) |
| FR-1.4 | Validate file type and reject unsupported formats with a clear error message |

### FR-2 Plugin Pipeline

| ID | Requirement |
|----|-------------|
| FR-2.1 | Provide an extensible plugin architecture with a defined `IPlugin` interface contract |
| FR-2.2 | Plugins are chainable — output of one feeds into the next via a shared `PipelineContext` |
| FR-2.3 | Plugins can run server-side or client-side |
| FR-2.4 | Plugins may expose optional UI panels (Angular components loaded dynamically) |
| FR-2.5 | Each plugin declares a JSON Schema `configSchema` for its configuration options |
| FR-2.6 | Pipeline execution reports progress to the frontend via SSE (Server-Sent Events) |
| FR-2.7 | The user can add, remove, and reorder plugins before execution |

**Built-in Plugins (v1):**

| Plugin | Type | Description |
|--------|------|-------------|
| Whisper Transcription | transcription | Local Whisper server — produces segments and words with timestamps |
| Groq Transcription | transcription | Groq cloud API — produces segments and words with timestamps |
| SRT Import | transcription | Parse `.srt` file into segments with estimated word-level timestamps |
| Speaker Diarization | diarization | Label segments by speaker identity |
| Silence Detection | detection | Detect silent gaps via FFmpeg; optionally split clips at silences |
| Narrative Restructuring | narrative | Reorder segments (e.g., interview → story narrative) |
| Translation | translation | Translate segment text to another language |

### FR-3 Clip Management

| ID | Requirement |
|----|-------------|
| FR-3.1 | The plugin pipeline produces one or more clips from the source media |
| FR-3.2 | Each **Clip** has: `id`, `name`, `startTime`, `endTime`, `segments[]` |
| FR-3.3 | Each **Segment** has: `id`, `clipId`, `startTime`, `endTime`, `text`, `words[]`, `tags[]` (flat strings, e.g., `"speaker:Alice"`) |
| FR-3.4 | Each **Word** has: `id`, `segmentId`, `text`, `startTime`, `endTime`, `isRemoved` flag |
| FR-3.5 | REST API: list all clips with full segment/word data |
| FR-3.6 | REST API: stream a single clip's media (HTTP range-request support) |

### FR-4 txtMediaPlayer

| ID | Requirement |
|----|-------------|
| FR-4.1 | HTML5 video/audio player with custom playback controls (play/pause, seek, volume, speed 0.5×–2×) |
| FR-4.2 | Transcript panel: text grouped by segment, each segment visually distinct (color, label, border) |
| FR-4.3 | Segment-level timeline: horizontal bar with proportional-width blocks per segment |
| FR-4.4 | During playback, highlight the currently playing word in the transcript |
| FR-4.5 | Clicking a word repositions the playhead to that word's `startTime` |
| FR-4.6 | Select one or more words (Shift+click range or native text selection) to mark as removed |
| FR-4.7 | Removed words display with strikethrough + dimmed style and are skipped during playback (jump cut) |
| FR-4.8 | Removed words can be restored (click to restore, or select + "Restore" action) |
| FR-4.9 | Undo/redo support for word removal edits (Ctrl+Z / Ctrl+Shift+Z) |
| FR-4.10 | Transcript auto-scrolls to keep the active word visible during playback |

### FR-5 Export

| ID | Requirement |
|----|-------------|
| FR-5.1 | Export edited media: FFmpeg renders a new file with removed sections cut out (jump cuts) |
| FR-5.2 | Export SRT transcript with timecodes adjusted for removed sections |
| FR-5.3 | Export plain TXT transcript (removed words excluded) |
| FR-5.4 | Export progress reported via SSE |
| FR-5.5 | Exported files available for download via the API |

### FR-6 Project Management

| ID | Requirement |
|----|-------------|
| FR-6.1 | Single project at a time |
| FR-6.2 | Project state persisted as JSON on server filesystem (`storage/projects/{id}/project.json`) |
| FR-6.3 | Project stores: media reference, pipeline config, all clips with segments/words, edit history |
| FR-6.4 | Undo/redo edit history persisted with the project on save |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | **Backend**: Node.js + Express, TypeScript |
| NFR-2 | **Frontend**: Angular 18, standalone components, signals-based state management |
| NFR-3 | **Storage**: Local filesystem only (no database, no cloud storage) |
| NFR-4 | **Dependencies**: FFmpeg and ffprobe must be available on the host machine |
| NFR-5 | **Responsive**: Minimum supported viewport width is 1024px |
| NFR-6 | **Real-time**: SSE for one-way server→client progress events (pipeline, export) |
| NFR-7 | **Authentication**: None — single-user, local app |
| NFR-8 | **Performance**: Handle media files up to 2 hours; virtual scrolling for transcripts exceeding 1000 words |
| NFR-9 | **Browser Support**: Latest Chrome and Firefox |

---

## 4. Constraints & Assumptions

- FFmpeg is pre-installed on the host machine.
- Word-level timestamps are required from all transcription plugins. If a source (e.g., SRT) does not provide word-level timing, the plugin must estimate word times from segment timing.
- The app does not re-encode video for preview — jump-cut playback is achieved by programmatically skipping `currentTime` in the HTML5 player.
- Export is the only operation that invokes FFmpeg to produce a new media file.
