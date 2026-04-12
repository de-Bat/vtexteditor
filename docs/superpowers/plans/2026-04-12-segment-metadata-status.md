# Segment Metadata — Implementation Status

**Date:** 2026-04-12  
**Branch:** `feature/segment-metadata`  
**Worktree:** `C:\web.projects\VTextStudio\.worktrees\segment-metadata`  
**Spec:** `docs/superpowers/specs/2026-04-12-segment-metadata-design.md`  
**Plan:** `docs/superpowers/plans/2026-04-12-segment-metadata.md`

---

## Completed

| Task | Files | Commit |
|------|-------|--------|
| Task 1: Shared Metadata Model (Server) | `server/src/models/segment-metadata.model.ts` (created) | `eb5b0a2` |
| Task 2: Server Segment & Plugin Models | `server/src/models/segment.model.ts`, `server/src/models/plugin.model.ts` (modified) | `0b4478e` |
| Task 3: Server Metadata Validator | `server/src/validators/segment-metadata.validator.ts` (created) | `074beeb` |

---

## Remaining Tasks

---

### Task 4: Server ClipService — Metadata Methods

**File:** `server/src/services/clip.service.ts`

Add two methods to the existing ClipService class. Read the file first to understand the existing pattern (projects are loaded from disk, mutated in memory, written back).

```typescript
// Add to imports at top:
import { SegmentMetadata } from '../models/segment-metadata.model';

// Add these two methods to the ClipService class:

updateSegmentMetadata(
  projectId: string,
  clipId: string,
  segmentId: string,
  metadata: Record<string, SegmentMetadata[]>
): Segment {
  const project = this.loadProject(projectId);
  const clip = project.clips.find(c => c.id === clipId);
  if (!clip) throw new NotFoundError(`Clip ${clipId} not found`);
  const segment = clip.segments.find(s => s.id === segmentId);
  if (!segment) throw new NotFoundError(`Segment ${segmentId} not found`);
  segment.metadata = metadata;
  this.saveProject(project);
  return segment;
}

patchSegmentMetadata(
  projectId: string,
  clipId: string,
  segmentId: string,
  sourcePluginId: string,
  entries: SegmentMetadata[]
): Segment {
  const project = this.loadProject(projectId);
  const clip = project.clips.find(c => c.id === clipId);
  if (!clip) throw new NotFoundError(`Clip ${clipId} not found`);
  const segment = clip.segments.find(s => s.id === segmentId);
  if (!segment) throw new NotFoundError(`Segment ${segmentId} not found`);
  segment.metadata = { ...(segment.metadata ?? {}), [sourcePluginId]: entries };
  this.saveProject(project);
  return segment;
}
```

**Note:** Match the exact error-throwing pattern already used in the file. If it uses `new Error(...)` or a custom error class, follow suit. Read the file before writing.

Verify: `cd server && npx tsc --noEmit` — no new errors.

Commit: `git commit -m "feat: add updateSegmentMetadata and patchSegmentMetadata to ClipService"`

---

### Task 5: Server REST Endpoints

**File:** `server/src/routes/clip.routes.ts`

Add two routes. Read the file first to understand the existing route registration pattern and how the router is exported.

