# Transcript Auto-Follow Scroll + Silence Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable auto-follow scroll mode to the transcript panel, and gate silence markers behind an app setting with per-run override via the plugin panel.

**Architecture:** Auto-follow is pure component-local state in `txt-media-player-v2`. Silence markers flow as a field on `Clip` — set by the whisper plugin at pipeline time, read by the transcript viewer at display time. The app setting default is injected into the plugin's configSchema by the existing `settingsMap` mechanism.

**Tech Stack:** Angular 20 signals, TypeScript strict, Express/tsx server, no server-side test framework (verify server changes via build + manual inspection).

---

## File Map

| File | Change |
|------|--------|
| `server/src/services/settings.service.ts` | Add `SHOW_SILENCE_MARKERS` to `KNOWN_SETTING_KEYS` |
| `server/src/models/clip.model.ts` | Add `showSilenceMarkers?: boolean` |
| `server/src/plugins/transcription/whisper-openai.plugin.ts` | Add to `configSchema`, `settingsMap`, `execute()` |
| `client/src/app/core/services/settings.service.ts` | Add `SHOW_SILENCE_MARKERS` to `SettingKey` + `SETTING_META` |
| `client/src/app/core/models/clip.model.ts` | Add `showSilenceMarkers?: boolean` |
| `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` | Auto-follow signals + template updates + silence marker guard |
| `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.spec.ts` | New spec file |

---

## Task 1: Add SHOW_SILENCE_MARKERS to server settings

**Files:**
- Modify: `server/src/services/settings.service.ts`

- [ ] **Step 1: Add the key**

In `server/src/services/settings.service.ts`, add `'SHOW_SILENCE_MARKERS'` to `KNOWN_SETTING_KEYS`:

```typescript
export const KNOWN_SETTING_KEYS = [
  'OPENAI_API_KEY',
  'WHISPER_BASE_URL',
  'WHISPER_MODEL',
  'WHISPER_LANGUAGE',
  'SHOW_SILENCE_MARKERS',
  'GROQ_API_KEY',
] as const;
```

- [ ] **Step 2: Verify server builds**

```bash
cd server && npx tsx --version && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or pre-existing errors only — none new).

- [ ] **Step 3: Commit**

```bash
git add server/src/services/settings.service.ts
git commit -m "feat: add SHOW_SILENCE_MARKERS to known setting keys"
```

---

## Task 2: Add showSilenceMarkers to Clip models

**Files:**
- Modify: `server/src/models/clip.model.ts`
- Modify: `client/src/app/core/models/clip.model.ts`

- [ ] **Step 1: Update server Clip model**

```typescript
// server/src/models/clip.model.ts
import { Segment } from './segment.model';

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  showSilenceMarkers?: boolean;
}
```

- [ ] **Step 2: Update client Clip model**

```typescript
// client/src/app/core/models/clip.model.ts
import { Segment } from './segment.model';

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  showSilenceMarkers?: boolean;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/models/clip.model.ts client/src/app/core/models/clip.model.ts
git commit -m "feat: add showSilenceMarkers field to Clip model"
```

---

## Task 3: Wire silence markers through the whisper plugin

**Files:**
- Modify: `server/src/plugins/transcription/whisper-openai.plugin.ts`

- [ ] **Step 1: Add to configSchema**

In `whisper-openai.plugin.ts`, inside `configSchema.properties`, add after the `language` property:

```typescript
        showSilenceMarkers: {
          type: 'boolean',
          title: 'Show Silence Markers',
          description: 'Show gap markers between segments in the transcript viewer.',
          default: false,
        },
```

- [ ] **Step 2: Add to settingsMap**

In the `settingsMap` object (already present on the plugin):

```typescript
  settingsMap: {
    model:               'WHISPER_MODEL',
    baseURL:             'WHISPER_BASE_URL',
    language:            'WHISPER_LANGUAGE',
    showSilenceMarkers:  'SHOW_SILENCE_MARKERS',
  },
