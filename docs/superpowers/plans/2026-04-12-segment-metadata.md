# Segment Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow plugins to attach structured metadata (speaker, geo, time range, language, custom) to segments, with a toggleable side panel in the studio UI for viewing and editing.

**Architecture:** New `segment-metadata.model.ts` shared model defines typed metadata entries. Server adds two REST endpoints for metadata persistence. Client adds a metadata side panel as a child of `TxtMediaPlayerV2Component`, toggled via a toolbar button, displaying metadata for the selected segment with edit/delete/add capabilities.

**Tech Stack:** Angular 20+ (standalone components, signals, OnPush), Express/Node.js, TypeScript strict mode

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `server/src/models/segment-metadata.model.ts` | Shared metadata type definitions |
| Modify | `server/src/models/segment.model.ts:1-12` | Add optional `metadata` field to `Segment` |
| Modify | `server/src/models/plugin.model.ts:1-29` | Add `produces` to `PluginMeta` |
| Create | `server/src/validators/segment-metadata.validator.ts` | Validation for built-in metadata types |
| Modify | `server/src/routes/clip.routes.ts:1-113` | Add PUT/PATCH metadata endpoints |
| Modify | `server/src/services/clip.service.ts:1-74` | Add `updateSegmentMetadata` method |
| Create | `client/src/app/core/models/segment-metadata.model.ts` | Client-side metadata type mirror |
| Modify | `client/src/app/core/models/segment.model.ts:1-12` | Add optional `metadata` field |
| Modify | `client/src/app/core/models/plugin.model.ts:1-24` | Add `produces` to `PluginMeta` |
| Modify | `client/src/app/core/services/api.service.ts:1-40` | Add `patch` method |
| Modify | `client/src/app/core/services/clip.service.ts:1-61` | Add `updateSegmentMetadata` method |
| Create | `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.ts` | Side panel component |
| Create | `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.scss` | Side panel styles |
| Create | `client/src/app/features/studio/segment-metadata-panel/metadata-entry.component.ts` | Single metadata entry renderer |
| Create | `client/src/app/features/studio/segment-metadata-panel/metadata-add-form.component.ts` | Add metadata inline form |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` | Add toggle, selectedSegmentId, host panel |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss` | Panel layout styles |

---

### Task 1: Shared Metadata Model (Server)

**Files:**
- Create: `server/src/models/segment-metadata.model.ts`

- [ ] **Step 1: Create the metadata model file**

```typescript
// server/src/models/segment-metadata.model.ts

export type BuiltInMetadataType = 'speaker' | 'geo' | 'timeRange' | 'language';
export type MetadataType = BuiltInMetadataType | 'custom';

export interface SegmentMetadataEntry {
  type: MetadataType;
  sourcePluginId: string;
  confidence?: number;
}

export interface SpeakerMetadata extends SegmentMetadataEntry {
  type: 'speaker';
  name: string;
  label?: string;
}

export interface GeoMetadata extends SegmentMetadataEntry {
  type: 'geo';
  lat: number;
  lng: number;
  placeName?: string;
}

export interface TimeRangeMetadata extends SegmentMetadataEntry {
  type: 'timeRange';
  from: number;
  to: number;
  label?: string;
}

export interface LanguageMetadata extends SegmentMetadataEntry {
  type: 'language';
  code: string;
  name?: string;
}

export interface CustomMetadata extends SegmentMetadataEntry {
  type: 'custom';
  key: string;
  value: string | number | boolean;
}

export type SegmentMetadata =
  | SpeakerMetadata
  | GeoMetadata
  | TimeRangeMetadata
  | LanguageMetadata
  | CustomMetadata;

export interface MetadataProduction {
  key: string;
  type: MetadataType;
  description?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/models/segment-metadata.model.ts
git commit -m "feat: add segment metadata model types"
```

---

### Task 2: Update Server Segment & Plugin Models

**Files:**
- Modify: `server/src/models/segment.model.ts:1-12`
- Modify: `server/src/models/plugin.model.ts:1-29`

- [ ] **Step 1: Add metadata field to Segment**

In `server/src/models/segment.model.ts`, add the import and optional field:

```typescript
import { Word } from './word.model';
import { SegmentMetadata } from './segment-metadata.model';

export interface Segment {
  id: string;
  clipId: string;
  startTime: number;
  endTime: number;
  text: string;
  words: Word[];
  /** Flat string tags, e.g. ["speaker:Alice", "topic:intro"] */
  tags: string[];
  /** Structured metadata keyed by sourcePluginId */
  metadata?: Record<string, SegmentMetadata[]>;
}
```

- [ ] **Step 2: Add produces field to PluginMeta**

In `server/src/models/plugin.model.ts`, add the import and field:

```typescript
import { MetadataProduction } from './segment-metadata.model';

export type PluginType =
  | 'transcription'
  | 'diarization'
  | 'detection'
  | 'narrative'
  | 'translation';

export interface PluginMeta {
  id: string;
  name: string;
  description: string;
  type: PluginType;
  /** JSON Schema object describing plugin configuration options */
  configSchema: Record<string, unknown>;
  /** Whether this plugin ships an Angular UI component */
  hasUI: boolean;
  /**
   * Maps configSchema property names to app setting keys.
   * The plugin list endpoint injects current setting values as schema defaults
   * so the client panel pre-fills fields without any client-side changes.
   */
  settingsMap?: Record<string, string>;
  /** Metadata types this plugin produces on segments during pipeline execution */
  produces?: MetadataProduction[];
}

export interface PipelineStep {
  pluginId: string;
  config: Record<string, unknown>;
  order: number;
}
```

- [ ] **Step 3: Verify the server compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add server/src/models/segment.model.ts server/src/models/plugin.model.ts
git commit -m "feat: add metadata field to Segment, produces to PluginMeta"
```

---

### Task 3: Server Metadata Validator

**Files:**
- Create: `server/src/validators/segment-metadata.validator.ts`

- [ ] **Step 1: Create the validator**

```typescript
// server/src/validators/segment-metadata.validator.ts

import { SegmentMetadata, MetadataType } from '../models/segment-metadata.model';

const VALID_TYPES: MetadataType[] = ['speaker', 'geo', 'timeRange', 'language', 'custom'];

