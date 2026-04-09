# VTextStudio — UI Specifications

## 1. Views & Routing

| Route | View | Description |
|-------|------|-------------|
| `/` | Onboarding | Project home (list existing projects) or wizard (upload → configure → process) |
| `/studio/:id` | Studio | Clip list, media player with hover controls, transcript editing, export |

---

## 2. Onboarding View

Dual-mode view selected automatically: **Project Home** when projects exist, **Wizard** for new project creation.

### Project Home

Full-page layout showing all existing projects in a responsive grid.

**ProjectsGrid**
- Responsive column grid of project cards
- Each card: project title, filename + duration + format, stats (clips, segments, words), transcription status badge
- Card footer: "Open" button navigates to `/studio/:id`; overflow menu (⋮) with "Delete" action
- "New Project" placeholder card triggers wizard mode

**Project Card States**
- Default: `surface-container-high` on `surface` (tonal lift)
- Hover: ambient glow effect

### Wizard

Step-by-step flow: Upload → Configure → Process → auto-navigate to `/studio/:id`.

#### Components

**StepsBar**
- Three steps displayed horizontally: ① Upload, ② Configure, ③ Process
- Active step highlighted with `primary` accent; completed steps show check icon

**MediaUploader**
- Large drop zone accepting drag-and-drop or click-to-browse
- Accepted formats: MP4, WebM, MKV, MP3, WAV, FLAC, OGG
- Upload progress bar during file transfer
- Error state for rejected file types

**FileInfoPanel**
- Appears after successful upload
- Displays: filename, duration (formatted), format/codec, resolution (video) or bitrate (audio)

**PipelineConfigurator**
- Horizontal card layout with left-to-right flow arrows between steps
- Each card: plugin name (Manrope 700) and type badge (Space Grotesk)
- `[+]` button to add a pipeline step (dropdown of available plugins)
- Click `×` to remove a step
- Fetches plugins from `GET /api/plugins`
- Plugin config fields auto-filled from app-level settings via `settingsMap`

**PluginOptionsPanel**
- Below the pipeline when a step card is selected
- Dynamically generated form from the plugin's JSON Schema `configSchema`
- Supports: text inputs, dropdowns, number fields, toggles

**ProcessingProgress**
- Full-width progress bar below the pipeline
- Shows: current step label, step count, percentage
- Subscribes to `GET /api/events` (SSE) for `pipeline:progress` events

**ProcessButton**
- Glass & Gradient style: `linear-gradient(135deg, primary, primary-dim)`
- Disabled until media uploaded and at least one pipeline step configured
- Replaced by ProcessingProgress during execution

### Flow
1. User drops/selects media → upload → FileInfoPanel appears
2. User configures pipeline → PipelineConfigurator + PluginOptionsPanel
3. User clicks Process → ProcessingProgress → on complete, auto-navigate to `/studio/:id`

---

## 3. Studio View

