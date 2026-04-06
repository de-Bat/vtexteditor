# VTextStudio — UI Design

## 1. Design System

### 1.1 Color Tokens (Dark Theme)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#0F1117` | Page background |
| `--bg-surface` | `#1A1D27` | Cards, panels, sidebar |
| `--bg-surface-hover` | `#242837` | Hovered cards, list items |
| `--bg-surface-active` | `#2D3247` | Selected/active surfaces |
| `--color-primary` | `#6C8EEF` | Accent, buttons, links, active indicators |
| `--color-primary-hover` | `#8AA4F4` | Hover state of primary elements |
| `--color-primary-muted` | `rgba(108, 142, 239, 0.2)` | Active word background, selection highlight |
| `--color-text` | `#E1E4ED` | Primary text |
| `--color-text-secondary` | `#8B8FA3` | Secondary text, labels, captions |
| `--color-text-disabled` | `#4A4E5E` | Disabled text |
| `--color-danger` | `#EF4444` | Destructive actions, errors |
| `--color-danger-muted` | `rgba(239, 68, 68, 0.1)` | Removed word background |
| `--color-success` | `#22C55E` | Success states, completed steps |
| `--color-warning` | `#F59E0B` | Warning states |
| `--color-border` | `#2A2E3D` | Borders, dividers |
| `--color-border-focus` | `#6C8EEF` | Focused input borders |

### 1.2 Segment Tag Color Palette

Rotating palette assigned by tag value (deterministic hash):

| Index | Color | Example Tag |
|-------|-------|-------------|
| 0 | `#6C8EEF` (blue) | speaker:Alice |
| 1 | `#F59E0B` (amber) | speaker:Bob |
| 2 | `#22C55E` (green) | speaker:Charlie |
| 3 | `#EF4444` (red) | speaker:Dave |
| 4 | `#A855F7` (purple) | topic:intro |
| 5 | `#EC4899` (pink) | topic:main |
| 6 | `#14B8A6` (teal) | topic:closing |
| 7 | `#F97316` (orange) | (additional) |

### 1.3 Typography

| Element | Font | Weight | Size | Line Height |
|---------|------|--------|------|-------------|
| Page title | Inter | 600 | 20px | 28px |
| Section header | Inter | 600 | 16px | 24px |
| Body text | Inter | 400 | 14px | 20px |
| Small / caption | Inter | 400 | 12px | 16px |
| Transcript text | JetBrains Mono | 400 | 14px | 22px |
| Timeline label | JetBrains Mono | 500 | 11px | 16px |
| Button | Inter | 500 | 14px | 20px |
| Input | Inter | 400 | 14px | 20px |

### 1.4 Spacing & Layout

- **Grid unit**: 8px
- **Page padding**: 24px (3 units)
- **Card padding**: 16px (2 units)
- **Component gap**: 16px
- **Border radius**: 8px (cards, modals), 4px (buttons, inputs, tags)
- **Sidebar width**: 240px (fixed, collapsible)
- **Max content width** (Onboarding): 720px centered

### 1.5 Shadows & Effects

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | Buttons, small elevations |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.4)` | Cards, dropdowns |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.5)` | Modals, floating toolbar |

---

## 2. Onboarding View

### 2.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                      │
│  ┌──────┐                                                        │
│  │ Logo │  VTextStudio                                           │
│  └──────┘                                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│              ┌────────────────────────────────────┐              │
│              │                                    │              │
│              │   ┌────────────────────────────┐   │              │
│              │   │     ↑                      │   │              │
│              │   │     Drop media file here   │   │  ← Drop Zone│
│              │   │     or click to browse     │   │    200px h   │
│              │   │                            │   │    dashed    │
│              │   │  MP4 · WebM · MP3 · WAV    │   │    border    │
│              │   └────────────────────────────┘   │              │
│              │                                    │              │
│              │   ── File Info ─────────────────   │              │
│              │   📄 interview.mp4                  │              │
│              │   ⏱ 45:23  ·  H.264  · 1080p      │              │
│              │                                    │              │
│              │   ── Pipeline ─────────────────    │              │
│              │   ┌──────────┐  →  ┌──────────┐   │              │
│              │   │Transcribe│     │ Diarize  │   │              │
│              │   │ Whisper  │     │ Speakers │   │              │
│              │   └──────────┘     └──────────┘   │              │
│              │                            [ + ]   │              │
│              │                                    │              │
│              │   ── Options (Whisper) ────────    │              │
│              │   Language  [English       ▾]      │              │
│              │   Model     [large-v3      ▾]      │              │
│              │   Server    [localhost:8080  ]      │              │
│              │                                    │              │
│              │              ┌─────────────────┐   │              │
│              │              │   ▶ Process     │   │              │
│              │              └─────────────────┘   │              │
│              │                                    │              │
│              │   ┌────────────────────────────┐   │              │
│              │   │ ████████░░░░░░░ 45% (1/2)  │   │              │
│              │   │ Transcribing with Whisper   │   │              │
│              │   └────────────────────────────┘   │              │
│              │                                    │              │
│              └────────────────────────────────────┘              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Specs