export function validateMetadataEntry(entry: unknown): { valid: boolean; error?: string } {
  if (!entry || typeof entry !== 'object') {
    return { valid: false, error: 'Entry must be an object' };
  }

  const e = entry as Record<string, unknown>;

  if (typeof e.type !== 'string' || !VALID_TYPES.includes(e.type as MetadataType)) {
    return { valid: false, error: `Invalid type: ${e.type}. Must be one of: ${VALID_TYPES.join(', ')}` };
  }

  if (typeof e.sourcePluginId !== 'string' || e.sourcePluginId.length === 0) {
    return { valid: false, error: 'sourcePluginId must be a non-empty string' };
  }

  if (e.confidence !== undefined && (typeof e.confidence !== 'number' || e.confidence < 0 || e.confidence > 1)) {
    return { valid: false, error: 'confidence must be a number between 0 and 1' };
  }

  switch (e.type) {
    case 'speaker':
      if (typeof e.name !== 'string' || e.name.length === 0) {
        return { valid: false, error: 'speaker metadata requires a non-empty name' };
      }
      break;
    case 'geo':
      if (typeof e.lat !== 'number' || typeof e.lng !== 'number') {
        return { valid: false, error: 'geo metadata requires numeric lat and lng' };
      }
      if (e.lat < -90 || e.lat > 90 || e.lng < -180 || e.lng > 180) {
        return { valid: false, error: 'geo coordinates out of range (lat: -90..90, lng: -180..180)' };
      }
      break;
    case 'timeRange':
      if (typeof e.from !== 'number' || typeof e.to !== 'number') {
        return { valid: false, error: 'timeRange metadata requires numeric from and to' };
      }
      if (e.from < 0 || e.to < e.from) {
        return { valid: false, error: 'timeRange: from must be >= 0 and to must be >= from' };
      }
      break;
    case 'language':
      if (typeof e.code !== 'string' || e.code.length === 0) {
        return { valid: false, error: 'language metadata requires a non-empty code' };
      }
      break;
    case 'custom':
      if (typeof e.key !== 'string' || e.key.length === 0) {
        return { valid: false, error: 'custom metadata requires a non-empty key' };
      }
      if (!['string', 'number', 'boolean'].includes(typeof e.value)) {
        return { valid: false, error: 'custom metadata value must be string, number, or boolean' };
      }
      break;
  }

  return { valid: true };
}

export function validateMetadataMap(
  metadata: unknown
): { valid: boolean; error?: string } {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { valid: false, error: 'metadata must be an object keyed by sourcePluginId' };
  }

  for (const [sourceId, entries] of Object.entries(metadata as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      return { valid: false, error: `metadata["${sourceId}"] must be an array` };
    }
    for (let i = 0; i < entries.length; i++) {
      const result = validateMetadataEntry(entries[i]);
      if (!result.valid) {
        return { valid: false, error: `metadata["${sourceId}"][${i}]: ${result.error}` };
      }
      if ((entries[i] as Record<string, unknown>).sourcePluginId !== sourceId) {
        return { valid: false, error: `metadata["${sourceId}"][${i}]: sourcePluginId must match the key "${sourceId}"` };
      }
    }
  }

  return { valid: true };
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/validators/segment-metadata.validator.ts
git commit -m "feat: add metadata validation for built-in and custom types"
```

---

### Task 4: Server ClipService — updateSegmentMetadata Method

**Files:**
- Modify: `server/src/services/clip.service.ts:1-74`

- [ ] **Step 1: Add the updateSegmentMetadata method**

Add this import at the top of `server/src/services/clip.service.ts`:

```typescript
import { SegmentMetadata } from '../models/segment-metadata.model';
```

Add this method to the `ClipService` class, after the existing `updateWordStates` method:

```typescript
  updateSegmentMetadata(
    clipId: string,
    segmentId: string,
    metadata: Record<string, SegmentMetadata[]>
  ): Clip | null {
    const project = projectService.getCurrent();
    if (!project) return null;

    const clipIndex = project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return null;

    const clip = project.clips[clipIndex];
    const segIndex = clip.segments.findIndex((s) => s.id === segmentId);
    if (segIndex === -1) return null;

    const updatedSegments = [...clip.segments];
    updatedSegments[segIndex] = { ...updatedSegments[segIndex], metadata };

    const updatedClip: Clip = { ...clip, segments: updatedSegments };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;
    projectService.update(project.id, { clips: updatedClips });

    return updatedClip;
  }

  patchSegmentMetadata(
    clipId: string,
    segmentId: string,
    sourcePluginId: string,
    entries: SegmentMetadata[]
  ): Clip | null {
    const project = projectService.getCurrent();
    if (!project) return null;

    const clipIndex = project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return null;

    const clip = project.clips[clipIndex];
    const segIndex = clip.segments.findIndex((s) => s.id === segmentId);
    if (segIndex === -1) return null;

    const segment = clip.segments[segIndex];
    const existingMetadata = segment.metadata ?? {};
    const mergedMetadata = { ...existingMetadata, [sourcePluginId]: entries };

    const updatedSegments = [...clip.segments];
    updatedSegments[segIndex] = { ...segment, metadata: mergedMetadata };

    const updatedClip: Clip = { ...clip, segments: updatedSegments };
    const updatedClips = [...project.clips];
    updatedClips[clipIndex] = updatedClip;
    projectService.update(project.id, { clips: updatedClips });

    return updatedClip;
  }
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/services/clip.service.ts
git commit -m "feat: add updateSegmentMetadata and patchSegmentMetadata to ClipService"
```

---

### Task 5: Server REST Endpoints for Metadata

**Files:**
- Modify: `server/src/routes/clip.routes.ts:1-113`

- [ ] **Step 1: Add the two metadata endpoints**

Add these imports at the top of `server/src/routes/clip.routes.ts`:

```typescript
import { validateMetadataMap, validateMetadataEntry } from '../validators/segment-metadata.validator';
```

Add these routes at the end of the file (before the closing):

```typescript
/** PUT /api/clips/:id/segments/:segId/metadata — replace all metadata for a segment */
clipRoutes.put('/:id/segments/:segId/metadata', (req: Request, res: Response) => {
  const { metadata } = req.body as { metadata?: unknown };
  if (metadata === undefined) {
    res.status(400).json({ error: 'Body must be { metadata: Record<string, SegmentMetadata[]> }' });
    return;
  }

  const validation = validateMetadataMap(metadata);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const updated = clipService.updateSegmentMetadata(
    String(req.params.id),
    String(req.params.segId),
    metadata as any
  );
  if (!updated) {
    res.status(404).json({ error: 'Clip or segment not found' });
    return;
  }
  res.json(updated);
});

