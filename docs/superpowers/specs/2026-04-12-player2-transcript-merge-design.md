# Player V2 — Transcript Header/Footer Merge

**Date:** 2026-04-12  
**Component:** `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` + `.scss`  
**Approach:** Surgical restore of UI improvements from commit 552e982, merged with cut-region/effect system from commits 60ec0f6–d6b9625.

---

## Background

Two sets of improvements diverged:

| Version | What it had |
|---|---|
| 552e982 (previous v2) | Collapsible search, silence popover + slider, icon-only smart cut, vertical side label, chip-count spans in status bar |
| HEAD (current) | Cut-region/effect system (popover per word, effect pills, striped timeline overlay), always-visible search, bare number input for silence, full-text Smart Cut button |

Goal: combine both — restore the compact/polished UI patterns from 552e982 while keeping all cut-region/effect features intact.

---

## Scope

Only `txt-media-player-v2.component.ts` and `txt-media-player-v2.component.scss` are modified. No other files change.

---

## Template Changes

### 1. Transcript section — side label + wrapper

The transcript `<section>` gets a vertical side label and a content wrapper:

```html
<section class="transcript-section">
  <div class="transcript-side-label"><span>TRANSCRIPT</span></div>
  <div class="transcript-content-wrapper">
    <!-- header + body + status-bar -->
  </div>
</section>
```

### 2. Header row 1 — replace title group with icon badge

Replace the `hdr-title-group` (text "Transcript" + "AUTO-GEN" span) with the compact brain icon badge from 552e982:

```html
<div class="hdr-group">
  <div class="auto-badge-icon" title="Auto-Generated Transcript">
    <span class="material-symbols-outlined">psychology</span>
  </div>
</div>
<div class="spacer"></div>
```

Keeps: edit group (restore/undo/redo), selection group (cut/restore/jumpcut), auto-follow.

### 3. Header row 2 — collapsible search + icon-only tools

Replace the current row 2 (always-visible input + bare number + full Smart Cut button) with:

```
[search-wrap (collapsible)] [spacer] [silence-control-wrap] [smart-cut-wrap] [effect-pills-wrap]
```

**Search** — toggle button expands/collapses the input:
```html
<div class="search-wrap" [class.expanded]="searchExpanded()">
  <button class="hdr-btn search-trigger" (click)="searchExpanded.set(!searchExpanded())">
    <span class="material-symbols-outlined">search</span>
  </button>
  <input class="search-input" ... />
</div>
```

**Silence** — icon button opens a popover with number input + range slider:
```html
<div class="silence-control-wrap">
  <button class="hdr-btn" [class.active]="silenceControlOpen()"
    (click)="silenceControlOpen.set(!silenceControlOpen())">
    <span class="material-symbols-outlined">timer</span>
  </button>
  @if (silenceControlOpen()) {
    <div class="silence-dropdown popover">
      <!-- si-header with label + number input -->
      <!-- si-slider range input -->
    </div>
  }
</div>
```

**Smart Cut** — icon-only button (was `auto_fix_high`); existing dropdown content unchanged:
```html
<button class="smart-cut-trigger" (click)="smartCutOpen.set(!smartCutOpen())">
  <span class="material-symbols-outlined">auto_fix_high</span>
</button>
```
Remove the "Smart Cut" text label and the `sc-caret` chevron.

**Effect pills** — kept exactly as-is (hard-cut / fade / cross-cut).

### 4. Status bar — chip-count spans

Each chip that shows a count gets a separate `<span class="chip-count">`:

```html
<span class="status-chip">
  <span class="material-symbols-outlined">select_all</span>
  <span class="chip-count">{{ selectedCount() }}</span>
</span>
```

The "selected" / "removed" text labels are removed; the count is communicated via the icon title and the numeric span.

---

## TypeScript Changes

Two new signals (no logic changes):

```ts
readonly searchExpanded = signal(false);
readonly silenceControlOpen = signal(false);
```

`moreMenuOpen` is **not** restored — there is no overflow menu in this design (selection actions are permanently in row 1).

---

## SCSS Changes

Add the following blocks (all verbatim from 552e982, no modifications):

- `.transcript-side-label` — 36px wide vertical label
- `.transcript-content-wrapper` — flex column wrapping header + body + status bar
- `.auto-badge-icon` — brain-icon badge styling
- `.spacer` — `flex: 1` utility
- `.inline-tools` — flex row for row-2 tool groups
- `.popover` — base absolute popover card (surface-container-highest, border-radius 12px, shadow)
- `.silence-control-wrap` — `position: relative` wrapper
- `.silence-dropdown` — popover content (si-header, si-label, si-value, si-input, si-slider, si-unit)
- `.search-wrap` collapsible styles — width 0→140px transition on `.expanded`
- `.chip-count` — small numeric label inside status chips

Update `.smart-cut-trigger` — remove the text-button styles (padding, text label, caret); the button becomes a plain `.hdr-btn`.

All existing styles (`.hdr-btn`, `.hdr-group`, `.hdr-divider`, `.transcript-header`, `.transcript-body`, `.status-bar`, `.status-chip`, `.filler-badge`, `.effect-popover`, `.cut-region-overlay`, etc.) are **unchanged**.

---

## What Is Explicitly Not Changed

- All cut-region/effect logic (`CutRegionService`, `EffectPlayerService`, `applyCutRegionChange`, etc.)
- Effect popover on removed words (`.filler-badge` + `.effect-popover`)
- Cut-region timeline overlays
- Effect pills (hard-cut / fade / cross-cut)
- Word flow rendering
- Virtualization logic
- Playback / keyboard shortcut logic

---

## Acceptance Criteria

1. Search input is hidden by default; clicking the search icon reveals it with a smooth width animation.
2. Silence threshold is controlled via a popover (icon button → popover with number input + slider); inline number input in row 2 is gone.
3. Smart Cut button is icon-only (no text, no caret).
4. Vertical "TRANSCRIPT" side label is visible on the left edge of the transcript panel.
5. Status bar chips show icon + separate numeric count (no trailing text like "selected" / "removed").
6. All cut-region/effect features (per-word effect popover, timeline overlays, effect pills) work identically to before.
7. No TypeScript errors; no new `any` usages introduced.
