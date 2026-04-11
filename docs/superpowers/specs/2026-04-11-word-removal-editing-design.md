# Word Removal Editing with Smart Effects — Design Spec

**Date:** 2026-04-11
**Status:** Approved

---

## Summary

Add first-class word-removal editing with transition effects (hard cut, fade, cross-cut) reflected in both browser preview and exported video. Removals are modelled as `CutRegion` entities with a global default effect type and per-removal override. The existing `Word.isRemoved` flag is kept as a **derived mirror** of the `CutRegion` array to contain migration scope.

---

## 1. Data Model

### `CutRegion`

```ts
type EffectType = 'hard-cut' | 'fade' | 'cross-cut';

interface CutRegion {
  id: string;                    // uuid
  wordIds: string[];              // ordered IDs of removed words (contiguous span)
  effectType: EffectType;
  effectTypeOverridden: boolean;  // true = user explicitly set, false = inherits global default
  effectDuration: number;         // ms, auto-calculated or user-pinned
  durationFixed: boolean;         // true = user pinned, skip auto-recalc
}
```

### `isRemoved` stays as a derived mirror

The `isRemoved` field on `Word` is **kept**. It is treated as derived state: whenever `cutRegions` change, a sync function sets `word.isRemoved = true` for every word in any region and `false` otherwise. This contains the blast radius — transcription plugins, server-side models, and non-editing code paths continue using `isRemoved` unchanged. All **editing-path** code (selection, Cut action, undo/redo, effect override) reads and writes `cutRegions` as the source of truth.

### Auto-duration formula

```
effectDuration = clamp(removedContentDuration_ms * 0.1, 150, 500)
```

Where `removedContentDuration_ms` is the wall-clock span from the start of the first removed word to the end of the last removed word in the region. Larger cuts get proportionally longer transitions, within a 150–500 ms range. Recalculated whenever the region's word membership changes, unless `durationFixed = true`.

### Global default

A `defaultEffectType: Signal<EffectType>` on the player component (default: `'hard-cut'`). New `CutRegion`s inherit this type with `effectTypeOverridden = false`.

### Clip model extension

```ts
interface Clip {
  // ... existing fields
  cutRegions: CutRegion[];
}
```

Word IDs are globally unique (uuid), so region membership lookups work without needing segment scoping. Regions are stored per-clip because removals don't cross clip boundaries.

---

## 2. Interaction / UX

### Removing words

Select words → Cut in Action Footer → words are bundled into a new `CutRegion` with the global default `effectType` (`effectTypeOverridden = false`) and auto-calculated `effectDuration`. Commit is immediate — playback reflects the effect at once. If the selection is adjacent to one or more existing `CutRegion`s, all touched regions merge into one. **Merge effect-type precedence:** if any merged region has `effectTypeOverridden = true`, its effect type wins (first-wins among overrides); otherwise the earliest region's type is used.

### Per-removal effect override

Clicking an already-removed filler-badge (left-click, not right-click) opens a small popover anchored to that word:
- Effect type selector: **Hard Cut / Fade / Cross-cut** (pill buttons). Selecting a type sets `effectTypeOverridden = true`.
- Duration chip: shows auto-calculated value; click to pin and edit (number input, 150–500 ms range). Pinning sets `durationFixed = true`.
- "Reset to default" link — clears `effectTypeOverridden` (re-inherits global default) and `durationFixed` (re-auto-calculates).

Clicking a kept (normal) word preserves the existing selection behavior.

### Global default selector

A small effect-type pill group added to the Action Footer right section (alongside Smart Cut). Changing it updates all `CutRegion`s where `effectTypeOverridden = false`. Regions with overrides are untouched.

---

## 3. Playback Simulation

Effects are simulated in the browser at each `CutRegion` boundary during `timeupdate`.

### Hard cut
Existing jump-cut behavior — seek to first kept word after the region. No change.

### Fade

When the playhead reaches `effectDuration / 2` ms before the end of the last kept word before a `CutRegion`:

1. Ramp `GainNode` 1 → 0 over `effectDuration / 2` ms (`linearRampToValueAtTime`)
2. Animate video `opacity` 1 → 0 via CSS transition (signal-driven)
3. Seek to first kept word after the region
4. Ramp gain 0 → 1 and opacity 0 → 1 over `effectDuration / 2` ms

**Tradeoff acknowledged:** the fade eats into the tail of the last kept word and the head of the first kept word after the region. This is the standard behavior for non-linear editor crossfades and matches the export result. The 150–500 ms range keeps the eaten content minimal.

### Cross-cut

At the boundary:

1. Hard seek (no opacity change)
2. Audio crossfade: gain envelope overlap over `effectDuration` ms — outgoing tail fades out as incoming fades in
3. Brief `brightness(1.4)` CSS filter spike (~80 ms) on the video frame for visual feedback

**Preview vs. export parity note:** the preview uses a brightness flash instead of a true visual dissolve (which would require a second video element for frame compositing). The export uses ffmpeg's `xfade` filter for a true visual crossfade. Preview is therefore an approximation of the export output — documented in a tooltip on the cross-cut selector: "Preview is approximate; export renders a true video crossfade."