/** PATCH /api/clips/:id/segments/:segId/metadata/:sourcePluginId — update entries from a specific source */
clipRoutes.patch('/:id/segments/:segId/metadata/:sourcePluginId', (req: Request, res: Response) => {
  const { entries } = req.body as { entries?: unknown };
  if (!Array.isArray(entries)) {
    res.status(400).json({ error: 'Body must be { entries: SegmentMetadata[] }' });
    return;
  }

  const sourcePluginId = String(req.params.sourcePluginId);
  for (let i = 0; i < entries.length; i++) {
    const result = validateMetadataEntry(entries[i]);
    if (!result.valid) {
      res.status(400).json({ error: `entries[${i}]: ${result.error}` });
      return;
    }
    if ((entries[i] as any).sourcePluginId !== sourcePluginId) {
      res.status(400).json({ error: `entries[${i}]: sourcePluginId must match URL parameter "${sourcePluginId}"` });
      return;
    }
  }

  const updated = clipService.patchSegmentMetadata(
    String(req.params.id),
    String(req.params.segId),
    sourcePluginId,
    entries as any
  );
  if (!updated) {
    res.status(404).json({ error: 'Clip or segment not found' });
    return;
  }
  res.json(updated);
});
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/clip.routes.ts
git commit -m "feat: add PUT/PATCH endpoints for segment metadata"
```

---

### Task 6: Client Metadata Model & Service

**Files:**
- Create: `client/src/app/core/models/segment-metadata.model.ts`
- Modify: `client/src/app/core/models/segment.model.ts:1-12`
- Modify: `client/src/app/core/models/plugin.model.ts:1-24`
- Modify: `client/src/app/core/services/api.service.ts:1-40`
- Modify: `client/src/app/core/services/clip.service.ts:1-61`

- [ ] **Step 1: Create client metadata model**

Create `client/src/app/core/models/segment-metadata.model.ts` — identical to the server model:

```typescript
export type BuiltInMetadataType = 'speaker' | 'geo' | 'timeRange' | 'language';
export type MetadataType = BuiltInMetadataType | 'custom';

export interface SegmentMetadataEntry {
  type: MetadataType;
  sourcePluginId: string;
  confidence?: number;
}

export interface SpeakerMetadata extends SegmentMetadataEntry {
  type: 'speaker';
  name: string;
  label?: string;
}

export interface GeoMetadata extends SegmentMetadataEntry {
  type: 'geo';
  lat: number;
  lng: number;
  placeName?: string;
}

export interface TimeRangeMetadata extends SegmentMetadataEntry {
  type: 'timeRange';
  from: number;
  to: number;
  label?: string;
}

export interface LanguageMetadata extends SegmentMetadataEntry {
  type: 'language';
  code: string;
  name?: string;
}

export interface CustomMetadata extends SegmentMetadataEntry {
  type: 'custom';
  key: string;
  value: string | number | boolean;
}

export type SegmentMetadata =
  | SpeakerMetadata
  | GeoMetadata
  | TimeRangeMetadata
  | LanguageMetadata
  | CustomMetadata;

export interface MetadataProduction {
  key: string;
  type: MetadataType;
  description?: string;
}
```

- [ ] **Step 2: Update client Segment model**

In `client/src/app/core/models/segment.model.ts`:

```typescript
import { Word } from './word.model';
import { SegmentMetadata } from './segment-metadata.model';

export interface Segment {
  id: string;
  clipId: string;
  startTime: number;
  endTime: number;
  text: string;
  words: Word[];
  /** Flat string tags, e.g. ["speaker:Alice", "topic:intro"] */
  tags: string[];
  /** Structured metadata keyed by sourcePluginId */
  metadata?: Record<string, SegmentMetadata[]>;
}
```

- [ ] **Step 3: Update client PluginMeta model**

In `client/src/app/core/models/plugin.model.ts`, add the import and field:

```typescript
import { MetadataProduction } from './segment-metadata.model';

export type PluginType =
  | 'transcription'
  | 'diarization'
  | 'detection'
  | 'narrative'
  | 'translation';

export interface PluginMeta {
  id: string;
  name: string;
  description: string;
  type: PluginType;
  /** JSON Schema object describing plugin configuration options */
  configSchema: Record<string, unknown>;
  /** Whether this plugin ships an Angular UI component */
  hasUI: boolean;
  /** Metadata types this plugin produces on segments during pipeline execution */
  produces?: MetadataProduction[];
}

export interface PipelineStep {
  pluginId: string;
  config: Record<string, unknown>;
  order: number;
}
```

- [ ] **Step 4: Add patch method to ApiService**

In `client/src/app/core/services/api.service.ts`, add after the `put` method:

```typescript
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.base}${path}`, body).pipe(catchError(this.handleError));
  }
```

- [ ] **Step 5: Add metadata methods to ClipService**

In `client/src/app/core/services/clip.service.ts`, add the import:

```typescript
import { SegmentMetadata } from '../models/segment-metadata.model';
```

Add these methods to the `ClipService` class:

```typescript
  /** Replace all metadata for a segment. */
  updateSegmentMetadata(clipId: string, segmentId: string, metadata: Record<string, SegmentMetadata[]>): Observable<Clip> {
    return this.api.put<Clip>(`/clips/${clipId}/segments/${segmentId}/metadata`, { metadata }).pipe(
      tap((updated) => {
        this.clips.update((list) => list.map((c) => (c.id === clipId ? updated : c)));
      })
    );
  }

  /** Patch metadata for a specific source (plugin or 'user'). */
  patchSegmentMetadata(clipId: string, segmentId: string, sourcePluginId: string, entries: SegmentMetadata[]): Observable<Clip> {
    return this.api.patch<Clip>(`/clips/${clipId}/segments/${segmentId}/metadata/${sourcePluginId}`, { entries }).pipe(
      tap((updated) => {
        this.clips.update((list) => list.map((c) => (c.id === clipId ? updated : c)));
      })
    );
  }
```

