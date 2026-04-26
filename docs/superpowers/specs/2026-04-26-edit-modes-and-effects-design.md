# Edit Modes & Edit Effects — Design Spec

**Date:** 2026-04-26
**Scope:** `client/src/app/features/studio/txt-media-player-v2/` (V2 only — V1 frozen)

## 1. Goal

Introduce two distinct **editing modes** that change how transcript edits (word cut/restore + text edits) flow into the saved clip state, and rename/extend the **cut effect** taxonomy.

### 1.1 Editing modes

- **Live edit** — every change reflects immediately in the clip and is persisted (current behavior).
- **Apply edit** — changes are staged as **pending**; preview-during-playback uses the pending state, but persistence only happens when the user clicks **Apply**.

### 1.2 Cut effect types (renamed + extended)

| Old | New |
|-----|-----|
| `hard-cut` | `clear-cut` |
| `fade` | `fade-in` |
| `cross-cut` | `cross-cut` (unchanged) |
| — | `smart` (new) |

**Smart** = heuristic chooses the actual rendered effect per region; adaptive duration as fallback.

## 2. Non-goals

- V1 player (`txt-media-player`) is **not** updated.
- No collaborative/multi-user pending semantics.
- No per-pending-region individual discard button (selection-based discard only).

## 3. Data model

### 3.1 `EffectType` (`core/models/cut-region.model.ts`)

```ts
export type EffectType = 'clear-cut' | 'fade-in' | 'cross-cut' | 'smart';
```

Server read mapping: `'hard-cut'` → `'clear-cut'`, `'fade'` → `'fade-in'`. Server write path accepts new names only; legacy stored values are migrated lazily on next save. (One-shot migration script optional.)

### 3.2 `CutRegion`

```ts
export interface CutRegion {
  id: string;
  wordIds: string[];
  startTime?: number;
  endTime?: number;
  effectType: EffectType;
  effectTypeOverridden: boolean;
  effectDuration: number;
  durationFixed: boolean;
  // NEW
  pending?: boolean;                 // true => staged, not saved
  pendingKind?: 'add' | 'remove';    // 'add' = staged new cut; 'remove' = staged restore (refers to a committed region)
  pendingTargetId?: string;          // when pendingKind === 'remove', id of committed region this cancels
  resolvedEffectType?: EffectType;   // cached resolution when effectType === 'smart'
}
```

### 3.3 `Word` (`core/models/word.model.ts`)

```ts
export interface Word {
  // ... existing fields
  pendingText?: string;  // staged text edit; render this w/ amber dashed underline
}
```

`pendingText` and `CutRegion.pending*` are **client-only** — stripped before persisting.

## 4. State

### 4.1 `SettingsService` (extend)

`SettingsService` today is a thin server-backed key/value store (`load()` / `save()`) with no in-memory signals. Extend it:

- New `SettingKey` value: `'DEFAULT_EDIT_MODE'`. Stored as string `'live'` or `'apply'`.
- Add a reactive cache exposed as `defaultEditMode = signal<'live' | 'apply'>('live')`.
- On app boot (existing `load()` flow), populate the signal from the loaded map. Writing to `defaultEditMode` updates the signal **and** issues a `save({ DEFAULT_EDIT_MODE: '<value>' })`.

Add a `SETTING_META` entry so it surfaces in the settings panel.

### 4.2 `TxtMediaPlayerV2Component` (extend)

```ts
readonly editModeOverride = signal<'live' | 'apply' | null>(null);
readonly editingMode = computed<'live' | 'apply'>(() =>
  this.editModeOverride() ?? this.settings.defaultEditMode()
);

// Rename existing `editMode` (contenteditable toggle) -> `textEditMode`
readonly textEditMode = signal(false);
```

Override resets to `null` on clip change.

## 5. Cut / restore flow

`CutRegionService` extended: every mutating method takes a `pending: boolean` param.

```ts
cut(clip, wordIds, defaultEffectType, pending: boolean): { clip, entry }
restore(clip, wordIds, pending: boolean): { clip, entry }
updateRegionEffect(clip, regionId, effectType, pending: boolean): { clip, entry }
updateRegionDuration(clip, regionId, ms, pending: boolean): { clip, entry }
```

### 5.1 Live mode

`pending = false`. Behavior identical to today: regions written into `clip.cutRegions`, save fires after 1s debounce.

### 5.2 Apply mode

`pending = true`. Pending entries co-exist with committed regions in `clip.cutRegions`:

