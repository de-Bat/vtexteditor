# Plugin Panel: Pre-fill from App Settings

**Date:** 2026-04-08
**Status:** Approved

## Problem

The whisper plugin panel shows blank fields for model, base URL, and language even when
those values are already configured in App Settings. The user must re-enter them for every
pipeline run.

## Goal

Pre-fill plugin config fields with current app setting values so the user sees their
configured defaults and can override them per-run without touching App Settings.

## Approach: Server injects defaults into configSchema (Option A)

The `GET /api/plugins` route already returns each plugin's `configSchema`. Before
responding, it clones the schema and injects current app setting values as `default`
for mapped fields. The client `plugin-options` component already reads `default` on
init to pre-fill fields — no client changes required.

## Changes

### 1. `server/src/models/plugin.model.ts` (or wherever `PluginMeta` is defined)

Add optional field:

```ts
settingsMap?: Partial<Record<string, SettingKey>>;
```

Maps schema property names → app setting keys. Only plugins that want pre-fill need
to declare this. Other plugins (srt-import, groq) are unaffected.

### 2. `server/src/plugins/transcription/whisper-openai.plugin.ts`

Add to the plugin definition:

```ts
settingsMap: {
  model:   'WHISPER_MODEL',
  baseURL: 'WHISPER_BASE_URL',
  language: 'WHISPER_LANGUAGE',
},
```

### 3. `server/src/routes/plugin.routes.ts` — `GET /api/plugins`

For each plugin with a `settingsMap`:
- Deep-clone `configSchema`
- For each mapped field, read the current setting value from `settingsService`
- If a value exists, write it as `properties[field].default`

Return the enriched schema. Original plugin objects are never mutated.

### 4. Client — no changes

`plugin-options.component` already does:

```ts
const def = props[key]['default'];
if (def !== undefined) this.config[key] = def;
```

So injected defaults flow through automatically.

## Data Flow

```
GET /api/plugins
  → route clones configSchema
  → reads WHISPER_MODEL / WHISPER_BASE_URL / WHISPER_LANGUAGE from settingsService
  → injects as schema.properties.model.default etc.
  → returns enriched schema

plugin-options.component.ngOnInit()
  → reads schema.properties[key].default
  → sets config[key] = default value
  → user sees pre-filled fields, can override
```

## Constraints

- No write-back: changes in the plugin panel apply to the current run only.
- Server never mutates live plugin objects — always clones the schema.
- `SettingKey` import on the server must include `WHISPER_MODEL` and `WHISPER_LANGUAGE`
  (already added in a prior session).

## Out of Scope

- Saving per-run overrides back to app settings
- Visual indication that a field value came from app settings