- [ ] **Step 6: Verify client compiles**

Run: `cd client && npx ng build --configuration development 2>&1 | head -20`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add client/src/app/core/models/segment-metadata.model.ts \
       client/src/app/core/models/segment.model.ts \
       client/src/app/core/models/plugin.model.ts \
       client/src/app/core/services/api.service.ts \
       client/src/app/core/services/clip.service.ts
git commit -m "feat: add client-side metadata model, API patch method, and ClipService metadata methods"
```

---

### Task 7: MetadataEntry Component

**Files:**
- Create: `client/src/app/features/studio/segment-metadata-panel/metadata-entry.component.ts`

This component renders a single collapsible metadata entry with type-specific formatting.

- [ ] **Step 1: Create the component**

```typescript
// client/src/app/features/studio/segment-metadata-panel/metadata-entry.component.ts

import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SegmentMetadata,
  SpeakerMetadata,
  GeoMetadata,
  TimeRangeMetadata,
  LanguageMetadata,
  CustomMetadata,
} from '../../../core/models/segment-metadata.model';

@Component({
  selector: 'app-metadata-entry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="entry" [class.expanded]="expanded()">
      <button class="entry-header" (click)="expanded.update(v => !v)">
        <span class="material-symbols-outlined entry-icon">{{ icon() }}</span>
        <span class="entry-title">{{ title() }}</span>
        @if (entry().confidence !== undefined) {
          <span class="confidence-badge">{{ (entry().confidence! * 100).toFixed(0) }}%</span>
        }
        <span class="material-symbols-outlined expand-icon">
          {{ expanded() ? 'expand_less' : 'expand_more' }}
        </span>
      </button>

      @if (expanded()) {
        <div class="entry-body">
          @if (editing()) {
            <!-- Edit mode: type-specific fields -->
            @switch (entry().type) {
              @case ('speaker') {
                <label class="field">
                  <span class="field-label">Name</span>
                  <input type="text" class="field-input" [ngModel]="asSpeaker().name"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, name: $event })" />
                </label>
                <label class="field">
                  <span class="field-label">Label</span>
                  <input type="text" class="field-input" [ngModel]="asSpeaker().label ?? ''"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, label: $event || undefined })" />
                </label>
              }
              @case ('geo') {
                <label class="field">
                  <span class="field-label">Latitude</span>
                  <input type="number" class="field-input" [ngModel]="asGeo().lat" step="any"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, lat: $event })" />
                </label>
                <label class="field">
                  <span class="field-label">Longitude</span>
                  <input type="number" class="field-input" [ngModel]="asGeo().lng" step="any"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, lng: $event })" />
                </label>
                <label class="field">
                  <span class="field-label">Place Name</span>
                  <input type="text" class="field-input" [ngModel]="asGeo().placeName ?? ''"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, placeName: $event || undefined })" />
                </label>
              }
              @case ('timeRange') {
                <label class="field">
                  <span class="field-label">From (s)</span>
                  <input type="number" class="field-input" [ngModel]="asTimeRange().from" step="0.1"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, from: $event })" />
                </label>
                <label class="field">
                  <span class="field-label">To (s)</span>
                  <input type="number" class="field-input" [ngModel]="asTimeRange().to" step="0.1"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, to: $event })" />
                </label>
                <label class="field">
                  <span class="field-label">Label</span>
                  <input type="text" class="field-input" [ngModel]="asTimeRange().label ?? ''"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, label: $event || undefined })" />
                </label>
              }
              @case ('language') {
                <label class="field">
                  <span class="field-label">Code</span>
                  <input type="text" class="field-input" [ngModel]="asLanguage().code"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, code: $event })" />
                </label>
                <label class="field">
                  <span class="field-label">Name</span>
                  <input type="text" class="field-input" [ngModel]="asLanguage().name ?? ''"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, name: $event || undefined })" />
                </label>
              }
              @case ('custom') {
                <label class="field">
                  <span class="field-label">Key</span>
                  <input type="text" class="field-input" [ngModel]="asCustom().key"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, key: $event })" />
                </label>
                <label class="field">
                  <span class="field-label">Value</span>
                  <input type="text" class="field-input" [ngModel]="'' + asCustom().value"
                    (ngModelChange)="editDraft.set({ ...editDraft()!, value: $event })" />
                </label>
              }
            }
            <div class="edit-actions">
              <button class="action-btn save-btn" (click)="saveEdit()">Save</button>
              <button class="action-btn cancel-btn" (click)="cancelEdit()">Cancel</button>
            </div>
          } @else {
            <!-- Read mode: type-specific display -->
            @switch (entry().type) {
              @case ('speaker') {
                <div class="field-row"><span class="field-label">Name</span><span class="field-value">{{ asSpeaker().name }}</span></div>
                @if (asSpeaker().label) {
                  <div class="field-row"><span class="field-label">Label</span><span class="field-value">{{ asSpeaker().label }}</span></div>
                }
              }
              @case ('geo') {
                <div class="field-row"><span class="field-label">Coordinates</span><span class="field-value">{{ asGeo().lat.toFixed(5) }}, {{ asGeo().lng.toFixed(5) }}</span></div>
                @if (asGeo().placeName) {
                  <div class="field-row"><span class="field-label">Place</span><span class="field-value">{{ asGeo().placeName }}</span></div>
                }
              }
              @case ('timeRange') {
                <div class="field-row"><span class="field-label">Range</span><span class="field-value">{{ asTimeRange().from }}s – {{ asTimeRange().to }}s</span></div>
                @if (asTimeRange().label) {
                  <div class="field-row"><span class="field-label">Label</span><span class="field-value">{{ asTimeRange().label }}</span></div>
                }
              }
              @case ('language') {
                <div class="field-row"><span class="field-label">Code</span><span class="field-value">{{ asLanguage().code }}</span></div>
                @if (asLanguage().name) {
                  <div class="field-row"><span class="field-label">Language</span><span class="field-value">{{ asLanguage().name }}</span></div>
                }
              }
              @case ('custom') {
                <div class="field-row"><span class="field-label">{{ asCustom().key }}</span><span class="field-value">{{ asCustom().value }}</span></div>
              }
            }
            <div class="field-row source-row">
              <span class="field-label">Source</span>
              <span class="field-value source-value">{{ entry().sourcePluginId }}</span>
            </div>
            <div class="entry-actions">
              <button class="action-btn" (click)="startEdit()">Edit</button>
              <button class="action-btn delete-btn" (click)="deleteRequested.emit()">Delete</button>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .entry { border-bottom: 1px solid var(--color-border); }
    .entry-header {
      display: flex; align-items: center; gap: 6px;
      width: 100%; padding: 8px 10px; border: none; background: none;
      color: var(--color-text); cursor: pointer; font: inherit; text-align: left;
    }
    .entry-header:hover { background: var(--color-surface-hover, rgba(255,255,255,0.04)); }
    .entry-icon { font-size: 1.1rem; opacity: 0.7; }
    .entry-title { flex: 1; font-size: 0.85rem; font-weight: 500; }
    .confidence-badge {
      font-size: 0.7rem; padding: 1px 5px; border-radius: 8px;
      background: rgba(139,92,246,0.2); color: #a78bfa;
    }
    .expand-icon { font-size: 1.1rem; opacity: 0.5; }
    .entry-body { padding: 4px 10px 10px 30px; }
    .field-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 2px 0; font-size: 0.8rem;
    }
    .field-label { opacity: 0.6; font-size: 0.75rem; }
    .field-value { font-size: 0.8rem; }
    .source-row { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--color-border); }
    .source-value { opacity: 0.5; font-style: italic; }
    .entry-actions, .edit-actions { display: flex; gap: 6px; margin-top: 8px; }
    .action-btn {
      padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 4px;
      background: var(--color-surface); color: var(--color-text); font-size: 0.75rem;
      cursor: pointer;
    }
    .action-btn:hover { background: var(--color-surface-hover, rgba(255,255,255,0.06)); }
    .delete-btn { color: #f87171; border-color: rgba(248,113,113,0.3); }
    .delete-btn:hover { background: rgba(248,113,113,0.1); }
    .save-btn { color: #34d399; border-color: rgba(52,211,153,0.3); }
    .field { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
    .field .field-label { font-size: 0.7rem; }
    .field-input {
      padding: 4px 6px; border: 1px solid var(--color-border); border-radius: 4px;
      background: var(--color-surface); color: var(--color-text); font-size: 0.8rem;
    }
  `],
})
export class MetadataEntryComponent {
  readonly entry = input.required<SegmentMetadata>();
  readonly deleteRequested = output<void>();
  readonly updated = output<SegmentMetadata>();

  readonly expanded = signal(false);
  readonly editing = signal(false);
  readonly editDraft = signal<Record<string, unknown> | null>(null);

  readonly icon = computed(() => {
    switch (this.entry().type) {
      case 'speaker': return 'person';
      case 'geo': return 'location_on';
      case 'timeRange': return 'schedule';
      case 'language': return 'translate';
      case 'custom': return 'label';
    }
  });

  readonly title = computed(() => {
    switch (this.entry().type) {
      case 'speaker': return `Speaker: ${(this.entry() as SpeakerMetadata).name}`;
      case 'geo': return (this.entry() as GeoMetadata).placeName ?? 'Geo Location';
      case 'timeRange': return (this.entry() as TimeRangeMetadata).label ?? 'Time Range';
      case 'language': return (this.entry() as LanguageMetadata).name ?? (this.entry() as LanguageMetadata).code;
      case 'custom': return (this.entry() as CustomMetadata).key;
    }
  });

  asSpeaker(): SpeakerMetadata { return this.entry() as SpeakerMetadata; }
  asGeo(): GeoMetadata { return this.entry() as GeoMetadata; }
  asTimeRange(): TimeRangeMetadata { return this.entry() as TimeRangeMetadata; }
  asLanguage(): LanguageMetadata { return this.entry() as LanguageMetadata; }
  asCustom(): CustomMetadata { return this.entry() as CustomMetadata; }

  startEdit(): void {
    this.editDraft.set({ ...this.entry() });
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.editDraft.set(null);
  }

  saveEdit(): void {
    const draft = this.editDraft();
    if (draft) {
      this.updated.emit(draft as SegmentMetadata);
    }
    this.editing.set(false);
    this.editDraft.set(null);
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd client && npx ng build --configuration development 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/app/features/studio/segment-metadata-panel/metadata-entry.component.ts
git commit -m "feat: add MetadataEntryComponent for rendering/editing individual metadata entries"
```

---

### Task 8: MetadataAddForm Component

**Files:**
- Create: `client/src/app/features/studio/segment-metadata-panel/metadata-add-form.component.ts`

- [ ] **Step 1: Create the add form component**

```typescript
// client/src/app/features/studio/segment-metadata-panel/metadata-add-form.component.ts

import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SegmentMetadata, MetadataType } from '../../../core/models/segment-metadata.model';

@Component({
  selector: 'app-metadata-add-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    @if (!formOpen()) {
      <button class="add-btn" (click)="formOpen.set(true)">
        <span class="material-symbols-outlined">add</span>
        Add Metadata
      </button>
    } @else {
      <div class="add-form">
        <label class="field">
          <span class="field-label">Type</span>
          <select class="field-input" [ngModel]="selectedType()" (ngModelChange)="selectedType.set($event)">
            <option value="speaker">Speaker</option>
            <option value="geo">Geo Location</option>
            <option value="timeRange">Time Range</option>
            <option value="language">Language</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        @switch (selectedType()) {
          @case ('speaker') {
            <label class="field"><span class="field-label">Name</span>
              <input type="text" class="field-input" [ngModel]="speakerName()" (ngModelChange)="speakerName.set($event)" placeholder="e.g. Alice" /></label>
            <label class="field"><span class="field-label">Label (optional)</span>
              <input type="text" class="field-input" [ngModel]="speakerLabel()" (ngModelChange)="speakerLabel.set($event)" /></label>
          }
          @case ('geo') {
            <label class="field"><span class="field-label">Latitude</span>
              <input type="number" class="field-input" [ngModel]="geoLat()" (ngModelChange)="geoLat.set($event)" step="any" /></label>
            <label class="field"><span class="field-label">Longitude</span>
              <input type="number" class="field-input" [ngModel]="geoLng()" (ngModelChange)="geoLng.set($event)" step="any" /></label>
            <label class="field"><span class="field-label">Place Name (optional)</span>
              <input type="text" class="field-input" [ngModel]="geoPlace()" (ngModelChange)="geoPlace.set($event)" /></label>
          }
          @case ('timeRange') {
            <label class="field"><span class="field-label">From (seconds)</span>
              <input type="number" class="field-input" [ngModel]="trFrom()" (ngModelChange)="trFrom.set($event)" step="0.1" /></label>
            <label class="field"><span class="field-label">To (seconds)</span>
              <input type="number" class="field-input" [ngModel]="trTo()" (ngModelChange)="trTo.set($event)" step="0.1" /></label>
            <label class="field"><span class="field-label">Label (optional)</span>
              <input type="text" class="field-input" [ngModel]="trLabel()" (ngModelChange)="trLabel.set($event)" /></label>
          }
          @case ('language') {
            <label class="field"><span class="field-label">Code (ISO 639-1)</span>
              <input type="text" class="field-input" [ngModel]="langCode()" (ngModelChange)="langCode.set($event)" placeholder="en" /></label>
            <label class="field"><span class="field-label">Name (optional)</span>
              <input type="text" class="field-input" [ngModel]="langName()" (ngModelChange)="langName.set($event)" placeholder="English" /></label>
          }
          @case ('custom') {
            <label class="field"><span class="field-label">Key</span>
              <input type="text" class="field-input" [ngModel]="customKey()" (ngModelChange)="customKey.set($event)" placeholder="e.g. mood" /></label>
            <label class="field"><span class="field-label">Value</span>
              <input type="text" class="field-input" [ngModel]="customValue()" (ngModelChange)="customValue.set($event)" /></label>
          }
        }

        <div class="form-actions">
          <button class="action-btn save-btn" (click)="submit()">Add</button>
          <button class="action-btn cancel-btn" (click)="reset()">Cancel</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .add-btn {
      display: flex; align-items: center; gap: 4px; width: 100%;
      padding: 8px 10px; border: 1px dashed var(--color-border); border-radius: 4px;
      background: none; color: var(--color-text); opacity: 0.6; cursor: pointer;
      font-size: 0.8rem;
    }
    .add-btn:hover { opacity: 1; background: var(--color-surface-hover, rgba(255,255,255,0.04)); }
    .add-btn .material-symbols-outlined { font-size: 1rem; }
    .add-form { padding: 8px 0; }
    .field { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
    .field-label { font-size: 0.7rem; opacity: 0.6; }
    .field-input {
      padding: 4px 6px; border: 1px solid var(--color-border); border-radius: 4px;
      background: var(--color-surface); color: var(--color-text); font-size: 0.8rem;
    }
    select.field-input { cursor: pointer; }
    .form-actions { display: flex; gap: 6px; margin-top: 8px; }
    .action-btn {
      padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 4px;
      background: var(--color-surface); color: var(--color-text); font-size: 0.75rem;
      cursor: pointer;
    }
    .action-btn:hover { background: var(--color-surface-hover, rgba(255,255,255,0.06)); }
    .save-btn { color: #34d399; border-color: rgba(52,211,153,0.3); }
    .cancel-btn { color: var(--color-text); opacity: 0.7; }
  `],
})
export class MetadataAddFormComponent {
  readonly added = output<SegmentMetadata>();