**Drop Zone**
- Height: 200px, full content width
- Border: 2px dashed `--color-border`, radius 8px
- Background: `--bg-surface`
- Hover/dragover: border color → `--color-primary`, background → `--color-primary-muted`
- Icon: upload cloud icon, 48px, `--color-text-secondary`
- Text: "Drop media file here" (16px, secondary) + "or click to browse" (14px, link style)
- Accepted formats: listed below in 12px caption text

**Pipeline Card**
- Width: 140px, height: 80px
- Background: `--bg-surface`, border: 1px solid `--color-border`
- Radius: 8px
- Content: plugin name (14px, bold) + type badge (11px, muted)
- Hover: border → `--color-primary`, shadow-sm
- Selected: border → `--color-primary`, background → `--bg-surface-active`
- Close button (×): top-right corner, 16px, visible on hover
- Arrow between cards: `→` character in `--color-text-secondary`, 16px

**Process Button**
- Width: auto (min 160px), centered
- Height: 44px
- Background: `--color-primary`, radius 4px
- Text: "▶ Process" white, 14px, weight 500
- Hover: `--color-primary-hover`
- Disabled: opacity 0.5, no pointer events

**Progress Bar**
- Height: 8px, full width, radius 4px
- Track: `--bg-surface`
- Fill: `--color-primary`, animated width transition
- Label above: step name + percentage (14px)
- Sub-label: step count "Step 1/2" (12px, secondary)

---

## 3. Studio View

### 3.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                      │
│  Logo  VTextStudio  │  project-name        [← Back] [Export ▾]  │
├──────────┬───────────────────────────────────────────────────────┤
│          │                                                       │
│ SIDEBAR  │  MEDIA PLAYER                                         │
│ 240px    │  ┌───────────────────────────────────────────────┐    │
│          │  │                                               │    │
│ ┌──────┐ │  │         <video> / <audio> element             │    │
│ │Clip 1│ │  │              aspect-ratio: 16/9               │    │
│ │active│ │  │                                               │    │
│ └──────┘ │  └───────────────────────────────────────────────┘    │
│          │                                                       │
│ ┌──────┐ │  TRANSCRIPT                                           │
│ │Clip 2│ │  ┌───────────────────────────────────────────────┐    │
│ │      │ │  │ ┌─ Speaker A ───────────────────────────────┐ │    │
│ └──────┘ │  │ │ Hello and welcome to today's show. We     │ │    │
│          │  │ │ have a ~~great~~ lineup for you today.    │ │    │
│ ┌──────┐ │  │ └───────────────────────────────────────────┘ │    │
│ │Clip 3│ │  │                                               │    │
│ │      │ │  │ ┌─ Speaker B ───────────────────────────────┐ │    │
│ └──────┘ │  │ │ Thanks for having me here. I'm really     │ │    │
│          │  │ │ excited to **discuss** this topic today.   │ │    │
│          │  │ └───────────────────────────────────────────┘ │    │
│          │  └───────────────────────────────────────────────┘    │
│          │                                                       │
│          │  SEGMENT TIMELINE                                     │
│          │  ┌───────────────────────────────────────────────┐    │
│          │  │[███ Seg 1 ███][██████ Seg 2 ██████][██ S3 ██] │    │
│          │  │       ▲ playhead                               │    │
│          │  └───────────────────────────────────────────────┘    │
│          │                                                       │
├──────────┴───────────────────────────────────────────────────────┤
│  TRANSPORT BAR                                                   │
│  ◀◀  ▶  ▶▶  ━━━━━━●━━━━━━━━━━━━━━━  00:34 / 02:15  🔊━━━ 1.0× │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Specs

**Sidebar — ClipList**
- Width: 240px fixed (collapsible to 0 via hamburger toggle in header)
- Background: `--bg-surface`
- Header: "CLIPS" label, 12px, weight 600, uppercase, `--color-text-secondary`, padding 16px
- Clip item:
  - Padding: 12px 16px
  - Name: 14px, weight 500, `--color-text`
  - Meta: 12px, `--color-text-secondary` (e.g., "0:00 - 2:15 · 3 segments")
  - Hover: background → `--bg-surface-hover`
  - Selected: background → `--bg-surface-active`, left border 3px solid `--color-primary`
- Divider: 1px `--color-border` between items

**Media Player Area**
- Max height: 40% of main area (for video); hidden for audio-only (replaced by album art or waveform placeholder)
- Video: aspect ratio 16:9, rounded corners 8px, background black
- Audio fallback: 120px height, centered waveform visualization placeholder

