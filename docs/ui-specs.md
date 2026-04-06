# VTextStudio — UI Specifications

## 1. Views & Routing

| Route | View | Description |
|-------|------|-------------|
| `/` | Onboarding | Media upload, pipeline configuration, processing |
| `/studio` | Studio | Clip list, media player, transcript editing, export |

---

## 2. Onboarding View

Full-page centered layout. Step-by-step flow: upload → configure → process → navigate.

### Components

#### MediaUploader
- Large drop zone (centered, dashed border) accepting drag-and-drop or click-to-browse
- Accepted formats listed below the zone: MP4, WebM, MKV, MP3, WAV, FLAC, OGG
- Upload progress bar shown during file transfer
- Error state for rejected file types

#### FileInfoPanel
- Appears after successful upload
- Displays: filename, duration (formatted), format/codec, resolution (video) or bitrate (audio)
- Compact horizontal metadata strip

#### PipelineConfigurator
- Horizontal card layout with left-to-right flow arrows between steps
- Each card shows: plugin icon/name and type badge
- `[+]` button at the end to add a pipeline step (opens a dropdown of available plugins)
- Drag-to-reorder cards; click `×` to remove a step
- Fetches available plugins from `GET /api/plugins`

#### PluginOptionsPanel
- Appears below the pipeline when a step card is selected
- Dynamically generated form from the plugin's JSON Schema `configSchema`
- Supports: text inputs, dropdowns, number fields, toggles
- Section header shows the plugin name

#### ProcessingProgress
- Full-width progress bar below the pipeline section
- Shows: current step label (e.g., "Transcribing..."), step count (e.g., "1/3"), percentage
- Multi-step: bar fills proportionally across all pipeline steps
- Subscribes to `GET /api/events` (SSE)

#### ProcessButton
- Primary action button: `▶ Process`
- Disabled until media is uploaded and at least one pipeline step is configured
- Replaced by ProcessingProgress during execution

### Flow
1. User drops/selects media → MediaUploader uploads → FileInfoPanel appears
2. User configures pipeline → PipelineConfigurator + PluginOptionsPanel
3. User clicks Process → ProcessingProgress shows → on complete, auto-navigate to `/studio`

---

## 3. Studio View

Three-area layout: left sidebar + main content area + bottom transport bar.

### Layout

```
┌─────────────┬──────────────────────────────────────────┐
│  Sidebar    │  Main Content                            │
│  (240px)    │  ┌──────────────────────────────────────┐ │
│             │  │  Media Player                        │ │
│  ClipList   │  └──────────────────────────────────────┘ │
│             │  ┌──────────────────────────────────────┐ │
│             │  │  Transcript                          │ │
│             │  └──────────────────────────────────────┘ │
│             │  ┌──────────────────────────────────────┐ │
│             │  │  Segment Timeline                    │ │
│             │  └──────────────────────────────────────┘ │
├─────────────┴──────────────────────────────────────────┤
│  Transport Controls                                    │
└────────────────────────────────────────────────────────┘
```

### Components

#### ClipList (Sidebar)
- Scrollable vertical list
- Each item shows: clip name, time range (formatted), segment count
- Selected clip: highlighted row with blue left border accent
- Click to select → loads clip into TxtMediaPlayer
- Header: "CLIPS" label
- Footer: optional "← Back" link to return to Onboarding

#### TxtMediaPlayer (Main)
Container component that composes: MediaPlayer, TranscriptView, SegmentTimeline.

**MediaPlayer area:**
- HTML5 `<video>` or `<audio>` element (determined by media type)
- Source: `GET /api/clips/:id/stream` (or full media stream with time offset)
- No native controls — custom controls in transport bar

**TranscriptView area:**
- Segments rendered as visually distinct cards/blocks
- Each segment card has:
  - Header: segment tag labels (e.g., "Speaker A") with colored indicator
  - Body: words rendered as individual `<span>` elements, inline flow (wrapping)
- Word states:
  - **Normal**: default text style
  - **Active (playing)**: highlighted background (primary color at 20% opacity), bold text
  - **Hover**: subtle underline, pointer cursor
  - **Removed**: strikethrough, opacity 0.35, subtle red-tinted background
- Scroll container with auto-scroll to active word during playback

**SegmentTimeline area:**
- Horizontal bar spanning the clip duration
- Segments as proportional-width blocks, colored by primary tag value
- Playhead: vertical line indicator at current playback position
- Click anywhere on timeline → seek to that time position
- Segment hover: tooltip with segment info (text preview, duration, tag)

#### MediaControls (Transport Bar)
- Full-width bar at bottom of Studio view
- Elements (left to right):
  - Skip back button (◀◀)
  - Play/Pause toggle (▶ / ⏸)
  - Skip forward button (▶▶)
  - Seek bar (range slider with elapsed/total time labels)
  - Volume control (icon + slider)
  - Playback speed selector (0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×)

#### ExportPanel
- Triggered from toolbar "Export ▾" dropdown button
- Opens as a modal or slide-out drawer
- Options: format selection (Video/Audio, SRT, TXT), quality settings for media export
- Export progress bar (SSE-driven)
- Download button appears on completion

#### Word Selection & Removal Toolbar
- Floating toolbar appears above the text selection
- Appears when one or more words are selected (Shift+click range or native selection)
- Actions: "Remove" (for normal words), "Restore" (for removed words)
- Keyboard shortcut: Delete key to remove selected words

---

## 4. Interaction Patterns

### Word Highlighting (Playback Sync)
- On every `timeupdate` event from the HTML5 player
- Binary search through the current clip's words (sorted by startTime) to find the word where `startTime <= currentTime < endTime`
- Apply `.active` CSS class to that word's `<span>`, remove from previous
- If the active word is removed, find the next non-removed word and skip playhead there

### Word Click → Seek
- Click handler on every word `<span>`
- On click: `player.currentTime = word.startTime`
- Works for both normal and removed words (seeking to a removed word does not trigger removal skip)

### Word Selection
- **Shift+Click**: select all words between the last-clicked word and the Shift+clicked word
- **Native text selection**: detect which word `<span>` elements are within the browser selection range
- Selected words receive a temporary `.selected` CSS class (blue highlight)
- Floating toolbar appears above the selection

### Jump-Cut Playback
- On `timeupdate`, check if the next word(s) are removed
- If entering a removed region: calculate the start time of the next non-removed word after the removed range
- Set `player.currentTime` to that time, creating a seamless jump cut
- Edge case: if all remaining words are removed, pause playback

### Undo / Redo
- **Ctrl+Z**: undo last word removal or restoration
- **Ctrl+Shift+Z**: redo
- Edit history stack: each entry stores the affected word IDs and their previous `isRemoved` state
- Stack is maintained by `EditHistoryService` and persisted with the project

### Pipeline Builder (Onboarding)
- Click `[+]` button → dropdown with available plugin names
- Select a plugin → card appears in pipeline row
- Drag cards horizontally to reorder
- Click card → PluginOptionsPanel shows its config form
- Click `×` on card → remove from pipeline (confirm if it was configured)

---

## 5. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Space | Play / Pause |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Delete | Remove selected words |
| Left Arrow | Seek back 5 seconds |
| Right Arrow | Seek forward 5 seconds |
| Shift+Click (word) | Extend selection to clicked word |

---

## 6. Responsive Behavior

- Minimum supported width: 1024px
- Sidebar is collapsible (hamburger toggle) on narrower viewports
- Media player area stacks above transcript on very constrained heights
- Onboarding view is single-column centered, max-width 720px