  readonly formOpen = signal(false);
  readonly selectedType = signal<MetadataType>('speaker');

  // Speaker fields
  readonly speakerName = signal('');
  readonly speakerLabel = signal('');

  // Geo fields
  readonly geoLat = signal(0);
  readonly geoLng = signal(0);
  readonly geoPlace = signal('');

  // TimeRange fields
  readonly trFrom = signal(0);
  readonly trTo = signal(0);
  readonly trLabel = signal('');

  // Language fields
  readonly langCode = signal('');
  readonly langName = signal('');

  // Custom fields
  readonly customKey = signal('');
  readonly customValue = signal('');

  submit(): void {
    const base = { sourcePluginId: 'user' };
    let entry: SegmentMetadata;

    switch (this.selectedType()) {
      case 'speaker':
        if (!this.speakerName()) return;
        entry = { ...base, type: 'speaker', name: this.speakerName(), label: this.speakerLabel() || undefined };
        break;
      case 'geo':
        entry = { ...base, type: 'geo', lat: this.geoLat(), lng: this.geoLng(), placeName: this.geoPlace() || undefined };
        break;
      case 'timeRange':
        entry = { ...base, type: 'timeRange', from: this.trFrom(), to: this.trTo(), label: this.trLabel() || undefined };
        break;
      case 'language':
        if (!this.langCode()) return;
        entry = { ...base, type: 'language', code: this.langCode(), name: this.langName() || undefined };
        break;
      case 'custom':
        if (!this.customKey()) return;
        entry = { ...base, type: 'custom', key: this.customKey(), value: this.customValue() };
        break;
    }

    this.added.emit(entry!);
    this.reset();
  }