- **Staged new cut** → new region with `pending: true, pendingKind: 'add'`. Adjacent pending-add regions merge with each other (same logic as live `cut`), but never merge with committed regions until applied.
- **Staged restore touching a committed region** → for each committed region whose `wordIds` intersects the restore selection, create one `pending: true, pendingKind: 'remove', pendingTargetId: <committed.id>, wordIds: <intersection>` entry. The committed region itself stays untouched until apply. Multiple committed regions touched by one selection produce multiple pending-remove entries.
- **Staged restore touching a pending-add region** → mutate the pending-add region in place (drop the restored wordIds, splitting if needed) — no pending-remove entry. If the pending-add region is fully restored, drop it entirely.

### 5.3 `syncIsRemoved` rewrite

Compute the **effective removed wordId set**:

```
removed =
  ⋃ committedRegion.wordIds              (every region with pending !== true)
  ∪ ⋃ pendingAddRegion.wordIds           (pending: true, pendingKind: 'add')
  \ ⋃ pendingRemoveRegion.wordIds        (pending: true, pendingKind: 'remove')
```

Then `word.isRemoved = removed.has(word.id)`. This single pass replaces the existing implementation.

### 5.4 Effect picker on a pending region

Setting `effectType` on a pending region works the same as on a committed one but writes through the `pending: true` path — no save fires.

## 6. Text edit flow

### 6.1 Live mode

Blur on `contenteditable` word → `word.text = newText`, `isEdited = true`, save via existing `updateWordStates`.

### 6.2 Apply mode

Blur → `word.pendingText = newText`. `word.text` unchanged.
Render: if `pendingText` exists, show `pendingText` w/ amber dashed underline + `*` prefix; tooltip = `Original: <word.text>`.

### 6.3 `isTranscriptEdited` computed

Includes both `isEdited` words and words with `pendingText`.

## 7. Apply / Discard

### 7.1 New service: `PendingEditsService`

```ts
@Injectable({ providedIn: 'root' })
export class PendingEditsService {
  hasPending(clip: Clip): boolean
  pendingCount(clip: Clip): { cuts: number; restores: number; texts: number; total: number }
  applyAll(clip: Clip): Observable<Clip>
  discardAll(clip: Clip): Clip
  applySelection(clip: Clip, wordIds: string[]): Observable<Clip>
  discardSelection(clip: Clip, wordIds: string[]): Clip
}
```

### 7.2 `applyAll` algorithm

1. Walk `clip.cutRegions`:
   - For each `pending: true, pendingKind: 'add'` → flip `pending = false`, drop `pendingKind`.
   - For each `pending: true, pendingKind: 'remove'` → drop both this entry **and** the committed region with id === `pendingTargetId`.
2. Walk all words: if `pendingText`, set `word.text = pendingText`, `word.isEdited = true`, delete `pendingText`.
3. Persist:
   - `clipService.updateCutRegions(clip.id, finalRegions)` (strip all `pending*` fields).
   - `clipService.updateWordStates(clip.id, [...word edits])` for words with text changes.
   - Both via `forkJoin` → single completion.
4. Record one history entry `{ kind: 'apply-batch', operations: [...] }` for atomic undo.
5. Toast: `"N pending edits applied"`.

### 7.3 `discardAll`

- Drop every region with `pending: true`.
- Clear `pendingText` on every word.
- No history entry (pending was never recorded).

### 7.4 Selection variants

`applySelection` / `discardSelection` operate only on regions whose `wordIds` intersect `wordIds` arg, and on words in that arg with `pendingText`.

### 7.5 Floating Apply pill

Position: absolute, top-right of `.preview-area` in V2 template.
Visible when `pendingEdits.hasPending(clip())` is true.
Layout:

```
[ Apply (N) ▾ ]
            └─ Discard all
            └─ Apply selected   (when selection > 0)
            └─ Discard selected (when selection > 0)
```

Glow pulse animation when count increases. Confirm dialog for `Discard all` if N > 5.

## 8. Smart effect heuristic

### 8.1 New service: `SmartEffectService`

Pure deterministic resolver.

```ts
@Injectable({ providedIn: 'root' })
export class SmartEffectService {
  resolve(clip: Clip, region: CutRegion): { effectType: Exclude<EffectType, 'smart'>; durationMs: number }
}
```

### 8.2 Rules (first match wins)

