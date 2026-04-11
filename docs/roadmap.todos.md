# VTextStudio — Roadmap

## Implement Now

### Header & Footer Revamp (Phase 1)
- [x] Redesign transcript header as compact two-row toolbar (all actions icon-only with tooltips)
- [ ] Row 1: title + edit group (Restore All, Undo, Redo) + selection group (Cut, Restore, Jump-cut) + auto-follow + export btn
- [ ] Row 2: search input + silence interval + Smart Cut dropdown trigger
- [ ] Add canUndo/canRedo getters to EditHistoryService; expose undo/redo as public
- [ ] Restore All with confirm dialog (>10 removed)
- [x] Auto-follow: icon-only toggle (my_location / location_disabled), return button
- [x] Replace action footer with status-only bar (selected count, removed count, active modes)

### Smart Cut — Highlight & Remove Toggle (Phase 2)
- [ ] Configurable min silence interval signal (replaces hardcoded thresholds)
- [ ] Silence progress bar animation (left-to-right fill during silence gaps)
- [ ] Smart Cut dropdown: bilingual filler word lists (EN + HE)
- [ ] Independent highlight toggle (eye icon) — orange underline fillers, blue underline silence
- [ ] Independent cut toggle (scissors icon) — remove/restore filler words or silence-adjacent words

### Timeline Ruler (Step 3.2)
- [ ] Adaptive time marks (5s / 15s / 60s / 5min intervals based on duration)
- [ ] Click-to-seek on ruler
- [ ] Styled per design system (Space Grotesk labels, outline-variant ticks)

### Scrollbar Playback Indicator (Step 3.3)
- [ ] Playback position indicator on transcript scrollbar track
- [ ] Draggable — seek media by dragging indicator
- [ ] Auto-follow pauses during drag, resumes on release

---

## To Be Implemented (Backlog)

### Export Flyout Redesign (Step 3.1)
- [ ] Remove always-visible export aside from studio layout
- [ ] Add export flyout toggled from header toolbar button
- [ ] Click-outside closes flyout

### Dashboard Phase Navigation (Phase 4)
- [ ] Split-button on project cards (Open / Configure based on transcription state)
- [ ] Dropdown caret reveals "Configure Pipeline" / "Open Player"
- [ ] Route support for phase parameter

### Resizable Panels (Phase 5)
- [ ] Resizable clip sidebar (180–400px, drag handle)
- [ ] Resizable transcript panel (300–600px, drag handle)
- [ ] Hidden on mobile (≤1024px)

---

## Existing Backlog
- [ ] Show audio player only
- [ ] Fix remove word(s)
- [ ] Improve sync playback-transcript
- [ ] Add segmentation support: cut existing segment
- [ ] Add segments reorder (drag & drop on timeline)
- [ ] Transcription plugins: explore whether possible to show progress
- [ ] Segmentation: support tags (filter by, apply same color)
- [ ] For every plugin: add description for its capabilities list
- [ ] Transcription plugin: add support for speakers diarization if possible by plugin
- [ ] Support selecting word(s) —  highlight differently than current word
- [] selected word(s) - have a specific menue - remove, mute.
- [] muted words have visual indication, diffrent than removed
- [] export - support export by segments, tags
- [] transcription plugin - add suport for fixing words. let user choose on plugin panel 
- [] transcription panel (player) - support fix words
- [] performance - upload file if not in cache, upload file in server side - not through browser,  try transcribe mutiple parts simoulanslycopl