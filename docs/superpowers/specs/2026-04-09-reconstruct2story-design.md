# reconstruct2story Plugin — Design Spec

**Date:** 2026-04-09  
**Status:** Approved

---

## Overview

`reconstruct2story` is a `narrative`-type VTextStudio plugin that takes a completed transcription (one or more clips of segments) and restructures it into a life-story narrative told in the interviewee's voice. An LLM groups and reorders the original transcript segments into named life-event chapters. The user reviews the proposal, accepting or rejecting individual segments and renaming events, before committing the result as new clips.

---

## Architecture

The plugin follows a **two-phase, single-plugin** pattern:

1. **Analysis phase (`execute()`)** — runs during the pipeline. Calls the Microsoft Copilot Studio SDK with the full transcript. The LLM proposes story events (name + ordered segment IDs). The proposal is saved to project metadata under `reconstruct2story:proposal`. The pipeline completes normally.

2. **Review & commit phase (self-registered routes)** — the plugin registers its own Express routes at server startup via the `registerRoutes(app)` hook. The Angular Studio detects a pending proposal and presents the review UI. The user approves/rejects segments and confirms or discards.

```
Pipeline run
  [transcription plugin] → [reconstruct2story.execute()]
                                    │
                          Copilot Studio SDK call
                          (full transcript as structured text)
                                    │
                          LLM returns: events + segment IDs
                                    │
                          Saved to project metadata
                          key: "reconstruct2story:proposal"
                                    │
                          pipeline:complete SSE fired

Self-registered routes (called once at server startup)
  GET    /plugins/reconstruct2story/proposal/:projectId
  POST   /plugins/reconstruct2story/commit/:projectId
  DELETE /plugins/reconstruct2story/proposal/:projectId

Angular Studio
  Detects proposal in metadata → shows banner
  User opens Story Review panel (side drawer)
  Accepts/rejects segments, edits event titles
  Commit → POST commit → clips replaced
  Discard → DELETE proposal → original clips preserved
```

---

## Data Shapes

### StoryProposal (stored in project metadata)

```ts
interface StoryProposal {
  projectId: string;
  sourceClipIds: string[];     // transcription clip IDs consumed by this proposal
  events: StoryEvent[];
}

interface StoryEvent {
  id: string;                  // uuid, stable across user edits
  title: string;               // LLM-proposed, user-editable inline
  segments: StorySegmentRef[];
}

interface StorySegmentRef {
  segmentId: string;           // references original segment by ID
  clipId: string;              // which source clip it came from
  accepted: boolean;           // default true; user can toggle to false
}
```

### LLM Prompt Contract

The plugin sends the transcript as structured plain text: one line per segment, formatted as `[SEGMENT_ID] segment text`, in chronological order. The LLM returns a JSON array:

```json
[
  {
    "title": "Family",
    "segments": ["seg-uuid-1", "seg-uuid-4", "seg-uuid-2"]
  },
  {
    "title": "School Years",
    "segments": ["seg-uuid-7", "seg-uuid-9"]
  }
]
```

The plugin validates the response: any segment ID not present in the source clips is silently discarded.

### Commit Output

On `POST /commit`, the server:
1. Reads the approved `StoryProposal` from project metadata
2. For each event: creates one `Clip` (only accepted segments, in the LLM-proposed order)
3. Copies full `Segment` objects verbatim (text, words, timing) from the source clips
4. Writes the new story-event clips to the project
5. Removes the source transcription clips (`sourceClipIds`)
6. Deletes `reconstruct2story:proposal` from project metadata

---

## Plugin Config Schema

```ts
{
  copilotEndpoint: string;      // Copilot Studio bot endpoint URL
  seedCategories?: string;      // optional comma-separated hints, e.g. "family, school, army"
  language?: string;            // narrative language; default: auto-detect from transcript
  maxEvents?: number;           // cap on LLM-proposed events; default: 10
  storyClipPrefix?: string;     // prefix for generated clip names; default: "Story"
}
```

---

## IPlugin Interface Extension

A new optional hook is added to `IPlugin`:

```ts
export interface IPlugin extends PluginMeta {
  execute(input: PipelineContext): Promise<PipelineContext>;
  registerRoutes?(app: Express): void;   // called once at server startup
}
```

The plugin registry calls `registerRoutes` for every plugin that defines it. This requires passing the Express `app` instance into the registry at startup (small change to `main.ts` and `PluginRegistry` constructor).

---

## Server-Side Routes

Registered by the plugin itself via `registerRoutes(app)`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/plugins/reconstruct2story/proposal/:projectId` | Returns the draft `StoryProposal` from project metadata |
| `POST` | `/plugins/reconstruct2story/commit/:projectId` | Body: `{ events: StoryEvent[] }`. Commits approved events as clips. |
| `DELETE` | `/plugins/reconstruct2story/proposal/:projectId` | Discards the proposal; project clips unchanged. |

---

## Angular Review UI

**Component:** `StoryReviewPanelComponent` (standalone, `OnPush`)

**Location:** Rendered inside the Studio component. The Studio checks project metadata for `reconstruct2story:proposal` on load. If found, a dismissible banner is shown.

**Panel layout (side drawer):**

```
┌─────────────────────────────────────────┐
│ Story Review                        [×] │
├─────────────────────────────────────────┤
│ ▼ Family                        [edit]  │
│   ✓ "My mother came from a small..."    │
│   ✓ "We had five siblings and..."       │
│   ✗ "The harvest that year was..."      │
│                                         │
│ ▼ School Years                  [edit]  │
│   ✓ "I started school at age seven..."  │
│   ✓ "Our teacher was very strict..."    │
│                                         │
│ ──────────────────────────────────────  │
│  [Discard Story]        [Commit Story]  │
└─────────────────────────────────────────┘
```

**Interactions:**
- Event sections are collapsible
- Event titles are inline-editable
- Each segment row shows truncated text with an accept/reject toggle (accepted by default)
- Rejected segments appear struck through
- **Commit** → `POST /plugins/reconstruct2story/commit/:projectId` → panel closes, project clips reload
- **Discard** → `DELETE /plugins/reconstruct2story/proposal/:projectId` → panel closes, project unchanged

---

## Files to Create / Modify

### Server
- `server/src/plugins/narrative/reconstruct2story.plugin.ts` — plugin implementation
- `server/src/plugins/plugin.interface.ts` — add optional `registerRoutes?(app: Express): void`
- `server/src/plugins/plugin-registry.ts` — accept `app` in constructor, call `registerRoutes`
- `server/src/main.ts` — pass `app` to plugin registry

### Client
- `client/src/app/core/models/plugin.model.ts` — add `'narrative'` is already there; no change needed
- `client/src/app/features/studio/story-review-panel/story-review-panel.component.ts` — review UI
- `client/src/app/features/studio/studio.component.ts` — detect proposal, show banner + panel

### Schema change
- `server/src/models/project.model.ts` — add `metadata?: Record<string, unknown>` to `Project` interface
- `client/src/app/core/models/project.model.ts` — mirror the same addition

---

## Constraints & Notes

- Segment text, words, and timing are **never modified** — the plugin is purely a structural reorganizer
- If the Copilot Studio SDK call fails, `execute()` throws; the pipeline error SSE is emitted and the project is unchanged
- The proposal is stored under `project.metadata['reconstruct2story:proposal']`; `metadata` must be added to the `Project` interface (optional field, defaults to `{}`)
- A project can only have one pending proposal at a time; running the plugin again overwrites the previous proposal
