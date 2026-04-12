# Segment Metadata Design

**Date:** 2026-04-12
**Status:** Draft

## Overview

Support attaching structured metadata to segments in a clip. Plugins produce metadata during pipeline execution; users can edit plugin-generated metadata and delete entries via a toggleable side panel in the studio UI.

Existing `tags: string[]` on segments remain as-is — metadata is a parallel system for richer, typed, plugin-driven data.

## Goals

- Plugins can attach typed metadata (speaker, geo, time range, language) to segments during pipeline execution
- Plugins declare what metadata types they produce via `PluginMeta.produces`
- Users can edit and delete plugin-generated metadata entries in the studio
- A collapsible side panel in the transcript view shows metadata for the selected segment
- Custom key-value metadata for anything not covered by built-in types

## Non-Goals

- Replacing or migrating the existing `tags` system
- Full-text search across metadata
- Metadata-based segment filtering or sorting (future work)
- Metadata versioning or history tracking

---

## Data Model

### Base Entry

```typescript
interface SegmentMetadataEntry {
  type: string;              // discriminator: 'speaker' | 'geo' | 'timeRange' | 'language' | 'custom'
  sourcePluginId: string;    // producing plugin ID, or 'user' for manual entries
  confidence?: number;       // 0–1, optional
}
```

### Built-in Types

```typescript
interface SpeakerMetadata extends SegmentMetadataEntry {
  type: 'speaker';
  name: string;
  label?: string;            // e.g. "Speaker A" before identification
}

interface GeoMetadata extends SegmentMetadataEntry {
  type: 'geo';
  lat: number;
  lng: number;
  placeName?: string;
}

interface TimeRangeMetadata extends SegmentMetadataEntry {
  type: 'timeRange';
  from: number;              // seconds
  to: number;
  label?: string;            // e.g. "Chapter 1"
}

interface LanguageMetadata extends SegmentMetadataEntry {
  type: 'language';
  code: string;              // ISO 639-1
  name?: string;             // human-readable
}

interface CustomMetadata extends SegmentMetadataEntry {
  type: 'custom';
  key: string;
  value: string | number | boolean;
}
```

### Union Type

```typescript
type SegmentMetadata =
  | SpeakerMetadata
  | GeoMetadata
  | TimeRangeMetadata
  | LanguageMetadata
  | CustomMetadata;
```

### On the Segment Model

```typescript
interface Segment {
  id: string;
  clipId: string;
  startTime: number;
  endTime: number;
  text: string;
  words: Word[];
  tags: string[];
  metadata?: Record<string, SegmentMetadata[]>;  // keyed by sourcePluginId
}
```

The `metadata` map is keyed by `sourcePluginId`. Each plugin can produce multiple entries per segment. User edits/additions use the key `'user'`.

---

## Plugin Declaration

### MetadataProduction

```typescript
interface MetadataProduction {
  key: string;                // unique key, e.g. 'speaker', 'geo'
  type: 'speaker' | 'geo' | 'timeRange' | 'language' | 'custom';
  description?: string;       // e.g. "Identifies speakers via voice fingerprint"
}
```

### PluginMeta Extension

```typescript
interface PluginMeta {
  id: string;
  name: string;
  description: string;
  type: PluginType;
  configSchema: Record<string, unknown>;
  hasUI: boolean;
  settingsMap?: Record<string, string>;
  produces?: MetadataProduction[];       // NEW
}
```

### Pipeline Integration

Plugins write metadata directly to `segment.metadata` during `execute()`. No new API surface on `PipelineContext`.

**Re-run behavior:** When a pipeline re-runs, each plugin overwrites its own key in `segment.metadata` (keyed by `sourcePluginId`). User-added entries (`sourcePluginId: 'user'`) are preserved across re-runs since no plugin writes to that key.

```typescript
// Example: diarization plugin
async execute(context: PipelineContext): Promise<PipelineContext> {
  for (const clip of context.clips) {
    for (const segment of clip.segments) {
      const entries: SegmentMetadata[] = [
        { type: 'speaker', sourcePluginId: this.id, name: 'Alice', confidence: 0.92 },
        { type: 'language', sourcePluginId: this.id, code: 'en', name: 'English', confidence: 0.98 },
      ];
      segment.metadata = { ...segment.metadata, [this.id]: entries };
    }
  }
  return context;
}
```

---

## Studio UI

### Metadata Toggle Button

Added to the transcript header toolbar in `TxtMediaPlayerV2Component`, alongside Edit, Smart Cut, Timer:

```
[Search] [Edit] [Smart Cut] [Timer] [Metadata] | [Undo] [Redo]
```

