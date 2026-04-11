# Word Removal Editing with Smart Effects — Design Spec

**Date:** 2026-04-11
**Status:** Approved

---

## Summary

Add first-class word-removal editing with transition effects (hard cut, fade, cross-cut) reflected in both browser preview and exported video. Removals are modelled as `CutRegion` entities — replacing the current `isRemoved` flag — with a global default effect type and per-removal override. Supports both immediate (live) and staged (apply-button) editing modes.

---

## 1. Data Model

### `CutRegion`

```ts
type EffectType = 'hard-cut' | 'fade' | 'cross-cut';

interface CutRegion {
  id: string;           // uuid
  wordIds: string[];    // ordered IDs of removed words (contiguous span)
  effectType: EffectType;
  effectDuration: number;   // ms, auto-calculated or user-pinned
  durationFixed: boolean;   // true = user pinned, skip auto-recalc
}
```

### `isRemoved` becomes derived

A word is considered removed if its `id` appears in any `CutRegion.wordIds` for the current clip. The `isRemoved` field on `Word` is removed; all removal lookups go through the `CutRegion` list.

### Auto-duration formula

```
effectDuration = clamp(gapToNextKeptWord_ms * 0.6, 80, 600)
```

Recalculated whenever adjacent words change, unless `durationFixed = true`.

### Global default

A `defaultEffectType: Signal<EffectType>` on the player component (default: `'hard-cut'`). New `CutRegion`s inherit this type; duration is always auto-calculated unless pinned.

### Clip model extension

```ts
interface Clip {
  // ... existing fields
  cutRegions: CutRegion[];
}
```

---

## 2. Interaction / UX

### Removing words

Select words → Cut in Action Footer → words are bundled into a new `CutRegion` with the global default `effectType` and auto-calculated `effectDuration`. If the selection is adjacent to an existing `CutRegion`, the regions merge (effect type preserved from the existing region).

### Live vs. Stage mode

A toggle in the Action Footer switches editing mode:

| Mode | Behaviour |
|------|-----------|
| **Live** (default) | Cut commits immediately; playback reflects the effect at once |
| **Stage** | Removed words enter a "pending" visual state; a floating "Apply" button appears. Playback previews the effect. Apply commits all pending regions; Discard rolls them back as a single undo batch. |

Pending words use a distinct visual style: lighter opacity dashed badge (vs. the solid error-color badge for committed removals).

### Per-removal effect override

Right-clicking a filler-badge opens a small popover anchored to that word:
- Effect type selector: **Hard Cut / Fade / Cross-cut** (pill buttons)
- Duration chip: shows auto-calculated value; click to pin and edit (number input, 80–600 ms range)
- "Reset duration" link when pinned (`durationFixed → false`, recalculates)

### Global default selector

A small effect-type pill group added to the Action Footer right section (alongside Smart Cut). Changing it updates all `CutRegion`s where `effectType` was inherited (i.e., not explicitly overridden by the user).

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

Audio routing: `<video>`/`<audio>` element connected via `createMediaElementSource` → `GainNode` → `AudioContext.destination`. One-time setup in `MediaPlayerService`.

### Cross-cut
At the boundary:

1. Hard seek (no opacity change)
2. Audio crossfade: gain envelope overlap over `effectDuration` ms — outgoing tail fades out as incoming fades in
3. Brief `brightness(1.4)` CSS filter spike (~80 ms) on the video frame for the cross-cut flash feel

### Stage mode playback
Pending (uncommitted) `CutRegion`s are treated identically to committed ones during preview — the user hears/sees the effect before applying.

### Performance
- Audio scheduling uses `AudioContext.currentTime` with Web Audio API ramps — no `setTimeout` for audio
- Visual transitions are CSS `transition` properties toggled via Angular signals
- `GainNode` is created once and reused across effects

---

## 4. Export

### API change

Export request body gains a `cutRegions: CutRegion[]` field. If absent, the server falls back to existing hard-cut logic (backwards compatible).

### Hard cut
Existing `concat` filter chain — no change.

### Fade
At each `CutRegion` boundary:
- Outgoing segment tail: `afade=t=out:st={fadeOutStart}:d={halfDuration}` + `fade=t=out:...`
- Incoming segment head: `afade=t=in:st=0:d={halfDuration}` + `fade=t=in:...`
- Concatenated via `concat=n={N}:v=1:a=1`

`halfDuration = effectDuration / 2` (converted from ms to seconds for ffmpeg).

### Cross-cut
- Audio: `acrossfade=d={duration_s}:c1=tri:c2=tri` between outgoing and incoming audio segments
- Video: hard cut (brightness flash is preview-only, not rendered to file)

### Duration source
`CutRegion.effectDuration` (ms) is passed directly; server converts to seconds for ffmpeg arguments.

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
| Cut | `add-region` | Remove the `CutRegion`; words become active |
| Merge | `merge-region` | Split back into original regions |
| Effect override | `edit-effect` | Restore previous `effectType` / `effectDuration` / `durationFixed` |
| Apply (stage mode) | Batch of `add-region` entries | Reverse the whole batch atomically |

`Ctrl+Z` / `Ctrl+Shift+Z` keyboard shortcuts unchanged.

---

## 6. Word Visual States (updated)

| State | Visual |
|-------|--------|
| Normal | Existing style |
| Removed — committed | Existing filler-badge style (error color, italic, dashed border) |
| Removed — pending (stage mode) | Lighter filler-badge: `rgba(44,44,47,0.25)` bg, `rgba(255,110,132,0.5)` text, dashed border |
| Removed — effect override active | Small colored dot on filler-badge corner (effect type color indicator) |

---

## 7. Out of Scope

- Dissolve / wipe / other transition types beyond fade and cross-cut
- Per-word (rather than per-region) effect control
- Transition preview in the segment timeline bar