```typescript
// Add to imports at top:
import { validateMetadataEntry, validateMetadataMap } from '../validators/segment-metadata.validator';
import { SegmentMetadata } from '../models/segment-metadata.model';

// PUT — replace all metadata on a segment
router.put(
  '/:projectId/clips/:clipId/segments/:segmentId/metadata',
  (req, res) => {
    const { projectId, clipId, segmentId } = req.params;
    const validation = validateMetadataMap(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      const segment = clipService.updateSegmentMetadata(
        projectId, clipId, segmentId,
        req.body as Record<string, SegmentMetadata[]>
      );
      res.json(segment);
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
      throw err;
    }
  }
);

// PATCH — replace one plugin's entries on a segment
router.patch(
  '/:projectId/clips/:clipId/segments/:segmentId/metadata/:sourcePluginId',
  (req, res) => {
    const { projectId, clipId, segmentId, sourcePluginId } = req.params;
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be an array of metadata entries' });
    }
    for (let i = 0; i < req.body.length; i++) {
      const result = validateMetadataEntry(req.body[i]);
      if (!result.valid) {
        return res.status(400).json({ error: `entries[${i}]: ${result.error}` });
      }
      if ((req.body[i] as Record<string, unknown>).sourcePluginId !== sourcePluginId) {
        return res.status(400).json({
          error: `entries[${i}].sourcePluginId must match route param "${sourcePluginId}"`
        });
      }
    }
    try {
      const segment = clipService.patchSegmentMetadata(
        projectId, clipId, segmentId, sourcePluginId,
        req.body as SegmentMetadata[]
      );
      res.json(segment);
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
      throw err;
    }
  }
);
```

**Note:** Match the existing route prefix (e.g., if clips routes are mounted at `/api/projects`, adjust accordingly). Read the file before writing.

Verify: `cd server && npx tsc --noEmit` — no new errors.

Commit: `git commit -m "feat: add PUT/PATCH metadata endpoints to clip routes"`

---

### Task 6: Client — Model Mirror + Services

**Files (in order):**

#### 6a. Create `client/src/app/core/models/segment-metadata.model.ts`

Exact mirror of the server model (copy + adjust paths as needed — no imports from server):

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

#### 6b. Modify `client/src/app/core/models/segment.model.ts`

Add import and field:
```typescript
import { SegmentMetadata } from './segment-metadata.model';
// Add to Segment interface:
metadata?: Record<string, SegmentMetadata[]>;
```

#### 6c. Modify `client/src/app/core/models/plugin.model.ts`

Add import and field:
```typescript
import { MetadataProduction } from './segment-metadata.model';
// Add to PluginMeta interface:
produces?: MetadataProduction[];
```

#### 6d. Modify `client/src/app/core/services/api.service.ts`

Add `patch` method (same pattern as existing `put`):
```typescript
patch<T>(url: string, body: unknown): Observable<T> {
  return this.http.patch<T>(url, body);
}
```

#### 6e. Modify `client/src/app/core/services/clip.service.ts`

Add method (read the file first — follow the existing `put` pattern with signal update):
```typescript
updateSegmentMetadata(
  clipId: string,
  segmentId: string,
  sourcePluginId: string,
  entries: SegmentMetadata[]
): Observable<Segment> {
  const clip = this.clips().find(c => c.id === clipId);
  if (!clip) throw new Error(`Clip ${clipId} not found`);
  const projectId = clip.projectId;
  return this.api
    .patch<Segment>(
      `/api/projects/${projectId}/clips/${clipId}/segments/${segmentId}/metadata/${sourcePluginId}`,
      entries
    )
    .pipe(
      tap(updatedSegment => {
        this.clips.update(clips =>
          clips.map(c => {
            if (c.id !== clipId) return c;
            return {
              ...c,
              segments: c.segments.map(s =>
                s.id === segmentId ? updatedSegment : s
              ),
            };
          })
        );
      })
    );
}
```

Verify: `cd client && npx tsc --noEmit` — no new errors.

Commit: `git commit -m "feat: add client metadata model mirror and updateSegmentMetadata to ClipService"`

---

### Task 7: MetadataEntry Component

**File:** `client/src/app/features/studio/segment-metadata-panel/metadata-entry.component.ts`

Standalone Angular component (OnPush, signals, no decorators). Renders a single metadata entry with type-specific fields and edit/delete controls.