  reset(): void {
    this.formOpen.set(false);
    this.selectedType.set('speaker');
    this.speakerName.set(''); this.speakerLabel.set('');
    this.geoLat.set(0); this.geoLng.set(0); this.geoPlace.set('');
    this.trFrom.set(0); this.trTo.set(0); this.trLabel.set('');
    this.langCode.set(''); this.langName.set('');
    this.customKey.set(''); this.customValue.set('');
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd client && npx ng build --configuration development 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/app/features/studio/segment-metadata-panel/metadata-add-form.component.ts
git commit -m "feat: add MetadataAddFormComponent for user-created metadata entries"
```

---

### Task 9: SegmentMetadataPanel Component

**Files:**
- Create: `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.ts`
- Create: `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.scss`

- [ ] **Step 1: Create the panel component**

```typescript
// client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.ts

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Segment } from '../../../core/models/segment.model';
import { SegmentMetadata } from '../../../core/models/segment-metadata.model';
import { ClipService } from '../../../core/services/clip.service';
import { MetadataEntryComponent } from './metadata-entry.component';
import { MetadataAddFormComponent } from './metadata-add-form.component';

@Component({
  selector: 'app-segment-metadata-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MetadataEntryComponent, MetadataAddFormComponent],
  template: `
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Segment Metadata</span>
        <button class="close-btn" (click)="closeRequested.emit()" aria-label="Close metadata panel">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      @if (segment(); as seg) {
        <div class="segment-info">
          <span class="seg-label">{{ segmentLabel() }}</span>
          <span class="seg-time">{{ formatTime(seg.startTime) }} – {{ formatTime(seg.endTime) }}</span>
        </div>

        <div class="entries-list">
          @for (entry of allEntries(); track $index) {
            <app-metadata-entry
              [entry]="entry"
              (updated)="onEntryUpdated($index, $event)"
              (deleteRequested)="onEntryDeleted($index)"
            />
          } @empty {
            <div class="empty-state">No metadata for this segment.</div>
          }
        </div>

        <div class="add-section">
          <app-metadata-add-form (added)="onEntryAdded($event)" />
        </div>
      } @else {
        <div class="empty-state no-segment">
          <span class="material-symbols-outlined empty-icon">touch_app</span>
          <span>Select a segment to view metadata.</span>
        </div>
      }
    </div>
  `,
  styleUrl: './segment-metadata-panel.component.scss',
})
export class SegmentMetadataPanelComponent {
  readonly segment = input.required<Segment | null>();
  readonly clipId = input.required<string>();
  readonly closeRequested = output<void>();