```

- [ ] **Step 3: Read the value and write onto Clip in execute()**

The `cfg` object is typed as `WhisperConfig & { clipName?: string }`. Extend the inline cast to include `showSilenceMarkers`:

Find the line (near top of `execute()`):
```typescript
const cfg = (ctx.metadata['whisper-openai'] ?? {}) as WhisperConfig & { clipName?: string };
```

Replace with:
```typescript
const cfg = (ctx.metadata['whisper-openai'] ?? {}) as WhisperConfig & { clipName?: string; showSilenceMarkers?: boolean };
```

Then find where `const clip: Clip = {` is built (near end of `execute()`) and add the field:

```typescript
    const clip: Clip = {
      id: clipId,
      projectId: ctx.projectId,
      name: clipName,
      startTime: segments[0]?.startTime ?? 0,
      endTime: segments[segments.length - 1]?.endTime ?? (ctx.mediaInfo?.duration ?? 0),
      segments,
      showSilenceMarkers: cfg.showSilenceMarkers ?? false,
    };
```

- [ ] **Step 4: Verify server builds**

```bash
cd server && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add server/src/plugins/transcription/whisper-openai.plugin.ts
git commit -m "feat: whisper plugin exposes showSilenceMarkers in config and writes it to clip"
```

---

## Task 4: Add SHOW_SILENCE_MARKERS to client settings service

**Files:**
- Modify: `client/src/app/core/services/settings.service.ts`

- [ ] **Step 1: Add to SettingKey and SETTING_META**

```typescript
export type SettingKey =
  | 'OPENAI_API_KEY'
  | 'WHISPER_BASE_URL'
  | 'WHISPER_MODEL'
  | 'WHISPER_LANGUAGE'
  | 'SHOW_SILENCE_MARKERS'
  | 'GROQ_API_KEY';

export const SETTING_META: Record<SettingKey, { label: string; description: string; placeholder: string; secret?: boolean }> = {
  OPENAI_API_KEY: {
    label: 'OpenAI API Key',
    description: 'Used by the Whisper (OpenAI-compatible) transcription plugin.',
    placeholder: 'sk-…',
    secret: true,
  },
  WHISPER_BASE_URL: {
    label: 'Whisper Base URL',
    description: 'Override the OpenAI endpoint for a self-hosted Whisper server (e.g. http://localhost:8000/v1).',
    placeholder: 'http://localhost:8000/v1',
  },
  WHISPER_MODEL: {
    label: 'Whisper Model',
    description: 'Default model for transcription (e.g. ivrit-ai/whisper-large-v3-turbo-ct2).',
    placeholder: 'ivrit-ai/whisper-large-v3-turbo-ct2',
  },
  WHISPER_LANGUAGE: {
    label: 'Whisper Language',
    description: 'ISO 639-1 language code (e.g. "he"). Leave blank for auto-detect.',
    placeholder: 'he',
  },
  SHOW_SILENCE_MARKERS: {
    label: 'Show Silence Markers',
    description: 'Show gap markers between transcript segments. Can be overridden per pipeline run.',
    placeholder: 'false',
  },
  GROQ_API_KEY: {
    label: 'Groq API Key',
    description: 'Used by the Groq Whisper transcription plugin.',
    placeholder: 'gsk_…',
    secret: true,
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add client/src/app/core/services/settings.service.ts
git commit -m "feat: add SHOW_SILENCE_MARKERS to client settings meta"
```

---

## Task 5: Implement auto-follow + silence markers in the transcript component

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

This task has several sub-steps. Make all changes before committing.

- [ ] **Step 1: Add autoFollow signal and suppressScrollDetection flag**

In the `/* ── Local Signals ───────────────────────────────────── */` section, add:

```typescript
  readonly autoFollow = signal(true);
```

In the `/* ── Private State ───────────────────────────────────── */` section, add:

```typescript
  private suppressScrollDetection = false;
```

- [ ] **Step 2: Update scrollToCurrentWord() to respect autoFollow and set the suppress flag**

Replace the existing `private scrollToCurrentWord()` method:

```typescript
  private scrollToCurrentWord(): void {
    if (!this.autoFollow()) return;
    if (!this.transcriptElRef) return;
    const container = this.transcriptElRef.nativeElement;
    this.measureTranscriptViewport();

    this.suppressScrollDetection = true;
    setTimeout(() => { this.suppressScrollDetection = false; }, 150);

    const highlighted = container.querySelector('.word.highlighted') as HTMLElement | null;
    if (highlighted) {
      const cRect = container.getBoundingClientRect();
      const eRect = highlighted.getBoundingClientRect();
      if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
        highlighted.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    if (!this.shouldVirtualize()) return;
    const idx = this.findActiveSegmentIndex();
    if (idx < 0) return;
    const item = this.segmentViewItems()[idx];
    if (!item) return;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    if (item.top < viewTop || item.bottom > viewBottom) {
      const nextTop = Math.max(0, item.top - container.clientHeight * 0.4);
      container.scrollTo({ top: nextTop, behavior: 'smooth' });
      this.transcriptScrollTop.set(nextTop);
    }
  }
```

- [ ] **Step 3: Update onTranscriptScroll() to detect manual scroll**

Replace the existing `onTranscriptScroll()`:

```typescript
  onTranscriptScroll(): void {
    if (!this.transcriptElRef) return;
    this.transcriptScrollTop.set(this.transcriptElRef.nativeElement.scrollTop);
    if (!this.transcriptViewportHeight()) this.measureTranscriptViewport();
    if (!this.suppressScrollDetection) {
      this.autoFollow.set(false);
    }
  }
```

- [ ] **Step 4: Add a public method for returning to current position**

```typescript
  returnToCurrentWord(): void {
    this.autoFollow.set(true);
    this.scrollToCurrentWord();
  }
```

- [ ] **Step 5: Update the transcript header in the template**

Find the transcript header section in the template:

```html
    <!-- Header -->
    <div class="transcript-header">
      <div class="header-row">
        <div class="header-left">
          <h2 class="transcript-title">Transcript</h2>
          <span class="auto-badge">AUTO-GEN</span>
        </div>
        <button class="clean-all-btn" (click)="restoreAll()" title="Restore all removed words">
          <span class="material-symbols-outlined">delete_sweep</span>
          Clean All
        </button>
      </div>
```

Replace with:

```html
    <!-- Header -->
    <div class="transcript-header">
      <div class="header-row">
        <div class="header-left">
          <h2 class="transcript-title">Transcript</h2>
          <span class="auto-badge">AUTO-GEN</span>
        </div>
        <div class="header-right">
          @if (!autoFollow()) {
            <button class="return-btn" (click)="returnToCurrentWord()" title="Return to current word">
              <span class="material-symbols-outlined">keyboard_return</span>
              Return
            </button>
          }
          <button
            class="follow-btn"
            [class.active]="autoFollow()"
            (click)="returnToCurrentWord()"
            [title]="autoFollow() ? 'Auto-follow on — click to pause' : 'Auto-follow paused — click to resume'"
            (click)="autoFollow() ? autoFollow.set(false) : returnToCurrentWord()"
          >
            <span class="material-symbols-outlined">
              {{ autoFollow() ? 'my_location' : 'location_disabled' }}
            </span>
            {{ autoFollow() ? 'Following' : 'Paused' }}
          </button>
          <button class="clean-all-btn" (click)="restoreAll()" title="Restore all removed words">
            <span class="material-symbols-outlined">delete_sweep</span>
            Clean All
          </button>
        </div>
      </div>
```

Note: the two `(click)` bindings on `.follow-btn` need to be a single handler. Replace that button with:

```html
          <button
            class="follow-btn"
            [class.active]="autoFollow()"
            [title]="autoFollow() ? 'Auto-follow on — click to pause' : 'Auto-follow paused — click to resume'"
            (click)="autoFollow() ? autoFollow.set(false) : returnToCurrentWord()"
          >
            <span class="material-symbols-outlined">
              {{ autoFollow() ? 'my_location' : 'location_disabled' }}
            </span>
            {{ autoFollow() ? 'Following' : 'Paused' }}
          </button>
```

- [ ] **Step 6: Guard silence markers with clip().showSilenceMarkers**

Find in the template (inside the `@for` loop):

```html
        <!-- Silence marker -->
        @if (item.silenceAfter; as sil) {
```

Replace with:

```html
        <!-- Silence marker -->
        @if (clip().showSilenceMarkers && item.silenceAfter; as sil) {
```

- [ ] **Step 7: Add styles for new buttons**

In the component's `styleUrl` (`.scss` file), add after existing button styles. Open `txt-media-player-v2.component.scss` and append:

```scss
.header-right {
  display: flex;
  align-items: center;
  gap: .5rem;
}

.follow-btn {
  display: flex;
  align-items: center;
  gap: .25rem;
  padding: .25rem .6rem;
  border: 1px solid var(--color-border);
  border-radius: 20px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: .75rem;
  cursor: pointer;
  transition: color .15s, border-color .15s, background .15s;

  .material-symbols-outlined { font-size: 1rem; }

  &.active {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  &:hover { border-color: var(--color-accent); color: var(--color-accent); }
}

.return-btn {
  display: flex;
  align-items: center;
  gap: .25rem;
  padding: .25rem .6rem;
  border: 1px solid var(--color-accent);
  border-radius: 20px;
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  color: var(--color-accent);
  font-size: .75rem;
  cursor: pointer;
  animation: pulse-border .8s ease-in-out infinite alternate;

  .material-symbols-outlined { font-size: 1rem; }
  &:hover { background: color-mix(in srgb, var(--color-accent) 25%, transparent); }
}

@keyframes pulse-border {
  from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 40%, transparent); }
  to   { box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 0%, transparent); }
}
```

- [ ] **Step 8: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/
git commit -m "feat: transcript auto-follow scroll toggle and silence marker guard"
```

---

## Task 6: Write component spec for new behaviours

**Files:**
- Create: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.spec.ts`

- [ ] **Step 1: Create spec file**

```typescript
import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { Clip } from '../../../core/models/clip.model';
import { ClipService } from '../../../core/services/clip.service';
import { ProjectService } from '../../../core/services/project.service';
import { EditHistoryService } from '../txt-media-player/edit-history.service';
import { KeyboardShortcutsService } from '../txt-media-player/keyboard-shortcuts.service';
import { MediaPlayerService } from '../txt-media-player/media-player.service';
import { TxtMediaPlayerV2Component } from './txt-media-player-v2.component';

function createClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip-1',
    projectId: 'proj-1',
    name: 'Test Clip',
    startTime: 0,
    endTime: 10,
    showSilenceMarkers: false,
    segments: [
      {
        id: 'seg-1', clipId: 'clip-1', startTime: 0, endTime: 5, text: 'Hello world', tags: [],
        words: [
          { id: 'w1', segmentId: 'seg-1', text: 'Hello', startTime: 0, endTime: 2, isRemoved: false },
          { id: 'w2', segmentId: 'seg-1', text: 'world', startTime: 2, endTime: 5, isRemoved: false },
        ],
      },
      {
        id: 'seg-2', clipId: 'clip-1', startTime: 6, endTime: 10, text: 'Foo bar', tags: [],
        words: [
          { id: 'w3', segmentId: 'seg-2', text: 'Foo', startTime: 6, endTime: 8, isRemoved: false },
          { id: 'w4', segmentId: 'seg-2', text: 'bar', startTime: 8, endTime: 10, isRemoved: false },
        ],
      },
    ],
    ...overrides,
  };
}

class MediaPlayerServiceMock {
  isPlaying = signal(false);
  currentTime = signal(0);
  duration = signal(10);
  playbackRate = signal(1);
  volume = signal(1);
  attachElement = () => {};
  detachElement = () => {};
  play = () => Promise.resolve();
  pause = () => {};
  seek = () => {};
  setRate = () => {};
  setVolume = () => {};
}

class ClipServiceMock {
  updateWordStates = () => of(null);
}

class ProjectServiceMock {
  project = signal({ mediaType: 'video', mediaInfo: { duration: 10 } });
}

class KeyboardShortcutsServiceMock {
  createPlayerHandler = () => () => {};
  bindWindowKeydown = () => () => {};
}

describe('TxtMediaPlayerV2Component', () => {
  let fixture: ComponentFixture<TxtMediaPlayerV2Component>;
  let component: TxtMediaPlayerV2Component;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TxtMediaPlayerV2Component],
      providers: [
        { provide: ClipService, useClass: ClipServiceMock },
        { provide: ProjectService, useClass: ProjectServiceMock },
        { provide: MediaPlayerService, useClass: MediaPlayerServiceMock },
        { provide: KeyboardShortcutsService, useClass: KeyboardShortcutsServiceMock },
        EditHistoryService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TxtMediaPlayerV2Component);
    fixture.componentRef.setInput('clip', createClip());
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  describe('auto-follow', () => {
    it('starts with autoFollow enabled', () => {
      expect(component.autoFollow()).toBe(true);
    });

    it('disables autoFollow when onTranscriptScroll is called without suppress flag', () => {
      component.onTranscriptScroll();
      expect(component.autoFollow()).toBe(false);
    });

    it('re-enables autoFollow when returnToCurrentWord is called', () => {
      component.autoFollow.set(false);
      component.returnToCurrentWord();
      expect(component.autoFollow()).toBe(true);
    });

    it('shows follow-btn in template', () => {
      const btn = fixture.nativeElement.querySelector('.follow-btn');
      expect(btn).toBeTruthy();
    });

    it('shows return-btn when autoFollow is false', () => {
      component.autoFollow.set(false);
      fixture.detectChanges();
      const btn = fixture.nativeElement.querySelector('.return-btn');
      expect(btn).toBeTruthy();
    });

    it('hides return-btn when autoFollow is true', () => {
      component.autoFollow.set(true);
      fixture.detectChanges();
      const btn = fixture.nativeElement.querySelector('.return-btn');
      expect(btn).toBeNull();
    });
  });

  describe('silence markers', () => {
    it('hides silence rows when clip.showSilenceMarkers is false', () => {
      fixture.componentRef.setInput('clip', createClip({ showSilenceMarkers: false }));
      fixture.detectChanges();
      const rows = fixture.nativeElement.querySelectorAll('.silence-row');
      expect(rows.length).toBe(0);
    });

    it('shows silence rows when clip.showSilenceMarkers is true and gap >= 0.5s', () => {
      // Gap between seg-1 end (5s) and seg-2 start (6s) = 1s >= 0.5s threshold
      fixture.componentRef.setInput('clip', createClip({ showSilenceMarkers: true }));
      fixture.detectChanges();
      const rows = fixture.nativeElement.querySelectorAll('.silence-row');
      expect(rows.length).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
cd client && npx ng test --include="**/txt-media-player-v2/**" --watch=false 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.spec.ts
git commit -m "test: txt-media-player-v2 auto-follow and silence markers specs"
```

---

## Self-Review

**Spec coverage:**
- ✅ Auto-follow signal + mode indicator button → Task 5 steps 1, 4, 5
- ✅ Manual scroll detection → Task 5 step 3
- ✅ Return to current word → Task 5 steps 2, 4
- ✅ Suppress flag for programmatic scrolls → Task 5 step 2
- ✅ `SHOW_SILENCE_MARKERS` app setting (server) → Task 1
- ✅ `SHOW_SILENCE_MARKERS` app setting (client) → Task 4
- ✅ `showSilenceMarkers` on Clip model (both sides) → Task 2
- ✅ Whisper plugin configSchema + settingsMap + execute → Task 3
- ✅ Template guard on silence rows → Task 5 step 6
- ✅ Tests → Task 6

**Placeholder scan:** No TBDs or incomplete steps found.

**Type consistency:** `autoFollow` signal is `signal(true)` (boolean), referenced consistently. `showSilenceMarkers?: boolean` on both Clip interfaces. `cfg.showSilenceMarkers` cast as `boolean | undefined`, defaulted with `?? false` when writing to clip.