```typescript
import {
  Component, ChangeDetectionStrategy, input, output, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { SegmentMetadata } from '../../../core/models/segment-metadata.model';

@Component({
  selector: 'app-metadata-entry',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="metadata-entry">
      <div class="entry-header">
        <span class="entry-type">{{ entry().type }}</span>
        @if (entry().confidence !== undefined) {
          <span class="entry-confidence">{{ (entry().confidence! * 100).toFixed(0) }}%</span>
        }
        <span class="entry-source">{{ entry().sourcePluginId }}</span>
        @if (isEdited()) {
          <span class="entry-edited">(edited)</span>
        }
        <button type="button" (click)="startEdit()" aria-label="Edit entry">Edit</button>
        <button type="button" (click)="delete.emit()" aria-label="Delete entry">Delete</button>
      </div>

      @if (!editing()) {
        <div class="entry-fields">
          @switch (entry().type) {
            @case ('speaker') {
              <div>Name: {{ $any(entry()).name }}</div>
              @if ($any(entry()).label) { <div>Label: {{ $any(entry()).label }}</div> }
            }
            @case ('geo') {
              <div>Lat: {{ $any(entry()).lat }}, Lng: {{ $any(entry()).lng }}</div>
              @if ($any(entry()).placeName) { <div>Place: {{ $any(entry()).placeName }}</div> }
            }
            @case ('timeRange') {
              <div>{{ $any(entry()).from }}s – {{ $any(entry()).to }}s</div>
              @if ($any(entry()).label) { <div>Label: {{ $any(entry()).label }}</div> }
            }
            @case ('language') {
              <div>{{ $any(entry()).code }}@if ($any(entry()).name) { – {{ $any(entry()).name }} }</div>
            }
            @case ('custom') {
              <div>{{ $any(entry()).key }}: {{ $any(entry()).value }}</div>
            }
          }
        </div>
      }

      @if (editing()) {
        <!-- Edit form: emit the updated entry, then cancel editing -->
        <div class="entry-edit-form">
          <!-- Simplified: show a JSON textarea for inline editing of value fields -->
          <!-- Type-specific forms would go here in a full implementation -->
          <button type="button" (click)="cancelEdit()">Cancel</button>
          <button type="button" (click)="saveEdit()">Save</button>
        </div>
      }
    </div>
  `,
})
export class MetadataEntryComponent {
  readonly entry = input.required<SegmentMetadata>();
  readonly edit = output<SegmentMetadata>();
  readonly delete = output<void>();

  protected readonly editing = signal(false);
  protected readonly isEdited = computed(
    () => this.entry().sourcePluginId === 'user'
  );

  protected startEdit(): void { this.editing.set(true); }
  protected cancelEdit(): void { this.editing.set(false); }
  protected saveEdit(): void {
    // emit the current entry as-is for now; individual field editing wired in Task 9
    this.edit.emit(this.entry());
    this.editing.set(false);
  }
}
```

**Note:** The `isEdited` computed is a simplification — the design calls for showing "(edited)" when a plugin entry has been modified by the user (i.e., `sourcePluginId` is a plugin ID but the entry differs from plugin output). For now, the indicator shows when `sourcePluginId === 'user'`. Inline field editing is wired up at the panel level in Task 9.

Verify: `cd client && npx tsc --noEmit` — no new errors.

Commit: `git commit -m "feat: add MetadataEntry component"`

---

### Task 8: MetadataAddForm Component

**File:** `client/src/app/features/studio/segment-metadata-panel/metadata-add-form.component.ts`

Standalone Angular component with Reactive Forms. Type dropdown drives dynamic fields.

```typescript
import {
  Component, ChangeDetectionStrategy, output, signal, computed
} from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import {
  SegmentMetadata, MetadataType,
  SpeakerMetadata, GeoMetadata, TimeRangeMetadata, LanguageMetadata, CustomMetadata
} from '../../../core/models/segment-metadata.model';

