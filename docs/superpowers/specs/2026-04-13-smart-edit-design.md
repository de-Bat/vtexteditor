# Smart Edit — Design Spec

**Date:** 2026-04-13
**Status:** Draft

## Overview

Smart Edit is an export wizard that lets users stitch approved clips into a single video file with configurable transitions between them. It handles both single-clip exports (with intra-clip cut regions) and multi-clip assembly (from narrative reconstruction or manual selection).

The wizard presents a compact summary list of clips with transition controls between each pair. Transitions are ephemeral — configured at export time, not persisted to the project model.

## Data Model

Two new types. No changes to existing models.

### `TransitionEffect`

```typescript
type TransitionEffect = 'hard-cut' | 'fade-to-black' | 'fade-to-white' | 'cross-dissolve' | 'dip-to-color';
```

### `ClipTransition`

```typescript
interface ClipTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  effect: TransitionEffect;
  durationMs: number;  // total fade-out + fade-in time
  pauseMs: number;     // hold time on mid-state (e.g., seconds of black between fades)
  color?: string;      // hex color, only for 'dip-to-color'
}
```

- `durationMs` covers the fade-out and fade-in combined, split evenly (half for fade-out, half for fade-in). `pauseMs` is the hold on the mid-state (e.g., how long to stay on black). Together they control transition speed and breathing room.
- `ClipTransition` is separate from `CutRegion`. CutRegions handle intra-clip word removal gaps; ClipTransitions handle inter-clip boundaries.

### `SmartEditSession`

```typescript
interface SmartEditSession {
  projectId: string;
  clipIds: string[];           // ordered list of clips to stitch
  transitions: ClipTransition[]; // length = clipIds.length - 1
}
```

Ephemeral — lives in component signal state on the client, passed to the export API. No project schema changes.

## Export API Changes

The existing `POST /api/export` endpoint gains an optional `transitions` field.

### Request body

```typescript
{
  projectId: string;
  format: ExportFormat;
  clipIds?: string[];
  transitions?: ClipTransition[];  // omitted = existing behavior
}
```

### Server-side behavior

- `exportVideo()` gains a `transitions` parameter.
- After building kept segments per clip (existing logic), a new step inserts transition filter segments between clips.
- Text and SRT exports ignore transitions entirely.

### Effect mapping to FFmpeg filters

| Effect | FFmpeg approach |
|--------|----------------|
| `hard-cut` | No filter. Clips concat directly. |
| `fade-to-black` | `fade=t=out` on outgoing clip, `color=c=black` pad source for pause, `fade=t=in` on incoming clip. Audio gets `anullsrc` pad for pause duration. |
| `fade-to-white` | Same as fade-to-black with `color=c=white`. |
| `cross-dissolve` | `xfade=transition=fade` between outgoing and incoming clip streams. `acrossfade` for audio. No pause support (dissolve is continuous). |
| `dip-to-color` | Same pattern as fade-to-black with user-specified hex color. |

## FFmpeg Filter Chain Generation

New method `buildTransitionFilters()` in `ExportService`, alongside existing `buildKeptSegmentsWithEffects()`.

### Strategy

Each clip's internal segments are concatenated first using existing intra-clip CutRegion effect logic. This produces one video+audio stream per clip. Then inter-clip transitions are applied between those streams.

```
Step 1: Per-clip internal concat (existing logic)
  Clip A segments -> [clipA_v][clipA_a]
  Clip B segments -> [clipB_v][clipB_a]

Step 2: Inter-clip transitions (new logic)

  hard-cut:
    Streams pass through to final concat.

  fade-to-black / fade-to-white / dip-to-color:
    [clipA_v] -> fade=t=out:st={end-halfDur}:d={halfDur} -> [clipA_faded]
    color=c={color}:s={resolution}:d={pauseSec} -> [pad_v]
    anullsrc=r={sampleRate}:cl=stereo, atrim=0:{pauseSec} -> [pad_a]
    [clipB_v] -> fade=t=in:st=0:d={halfDur} -> [clipB_faded]
    Concat: [clipA_faded][clipA_a] [pad_v][pad_a] [clipB_faded][clipB_a]

  cross-dissolve:
    [clipA_v][clipB_v] xfade=transition=fade:duration={dur}:offset={clipA_dur-dur} -> [xf_v]
    [clipA_a][clipB_a] acrossfade=d={dur}:c1=tri:c2=tri -> [xf_a]

Step 3: Final concat
  All streams concatenated in order -> [vout][aout]
```

