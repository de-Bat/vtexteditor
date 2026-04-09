# VTextStudio — UI Design

> Design system: **"The Editorial Timeline"** — see `stitch/DESIGN.md` for the full creative brief.

## 1. Design System

### 1.1 Creative North Star

Move away from the cluttered "knobs-and-dials" look of legacy video editors toward a high-end, editorial experience. Key principles:

- **Tonal Depth over Lines** — surfaces feel carved from a single piece of obsidian, not boxes drawn on a screen.
- **Intentional Asymmetry** — wide margins for the transcript, condensed high-density utility bars for the timeline.
- **The "No-Line" Rule** — never use 1px solid borders to section off the interface. Boundaries are defined by tonal shifts between surface levels and 40px vertical spacing gaps.

### 1.2 Colors & Surface Hierarchy

The palette is rooted in a deep, nocturnal base to keep focus on video content and text.

| Token | Value | Usage |
|-------|-------|-------|
| `surface` | `#0e0e10` | Base workspace background |
| `surface-container-lowest` | `#000000` | Sunken content wells (transcript, video preview) |
| `surface-container-low` | `#1a1a1d` | Recessed panels |
| `surface-container-high` | `#242427` | Lifted cards, clip thumbnails |
| `surface-bright` | `#2c2c2f` | Floating utilities (with `backdrop-blur`) |
| `primary` | `#ba9eff` | Accent, active states, main actions |
| `primary-dim` | `#8455ef` | Gradient endpoint for primary buttons |
| `primary-container` | — | Active word highlight background |
| `on-primary-container` | — | Active word highlight text |
| `secondary` | `#9093ff` | Playhead, secondary accents |
| `tertiary` | `#ff716a` | Destructive text actions |
| `error` | `#ff6e84` | Calibrated error (dark-theme tuned, not standard red) |
| `error-container` | `#a70138` | Deleted word background (at 20% opacity) |
| `on-surface` | `#f6f3f5` | Primary text (never pure `#FFFFFF`) |
| `outline-variant` | `#48474a` | Ghost borders (at 15% opacity) |

**The "Glass & Gradient" Rule** — main actions (Export, Cut, Process) use a subtle `linear-gradient(135deg, primary, primary-dim)` for holographic depth.

### 1.3 Segment Color Palette

Six-color rotating palette assigned by segment index. Each color has four opacity variants:

| Index | Name | Bar (60%) | Track (40%) | Border | Glow (40%) |
|-------|------|-----------|-------------|--------|------------|
| 0 | Purple | `rgba(139,92,246,0.6)` | `rgba(139,92,246,0.4)` | `#a78bfa` | `rgba(139,92,246,0.4)` |
| 1 | Green | `rgba(16,185,129,0.6)` | `rgba(16,185,129,0.4)` | `#34d399` | `rgba(16,185,129,0.4)` |
| 2 | Amber | `rgba(245,158,11,0.6)` | `rgba(245,158,11,0.4)` | `#fbbf24` | `rgba(245,158,11,0.4)` |
| 3 | Rose | `rgba(244,63,94,0.6)` | `rgba(244,63,94,0.4)` | `#fb7185` | `rgba(244,63,94,0.4)` |
| 4 | Sky | `rgba(14,165,233,0.6)` | `rgba(14,165,233,0.4)` | `#38bdf8` | `rgba(14,165,233,0.4)` |
| 5 | Fuchsia | `rgba(217,70,239,0.6)` | `rgba(217,70,239,0.4)` | `#e879f9` | `rgba(217,70,239,0.4)` |

Usage: `bar` for timeline segment blocks, `track` for segment card backgrounds, `border` for segment header accents, `glow` for hover/active effects.

### 1.4 Typography

Tri-font system balancing technical precision with editorial elegance:

| Role | Font | Weights | Usage |
|------|------|---------|-------|
| Display & Headlines | **Manrope** | 400, 700, 800 | Project titles, badges, buttons, captions, transcript title. Wide aperture keeps the dark theme airy. |
| Body & Transcription | **Inter** | 400, 500, 600 | Transcript words, body text, form labels. High x-height for reading long-form transcripts. |
| Utility & Labels | **Space Grotesk** | 400, 500, 700 | Timecodes, metadata, uppercase labels. Mono-spaced feel for technical precision. |

**Rule:** Always use Space Grotesk for numbers (timecodes, frame rates) to ensure numerical alignment.

### 1.5 Spacing & Layout