@Component({
  selector: 'app-metadata-add-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="add-form">
      <label for="meta-type">Type</label>
      <select id="meta-type" formControlName="type">
        <option value="speaker">Speaker</option>
        <option value="geo">Geo</option>
        <option value="timeRange">Time Range</option>
        <option value="language">Language</option>
        <option value="custom">Custom</option>
      </select>

      @switch (selectedType()) {
        @case ('speaker') {
          <input formControlName="name" placeholder="Name" />
          <input formControlName="label" placeholder="Label (optional)" />
        }
        @case ('geo') {
          <input formControlName="lat" type="number" placeholder="Latitude" />
          <input formControlName="lng" type="number" placeholder="Longitude" />
          <input formControlName="placeName" placeholder="Place name (optional)" />
        }
        @case ('timeRange') {
          <input formControlName="from" type="number" placeholder="From (seconds)" />
          <input formControlName="to" type="number" placeholder="To (seconds)" />
          <input formControlName="label" placeholder="Label (optional)" />
        }
        @case ('language') {
          <input formControlName="code" placeholder="ISO 639-1 code (e.g. en)" />
          <input formControlName="name" placeholder="Name (optional)" />
        }
        @case ('custom') {
          <input formControlName="key" placeholder="Key" />
          <input formControlName="value" placeholder="Value" />
        }
      }

      <div class="form-actions">
        <button type="submit" [disabled]="form.invalid">Add</button>
        <button type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
})
export class MetadataAddFormComponent {
  readonly submitted = output<SegmentMetadata>();
  readonly cancelled = output<void>();

  protected readonly form = new FormGroup({
    type: new FormControl<MetadataType>('speaker', { nonNullable: true }),
    name: new FormControl(''),
    label: new FormControl(''),
    lat: new FormControl<number | null>(null),
    lng: new FormControl<number | null>(null),
    placeName: new FormControl(''),
    from: new FormControl<number | null>(null),
    to: new FormControl<number | null>(null),
    code: new FormControl(''),
    key: new FormControl(''),
    value: new FormControl(''),
  });

  protected readonly selectedType = signal<MetadataType>('speaker');

  constructor() {
    this.form.controls.type.valueChanges.subscribe(t => this.selectedType.set(t));
  }

  protected submit(): void {
    const v = this.form.getRawValue();
    let entry: SegmentMetadata;
    switch (v.type) {
      case 'speaker':
        entry = { type: 'speaker', sourcePluginId: 'user', name: v.name! };
        if (v.label) (entry as SpeakerMetadata).label = v.label;
        break;
      case 'geo':
        entry = { type: 'geo', sourcePluginId: 'user', lat: v.lat!, lng: v.lng! };
        if (v.placeName) (entry as GeoMetadata).placeName = v.placeName;
        break;
      case 'timeRange':
        entry = { type: 'timeRange', sourcePluginId: 'user', from: v.from!, to: v.to! };
        if (v.label) (entry as TimeRangeMetadata).label = v.label;
        break;
      case 'language':
        entry = { type: 'language', sourcePluginId: 'user', code: v.code! };
        if (v.name) (entry as LanguageMetadata).name = v.name;
        break;
      case 'custom':
        entry = { type: 'custom', sourcePluginId: 'user', key: v.key!, value: v.value! };
        break;
    }
    this.submitted.emit(entry!);
    this.form.reset({ type: v.type });
  }
}
```

Verify: `cd client && npx tsc --noEmit` — no new errors.

Commit: `git commit -m "feat: add MetadataAddForm component"`

---

### Task 9: SegmentMetadataPanel Component

**Files:**
- `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.ts`
- `client/src/app/features/studio/segment-metadata-panel/segment-metadata-panel.component.scss`

Inputs: `segmentId: Signal<string | null>`, `clips: Signal<Clip[]>` (or via `input()`). Uses ClipService for mutations.

Key behaviors:
- `segmentId() === null` → shows "Select a segment to view metadata"
- Otherwise: finds segment across clips, groups metadata entries by type, renders MetadataEntry per entry
- Edit output from MetadataEntry → calls `clipService.updateSegmentMetadata` with modified entry merged back into map
- Delete output → same, with entry removed
- "+ Add Metadata" button → shows MetadataAddForm; on submit → calls `clipService.updateSegmentMetadata` with new entry appended to `'user'` key
- 280px fixed width, collapsible groups by type

```typescript
import {
  Component, ChangeDetectionStrategy, input, computed, signal, inject
} from '@angular/core';
import { Clip } from '../../../core/models/clip.model';
import { SegmentMetadata } from '../../../core/models/segment-metadata.model';
import { ClipService } from '../../../core/services/clip.service';
import { MetadataEntryComponent } from './metadata-entry.component';
import { MetadataAddFormComponent } from './metadata-add-form.component';