**Transcript Area**
- Scrollable container, flex-grow to fill remaining space
- Padding: 16px

**Segment Card**
- Background: `--bg-surface`
- Border-left: 3px solid (tag-derived color from palette)
- Border-radius: 8px
- Padding: 12px 16px
- Margin-bottom: 8px
- Header: tag label (e.g., "Speaker A"), 12px, weight 600, colored matching left border
- Body: word spans, JetBrains Mono 14px, line-height 22px

**Word `<span>` States**

| State | Styles |
|-------|--------|
| Normal | `color: --color-text; cursor: pointer;` |
| Hover | `text-decoration: underline; text-underline-offset: 2px;` |
| Active (playing) | `background: --color-primary-muted; font-weight: 600; border-radius: 2px; padding: 1px 2px;` |
| Selected | `background: rgba(108, 142, 239, 0.3); border-radius: 2px;` |
| Removed | `text-decoration: line-through; opacity: 0.35; background: --color-danger-muted; border-radius: 2px; padding: 1px 2px;` |
| Removed + Hover | `opacity: 0.5; cursor: pointer;` (to allow restore) |

**Segment Timeline**
- Height: 40px
- Background: `--bg-primary`
- Border: 1px solid `--color-border`, radius 4px
- Segment blocks: height 32px (centered vertically), radius 2px, background from tag palette at 60% opacity
- Playhead: width 2px, height 40px, background `--color-primary`, absolute positioned
- Hover on segment: tooltip with shadow-md

**Transport Bar**
- Height: 56px
- Background: `--bg-surface`
- Border-top: 1px solid `--color-border`
- Padding: 0 24px
- Layout: flexbox, items center-aligned, gap 16px
- Buttons: 32×32px, icon only, `--color-text`, hover → `--color-primary`
- Seek bar: flex-grow, custom range input styled with `--color-primary` thumb and track
- Time display: JetBrains Mono 12px, `--color-text-secondary`
- Volume: 80px width slider
- Speed: dropdown button, 12px

**Floating Removal Toolbar**
- Position: absolute, above text selection
- Background: `--bg-surface`, shadow-lg, radius 8px
- Padding: 4px 8px
- Buttons: "Remove" (danger color) or "Restore" (primary color), 12px, weight 500
- Arrow pointer at bottom (CSS triangle)
- Dismiss: on click outside or Escape key

**Export Panel (Modal)**
- Overlay: black at 50% opacity
- Modal: `--bg-surface`, 480px wide, radius 12px, shadow-lg
- Header: "Export Clip" 18px weight 600, close button
- Body: radio group for format (Media, SRT, TXT), quality dropdown (for media)
- Footer: "Start Export" primary button, progress bar, download link on completion

---

## 4. Motion & Animation

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Page transition (Onboarding ↔ Studio) | Fade + slide up | 300ms | ease-out |
| Word active highlight | Background color transition | 150ms | ease-in-out |
| Word removal | Opacity + strikethrough | 200ms | ease-out |
| Playhead movement | Left position (smooth, no transition — updated per frame) | — | — |
| Sidebar collapse | Width 240px → 0 | 250ms | ease-in-out |
| Floating toolbar appear | Fade in + scale(0.95 → 1) | 150ms | ease-out |
| Modal appear | Fade in + translateY(8px → 0) | 200ms | ease-out |
| Progress bar fill | Width transition | 300ms | ease-out |
| Toast notification | Slide in from top-right | 250ms | ease-out |
| Tooltip | Fade in | 100ms | ease-in |

---

## 5. Icons

Use a minimal icon set (Lucide Icons or similar):

| Icon | Usage |
|------|-------|
| `upload-cloud` | Media drop zone |
| `play`, `pause` | Transport play/pause |
| `skip-back`, `skip-forward` | Transport skip |
| `volume-2`, `volume-x` | Volume control |
| `plus` | Add pipeline step |
| `x` | Remove pipeline step, close modal |
| `undo-2`, `redo-2` | Undo/redo (if shown in UI) |
| `download` | Export download |
| `scissors` | Remove words action |
| `rotate-ccw` | Restore words action |
| `chevron-down` | Dropdown indicators |
| `grip-vertical` | Drag handle (pipeline reorder) |
| `file-audio`, `file-video` | Media type indicators |
| `clock` | Duration display |
| `layers` | Segment count |

---

## 6. Accessibility

- All interactive elements have visible focus indicators (2px `--color-border-focus` outline)
- Color is not the only indicator for word states (strikethrough for removed, bold for active)
- Minimum contrast ratio: 4.5:1 for text on all backgrounds
- ARIA labels on icon-only buttons (play, pause, skip, volume)
- Keyboard navigation: Tab through controls, Enter/Space to activate
- Screen reader: transcript words announce their text and state (removed/active)
- Reduced motion: respect `prefers-reduced-motion` — disable non-essential animations