- **Grid unit**: 8px
- **Page padding**: 24px (3 units)
- **Card padding**: 16px (2 units)
- **Section break**: 40px vertical gap (replaces divider lines per No-Line Rule)
- **Border radius**: `md` 0.375rem (cards, buttons), `sm` 0.125rem (word highlights), `full` 9999px (status chips only)
- **Clip panel width**: 280px (fixed, transforms offscreen on mobile)
- **Max content width** (Onboarding): 720px centered

### 1.6 Elevation & Depth

Depth is achieved through **Tonal Layering**, not traditional shadows.

| Technique | Spec | Usage |
|-----------|------|-------|
| Tonal lift | Place `surface-container-high` on `surface-container-low` | Cards, clip thumbnails |
| Ambient glow | `0 0 32px rgba(186,158,255,0.06)` | Floating menus, action footer |
| Ghost border | `outline-variant` (#48474a) at 15% opacity | Buttons needing separation on similar surfaces |
| Backdrop blur | `backdrop-filter: blur(12px)` on `surface-bright` | Floating panels, action footer |

---

## 2. Onboarding View

Dual-mode view: **Project Home** (default when projects exist) and **Wizard** (new project creation).

### 2.1 Project Home Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
│  Logo  VTextStudio      tagline                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PROJECTS GRID (responsive columns)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Project A   │  │ Project B   │  │ + New       │             │
│  │ interview…  │  │ podcast…    │  │   Project   │             │
│  │ 2:34 · mp4  │  │ 45:10 · mp3 │  │             │             │
│  │ 3 clips     │  │ 1 clip      │  │             │             │
│  │ 142 segs    │  │ 28 segs     │  │             │             │
│  │ ✓ Done      │  │ ✓ Done      │  │             │             │
│  │─────────────│  │─────────────│  │             │             │
│  │ [Open]  [⋮] │  │ [Open]  [⋮] │  │             │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Project Card**: title row, file info (duration · format), stats (clips, segments, words), transcription status badge, footer with Open button and overflow menu (delete).

### 2.2 Wizard Layout

Step-by-step flow triggered by "New Project" or when no projects exist.

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
│  Logo  VTextStudio                                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STEPS BAR:  ① Upload  ─  ② Configure  ─  ③ Process            │
│                                                                  │
│  WIZARD BODY (centered, max-width 720px)                         │
│  ┌────────────────────────────────────────┐                      │
│  │                                        │                      │
│  │   Step-specific content:               │                      │
│  │   • Upload: drop zone + file info      │                      │
│  │   • Configure: pipeline cards + opts   │                      │
│  │   • Process: progress bar + status     │                      │
│  │                                        │                      │
│  └────────────────────────────────────────┘                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 Component Specs

**Drop Zone**
- Full content width, dashed border (Ghost Border style)
- Background: `surface-container-low`
- Hover/dragover: border → `primary`, background shift
- Icon: `upload` Material Symbol, 48px
- Text: "Drop media file here" + "or click to browse"

**Pipeline Card**
- Background: `surface-container-high`, no border (tonal lift)
- Radius: `md` (0.375rem)
- Content: plugin name (Manrope 700) + type badge (Space Grotesk)
- Close button (×): visible on hover
- Arrow between cards: `→` in muted text

**Process Button**
- Gradient: `linear-gradient(135deg, primary, primary-dim)`
- Radius: `md`, no border
- Text: "▶ Process" in `on-surface`, Manrope 700

**Progress Bar**
- Height: 8px, full width, radius `sm`
- Track: `surface-container-low`
- Fill: `primary`, animated width transition
- Label: step name + percentage (Inter 500) + step count (Space Grotesk)

---

## 3. Studio View

### 3.1 Layout

Three-panel flex layout. **No transport bar** — playback controls are a hover overlay on the media element.

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                      │
│  Logo  VTextStudio  │  project-name (flex:1)     [← Back]       │
├──────────┬──────────────────────────────────────┬────────────────┤
│          │                                      │                │
│ CLIP     │  MEDIA PLAYER (hover for controls)   │  EXPORT        │
│ PANEL    │  ┌──────────────────────────────────┐│  PANEL         │
│ 280px    │  │                                  ││  (min 240px)   │
│          │  │       <video> / <audio>           ││                │
│ ┌──────┐ │  │                                  ││  Format:       │
│ │Clip 1│ │  │  ┌────────────────────────────┐  ││  ○ Video (MP4) │
│ │active│ │  │  │ ▶ 01:23/05:45  Speaker A 🔊│  ││  ○ Plain Text  │
│ └──────┘ │  │  └── hover overlay ───────────┘  ││  ○ SRT         │
│          │  └──────────────────────────────────┘│                │
│ ┌──────┐ │                                      │  [Export]      │
│ │Clip 2│ │  TRANSCRIPT (FlowItems)              │                │
│ └──────┘ │  ┌──────────────────────────────────┐│                │
│          │  │ ┌─ Speaker A ──────────────────┐ ││                │
│ ┌──────┐ │  │ │ Hello and welcome 00:05      │ ││                │
│ │Clip 3│ │  │ │ to today's show. We have a   │ ││                │
│ └──────┘ │  │ │ ⌛ 0.4s  great lineup for    │ ││                │
│          │  │ │ you today. 00:10             │ ││                │
│          │  │ └──────────────────────────────┘ ││                │
│          │  │ ┌─ Speaker B ──────────────────┐ ││                │
│          │  │ │ Thanks for having me here.    │ ││                │
│          │  │ └──────────────────────────────┘ ││                │
│          │  └──────────────────────────────────┘│                │
│          │                                      │                │
│          │  SEGMENT TIMELINE                    │                │
│          │  ┌──────────────────────────────────┐│                │
│          │  │[███ Seg 1 ███][████ Seg 2 ████]  ││                │
│          │  │       ▲ playhead                  ││                │
│          │  └──────────────────────────────────┘│                │
│          │                                      │                │
│          │  ACTION FOOTER (floating, appears on selection)       │
│          │  ┌──────────────────────────────────┐│                │
│          │  │ ✂ Cut  ⟳ Restore │ 3 sel · 1 rem││                │
│          │  └──────────────────────────────────┘│                │
│          │                                      │                │
├──────────┴──────────────────────────────────────┴────────────────┤
```

### 3.2 Component Specs

**Clip Panel (Left Sidebar)**
- Width: 280px fixed (transforms offscreen at ≤1024px)
- Background: tonal shift from base `surface`
- Clip item: name (Inter 500), time range + segment count (Space Grotesk), colored left accent from segment palette
- Selected: `surface-container-high` background, left accent bar

**Media Player — Hover Overlay**

Controls appear on hover over the video/audio frame with a bottom-to-transparent gradient background. Fade transition: `opacity 300ms`.

| Position | Controls |
|----------|----------|
| Left | Play/Pause icon button, timecode (`HH:MM:SS / HH:MM:SS` in Space Grotesk), active segment label |
| Right | Volume button (dynamic icon: `volume_off` / `volume_down` / `volume_up`), Fullscreen button |

**Transcript — FlowItems**

Words are rendered as a continuous inline flow within each segment card, interleaved with two types of inline markers:

- **Time markers** (every 5 seconds): small `primary`-tinted pill showing `MM:SS` (Space Grotesk). Force a line break (`flex-basis: 100%`) so they visually anchor the timeline. Clickable → seek.
- **Silence chips** (gaps ≥ 300ms): inline pill with `hourglass_empty` icon and gap duration label. Positioned between the words surrounding the gap. Clickable → seek to gap midpoint.

Words flow naturally with `display: inline` / `flex-wrap: wrap`.

**Word States**

| State | Styles |
|-------|--------|
| Normal | `color: rgba(246,243,245,0.8); padding: 2px 4px; cursor: pointer;` |
| Hover | `color: var(--primary);` |
| Highlighted (playing) | `background: var(--primary-container); color: var(--on-primary-container); text-shadow: 0.4px 0 0 currentColor; border-radius: 2px;` |
| Selected | `outline: 1px solid rgba(186,158,255,0.65); background: rgba(186,158,255,0.25); border-radius: 2px;` |
| Search match | `background: linear-gradient(135deg, primary, primary-dim); -webkit-background-clip: text; -webkit-text-fill-color: transparent;` |
| Filler (removed) | Filler-badge: `background: rgba(44,44,47,0.4); border: 1px dashed rgba(72,71,74,0.3); border-radius: 4px;` Text: `color: var(--error); font-style: italic; font-size: 12px; text-decoration: underline dotted;` |

**Segment Timeline**
- Segment blocks use colors from the 6-color palette at 60% opacity (`bar` variant)
- Playhead: 2px line in `secondary` (#9093ff) with `surface-tint` glow
- Segments separated by 2px empty space (base background), not borders
- Click anywhere → seek to that time position

**Action Footer (Floating)**
- Position: absolute, bottom 32px, left/right 32px
- Background: `rgba(44,44,47,0.92)` with `backdrop-filter: blur(12px)`
- Border-radius: 12px, padding: 12px 16px
- Three sections:
  - Left: Cut (`content_cut`), Jump-Cut toggle (`auto_awesome`), Restore (`settings_backup_restore`) icon buttons
  - Center: "N selected" chip + "M removed" chip (meta info)
  - Right: Smart Cut action button
- Appears when words are selected; dismisses on deselection

**Export Panel (Inline Sidebar)**
- Docked to right of player panel, `min-width: 240px`
- Background: tonal shift with left border
- Format radio group: Video (MP4), Plain Text, SRT Subtitles
- Export button: Glass & Gradient style
- Status: `idle` → `pending` (spinner) → `done` (download link) → `error`
- Polling-based progress (1500ms interval), not SSE

---

## 4. Motion & Animation

| Element | Property | Duration | Easing |
|---------|----------|----------|--------|
| Hover overlay visibility | `opacity` | 300ms | — |
| Text color changes (hover, state) | `color` | 200ms | — |
| Button / icon state changes | `all` | 200ms | — |
| Border animations | `border-color` | 200ms | — |
| Filter effects (brightness) | `filter` | 200ms | — |
| Follow toggle state | `color, border-color, background` | 150ms | — |
| Playhead movement | `left` (per frame, no CSS transition) | — | — |
| Progress bar fill | `width` | 300ms | ease-out |
| Toast notification | Slide in from top-right | 250ms | ease-out |

**Keyframe Animations**

```
pulse-border  — 0.8s ease-in-out infinite alternate
  from: box-shadow: 0 0 0 0 color-mix(primary 40%, transparent)
  to:   box-shadow: 0 0 0 4px color-mix(primary 0%, transparent)
  Usage: "Return to playhead" button pulse

spin  — 0.8s linear infinite
  to: rotate(360deg)
  Usage: Export progress spinner
```

---

## 5. Icons

**Material Symbols Outlined** loaded from Google Fonts with variable settings:

```
font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
```

| Icon | Usage |
|------|-------|
| `play_arrow` / `pause` | Hover overlay play/pause |
| `volume_off` / `volume_down` / `volume_up` | Hover overlay volume (dynamic) |
| `fullscreen` | Hover overlay expand |
| `my_location` / `location_disabled` | Auto-follow toggle |
| `keyboard_return` | Return-to-playhead button |
| `delete_sweep` | Restore all removed words |
| `search` | Transcript search |
| `content_cut` | Cut / remove words |
| `auto_awesome` | Smart Cut / jump-cut toggle |
| `settings_backup_restore` | Restore removed words |
| `hourglass_empty` | Silence chip icon |
| `timer` | Inline time marker |
| `drag_indicator` | Drag handle (pipeline reorder) |
| `more_horiz` | Overflow menu |
| `close` | Close / dismiss |
| `reorder` | Clip list reorder |
| `upload` | Media drop zone |

---

## 6. Do's and Don'ts

### Do:
- **Do** use Space Grotesk for all numbers (timecodes, frame rates, durations) — ensures numerical alignment.
- **Do** lean into `surface-container-lowest` for the main video preview area to make colors pop.
- **Do** use `9999px` (full) roundedness for status chips only (e.g., "Rendering," "Done").
- **Do** use `on-surface` (#f6f3f5) for all text — never pure `#FFFFFF`.
- **Do** define boundaries through tonal surface shifts, not lines.

### Don't:
- **Don't** use 1px dividers anywhere. If you feel you need a line, increase padding by 8px instead.
- **Don't** use standard red for errors. Use the calibrated `error` (#ff6e84) tuned for dark-theme vibrance.
- **Don't** use drop shadows. Use ambient glow (primary-tinted, 32px blur, 6% opacity) or tonal layering.
- **Don't** use flat backgrounds for primary action buttons. Apply the Glass & Gradient rule.

---

## 7. Accessibility

- All interactive elements have visible focus indicators using `primary` outline
- Word states use redundant cues beyond color: `text-shadow` for active (highlighted), dashed border + italic for filler (removed)
- Minimum contrast ratio: 4.5:1 for `on-surface` text on all surface levels
- ARIA labels on all icon-only buttons (play, pause, volume, fullscreen, cut, restore)
- Keyboard navigation: Tab through controls, Enter/Space to activate
- Screen reader: transcript words announce their text and state
- Reduced motion: respect `prefers-reduced-motion` — disable non-essential animations (pulse, transitions)
