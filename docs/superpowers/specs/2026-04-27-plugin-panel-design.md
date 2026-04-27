# Plugin Panel — Design Spec

**Date:** 2026-04-27  
**Status:** Approved

---

## Overview

Add a Plugin Panel to the Studio — a right sidebar that lets users build a plugin pipeline, run it, inspect per-step outputs, and activate any step's output as the project's working data (clips + segments + metadata). The existing Metadata button in the header is removed; a Plugins button takes its place.

---

## Header Changes

- **Remove** the Metadata button (`showMetadataPanel` signal and all references in `studio.component.ts`).
- **Add** a Plugins button using the existing `export-toggle-btn` CSS class. Icon: puzzle-piece SVG. Toggles `showPluginsPanel` signal.
- Button order in `studio-nav`: New Project ← | Plugins | Export

---

## Layout

The plugin panel is a right sidebar, structurally identical to the export panel:

- Uses the existing `side-panel-wrapper export-wrapper` pattern (or a parallel `plugins-wrapper` class).
- Collapsed width: 0 (hidden). Expanded width: **400px** (pipeline only) or **750px** (pipeline + output viewer when a node is selected).
- Width is driven by a new `pluginsPanelWidth` signal in `StudioComponent`, animated via the existing CSS transition.
- A resizer handle appears between the player and plugin panel when open (reuses `resizer` + `startResizing` pattern).
- When both export and plugin panels are open simultaneously, they stack on the right; each has its own resizer.

---

## Plugin Panel Component

**File:** `client/src/app/features/studio/plugin-panel/plugin-panel.component.ts`

**Inputs:**
- `projectId: string` (required)
- `activeClipId: string | null`

**Outputs:**
- `close: void`

### Internal layout — two columns

```
┌──────────────────────────────────────────────────┐
│ [Pipeline column ~240px] │ [Output column ~510px] │
│                           │  (only when selected) │
└──────────────────────────────────────────────────┘
```

---

## Pipeline Column

### Plugin inventory
Available plugins fetched via `PluginService.loadAll()` on init. Displayed as chips at the top:  
`+ Whisper` `+ Diarize` `+ Translate` — clicking appends a new step to the pipeline.

### Step nodes (vertical diagram)
- Angular CDK `DragDropModule` (`cdkDropList` / `cdkDrag`) for DnD reordering.
- Each node renders:
  - Drag handle (`⠿`)
  - Step number circle (updates on reorder)
  - Plugin name
  - Status badge: `idle | running | done | error`
  - Gear icon → inline config expand (renders config fields using the same approach as `PluginOptionsComponent` — JSON Schema → form fields)
  - Remove button (×)
- Nodes connected by arrow lines (CSS `::after` pseudo-element).

### Run controls
- **▶ Run Pipeline** button at bottom of pipeline column.
- Calls `PluginService.runPipeline(projectId, steps)` → stores returned `jobId`.
- SSE events drive status:
  - `pipeline:progress` → updates active step badge + progress bar
  - `pipeline:complete` → fetches outputs via `PluginService.getOutputs(jobId)`, marks all steps done
  - `pipeline:error` → marks active step as error, shows message

### Progress bar
Thin bar beneath the Run button, visible only during a run. Maps SSE progress % to width.

---

## Output Column

Opens when user clicks a step node that has completed output. Closes via (×) or clicking the same node again.

### Header
Plugin name · run timestamp · total word count

### Tabs: Clips | Segments | Metadata

**Clips tab**  
List of clips from that step's output. Per clip: name, segment count, word count, first-line text preview (truncated).

**Segments tab**  
Scrollable list. Per segment: timestamp range (`00:00 – 00:14`), full text.

**Metadata tab**  
Key-value pairs from the plugin's output metadata. Rendered as a simple two-column table.

### Action buttons (footer)

**Save to Notebook**  
Posts this step's output to the notebook API (`POST /api/notebooks` with `{ jobId, stepIndex, label }`). The notebook panel (separate feature) handles management. This button just triggers the save and shows a toast on success.

**⚡ Use as Working Data**  
1. Auto-saves current project state to a notebook first (`POST /api/notebooks` with `{ projectId, label: 'Auto-save before activate', source: 'working-data' }`).  
2. Calls `PluginService.activateOutput(projectId, jobId, stepIndex)` → `POST /api/plugins/pipeline/activate`.  
3. On success: triggers `ClipService.loadAll()` to refresh the player with the new data, closes output column, emits a toast notification.  
4. On error: shows error message, does not close.

---

## New PluginService Methods

```typescript
// Fetch per-step outputs after pipeline completes
getOutputs(jobId: string): Observable<PipelineOutput>

// Replace project working data with a step's output
activateOutput(projectId: string, jobId: string, stepIndex: number): Observable<void>
```

**`PipelineOutput` model (new):**
```typescript
interface PluginStepOutput {
  stepIndex: number;
  pluginId: string;
  clips: Clip[];
  metadata: Record<string, unknown>;
  completedAt: string; // ISO timestamp
  wordCount: number;
}

interface PipelineOutput {
  jobId: string;
  steps: PluginStepOutput[];
}
```

---

## StudioComponent Changes

- Add `showPluginsPanel = signal(false)`.
- Add `pluginsPanelWidth = signal(400)`.
- Add `selectedPluginStep = signal<number | null>(null)` — drives whether output column is visible (width 750 vs 400).
- Extend `startResizing` / `onMouseMove` to handle a third resizer for the plugin panel.
- Import and declare `PluginPanelComponent`.
- Wire the Plugins button and panel in the template (same pattern as export panel).
- Remove Metadata button and `showMetadataPanel` signal. Remove `[metadataPanelOpen]` and `(metadataPanelToggle)` bindings from `TxtMediaPlayerV2Component`.

---

## Out of Scope

- Notebook panel UI (separate feature).
- `POST /api/plugins/pipeline/activate` backend implementation (assumed parallel work or pre-existing).
- `POST /api/notebooks` backend implementation (assumed parallel work).
- Multi-select of steps for batch output comparison.
- Real-time streaming of plugin output text during a run.