Resolution and sample rate are read from the source media's `MediaInfo` so `color` pad sources match input dimensions.

### Edge cases

- **Single clip, no transitions:** Falls back to existing export behavior entirely.
- **`pauseMs = 0` on fade effects:** No color pad inserted, just fade-out + fade-in.
- **`cross-dissolve` between clips from same source:** No resolution mismatch (all clips share source media).

## Client-Side: Smart Edit Wizard Component

### Entry point

A "Smart Edit" button in the studio toolbar, visible when:
- A single clip has removed words (cut regions exist), OR
- Multiple clips are selected/approved

### Component: `SmartEditDialogComponent`

Standalone Angular component, `ChangeDetectionStrategy.OnPush`, opened via Angular CDK Dialog.

### Layout

```
+--------------------------------------------------+
|  Smart Edit                               [Close] |
+--------------------------------------------------+
|                                                    |
|  Clip A: "Interview Part 1"  (00:00 - 02:34)     |
|  --- Transition --------------------------------- |
|  |  Effect: [fade-to-black v]                     |
|  |  Fade duration: [1500] ms                      |
|  |  Pause on black: [2000] ms                     |
|  ------------------------------------------------ |
|  Clip B: "Interview Part 2"  (02:34 - 05:12)     |
|  --- Transition --------------------------------- |
|  |  Effect: [cross-dissolve v]                    |
|  |  Fade duration: [1000] ms                      |
|  ------------------------------------------------ |
|  Clip C: "Closing"           (05:12 - 06:45)     |
|                                                    |
+--------------------------------------------------+
|  Total estimated duration: 06:49                   |
|                      [Cancel]  [Export Video]      |
+--------------------------------------------------+
```

### Behavior

- Each clip row shows name and active duration (excluding removed words).
- Transition row between each pair: effect dropdown, duration input, pause input.
- Pause input hidden for `cross-dissolve` (dissolve is continuous).
- Color picker shown only for `dip-to-color`.
- All transitions default to `hard-cut` / `0ms` / `0ms`.
- "Total estimated duration" computed as: sum of clip active durations + all transition durations and pauses.
- "Export Video" triggers the existing export flow with `transitions` attached.
- Progress shown inline (replaces button row with progress bar + percentage via SSE `export:progress`).
- On completion, shows download link (existing `GET /api/export/:id/download`).

### State management

- `SmartEditSession` held as signals: `clipIds`, `transitions`, `exporting`, `progress`, `exportJobId`.
- `estimatedDuration` as `computed()` from clip durations + transitions.

## Error Handling and Validation

### Client-side

- "Export Video" disabled if `clipIds` is empty or export is in progress.
- `durationMs` and `pauseMs` clamped to `[0, 10000]`.
- `color` validated as hex format when `dip-to-color` is selected.
- SSE `export:error` displayed inline replacing the progress bar.

### Server-side

- `transitions.length` must equal `clipIds.length - 1` — 400 otherwise.
- All `fromClipId`/`toClipId` must reference actual clips in the ordered list — 400 if mismatched.
- Unknown `effect` values rejected with 400.
- FFmpeg failures handled by existing error flow (sets `job.status = 'error'`, broadcasts via SSE).

## Scope

### In scope (v1)

- Smart Edit wizard dialog with summary list UI
- Five transition effects: hard-cut, fade-to-black, fade-to-white, cross-dissolve, dip-to-color
- Per-transition duration and pause configuration
- Video export only (text/SRT unaffected)
- Single-clip and multi-clip support
- Ephemeral session state

### Out of scope

- Transition preview/playback in the wizard
- Transition presets or templates
- AI-suggested transitions
- Persisting transitions to the project model
- Spatial transitions (split-screen wipe, slide, picture-in-picture)
- Audio-only transitions independent of video
- Clip reordering within the wizard