  private readonly clipService = inject(ClipService);

  readonly segmentLabel = computed(() => {
    const seg = this.segment();
    if (!seg) return '';
    const preview = seg.text.length > 40 ? seg.text.slice(0, 40) + '...' : seg.text;
    return preview;
  });

  readonly allEntries = computed((): SegmentMetadata[] => {
    const seg = this.segment();
    if (!seg?.metadata) return [];
    const entries: SegmentMetadata[] = [];
    for (const sourceEntries of Object.values(seg.metadata)) {
      entries.push(...sourceEntries);
    }
    return entries;
  });

  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  onEntryUpdated(flatIndex: number, updated: SegmentMetadata): void {
    const seg = this.segment();
    if (!seg?.metadata) return;

    const newMetadata = this.rebuildMetadata(seg, flatIndex, updated);
    this.clipService.updateSegmentMetadata(this.clipId(), seg.id, newMetadata).subscribe();
  }

  onEntryDeleted(flatIndex: number): void {
    const seg = this.segment();
    if (!seg?.metadata) return;

    const newMetadata = this.rebuildMetadata(seg, flatIndex, null);
    this.clipService.updateSegmentMetadata(this.clipId(), seg.id, newMetadata).subscribe();
  }

  onEntryAdded(entry: SegmentMetadata): void {
    const seg = this.segment();
    if (!seg) return;

    const existing = seg.metadata ?? {};
    const userEntries = [...(existing['user'] ?? []), entry];
    this.clipService.patchSegmentMetadata(this.clipId(), seg.id, 'user', userEntries).subscribe();
  }

  /**
   * Rebuild the metadata map after an update or deletion at a flat index.
   * A null `replacement` means deletion.
   */
  private rebuildMetadata(
    seg: Segment,
    flatIndex: number,
    replacement: SegmentMetadata | null
  ): Record<string, SegmentMetadata[]> {
    const result: Record<string, SegmentMetadata[]> = {};
    let idx = 0;

    for (const [source, entries] of Object.entries(seg.metadata!)) {
      const newEntries: SegmentMetadata[] = [];
      for (const entry of entries) {
        if (idx === flatIndex) {
          if (replacement) newEntries.push(replacement);
          // else: deletion — skip
        } else {
          newEntries.push(entry);
        }
        idx++;
      }
      if (newEntries.length > 0) {
        result[source] = newEntries;
      }
    }

    return result;
  }
}
```

- [ ] **Step 2: Create the panel stylesheet**

```scss
// client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.scss

.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-background);
  border-left: 1px solid var(--color-border);
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  color: var(--color-text);
  opacity: 0.6;
  cursor: pointer;
  border-radius: 4px;

  &:hover { opacity: 1; background: var(--color-surface-hover, rgba(255,255,255,0.06)); }

  .material-symbols-outlined { font-size: 1.1rem; }
}