Three-panel flex layout: clip panel (left) + player panel (center) + export panel (right). **No transport bar** — playback controls are a hover overlay on the media element.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Header: Logo │ project-name (flex:1) │ [← Back]                │
├──────────┬──────────────────────────────────────┬────────────────┤
│          │                                      │                │
│ Clip     │  Media Player (hover overlay)        │  Export Panel  │
│ Panel    │  ┌──────────────────────────────────┐│  (min 240px)   │
│ (280px)  │  │  <video>/<audio>                 ││                │
│          │  │  ┌ ▶ 01:23/05:45  Spkr A   🔊 ┐ ││  ○ Video       │
│          │  │  └──── overlay (on hover) ──────┘││  ○ Plain Text  │
│          │  └──────────────────────────────────┘│  ○ SRT         │
│          │                                      │                │
│          │  Transcript (FlowItems, scrollable)  │  [Export]      │
│          │  ┌──────────────────────────────────┐│                │
│          │  │ words · time-markers · silence   ││                │
│          │  │ chips within segment cards       ││                │
│          │  └──────────────────────────────────┘│                │
│          │                                      │                │
│          │  Segment Timeline                    │                │
│          │  ┌──────────────────────────────────┐│                │
│          │  │ [█ Seg1 █][███ Seg2 ███] ▲       ││                │
│          │  └──────────────────────────────────┘│                │
│          │                                      │                │
│          │  Action Footer (floating, on select) │                │
│          │  ┌──────────────────────────────────┐│                │
│          │  │ ✂ ⟳ │ 3 sel · 1 rem │ Smart Cut ││                │
│          │  └──────────────────────────────────┘│                │
├──────────┴──────────────────────────────────────┴────────────────┤
```

### Components

#### ClipPanel (Left Sidebar)
- Width: 280px fixed (transforms offscreen at ≤1024px breakpoint)
- Each item: clip name (Inter 500), time range + segment count (Space Grotesk), colored left accent from segment palette
- Selected clip: `surface-container-high` background, accent left bar
- Click to select → loads clip into TxtMediaPlayerV2

#### TxtMediaPlayerV2 (Main)
Container component that composes: media element with hover overlay, transcript with FlowItems, segment timeline, and action footer.

**Media Element + Hover Overlay:**
- HTML5 `<video>` or `<audio>` element (determined by `project.mediaType`)
- Source: proxied through API
- **No native controls** — custom overlay appears on hover over the media frame
- Overlay controls:
  - **Left**: Play/Pause icon button, timecode display (`HH:MM:SS / HH:MM:SS` in Space Grotesk), active segment label
  - **Right**: Volume button (dynamic icon: `volume_off` / `volume_down` / `volume_up`), Fullscreen button
- Overlay background: linear gradient (bottom transparent → semi-opaque), `opacity` transition 300ms

**Transcript (FlowItems):**
- Segments rendered as visually distinct cards with colored header (tag label + accent from segment palette)
- Within each segment, words are rendered as a continuous inline flow interleaved with:
  - **Inline time markers** (every 5 seconds): small `primary`-tinted pill with `MM:SS` label (Space Grotesk). Forces a line break via `flex-basis: 100%`. Clickable → seek.
  - **Silence chips** (gaps ≥ 300ms between words): inline pill with `hourglass_empty` icon and gap duration. Clickable → seek to gap midpoint.
- Scroll container with auto-follow: scrolls to keep the active word in view during playback
- Auto-follow toggle: `my_location` / `location_disabled` icon button; "Return to playhead" button (with pulse animation) appears when scrolled away
- **Virtual scrolling**: activates when total word count ≥ 1200 words. Overscan buffer: 700px. Segment heights estimated at `16 + ceil(words/10) * 28` px.
- **Search bar**: filters/highlights matching words with gradient text effect

**Word States:**

| State | Visual Treatment |
|-------|-----------------|
| Normal | `rgba(246,243,245,0.8)` text, `2px 4px` padding, pointer cursor |
| Hover | Text color → `primary` |
| Highlighted (current playback) | `primary-container` background, `on-primary-container` text, `text-shadow: 0.4px`, 2px radius |
| Selected | 1px `primary` outline at 65% opacity, `primary` background at 25% opacity |
| Search match | Gradient text (`primary` → `primary-dim`) via `background-clip: text` |
| Filler / Removed | Filler-badge wrapper: `rgba(44,44,47,0.4)` bg, 1px dashed border, 4px radius. Text: `error` color, italic, 12px, dotted underline |

**Gap-Bridging Highlight:** When the playhead is between words (in a gap), the system highlights the nearest non-removed word rather than showing no highlight.

**Segment Timeline:**
- Horizontal bar, full width of player panel
- Segments as proportional-width blocks colored from the 6-color palette (`bar` variant at 60% opacity)
- Separated by 2px empty space (base background), not borders
- Playhead: 2px `secondary` (#9093ff) vertical line with tinted glow
- Click anywhere → seek to that time position

**Action Footer (Floating):**
- Absolutely positioned at bottom of player panel (32px inset)
- Glass effect: `rgba(44,44,47,0.92)` background, `backdrop-filter: blur(12px)`, 12px radius
- Three sections:
  - **Left**: Cut (`content_cut`), Jump-Cut toggle (`auto_awesome`), Restore (`settings_backup_restore`)
  - **Center**: "N selected" + "M removed" meta chips
  - **Right**: Smart Cut action button
- Appears on word selection; dismisses when selection is cleared

#### ExportPanel (Right Sidebar)
- Docked inline to right of player panel, `min-width: 240px`
- Left border for separation (tonal shift)
- Format radio group:
  - **Video (MP4)** — "Removed words cut from media"
  - **Plain Text** — "Active words as plain text"
  - **SRT Subtitles** — "Active words as .srt file"
- Export button: Glass & Gradient style
- Status progression: `idle` → `pending` (spinner animation) → `done` (download link) → `error`
- **Polling-based**: checks export status every 1500ms (not SSE)
- Hidden at ≤1024px breakpoint

---

## 4. Interaction Patterns

### Word Highlighting (Playback Sync)
- On every `timeupdate` event from the HTML5 player
- Binary search through the current clip's words (sorted by `startTime`) to find the word where `startTime <= currentTime < endTime`
- Gap-bridging: if the playhead falls in a gap between words, the nearest non-removed word is highlighted
- Apply `.highlighted` CSS class to that word, remove from previous

### Word Click → Seek
- Click handler on every word span: `MediaPlayerService.seek(word.startTime)`
- Works for both normal and filler-badge (removed) words
- Time markers and silence chips also clickable → seek to their respective times

### Word Selection
- **Click**: select a single word
- **Shift+Click**: select all words between the last-clicked word and the Shift+clicked word
- Selected words receive `.selected` class (purple outline + background)
- Action footer appears with contextual actions

### Jump-Cut Playback
- On `timeupdate`, check if current/next words are removed
- If entering a removed region: calculate `startTime` of next non-removed word → seek there
- Creates seamless jump cuts during playback
- Edge case: if all remaining words are removed, pause playback

### Auto-Follow
- Toggle button (`my_location` / `location_disabled` icon) enables/disables auto-scroll
- When enabled: `scrollIntoView({ behavior: 'smooth', block: 'center' })` on active word
- When user manually scrolls away: "Return to playhead" button appears with `pulse-border` animation
- Clicking return button scrolls back and re-enables follow

### Undo / Redo
- **Ctrl+Z**: undo last word removal or restoration
- **Ctrl+Shift+Z**: redo
- Edit history stack maintained by `EditHistoryService`
- Each entry stores affected word IDs and their previous `isRemoved` state

---

## 5. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Delete` | Remove selected words |
| `←` Left Arrow | Seek back 5 seconds |
| `→` Right Arrow | Seek forward 5 seconds |
| `Shift+Click` (word) | Extend selection to clicked word |

---

## 6. Responsive Behavior

- **Minimum supported width**: 1024px
- **≤1024px breakpoint**:
  - Clip panel: fixed position, transforms offscreen (toggle to show/hide)
  - Export panel: hidden
  - Grid changes to single-column layout
- **Media player**: resizes proportionally with container
- **Onboarding**: single-column centered, max-width 720px
