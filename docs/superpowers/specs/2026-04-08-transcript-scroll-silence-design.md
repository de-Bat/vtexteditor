# Transcript Panel: Auto-Follow Scroll + Silence Markers Toggle

**Date:** 2026-04-08
**Status:** Approved

## Features

Two independent but co-delivered improvements to `txt-media-player-v2`:

1. **Auto-follow scroll** — user can scroll away from the active word; a mode indicator and return button let them snap back and re-enable following.
2. **Silence markers** — segment gap markers are hidden by default; opt-in via App Settings, overridable per pipeline run.

---

## 1. Auto-Follow Scroll

### Problem

The transcript always scrolls to the active word. The user cannot scroll up to review earlier text without being immediately dragged back.

### Design

**New signal:** `autoFollow = signal(true)`

**Detecting manual scroll:**
A private boolean flag `private suppressScrollDetection = false` is set to `true` immediately before any programmatic scroll (`scrollIntoView`, `scrollTo`), then cleared after 150 ms. In `onTranscriptScroll()`, if `suppressScrollDetection` is `true`, skip — otherwise set `autoFollow(false)`.

**`scrollToCurrentWord()`:** Guard at the top — return immediately if `!this.autoFollow()`.

**Mode indicator:** A small toggle button always visible in the transcript header. Shows:
- `"Following"` + `my_location` icon when `autoFollow()` is true
- `"Paused"` + `location_disabled` icon when false

Clicking it toggles `autoFollow`. When toggling back to `true`, immediately call `scrollToCurrentWord()`.

**Return button:** Shown only when `!autoFollow()`. A pill/button in the transcript header: `"↩ Return to current"`. Clicking it sets `autoFollow(true)` and calls `scrollToCurrentWord()`. The mode indicator button alone already covers this, so the return button is a secondary affordance for discoverability.

### Files

- `txt-media-player-v2.component.ts` only — template + logic.

---

## 2. Silence Markers Toggle

### Problem

Segment gap markers (silence rows between segments) are always shown. Most users find them visual noise. They should be off by default, opt-in per user preference, overridable per run.

### Design

**App setting:** Add `SHOW_SILENCE_MARKERS` to `KNOWN_SETTING_KEYS` (server `settings.service.ts`) and `SETTING_META` (client `settings.service.ts`). Default when absent: `false`.

**Clip model** (`client/src/app/core/models/clip.model.ts` and server equivalent):
Add `showSilenceMarkers?: boolean`. Existing clips without the field default to `false` via `??`.

**Whisper plugin** (`whisper-openai.plugin.ts`):
- Add `showSilenceMarkers: boolean` to `configSchema` with `default: false`.
- Add `showSilenceMarkers: 'SHOW_SILENCE_MARKERS'` to `settingsMap` so the route pre-fills it from the app setting.
- In `execute()`, read `cfg.showSilenceMarkers` and write it onto the built `Clip`.

**`GET /api/plugins` route:** Already handles `settingsMap` injection (delivered in prior session). No additional changes.

**Transcript component** (`txt-media-player-v2.component.ts`):
Wrap the silence marker row in:
```
@if (clip().showSilenceMarkers && item.silenceAfter; as sil) { … }
```

### Data Flow

```
User sets SHOW_SILENCE_MARKERS=true in App Settings (persisted)
→ GET /api/plugins injects it as showSilenceMarkers.default=true in whisper schema
→ Plugin panel pre-fills showSilenceMarkers=true (user can override to false)
→ Pipeline run: whisper execute() sets clip.showSilenceMarkers = cfg.showSilenceMarkers
→ Transcript viewer: clip().showSilenceMarkers controls silence row visibility
```

### Files

- `server/src/services/settings.service.ts` — add `SHOW_SILENCE_MARKERS` to known keys
- `server/src/plugins/transcription/whisper-openai.plugin.ts` — configSchema + settingsMap + execute
- `client/src/app/core/services/settings.service.ts` — add to `SettingKey` + `SETTING_META`
- `client/src/app/core/models/clip.model.ts` — add `showSilenceMarkers?`
- `server/src/models/plugin.model.ts` — same Clip model update (if separate)
- `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` — template guard

---

## Out of Scope

- Silence markers for non-whisper plugins (srt-import, groq) — they don't produce gap metadata today.
- Persisting per-run override back to app settings.
- Per-clip display settings panel.