### Audio routing

`<video>`/`<audio>` element connected via `createMediaElementSource` → `GainNode` → `AudioContext.destination`. One-time setup in `MediaPlayerService`.

**Known complications:**
- `AudioContext` must be resumed after a user gesture (autoplay policy)
- `createMediaElementSource` requires CORS-compatible sources (our media is same-origin proxied, so OK)
- Once the element is routed through Web Audio, all audio — even hard-cut playback — goes through the `GainNode`. Default gain stays at 1.0 when no effect is active.

### Performance
- Audio scheduling uses `AudioContext.currentTime` with Web Audio API ramps — no `setTimeout` for audio
- Visual transitions are CSS `transition` properties toggled via Angular signals
- `GainNode` is created once and reused across effects

---

## 4. Export

### API change

**No request body changes.** The export service reads `cutRegions` directly from the clip store (`clipService.getAll(projectId)`) — regions already live on `Clip`, so no redundant client→server payload. The `activeWords` filter in `exportVideo` keeps working unchanged because `isRemoved` is synced from `cutRegions` on the client before save.

### Hard cut
Existing `concat` filter chain — no change.

### Fade

At each `CutRegion` boundary, insert an audio/video fade pair on the surrounding kept segments:
- Outgoing segment tail: `afade=t=out:st={fadeOutStart}:d={halfDuration}` + `fade=t=out:st={fadeOutStart}:d={halfDuration}`
- Incoming segment head: `afade=t=in:st=0:d={halfDuration}` + `fade=t=in:st=0:d={halfDuration}`
- Concatenated via `concat=n={N}:v=1:a=1`

`halfDuration = effectDuration / 2000` (converted from ms to seconds for ffmpeg).

### Cross-cut

- **Video:** `xfade=transition=fade:duration={duration_s}:offset={offset_s}` between outgoing and incoming video segments — a true visual crossfade
- **Audio:** `acrossfade=d={duration_s}:c1=tri:c2=tri` between outgoing and incoming audio segments

Both filter chains composed into the existing `complexFilter` pipeline. `xfade` consumes `effectDuration` ms of each surrounding kept segment for the overlap.

### Duration source
`CutRegion.effectDuration` (ms) is read from the clip store server-side; converted to seconds for ffmpeg arguments.

---

## 5. Undo / Redo

`EditHistoryService` entries change shape to track `CutRegion` lifecycle:

```ts
type HistoryEntry =
  | { kind: 'add-region';    region: CutRegion }
  | { kind: 'remove-region'; region: CutRegion }
  | { kind: 'merge-region';  before: CutRegion[]; after: CutRegion }
  | { kind: 'edit-effect';   regionId: string; before: Partial<CutRegion>; after: Partial<CutRegion> }
```

| Action | History entry | Undo behaviour |
|--------|--------------|----------------|
| Cut (new region) | `add-region` | Remove the `CutRegion`; re-sync `isRemoved` |
| Cut (merged into existing) | `merge-region` | Split back into original regions |
| Effect override change | `edit-effect` | Restore previous `effectType` / `effectTypeOverridden` / `effectDuration` / `durationFixed` |
| Restore (un-cut) | `remove-region` | Re-add the region |
| Global default change | Not recorded | Changing the global default is a UI preference, not an edit |

After any undo/redo that modifies `cutRegions`, the `isRemoved` sync function runs to keep the derived mirror consistent.

`Ctrl+Z` / `Ctrl+Shift+Z` keyboard shortcuts unchanged.

---

## 6. Word Visual States (updated)

| State | Visual |
|-------|--------|
| Normal | Existing style |
| Removed — committed | Existing filler-badge style (error color, italic, dashed border) |
| Removed — effect override active | Small colored dot on filler-badge top-right corner (effect type color: purple=fade, amber=cross-cut, no dot for hard-cut) |

The override dot uses existing palette tokens (`primary` for fade, `tertiary` for cross-cut) at full opacity for AA contrast.

---

## 7. Segment Timeline Behavior

The segment timeline bar (ui-design §3.2) currently shows segment blocks at their original time positions with a playhead overlay. With `CutRegion`s added:

- Original segment positions and widths are **preserved** (the timeline shows source time, not edited time)
- `CutRegion` spans are rendered as a **dimmed overlay** (striped pattern at 40% opacity) on top of the affected segment blocks
- The playhead continues to follow wall-clock time during playback; when it enters a cut region, the effect plays as described in §3 and the playhead visibly jumps past the region

This keeps the timeline honest about source media and lets the user see where their cuts are relative to the whole clip.

---

## 8. Out of Scope

- Dissolve / wipe / other transition types beyond fade and cross-cut
- Per-word (rather than per-region) effect control
- Staged/preview editing mode with an Apply button (cuts are always committed immediately)
- Multi-select editing of multiple cut regions at once (override popover operates on one region at a time)
- Mobile/touch adaptations (studio view is desktop-only, ≥1024px)