@Component({
  selector: 'app-segment-metadata-panel',
  standalone: true,
  imports: [MetadataEntryComponent, MetadataAddFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './segment-metadata-panel.component.html',  // or inline template
  styleUrl: './segment-metadata-panel.component.scss',
})
export class SegmentMetadataPanelComponent {
  readonly segmentId = input<string | null>(null);
  readonly clips = input<Clip[]>([]);

  private readonly clipService = inject(ClipService);

  protected readonly showAddForm = signal(false);

  protected readonly segment = computed(() => {
    const id = this.segmentId();
    if (!id) return null;
    for (const clip of this.clips()) {
      const seg = clip.segments.find(s => s.id === id);
      if (seg) return { segment: seg, clipId: clip.id };
    }
    return null;
  });

  // Flat list of all entries with their sourcePluginId, grouped by type for display
  protected readonly entriesByType = computed(() => {
    const result = this.segment();
    if (!result) return {};
    const metadata = result.segment.metadata ?? {};
    const grouped: Record<string, Array<{ entry: SegmentMetadata; sourcePluginId: string }>> = {};
    for (const [sourceId, entries] of Object.entries(metadata)) {
      for (const entry of entries) {
        if (!grouped[entry.type]) grouped[entry.type] = [];
        grouped[entry.type].push({ entry, sourcePluginId: sourceId });
      }
    }
    return grouped;
  });

  protected onEdit(updatedEntry: SegmentMetadata): void {
    const result = this.segment();
    if (!result) return;
    const { segment, clipId } = result;
    const sourceId = updatedEntry.sourcePluginId;
    const currentEntries = segment.metadata?.[sourceId] ?? [];
    const updatedEntries = currentEntries.map(e =>
      e === updatedEntry ? updatedEntry : e
    );
    this.clipService.updateSegmentMetadata(clipId, segment.id, sourceId, updatedEntries).subscribe();
  }

  protected onDelete(entryToDelete: SegmentMetadata): void {
    const result = this.segment();
    if (!result) return;
    const { segment, clipId } = result;
    const sourceId = entryToDelete.sourcePluginId;
    const currentEntries = segment.metadata?.[sourceId] ?? [];
    const updatedEntries = currentEntries.filter(e => e !== entryToDelete);
    this.clipService.updateSegmentMetadata(clipId, segment.id, sourceId, updatedEntries).subscribe();
  }

  protected onAdd(newEntry: SegmentMetadata): void {
    const result = this.segment();
    if (!result) return;
    const { segment, clipId } = result;
    const currentUserEntries = segment.metadata?.['user'] ?? [];
    this.clipService.updateSegmentMetadata(
      clipId, segment.id, 'user', [...currentUserEntries, newEntry]
    ).subscribe();
    this.showAddForm.set(false);
  }
}
```

**SCSS** (`segment-metadata-panel.component.scss`):
```scss
:host {
  display: flex;
  flex-direction: column;
  width: 280px;
  min-width: 280px;
  border-left: 1px solid var(--border-color, #e0e0e0);
  background: var(--surface-color, #fff);
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  font-weight: 600;
}

.panel-empty {
  padding: 24px 16px;
  color: var(--text-secondary, #666);
  font-size: 14px;
}

.type-group {
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.type-group-header {
  padding: 8px 16px;
  font-weight: 500;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface-hover, #f5f5f5);
}

.add-btn {
  margin: 12px 16px;
}
```

Verify: `cd client && npx tsc --noEmit` — no new errors.

Commit: `git commit -m "feat: add SegmentMetadataPanel component"`

---

### Task 10: Integrate Panel into TxtMediaPlayerV2

**Files:**
- `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`
- `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

**Read both files before editing.** Changes are additive — don't disturb existing functionality.

#### Changes to the component TypeScript:

1. **Import** `SegmentMetadataPanelComponent` and add to `imports` array.

2. **Add two signals** to the class:
```typescript
protected readonly metadataPanelOpen = signal(false);
protected readonly selectedSegmentId = signal<string | null>(null);
```

3. **Add metadata button toggle** in `toggleMenu` pattern (or standalone toggle):
```typescript
protected toggleMetadataPanel(): void {
  this.metadataPanelOpen.update(v => !v);
}
```

4. **Add segment click handler** (if not already present, or extend existing one):
```typescript
protected onSegmentClick(segmentId: string): void {
  this.selectedSegmentId.set(segmentId);
}
```

5. **In the template**, add the Metadata button to the toolbar (alongside Edit, Smart Cut, Timer):
```html
<button
  type="button"
  class="toolbar-btn"
  [class.active]="metadataPanelOpen()"
  (click)="toggleMetadataPanel()"
  aria-label="Toggle metadata panel"
  aria-pressed="metadataPanelOpen()"
>
  <span class="material-symbols-outlined">info</span>
</button>
```

6. **In the transcript section**, add `(click)` to `.seg-block` elements to call `onSegmentClick(segment.id)` (read template to find the exact location).

7. **In the template**, add the panel next to the transcript section:
```html
@if (metadataPanelOpen()) {
  <app-segment-metadata-panel
    [segmentId]="selectedSegmentId()"
    [clips]="clips()"
  />
}
```

#### Changes to the SCSS:

The transcript and panel must sit side-by-side. Find the existing transcript container and make it flex:

```scss
.transcript-area {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.transcript-section {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
```

`app-segment-metadata-panel` is self-sizing at 280px via `:host` in its own SCSS.

Verify: `cd client && npx tsc --noEmit` — no new errors.

Commit: `git commit -m "feat: integrate SegmentMetadataPanel into TxtMediaPlayerV2"`

---

### Task 11: End-to-End Verification

1. **Server compile check:**
   ```
   cd server && npx tsc --noEmit
   ```
   Expect: only the two pre-existing test file errors (`reconstruct2story.helpers.test.ts:220-221`). No new errors.

2. **Client compile check:**
   ```
   cd client && npx tsc --noEmit
   ```
   Expect: zero errors.

3. **Manual checklist** (dev server):
   - Open a project in the studio
   - Confirm "Metadata" button appears in the toolbar between Timer and Undo
   - Click the button — panel opens to the right, transcript narrows
   - Click the button again — panel closes, transcript expands
   - Click a segment in the transcript — panel header updates to show segment time range
   - Panel shows "Select a segment" message when no segment is selected
   - Panel shows metadata entries if any exist on the segment
   - "(edited)" indicator behavior is correct
   - Delete button removes an entry (verify network call fires)
   - "+ Add Metadata" opens the inline form
   - Add form type dropdown switches field set
   - Submitting the add form calls the API and updates the panel

4. **Commit:** No new commit needed if no fixes were required.

---

## Resuming

Pick up at **Task 4**. Run tasks sequentially: 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11.

Each task follows the subagent-driven-development process:
1. Dispatch implementer subagent
2. Spec compliance review
3. Code quality review
4. Fix any issues, re-review
5. Mark complete, proceed to next