1. **Cross-segment**: region wordIds span ≥ 2 segments → `cross-cut`, 350 ms.
2. **Sentence boundary**: region contains a word ending in `.!?` AND its successor begins a new sentence (capitalized in EN, or follows punctuation in HE) → `cross-cut`, 300 ms.
3. **Long pause cut**: removed audio span ≥ 1.5 s → `fade-in`, 400 ms.
4. **Mid-sentence with internal pause**: any adjacent word-pair inside region has gap ≥ 0.6 s → `fade-in`, 250 ms.
5. **Filler-style**: region.wordIds.length ≤ 2 AND removed audio ≤ 600 ms → `clear-cut`, 0 ms.
6. **Default**: `clear-cut`, `autoEffectDuration(removedMs)`.

### 8.3 Caching

`resolve` writes to `region.resolvedEffectType` and `region.effectDuration` (when `effectType === 'smart'`). Cache invalidated when `region.wordIds` array changes (use length+first+last id as cheap signature).

### 8.4 Playback integration

`EffectPlayerService.playEffect(region)`:

```ts
if (region.effectType === 'smart') {
  const resolved = smartEffect.resolve(clip, region);
  // play resolved effect using resolved.durationMs
} else {
  // existing path
}
```

## 9. UI changes

### 9.1 Settings panel

`features/onboarding/settings-panel/settings-panel.component.ts` — add row "Default Edit Mode" with segmented `Live | Apply` toggle bound to `SettingsService.defaultEditMode`.

### 9.2 V2 header toolbar

In the existing `header-row1 > hdr-group`, add a `Live | Apply` segmented pill alongside the textEditMode button. Click flips `editModeOverride`. Hover state shows reset hint when override differs from global default.

### 9.3 Pending styling (`txt-media-player-v2.component.scss`)

- `.filler-badge.pending` (pending-add cut): amber dashed strikethrough, `border: 1px dashed #f59e0b`, bg `rgba(245,158,11,0.12)`.
- `.word.pending-restore` (pending-remove referencing committed): amber dashed underline, normal text color.
- `.word.pending-text` (`pendingText` non-empty): amber dashed underline, `*` prefix; tooltip via `[title]="'Original: ' + word.text"`.
- `.cut-region-overlay.pending`: dashed amber border on timeline.

### 9.4 Effect picker

Existing `.effect-pills-wrap` + per-region popover labels updated:

- `Clear Cut` (icon: `content_cut`)
- `Fade In` (icon: `blur_on`)
- `Cross` (icon: `shuffle`)
- `Smart` (icon: `auto_awesome`) — NEW

### 9.5 Floating Apply pill

```
.preview-area {
  position: relative;
}
.apply-pill {
  position: absolute; top: 12px; right: 12px;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  background: var(--color-accent); color: #fff;
  box-shadow: 0 0 0 2px rgba(245,158,11,0.35);
  animation: pendingPulse 1.6s ease-in-out infinite;
}
```

## 10. Mode switch behavior

| From | To | Pending? | Action |
|------|----|----------|--------|
| Live | Apply | n/a | Instant flip |
| Apply | Live | none | Instant flip |
| Apply | Live | yes | Auto `applyAll` → toast → flip |
| any | clip change | yes | Auto `applyAll` on previous clip → load new |
| any | component destroy | yes | Auto `applyAll` (best-effort, fire and forget) |

`editModeOverride` reset to `null` on clip change.

## 11. Persistence

- `CutRegion.pending`, `pendingKind`, `pendingTargetId`, `resolvedEffectType` and `Word.pendingText` are **never** sent to server. `PendingEditsService.serializeForSave(clip)` strips them.
- `EffectType` rename: server read normalizes legacy values; write rejects legacy values.
- `SettingsService.defaultEditMode`: persisted as `DEFAULT_EDIT_MODE` setting via existing `/settings` PUT endpoint. Loaded into the signal on app boot.

## 12. Testing

- `cut-region.service.spec.ts` — pending param across cut/restore/updateRegionEffect/updateRegionDuration. Covers pending-add merge, pending-remove targeting committed, syncIsRemoved combined view.
- `pending-edits.service.spec.ts` — applyAll/discardAll/selection variants; serializeForSave strips client fields.
- `smart-effect.service.spec.ts` — fixture clip for each rule; cache invalidation on wordIds change.
- `txt-media-player-v2.component.spec.ts` — mode toggle UI, pending word rendering, floating Apply visibility/menu, mode-switch auto-apply, history entry shape.
- E2E (manual): enter Apply mode → cut 3 words → playback shows jump-cut preview → Apply → single PATCH → reload preserves cuts.

## 13. Out-of-scope follow-ups

- Background "auto-save draft" of pending edits (currently lost on browser crash).
- Per-segment lock that forces Apply mode regardless of global default.
- Conflict UI when two pending edits target the same region (current model just drops/cancels).