Icon: `info` (Material Symbols). Active state matches existing button styling.

### Side Panel

When toggled open, a ~280px fixed-width panel appears to the right of the transcript. The transcript section narrows via flex layout.

**Panel structure:**

```
┌─────────────────────────┐
│ Segment Metadata    [x] │
│ Segment 3 - 01:23-01:45 │
├─────────────────────────┤
│ > Speaker               │  <- collapsible group by type
│   Name: Alice           │
│   Confidence: 92%       │
│   Source: diarize-v2    │
│   [Edit] [Delete]       │
├─────────────────────────┤
│ > Language              │
│   Code: en              │
│   Name: English         │
│   Source: diarize-v2    │
├─────────────────────────┤
│ > Custom: "mood"        │
│   Value: upbeat         │
│   Source: sentiment-ai  │
│   [Edit] [Delete]       │
├─────────────────────────┤
│ [+ Add Metadata]        │
└─────────────────────────┘
```

**Behavior:**

- Clicking a segment in the transcript or timeline populates the panel
- No segment selected: panel shows "Select a segment to view metadata"
- Entries are grouped by type, each collapsible
- Edit: inline editing of value fields; `sourcePluginId` preserved, "(edited)" indicator shown
- Delete: removes the entry
- Add: type dropdown (built-in types + custom) with dynamic fields

### Visual Indicator

When the metadata panel is open, segments that have metadata show a small colored dot at the start of the segment's first word in the transcript flow.

---

## Persistence & API

### Storage

Metadata is stored inline on the segment within the project JSON file, alongside `tags` and `words`. No separate storage.

```json
{
  "id": "seg-1",
  "metadata": {
    "diarize-v2": [
      { "type": "speaker", "sourcePluginId": "diarize-v2", "name": "Alice", "confidence": 0.92 },
      { "type": "language", "sourcePluginId": "diarize-v2", "code": "en", "name": "English" }
    ],
    "user": [
      { "type": "custom", "sourcePluginId": "user", "key": "review", "value": "needs cleanup" }
    ]
  }
}
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/api/projects/:projectId/clips/:clipId/segments/:segmentId/metadata` | Replace all metadata for a segment |
| `PATCH` | `/api/projects/:projectId/clips/:clipId/segments/:segmentId/metadata/:sourcePluginId` | Update entries from a specific source |

### Validation

- Built-in types are validated against their schemas (e.g., `geo` requires numeric `lat`/`lng`)
- `custom` entries require `key` (string) and `value` (string | number | boolean)
- Unknown `type` values return 400

---

## Component Architecture

### New Files

**Shared models (server + client):**
- `segment-metadata.model.ts` — all metadata interfaces, `MetadataProduction`, union type

**Client:**
- `segment-metadata-panel.component.ts` — side panel (toggle, segment selection, list of entries)
- `metadata-entry.component.ts` — single collapsible entry with type-specific rendering
- `metadata-add-form.component.ts` — "Add Metadata" inline form (type dropdown + dynamic fields)

**Server:**
- Extend clip controller with two new endpoints
- `segment-metadata.validator.ts` — validation utility for built-in types

### Integration Points

**`TxtMediaPlayerV2Component`:**
- New signal: `selectedSegmentId` — set on segment click in transcript or timeline
- New signal: `metadataPanelOpen` — toggled by the metadata button
- Hosts `<app-segment-metadata-panel>` conditionally
- CSS class on transcript section adjusts layout when panel is open

**`PluginMeta` / `IPlugin`:**
- `produces` field added — optional, no breaking changes

### Signal Flow

```
selectedSegmentId (signal)  -->  segment-metadata-panel [input]
metadataPanelOpen (signal)  -->  CSS class on transcript-section
segment.metadata            -->  panel reads from clip data
user edit/add/delete        -->  ClipService.updateSegmentMetadata() --> API
```

No new state management needed. Metadata lives on the segment model, the panel reads reactively, and mutations go through the existing clip service.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Metadata vs tags | Parallel systems | Tags are simple flat strings; metadata is structured and typed. No migration needed. |
| User editing | Edit, delete, and add | Users can correct plugin output (e.g., fix misidentified speaker), delete entries, and manually add new metadata entries via the panel. |
| Plugin declaration | `produces` on `PluginMeta` | Lightweight discoverability without full schema registry overhead. |
| Storage | Inline on segment | Simplest approach; no joins, no separate collections. Metadata travels with the segment. |
| UI pattern | Toggleable side panel | Keeps transcript clean; dedicated space for metadata detail. |
| Metadata key | `sourcePluginId` | Clear ownership per plugin. Multiple plugins can produce same types independently. |