.segment-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.seg-label {
  font-size: 0.8rem;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg-time {
  font-size: 0.7rem;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.entries-list {
  flex: 1;
  overflow-y: auto;
}

.add-section {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}

.empty-state {
  padding: 16px 12px;
  font-size: 0.8rem;
  opacity: 0.5;
  text-align: center;
}

.no-segment {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.3;
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd client && npx ng build --configuration development 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/segment-metadata-panel/
git commit -m "feat: add SegmentMetadataPanelComponent with entry list, edit, delete, and add"
```

---

### Task 10: Integrate Panel into TxtMediaPlayerV2

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

This is the integration task. It adds:
1. The metadata toggle button to the transcript header
2. The `selectedSegmentId` signal
3. The `metadataPanelOpen` signal
4. The panel host in the template
5. Segment click handling to set the selected segment
6. Layout CSS for the side panel

- [ ] **Step 1: Add imports**

In `txt-media-player-v2.component.ts`, add the import at the top (with other imports):

```typescript
import { SegmentMetadataPanelComponent } from '../segment-metadata-panel/segment-metadata-panel.component';
```

Add `SegmentMetadataPanelComponent` to the `imports` array in the `@Component` decorator (alongside `CommonModule`):

```typescript
imports: [CommonModule, SegmentMetadataPanelComponent],
```

- [ ] **Step 2: Add signals**

Add these signals to the component class, in the `/* ── Local Signals ── */` section (after `readonly silenceControlOpen`):

```typescript
  /** Whether the segment metadata side panel is visible */
  readonly metadataPanelOpen = signal(false);
  /** ID of the segment currently selected for metadata inspection */
  readonly selectedSegmentId = signal<string | null>(null);
```

Add this computed after the other computed signals:

```typescript
  /** The selected segment object, resolved from the clip data */
  readonly selectedSegment = computed(() => {
    const id = this.selectedSegmentId();
    if (!id) return null;
    return this.clip().segments.find(s => s.id === id) ?? null;
  });
```

- [ ] **Step 3: Add metadata toggle button to the template**

In the transcript header toolbar (row 1), find the silence-control-wrap closing `</div>` and add after it, inside the `@if (!searchExpanded())` block, before the `</div>` that closes `hdr-group`:

Find this in the template:
```html
            </div>

          <!-- Edit History -->
```

Insert the metadata toggle button before `<!-- Edit History -->`:

```html
            <!-- Metadata Panel -->
            <button class="hdr-btn" [class.active]="metadataPanelOpen()" (click)="metadataPanelOpen.update(v => !v)" title="Segment Metadata">
              <span class="material-symbols-outlined">info</span>
            </button>
```

- [ ] **Step 4: Add the panel to the template**

Find the closing of the transcript body `</div>` and status bar. The panel should be placed inside the `transcript-section` but after the `transcript-content-wrapper`. Find:

```html
    </div><!-- /.transcript-content-wrapper -->
  </section>
```

Replace with:

```html
    </div><!-- /.transcript-content-wrapper -->

    @if (metadataPanelOpen()) {
      <app-segment-metadata-panel
        [segment]="selectedSegment()"
        [clipId]="clip().id"
        (closeRequested)="metadataPanelOpen.set(false)"
      />
    }
  </section>
```

- [ ] **Step 5: Add CSS class for layout**

Add `[class.metadata-open]="metadataPanelOpen()"` to the `transcript-section` element:

Find:
```html
  <section class="transcript-section">
```

Replace with:
```html
  <section class="transcript-section" [class.metadata-open]="metadataPanelOpen()">
```

- [ ] **Step 6: Add segment click handler**

Find the `.seg-block` div in the transcript body template. Add a click handler that sets the selected segment (on the `seg-head` row to avoid conflicts with word clicks):

Find:
```html
            <div class="seg-head">
              <span class="seg-time" [class.active]="active">
```

Replace with:
```html
            <div class="seg-head" (click)="selectedSegmentId.set(seg.id)">
              <span class="seg-time" [class.active]="active">
```

- [ ] **Step 7: Add metadata dot indicator**

Add a metadata indicator dot to segments that have metadata. Find the segment time display:

```html
                {{ formatTimeShort(seg.startTime) }} - {{ active ? 'CURRENT' : formatTimeShort(seg.endTime) }}
              </span>
              <span class="material-symbols-outlined seg-more">more_horiz</span>
```

Replace with:

```html
                {{ formatTimeShort(seg.startTime) }} - {{ active ? 'CURRENT' : formatTimeShort(seg.endTime) }}
              </span>
              @if (metadataPanelOpen() && seg.metadata && hasMetadata(seg)) {
                <span class="metadata-dot" title="Has metadata"></span>
              }
              <span class="material-symbols-outlined seg-more">more_horiz</span>
```

Add the `hasMetadata` helper method to the component class:

```typescript
  hasMetadata(seg: Segment): boolean {
    if (!seg.metadata) return false;
    return Object.values(seg.metadata).some(entries => entries.length > 0);
  }
```

- [ ] **Step 8: Add styles to the SCSS file**

In `txt-media-player-v2.component.scss`, add these styles:

```scss
// Metadata panel layout
.transcript-section.metadata-open {
  .transcript-content-wrapper {
    flex: 1;
    min-width: 0;
  }

  app-segment-metadata-panel {
    width: 280px;
    flex-shrink: 0;
    border-left: 1px solid var(--color-border);
  }
}

// Ensure transcript-section uses flex when metadata panel is open
.transcript-section.metadata-open {
  display: flex;
  flex-direction: row;
}

// Metadata dot indicator
.metadata-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a78bfa;
  margin-left: 4px;
  vertical-align: middle;
}
```

- [ ] **Step 9: Verify compilation and test in browser**

Run: `cd client && npx ng build --configuration development 2>&1 | head -20`
Expected: No errors

Then start the dev server and verify:
1. The metadata toggle button appears in the transcript toolbar
2. Clicking it opens/closes the side panel
3. Clicking a segment header populates the panel
4. The panel shows "Select a segment to view metadata" when no segment is selected
5. The Add Metadata form works and persists via the API

- [ ] **Step 10: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts \
       client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss
git commit -m "feat: integrate segment metadata panel into TxtMediaPlayerV2"
```

---

### Task 11: Verify End-to-End Flow

**Files:** None (testing only)

- [ ] **Step 1: Start the dev servers**

Run: `cd server && npm run dev` (in one terminal)
Run: `cd client && ng serve` (in another terminal)

- [ ] **Step 2: Test the metadata toggle**

1. Open the studio with a project that has clips
2. Click the metadata toggle button (info icon) in the transcript header
3. Verify the side panel appears to the right of the transcript
4. Verify the transcript narrows to accommodate

- [ ] **Step 3: Test segment selection**

1. Click a segment header (time display) in the transcript
2. Verify the panel populates with the segment's time range and "No metadata" message
3. Click a different segment — verify the panel updates

- [ ] **Step 4: Test adding metadata**

1. Click "Add Metadata" in the panel
2. Select "Speaker" from the type dropdown
3. Enter a name (e.g., "Alice")
4. Click "Add"
5. Verify the entry appears in the panel with the speaker icon
6. Refresh the page — verify the metadata persists

- [ ] **Step 5: Test editing metadata**

1. Expand a metadata entry
2. Click "Edit"
3. Change the speaker name
4. Click "Save"
5. Verify the entry updates
6. Refresh — verify the change persists

- [ ] **Step 6: Test deleting metadata**

1. Expand a metadata entry
2. Click "Delete"
3. Verify the entry disappears
4. Refresh — verify it's gone

- [ ] **Step 7: Test metadata dot indicator**

1. Add metadata to a segment
2. Verify a small purple dot appears next to the segment time in the transcript
3. Close the metadata panel — verify the dots disappear
4. Reopen — dots reappear

- [ ] **Step 8: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end metadata testing"
```
