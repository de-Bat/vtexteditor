# reconstruct2story Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `reconstruct2story` plugin that turns interview transcription segments into a structured life-story narrative, with LLM-driven grouping via Microsoft Copilot Studio, a user review UI, and self-hosted Express routes.

**Architecture:** A single plugin with two phases: `execute()` calls Microsoft Copilot Studio via the Direct Line REST API and saves an event proposal to project metadata; `registerRoutes(app)` self-registers three Express routes for proposal retrieval, commit, and discard. An Angular side-drawer lets the user accept/reject segments and rename events before committing. The commit route replaces the source transcription clips with new story-event clips.

**Tech Stack:** TypeScript, Express 5, node-fetch v2 (already installed), uuid, Vitest (server + client tests), Angular 21 with signals + OnPush change detection.

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `server/src/plugins/narrative/reconstruct2story.types.ts` | StoryProposal, StoryEvent, StorySegmentRef interfaces |
| `server/src/plugins/narrative/reconstruct2story.helpers.ts` | Pure functions: buildPrompt, parseEvents, buildCommitClips |
| `server/src/plugins/narrative/reconstruct2story.helpers.test.ts` | Vitest unit tests for helpers |
| `server/src/plugins/narrative/copilot.client.ts` | Direct Line REST API wrapper (fetch-based) |
| `server/src/plugins/narrative/reconstruct2story.plugin.ts` | IPlugin implementation (execute + registerRoutes) |
| `server/vitest.config.ts` | Vitest configuration for server |
| `client/src/app/core/models/story-proposal.model.ts` | StoryProposal types (client mirror) |
| `client/src/app/features/studio/story-review-panel/story-review-panel.component.ts` | Review side-drawer component |
| `client/src/app/features/studio/story-review-panel/story-review-panel.component.spec.ts` | Component unit tests |

### Modified files
| Path | Change |
|------|--------|
| `server/src/models/project.model.ts` | Add `metadata?: Record<string, unknown>` to `Project` |
| `server/src/plugins/plugin.interface.ts` | Add optional `registerRoutes?(app: Express): void` |
| `server/src/plugins/plugin-registry.ts` | Accept `app: Express`, call `registerRoutes` |
| `server/src/main.ts` | Pass `app` to `pluginRegistry` after express setup |
| `server/package.json` | Add vitest devDependency + test script |
| `client/src/app/core/models/project.model.ts` | Add `metadata?: Record<string, unknown>` to `Project` |
| `client/src/app/features/studio/studio.component.ts` | Detect proposal banner + open review panel |

---

### Task 1: Add `metadata` field to Project models

**Files:**
- Modify: `server/src/models/project.model.ts`
- Modify: `client/src/app/core/models/project.model.ts`

- [ ] **Step 1: Add the field to server model**

In `server/src/models/project.model.ts`, add one line to the `Project` interface after `editHistory`:

```ts
export interface Project {
  id: string;
  name: string;
  mediaPath: string;
  mediaType: 'video' | 'audio';
  mediaInfo: MediaInfo | null;
  clips: Clip[];
  pipelineConfig: PipelineStep[];
  editHistory: EditAction[];
  metadata?: Record<string, unknown>;   // ← add this line
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Mirror in client model**

In `client/src/app/core/models/project.model.ts`, add the same field to the `Project` interface (client model mirrors the server model — check the file first, add after `editHistory`):

```ts
metadata?: Record<string, unknown>;
```

- [ ] **Step 3: Commit**

```bash
git add server/src/models/project.model.ts client/src/app/core/models/project.model.ts
git commit -m "feat: add metadata field to Project model"
```

---

### Task 2: Extend IPlugin with `registerRoutes` + wire registry + main.ts

**Files:**
- Modify: `server/src/plugins/plugin.interface.ts`
- Modify: `server/src/plugins/plugin-registry.ts`
- Modify: `server/src/main.ts`

- [ ] **Step 1: Add hook to IPlugin interface**

Replace `server/src/plugins/plugin.interface.ts` entirely:

```ts
import { Express } from 'express';
import { PipelineContext } from '../models/pipeline-context.model';
import { PluginMeta } from '../models/plugin.model';

export interface IPlugin extends PluginMeta {
  execute(input: PipelineContext): Promise<PipelineContext>;
  /** Optional: called once at server startup to register plugin-owned routes. */
  registerRoutes?(app: Express): void;
}
```

- [ ] **Step 2: Update PluginRegistry to accept app and call registerRoutes**

Replace `server/src/plugins/plugin-registry.ts` entirely:

```ts
import { Express } from 'express';
import { IPlugin } from './plugin.interface';
import { srtImportPlugin } from './transcription/srt-import.plugin';
import { whisperPlugin } from './transcription/whisper-openai.plugin';
import { groqWhisperPlugin } from './transcription/groq-whisper.plugin';

class PluginRegistry {
  private plugins: Map<string, IPlugin> = new Map();

  constructor() {
    this.register(srtImportPlugin);
    this.register(whisperPlugin);
    this.register(groqWhisperPlugin);
  }

  register(plugin: IPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  /** Call after all plugins are registered and the Express app is ready. */
  registerRoutes(app: Express): void {
    for (const plugin of this.plugins.values()) {
      plugin.registerRoutes?.(app);
    }
  }

  getAll(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  getById(id: string): IPlugin | undefined {
    return this.plugins.get(id);
  }
}

export const pluginRegistry = new PluginRegistry();
```

- [ ] **Step 3: Call registerRoutes in main.ts after routes are mounted**

In `server/src/main.ts`, add this line after the last `app.use(...)` route registration and before the global error handler:

```ts
// Let plugins self-register their own routes
import { pluginRegistry } from './plugins/plugin-registry';
// ... (existing imports)

// after all app.use() route lines:
pluginRegistry.registerRoutes(app);
```

The import of `pluginRegistry` already exists transitively (via pipeline.service) — add it explicitly at the top of `main.ts` if not present:

```ts
import { pluginRegistry } from './plugins/plugin-registry';
```

Then call it before the error handler:

```ts
pluginRegistry.registerRoutes(app);

// Global error handler (must remain last)
app.use((err: Error & { code?: string }, ...
```

- [ ] **Step 4: Commit**

```bash
git add server/src/plugins/plugin.interface.ts server/src/plugins/plugin-registry.ts server/src/main.ts
git commit -m "feat: add registerRoutes hook to IPlugin + wire in registry and main"
```

---

### Task 3: Set up Vitest on the server

**Files:**
- Modify: `server/package.json`
- Create: `server/vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
cd server && npm install --save-dev vitest
```

Expected: vitest appears in `devDependencies` in `server/package.json`.

- [ ] **Step 2: Add test script to server/package.json**

In `server/package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

Create `server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify config works**

```bash
cd server && npm test
```

Expected output: `No test files found` (no tests yet — that's fine, exit code 0 or 1 depending on vitest version; either is acceptable at this stage).

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/vitest.config.ts
git commit -m "chore(server): add vitest test runner"
```

---

### Task 4: Define StoryProposal types

**Files:**
- Create: `server/src/plugins/narrative/reconstruct2story.types.ts`
- Create: `client/src/app/core/models/story-proposal.model.ts`

- [ ] **Step 1: Create server types**

Create `server/src/plugins/narrative/reconstruct2story.types.ts`:

```ts
export interface StorySegmentRef {
  segmentId: string;
  clipId: string;
  accepted: boolean;  // default true; user can toggle to false
}

export interface StoryEvent {
  id: string;          // uuid, stable across user edits
  title: string;       // LLM-proposed, user-editable
  segments: StorySegmentRef[];
}

export interface StoryProposal {
  projectId: string;
  sourceClipIds: string[];   // transcription clip IDs consumed by this proposal
  storyClipPrefix: string;   // e.g. "Story" — used at commit time
  events: StoryEvent[];
}

/** Key used to store the proposal in project.metadata */
export const PROPOSAL_KEY = 'reconstruct2story:proposal';
```

- [ ] **Step 2: Create client types**

Create `client/src/app/core/models/story-proposal.model.ts`:

```ts
export interface StorySegmentRef {
  segmentId: string;
  clipId: string;
  accepted: boolean;
}

export interface StoryEvent {
  id: string;
  title: string;
  segments: StorySegmentRef[];
}

export interface StoryProposal {
  projectId: string;
  sourceClipIds: string[];
  storyClipPrefix: string;
  events: StoryEvent[];
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/plugins/narrative/reconstruct2story.types.ts client/src/app/core/models/story-proposal.model.ts
git commit -m "feat(reconstruct2story): add StoryProposal type definitions"
```

---

### Task 5: TDD — `buildPrompt` helper

**Files:**
- Create: `server/src/plugins/narrative/reconstruct2story.helpers.ts`
- Create: `server/src/plugins/narrative/reconstruct2story.helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/plugins/narrative/reconstruct2story.helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPrompt } from './reconstruct2story.helpers';
import { Clip } from '../../models/clip.model';

const makeClip = (segments: { id: string; text: string }[]): Clip => ({
  id: 'clip-1',
  projectId: 'proj-1',
  name: 'Test',
  startTime: 0,
  endTime: 60,
  segments: segments.map((s, i) => ({
    id: s.id,
    clipId: 'clip-1',
    startTime: i * 10,
    endTime: i * 10 + 10,
    text: s.text,
    words: [],
    tags: [],
  })),
});

describe('buildPrompt', () => {
  it('includes each segment formatted as [ID] text', () => {
    const clip = makeClip([
      { id: 'seg-1', text: 'My mother came from a village.' },
      { id: 'seg-2', text: 'We had five siblings.' },
    ]);
    const prompt = buildPrompt([clip], { maxEvents: 10 });
    expect(prompt).toContain('[seg-1] My mother came from a village.');
    expect(prompt).toContain('[seg-2] We had five siblings.');
  });

  it('includes seed categories when provided', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const prompt = buildPrompt([clip], { maxEvents: 5, seedCategories: 'family, school' });
    expect(prompt).toContain('family, school');
  });

  it('includes maxEvents cap in the prompt', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const prompt = buildPrompt([clip], { maxEvents: 7 });
    expect(prompt).toContain('7');
  });

  it('instructs the LLM to return only JSON', () => {
    const clip = makeClip([{ id: 'seg-1', text: 'Hello.' }]);
    const prompt = buildPrompt([clip], { maxEvents: 10 });
    expect(prompt).toContain('Return ONLY a JSON array');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test
```

Expected: FAIL — `Cannot find module './reconstruct2story.helpers'`

- [ ] **Step 3: Implement buildPrompt**

Create `server/src/plugins/narrative/reconstruct2story.helpers.ts`:

```ts
import { Clip } from '../../models/clip.model';

interface PromptConfig {
  maxEvents: number;
  seedCategories?: string;
  language?: string;
}

/**
 * Builds the LLM prompt from source clips.
 * Segments are listed chronologically as [SEGMENT_ID] text.
 */
export function buildPrompt(clips: Clip[], config: PromptConfig): string {
  const lines = clips
    .flatMap(c => c.segments)
    .sort((a, b) => a.startTime - b.startTime)
    .map(s => `[${s.id}] ${s.text}`)
    .join('\n');

  const seedLine = config.seedCategories
    ? `\nThe interviewer suggested these possible life chapters: ${config.seedCategories}\n`
    : '';

  const langLine = config.language
    ? `\nRespond with event titles in: ${config.language}\n`
    : '';

  return `You are helping reconstruct a life story from an interview transcript.

Below is the transcript, one segment per line, formatted as [SEGMENT_ID] text:

${lines}
${seedLine}${langLine}
Group these segments into meaningful life events (maximum ${config.maxEvents} events).
Each event should tell a coherent chapter of the interviewee's life story.
You may reorder segments within an event to improve narrative flow.
Each segment may appear in at most one event.
Omit segments that do not fit any chapter.

Return ONLY a JSON array — no explanation, no markdown fences:
[
  { "title": "Event name", "segments": ["segment-id-1", "segment-id-2"] },
  ...
]`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/plugins/narrative/reconstruct2story.helpers.ts server/src/plugins/narrative/reconstruct2story.helpers.test.ts
git commit -m "feat(reconstruct2story): add buildPrompt helper with tests"
```

---

### Task 6: TDD — `parseEvents` + `buildCommitClips` helpers

**Files:**
- Modify: `server/src/plugins/narrative/reconstruct2story.helpers.ts`
- Modify: `server/src/plugins/narrative/reconstruct2story.helpers.test.ts`

- [ ] **Step 1: Write failing tests for parseEvents**

Append to `server/src/plugins/narrative/reconstruct2story.helpers.test.ts`:

```ts
import { parseEvents, buildCommitClips } from './reconstruct2story.helpers';
import { StoryEvent } from './reconstruct2story.types';
import { Segment } from '../../models/segment.model';

describe('parseEvents', () => {
  const validIds = new Set(['seg-1', 'seg-2', 'seg-3']);

  it('parses valid JSON array from LLM response', () => {
    const raw = JSON.stringify([
      { title: 'Family', segments: ['seg-1', 'seg-2'] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Family');
    expect(result[0].segments).toEqual(['seg-1', 'seg-2']);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n[{ "title": "School", "segments": ["seg-3"] }]\n```';
    const result = parseEvents(raw, validIds);
    expect(result[0].title).toBe('School');
  });

  it('silently discards segment IDs not in validIds', () => {
    const raw = JSON.stringify([
      { title: 'Family', segments: ['seg-1', 'seg-UNKNOWN'] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result[0].segments).toEqual(['seg-1']);
  });

  it('drops events with no valid segments', () => {
    const raw = JSON.stringify([
      { title: 'Ghost', segments: ['seg-UNKNOWN'] },
    ]);
    const result = parseEvents(raw, validIds);
    expect(result).toHaveLength(0);
  });

  it('throws on non-array JSON', () => {
    expect(() => parseEvents('{ "title": "x" }', validIds)).toThrow();
  });
});

describe('buildCommitClips', () => {
  const makeSegment = (id: string, clipId: string, start: number): Segment => ({
    id,
    clipId,
    startTime: start,
    endTime: start + 5,
    text: `Text of ${id}`,
    words: [],
    tags: [],
  });

  const sourceClips = [
    {
      id: 'clip-src',
      projectId: 'proj-1',
      name: 'Transcription',
      startTime: 0,
      endTime: 30,
      segments: [
        makeSegment('seg-1', 'clip-src', 0),
        makeSegment('seg-2', 'clip-src', 10),
        makeSegment('seg-3', 'clip-src', 20),
      ],
    },
  ];

  it('creates one clip per event with accepted segments only', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Family',
        segments: [
          { segmentId: 'seg-1', clipId: 'clip-src', accepted: true },
          { segmentId: 'seg-2', clipId: 'clip-src', accepted: false },
        ],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips).toHaveLength(1);
    expect(clips[0].name).toBe('Story: Family');
    expect(clips[0].segments).toHaveLength(1);
    expect(clips[0].segments[0].id).toBe('seg-1');
  });

  it('drops events with zero accepted segments', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Empty',
        segments: [{ segmentId: 'seg-1', clipId: 'clip-src', accepted: false }],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips).toHaveLength(0);
  });

  it('rewrites segment.clipId to the event id', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-2',
        title: 'School',
        segments: [{ segmentId: 'seg-3', clipId: 'clip-src', accepted: true }],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips[0].segments[0].clipId).toBe('evt-2');
  });

  it('sets clip startTime/endTime from first/last accepted segment', () => {
    const events: StoryEvent[] = [
      {
        id: 'evt-1',
        title: 'Life',
        segments: [
          { segmentId: 'seg-1', clipId: 'clip-src', accepted: true },
          { segmentId: 'seg-3', clipId: 'clip-src', accepted: true },
        ],
      },
    ];
    const clips = buildCommitClips('proj-1', events, sourceClips, 'Story');
    expect(clips[0].startTime).toBe(0);   // seg-1.startTime
    expect(clips[0].endTime).toBe(25);    // seg-3.endTime (20 + 5)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test
```

Expected: FAIL — `parseEvents is not exported`, `buildCommitClips is not exported`

- [ ] **Step 3: Implement parseEvents and buildCommitClips**

Append to `server/src/plugins/narrative/reconstruct2story.helpers.ts`:

```ts
import { StoryEvent } from './reconstruct2story.types';
import { Clip } from '../../models/clip.model';
import { Segment } from '../../models/segment.model';

/**
 * Parses the LLM response text into a list of events with validated segment IDs.
 * Strips markdown fences, validates segment IDs against the known set.
 */
export function parseEvents(
  responseText: string,
  validSegmentIds: Set<string>,
): Array<{ title: string; segments: string[] }> {
  const cleaned = responseText.replace(/```(?:json)?|```/g, '').trim();
  const raw = JSON.parse(cleaned) as unknown;
  if (!Array.isArray(raw)) throw new Error('LLM response is not a JSON array');

  return (raw as unknown[])
    .filter(
      (e): e is { title: string; segments: unknown[] } =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Record<string, unknown>)['title'] === 'string' &&
        Array.isArray((e as Record<string, unknown>)['segments']),
    )
    .map(e => ({
      title: e.title,
      segments: (e.segments as unknown[]).filter(
        (id): id is string => typeof id === 'string' && validSegmentIds.has(id),
      ),
    }))
    .filter(e => e.segments.length > 0);
}

/**
 * Converts approved StoryEvents into Clip objects, copying verbatim Segment data
 * from the source clips. Drops events with zero accepted segments.
 */
export function buildCommitClips(
  projectId: string,
  events: StoryEvent[],
  sourceClips: Clip[],
  prefix: string,
): Clip[] {
  // Build a flat segment lookup from all source clips
  const segmentMap = new Map<string, Segment>();
  for (const clip of sourceClips) {
    for (const seg of clip.segments) {
      segmentMap.set(seg.id, seg);
    }
  }

  const result: Clip[] = [];

  for (const event of events) {
    const acceptedSegments: Segment[] = event.segments
      .filter(ref => ref.accepted)
      .map(ref => {
        const seg = segmentMap.get(ref.segmentId);
        if (!seg) return null;
        return { ...seg, clipId: event.id };
      })
      .filter((s): s is Segment => s !== null);

    if (acceptedSegments.length === 0) continue;

    result.push({
      id: event.id,
      projectId,
      name: `${prefix}: ${event.title}`,
      startTime: acceptedSegments[0].startTime,
      endTime: acceptedSegments[acceptedSegments.length - 1].endTime,
      segments: acceptedSegments,
    });
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test
```

Expected: PASS — all tests (buildPrompt + parseEvents + buildCommitClips) passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/plugins/narrative/reconstruct2story.helpers.ts server/src/plugins/narrative/reconstruct2story.helpers.test.ts
git commit -m "feat(reconstruct2story): add parseEvents + buildCommitClips helpers with tests"
```

---

### Task 7: Build Copilot Studio Direct Line client

**Files:**
- Create: `server/src/plugins/narrative/copilot.client.ts`

The plugin calls the Microsoft Copilot Studio bot via the [Direct Line REST API v3](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-direct-line-3-0-concepts). The `copilotEndpoint` config field is the Direct Line endpoint base URL (e.g. `https://directline.botframework.com/v3/directline`). The endpoint may optionally include a token via query string (as Copilot Studio provides when you copy the "Direct Line endpoint" from its publishing settings).

- [ ] **Step 1: Create the client**

Create `server/src/plugins/narrative/copilot.client.ts`:

```ts
import fetch from 'node-fetch';

interface DirectLineActivity {
  type: string;
  from: { id: string; role?: string };
  text?: string;
}

interface DirectLineConversationResponse {
  conversationId: string;
  token?: string;
}

interface DirectLineActivitiesResponse {
  activities: DirectLineActivity[];
  watermark?: string;
}

/**
 * Sends a single-turn prompt to a Microsoft Copilot Studio bot via Direct Line.
 * Returns the bot's first text reply.
 *
 * @param endpoint - Direct Line base URL, e.g. https://directline.botframework.com/v3/directline
 *                   May include a token query parameter as provided by Copilot Studio.
 * @param prompt   - The text message to send to the bot.
 * @param timeoutMs - Max wait time for bot response (default 60 seconds).
 */
export async function callCopilotStudio(
  endpoint: string,
  prompt: string,
  timeoutMs = 60_000,
): Promise<string> {
  // Step 1: Start a conversation
  const convRes = await fetch(`${endpoint}/conversations`, { method: 'POST' });
  if (!convRes.ok) {
    throw new Error(
      `Copilot Studio: failed to start conversation (HTTP ${convRes.status})`,
    );
  }
  const conv = (await convRes.json()) as DirectLineConversationResponse;
  const { conversationId } = conv;

  const userId = `vtextstudio-user`;

  // Step 2: Send the prompt as a message activity
  const sendRes = await fetch(
    `${endpoint}/conversations/${conversationId}/activities`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        from: { id: userId },
        text: prompt,
      }),
    },
  );
  if (!sendRes.ok) {
    throw new Error(
      `Copilot Studio: failed to send message (HTTP ${sendRes.status})`,
    );
  }

  // Step 3: Poll for the bot's response
  const deadline = Date.now() + timeoutMs;
  let watermark: string | undefined;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));

    const pollUrl = watermark
      ? `${endpoint}/conversations/${conversationId}/activities?watermark=${watermark}`
      : `${endpoint}/conversations/${conversationId}/activities`;

    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) continue;

    const data = (await pollRes.json()) as DirectLineActivitiesResponse;
    watermark = data.watermark;

    const botReply = data.activities.find(
      a => a.type === 'message' && a.from.role === 'bot' && a.text,
    );
    if (botReply?.text) return botReply.text;
  }

  throw new Error('Copilot Studio: timed out waiting for bot response');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/plugins/narrative/copilot.client.ts
git commit -m "feat(reconstruct2story): add Copilot Studio Direct Line client"
```

---

### Task 8: Implement the full plugin — `execute()` + `registerRoutes()`

**Files:**
- Create: `server/src/plugins/narrative/reconstruct2story.plugin.ts`

- [ ] **Step 1: Create the plugin**

Create `server/src/plugins/narrative/reconstruct2story.plugin.ts`:

```ts
import { Express, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { IPlugin } from '../plugin.interface';
import { PipelineContext } from '../../models/pipeline-context.model';
import { StoryProposal, StoryEvent, PROPOSAL_KEY } from './reconstruct2story.types';
import { buildPrompt, parseEvents, buildCommitClips } from './reconstruct2story.helpers';
import { callCopilotStudio } from './copilot.client';
import { projectService } from '../../services/project.service';

interface Reconstruct2StoryConfig {
  copilotEndpoint: string;
  seedCategories?: string;
  language?: string;
  maxEvents?: number;
  storyClipPrefix?: string;
}

export const reconstruct2storyPlugin: IPlugin = {
  id: 'reconstruct2story',
  name: 'Reconstruct to Story',
  description:
    'Groups interview transcript segments into life-event chapters using an LLM. Produces a story narrative told in the interviewee\'s voice.',
  type: 'narrative',
  hasUI: true,
  configSchema: {
    type: 'object',
    properties: {
      copilotEndpoint: {
        type: 'string',
        title: 'Copilot Studio Direct Line Endpoint',
        description:
          'Base URL of your Copilot Studio bot\'s Direct Line endpoint, e.g. https://directline.botframework.com/v3/directline',
      },
      seedCategories: {
        type: 'string',
        title: 'Seed Categories (optional)',
        description: 'Comma-separated life-chapter hints, e.g. "family, school, army"',
        default: '',
      },
      language: {
        type: 'string',
        title: 'Event Title Language (optional)',
        description: 'Language for generated event titles, e.g. "Hebrew". Defaults to auto-detect.',
        default: '',
      },
      maxEvents: {
        type: 'number',
        title: 'Max Events',
        description: 'Maximum number of life chapters the LLM may propose.',
        default: 10,
      },
      storyClipPrefix: {
        type: 'string',
        title: 'Clip Name Prefix',
        description: 'Prefix for generated clip names, e.g. "Story" → "Story: Family"',
        default: 'Story',
      },
    },
    required: ['copilotEndpoint'],
  },

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    const cfg = (ctx.metadata['reconstruct2story'] ?? {}) as Reconstruct2StoryConfig;

    if (!cfg.copilotEndpoint) {
      throw new Error('reconstruct2story: copilotEndpoint is required in plugin config.');
    }

    if (ctx.clips.length === 0) {
      throw new Error('reconstruct2story: no clips found. Run a transcription plugin first.');
    }

    const maxEvents = cfg.maxEvents ?? 10;
    const prefix = cfg.storyClipPrefix ?? 'Story';

    // Build prompt and call Copilot Studio
    const prompt = buildPrompt(ctx.clips, {
      maxEvents,
      seedCategories: cfg.seedCategories,
      language: cfg.language,
    });

    const responseText = await callCopilotStudio(cfg.copilotEndpoint, prompt);

    // Build a set of all valid segment IDs in this pipeline context
    const validSegmentIds = new Set(
      ctx.clips.flatMap(c => c.segments.map(s => s.id)),
    );

    const parsedEvents = parseEvents(responseText, validSegmentIds);

    // Convert to StoryEvent[]
    const events: StoryEvent[] = parsedEvents.map(e => ({
      id: uuidv4(),
      title: e.title,
      segments: e.segments.map(segId => {
        const clip = ctx.clips.find(c => c.segments.some(s => s.id === segId))!;
        return { segmentId: segId, clipId: clip.id, accepted: true };
      }),
    }));

    const proposal: StoryProposal = {
      projectId: ctx.projectId,
      sourceClipIds: ctx.clips.map(c => c.id),
      storyClipPrefix: prefix,
      events,
    };

    // Persist proposal to project metadata (clips unchanged at this stage)
    const project = projectService.get(ctx.projectId);
    if (project) {
      projectService.update(ctx.projectId, {
        metadata: { ...(project.metadata ?? {}), [PROPOSAL_KEY]: proposal },
      });
    }

    // Return context unchanged — clips are replaced only after user review
    return ctx;
  },

  registerRoutes(app: Express): void {
    const base = '/api/plugins/reconstruct2story';

    /** GET proposal — returns the pending StoryProposal for a project */
    app.get(`${base}/proposal/:projectId`, (req: Request, res: Response) => {
      const project = projectService.get(req.params['projectId']);
      if (!project) return void res.status(404).json({ error: 'Project not found' });

      const proposal = project.metadata?.[PROPOSAL_KEY] as StoryProposal | undefined;
      if (!proposal) return void res.status(404).json({ error: 'No pending proposal' });

      res.json(proposal);
    });

    /** DELETE proposal — discard without committing */
    app.delete(`${base}/proposal/:projectId`, (req: Request, res: Response) => {
      const project = projectService.get(req.params['projectId']);
      if (!project) return void res.status(404).json({ error: 'Project not found' });

      const newMeta = { ...(project.metadata ?? {}) };
      delete newMeta[PROPOSAL_KEY];
      projectService.update(req.params['projectId'], { metadata: newMeta });

      res.json({ ok: true });
    });

    /** POST commit — apply approved events, replace transcription clips */
    app.post(`${base}/commit/:projectId`, (req: Request, res: Response) => {
      const project = projectService.get(req.params['projectId']);
      if (!project) return void res.status(404).json({ error: 'Project not found' });

      const proposal = project.metadata?.[PROPOSAL_KEY] as StoryProposal | undefined;
      if (!proposal) return void res.status(404).json({ error: 'No pending proposal' });

      const { events } = req.body as { events: StoryEvent[] };
      if (!Array.isArray(events)) {
        return void res.status(400).json({ error: 'Request body must include events array' });
      }

      // Source clips (only the ones referenced in the proposal)
      const sourceClips = project.clips.filter(c =>
        proposal.sourceClipIds.includes(c.id),
      );

      const storyClips = buildCommitClips(
        project.id,
        events,
        sourceClips,
        proposal.storyClipPrefix,
      );

      // Replace source clips with story clips; keep any other clips untouched
      const otherClips = project.clips.filter(
        c => !proposal.sourceClipIds.includes(c.id),
      );

      const newMeta = { ...(project.metadata ?? {}) };
      delete newMeta[PROPOSAL_KEY];

      projectService.update(project.id, {
        clips: [...otherClips, ...storyClips],
        metadata: newMeta,
      });

      res.json({ clipCount: storyClips.length });
    });
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd server && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/plugins/narrative/reconstruct2story.plugin.ts
git commit -m "feat(reconstruct2story): implement execute() and registerRoutes()"
```

---

### Task 9: Register the plugin

**Files:**
- Modify: `server/src/plugins/plugin-registry.ts`

- [ ] **Step 1: Import and register the plugin**

In `server/src/plugins/plugin-registry.ts`, add the import and register call:

```ts
import { reconstruct2storyPlugin } from './narrative/reconstruct2story.plugin';
```

In the constructor, after the existing registrations:

```ts
this.register(reconstruct2storyPlugin);
```

- [ ] **Step 2: Verify the server starts**

```bash
cd server && npm run dev
```

Expected: `VTextStudio server running on http://localhost:3000` (no crash). Press Ctrl+C to stop.

- [ ] **Step 3: Verify plugin appears in plugin list**

```bash
curl http://localhost:3000/api/plugins
```

Expected: JSON array includes an object with `"id": "reconstruct2story"`.

- [ ] **Step 4: Commit**

```bash
git add server/src/plugins/plugin-registry.ts
git commit -m "feat(reconstruct2story): register plugin in registry"
```

---

### Task 10: Build `StoryReviewPanelComponent`

**Files:**
- Create: `client/src/app/features/studio/story-review-panel/story-review-panel.component.ts`
- Create: `client/src/app/features/studio/story-review-panel/story-review-panel.component.spec.ts`

- [ ] **Step 1: Write failing component tests**

Create `client/src/app/features/studio/story-review-panel/story-review-panel.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { StoryReviewPanelComponent } from './story-review-panel.component';
import { StoryProposal } from '../../../core/models/story-proposal.model';
import { By } from '@angular/platform-browser';

const makeProposal = (): StoryProposal => ({
  projectId: 'proj-1',
  sourceClipIds: ['clip-src'],
  storyClipPrefix: 'Story',
  events: [
    {
      id: 'evt-1',
      title: 'Family',
      segments: [
        { segmentId: 'seg-1', clipId: 'clip-src', accepted: true },
        { segmentId: 'seg-2', clipId: 'clip-src', accepted: true },
      ],
    },
  ],
});

const SEGMENT_TEXTS: Record<string, string> = {
  'seg-1': 'My mother came from a village.',
  'seg-2': 'We had five siblings.',
};

describe('StoryReviewPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StoryReviewPanelComponent],
    }).compileComponents();
  });

  it('renders one section per event', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    const sections = fixture.debugElement.queryAll(By.css('.event-section'));
    expect(sections.length).toBe(1);
  });

  it('shows the event title', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    const title = fixture.debugElement.query(By.css('.event-title'));
    expect(title.nativeElement.textContent).toContain('Family');
  });

  it('emits commit with current events on confirm click', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    let emitted: StoryProposal['events'] | undefined;
    fixture.componentInstance.commit.subscribe((v: StoryProposal['events']) => (emitted = v));

    fixture.debugElement.query(By.css('[data-testid="btn-commit"]')).nativeElement.click();
    expect(emitted).toBeDefined();
    expect(emitted![0].title).toBe('Family');
  });

  it('emits discard on discard click', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    let discarded = false;
    fixture.componentInstance.discard.subscribe(() => (discarded = true));

    fixture.debugElement.query(By.css('[data-testid="btn-discard"]')).nativeElement.click();
    expect(discarded).toBe(true);
  });

  it('toggling a segment flips accepted state', () => {
    const fixture = TestBed.createComponent(StoryReviewPanelComponent);
    fixture.componentRef.setInput('proposal', makeProposal());
    fixture.componentRef.setInput('segmentTexts', SEGMENT_TEXTS);
    fixture.detectChanges();

    const toggle = fixture.debugElement.query(By.css('.segment-toggle'));
    toggle.nativeElement.click();
    fixture.detectChanges();

    // First segment should now be rejected (struck through)
    const segRow = fixture.debugElement.query(By.css('.segment-row'));
    expect(segRow.classes['rejected']).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client && npm test
```

Expected: FAIL — `Cannot find module './story-review-panel.component'`

- [ ] **Step 3: Implement StoryReviewPanelComponent**

Create `client/src/app/features/studio/story-review-panel/story-review-panel.component.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { StoryEvent, StoryProposal, StorySegmentRef } from '../../../core/models/story-proposal.model';

interface MutableSegmentRef extends StorySegmentRef {
  accepted: boolean;
}

interface MutableEvent {
  id: string;
  title: string;
  segments: MutableSegmentRef[];
  collapsed: boolean;
  editingTitle: boolean;
}

@Component({
  selector: 'app-story-review-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel" role="complementary" aria-label="Story review panel">
      <div class="panel-header">
        <h2 class="panel-title">Story Review</h2>
        <button class="close-btn" (click)="discard.emit()" aria-label="Close panel">×</button>
      </div>

      <div class="panel-body">
        @for (event of events(); track event.id) {
          <section class="event-section">
            <div class="event-header">
              @if (event.editingTitle) {
                <input
                  class="title-input"
                  [value]="event.title"
                  (blur)="finishEditTitle(event, $any($event.target).value)"
                  (keydown.enter)="finishEditTitle(event, $any($event.target).value)"
                  autofocus
                  aria-label="Event title"
                />
              } @else {
                <button
                  class="event-title"
                  (click)="toggleCollapse(event)"
                  [attr.aria-expanded]="!event.collapsed"
                >
                  {{ event.collapsed ? '▶' : '▼' }} {{ event.title }}
                </button>
              }
              <button
                class="edit-btn"
                (click)="startEditTitle(event)"
                aria-label="Edit event title"
              >edit</button>
            </div>

            @if (!event.collapsed) {
              <ul class="segment-list" role="list">
                @for (seg of event.segments; track seg.segmentId) {
                  <li
                    class="segment-row"
                    [class.rejected]="!seg.accepted"
                    role="listitem"
                  >
                    <button
                      class="segment-toggle"
                      (click)="toggleSegment(seg)"
                      [attr.aria-pressed]="seg.accepted"
                      [attr.aria-label]="seg.accepted ? 'Reject segment' : 'Accept segment'"
                    >{{ seg.accepted ? '✓' : '✗' }}</button>
                    <span class="segment-text">
                      {{ (segmentTexts()[seg.segmentId] ?? seg.segmentId) | slice:0:120 }}
                    </span>
                  </li>
                }
              </ul>
            }
          </section>
        }
      </div>

      <div class="panel-footer">
        <button
          class="btn-discard"
          data-testid="btn-discard"
          (click)="discard.emit()"
        >Discard Story</button>
        <button
          class="btn-commit"
          data-testid="btn-commit"
          (click)="onCommit()"
        >Commit Story</button>
      </div>
    </div>
  `,
  styles: [`
    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      width: 340px;
      overflow: hidden;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: .75rem 1rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .panel-title { margin: 0; font-size: .95rem; font-weight: 600; }
    .close-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.2rem; color: var(--color-muted);
      line-height: 1; padding: 0;
    }
    .panel-body { flex: 1; overflow-y: auto; padding: .5rem 0; }
    .event-section { border-bottom: 1px solid var(--color-border); }
    .event-header {
      display: flex; align-items: center; gap: .5rem;
      padding: .5rem 1rem;
    }
    .event-title {
      flex: 1; text-align: left; background: none; border: none;
      cursor: pointer; font-weight: 600; font-size: .88rem;
      color: var(--color-text);
    }
    .title-input {
      flex: 1; font-size: .88rem; font-weight: 600;
      border: 1px solid var(--color-accent); border-radius: 4px;
      padding: .2rem .4rem; background: var(--color-bg); color: var(--color-text);
    }
    .edit-btn {
      background: none; border: none; cursor: pointer;
      font-size: .75rem; color: var(--color-muted);
    }
    .segment-list { list-style: none; margin: 0; padding: 0 1rem .5rem; }
    .segment-row {
      display: flex; align-items: flex-start; gap: .5rem;
      padding: .25rem 0; font-size: .82rem;
    }
    .segment-row.rejected .segment-text { text-decoration: line-through; color: var(--color-muted); }
    .segment-toggle {
      flex-shrink: 0; background: none; border: 1px solid var(--color-border);
      border-radius: 3px; cursor: pointer; font-size: .8rem; width: 1.4rem; height: 1.4rem;
      display: flex; align-items: center; justify-content: center;
    }
    .segment-text { line-height: 1.4; }
    .panel-footer {
      display: flex; justify-content: space-between; gap: .5rem;
      padding: .75rem 1rem; border-top: 1px solid var(--color-border); flex-shrink: 0;
    }
    .btn-discard {
      background: none; border: 1px solid var(--color-border); border-radius: 6px;
      padding: .4rem .8rem; cursor: pointer; font-size: .85rem; color: var(--color-muted);
    }
    .btn-commit {
      background: var(--color-accent); color: #fff; border: none; border-radius: 6px;
      padding: .4rem .8rem; cursor: pointer; font-size: .85rem; font-weight: 600;
    }
  `],
  imports: [],
  host: {},
})
export class StoryReviewPanelComponent {
  readonly proposal = input.required<StoryProposal>();
  readonly segmentTexts = input<Record<string, string>>({});

  readonly commit = output<StoryEvent[]>();
  readonly discard = output<void>();

  readonly events = computed<MutableEvent[]>(() =>
    this.proposal().events.map(e => ({
      id: e.id,
      title: e.title,
      segments: e.segments.map(s => ({ ...s })),
      collapsed: false,
      editingTitle: false,
    })),
  );

  toggleCollapse(event: MutableEvent): void {
    event.collapsed = !event.collapsed;
  }

  startEditTitle(event: MutableEvent): void {
    event.editingTitle = true;
  }

  finishEditTitle(event: MutableEvent, newTitle: string): void {
    event.title = newTitle.trim() || event.title;
    event.editingTitle = false;
  }

  toggleSegment(seg: MutableSegmentRef): void {
    seg.accepted = !seg.accepted;
  }

  onCommit(): void {
    const result: StoryEvent[] = this.events().map(e => ({
      id: e.id,
      title: e.title,
      segments: e.segments,
    }));
    this.commit.emit(result);
  }
}
```

**Note on mutability:** `computed()` creates mutable objects from the signal each time the signal changes. Direct mutations to array items (toggling `accepted`, collapsing) work because Angular's OnPush only checks the signal reference, and these local mutations drive immediate DOM updates via the template. If the `proposal` input changes, `events()` recomputes from scratch.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npm test
```

Expected: PASS — all 5 StoryReviewPanel tests passing.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/story-review-panel/
git commit -m "feat(reconstruct2story): add StoryReviewPanelComponent with tests"
```

---

### Task 11: Wire `StoryReviewPanelComponent` into `StudioComponent`

**Files:**
- Modify: `client/src/app/features/studio/studio.component.ts`

The Studio needs to:
1. Check project metadata for a pending proposal after loading
2. Show a dismissible banner if one exists
3. Open the review panel when the user clicks the banner
4. Call the plugin's API routes to GET the proposal, POST commit, or DELETE discard

- [ ] **Step 1: Add a `StoryApiService` for the three HTTP calls**

Add a small service directly in the studio directory:

Create `client/src/app/features/studio/story-review-panel/story-api.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { StoryEvent, StoryProposal } from '../../../core/models/story-proposal.model';

@Injectable({ providedIn: 'root' })
export class StoryApiService {
  private api = inject(ApiService);
  // ApiService prepends /api — so base is without the /api prefix
  private base = '/plugins/reconstruct2story';

  getProposal(projectId: string): Observable<StoryProposal> {
    return this.api.get<StoryProposal>(`${this.base}/proposal/${projectId}`);
  }

  commit(projectId: string, events: StoryEvent[]): Observable<{ clipCount: number }> {
    return this.api.post<{ clipCount: number }>(
      `${this.base}/commit/${projectId}`,
      { events },
    );
  }

  discard(projectId: string): Observable<{ ok: boolean }> {
    return this.api.delete<{ ok: boolean }>(`${this.base}/proposal/${projectId}`);
  }
}
```

- [ ] **Step 2: Update StudioComponent**

Replace `client/src/app/features/studio/studio.component.ts` with the updated version that adds proposal detection and the review panel. Key changes:

```ts
import { ChangeDetectionStrategy, Component, OnInit, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ClipService } from '../../core/services/clip.service';
import { ProjectService } from '../../core/services/project.service';
import { SseService } from '../../core/services/sse.service';
import { ApiService } from '../../core/services/api.service';
import { ClipListComponent } from './clip-list/clip-list.component';
import { TxtMediaPlayerV2Component } from './txt-media-player-v2/txt-media-player-v2.component';
import { ExportPanelComponent } from './export-panel/export-panel.component';
import { StoryReviewPanelComponent } from './story-review-panel/story-review-panel.component';
import { StoryApiService } from './story-review-panel/story-api.service';
import { Clip } from '../../core/models/clip.model';
import { StoryEvent, StoryProposal } from '../../core/models/story-proposal.model';

@Component({
  selector: 'app-studio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ClipListComponent,
    TxtMediaPlayerV2Component,
    ExportPanelComponent,
    StoryReviewPanelComponent,
  ],
  template: `
    <div class="studio-layout">
      <header class="studio-header">
        <div class="logo">
          <span class="logo-icon">✦</span>
          <span class="logo-text">VTextStudio</span>
        </div>
        <button class="sidebar-toggle" (click)="toggleSidebar()" aria-label="Toggle clip sidebar">☰</button>
        <h1 class="project-name">{{ (projectService.project()?.name) ?? 'Untitled Project' }}</h1>
        <nav class="studio-nav">
          <a routerLink="/" class="nav-link">← New Project</a>
        </nav>
      </header>

      @if (pendingProposal()) {
        <div class="proposal-banner" role="alert">
          <span>A story reconstruction is ready for your review.</span>
          <button class="banner-btn" (click)="openReviewPanel()">Review Story</button>
          <button class="banner-dismiss" (click)="pendingProposal.set(null)" aria-label="Dismiss banner">×</button>
        </div>
      }

      <main class="studio-body">
        <aside class="clip-panel" [class.open]="isSidebarOpen()">
          @if (isLoadingClips()) {
            <div class="clip-loading">Loading clips...</div>
          } @else {
            <app-clip-list
              [clips]="clipService.clips()"
              [activeClipId]="activeClip()?.id ?? null"
              (clipSelected)="selectClip($event)"
            />
          }
        </aside>
        <div class="clip-backdrop" [class.visible]="isSidebarOpen()" (click)="closeSidebar()"></div>

        <section class="player-panel">
          @if (activeClip()) {
            <app-txt-media-player-v2 [clip]="activeClip()!" />
          } @else {
            <div class="empty-player">
              <p>Select a clip from the list to start editing</p>
            </div>
          }
        </section>

        @if (projectService.project(); as proj) {
          <aside class="export-panel-wrapper">
            <app-export-panel [projectId]="proj.id" />
          </aside>
        }

        @if (showReviewPanel() && pendingProposal()) {
          <aside class="review-panel-wrapper">
            <app-story-review-panel
              [proposal]="pendingProposal()!"
              [segmentTexts]="segmentTexts()"
              (commit)="onCommit($event)"
              (discard)="onDiscard()"
            />
          </aside>
        }
      </main>
    </div>
  `,
  styles: [`
    /* Copy all existing styles from the original studio.component.ts styles array here,
       then append the new rules below: */
    .studio-layout { display: flex; flex-direction: column; height: 100vh; background: var(--color-bg); overflow: hidden; }
    .studio-header { display: flex; align-items: center; gap: 1rem; padding: .6rem 1.25rem; border-bottom: 1px solid var(--color-border); background: var(--color-surface); flex-shrink: 0; }
    .logo { display: flex; align-items: center; gap: .4rem; }
    .logo-icon { color: var(--color-accent); font-size: 1.1rem; }
    .logo-text { font-weight: 700; font-size: 1rem; }
    .project-name { flex: 1; font-size: .95rem; color: var(--color-text-secondary); margin: 0; font-weight: 400; }
    .studio-nav { display: flex; gap: .75rem; }
    .sidebar-toggle { display: none; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-bg); color: var(--color-text); cursor: pointer; font-size: .95rem; line-height: 1; padding: .28rem .42rem; }
    .nav-link { color: var(--color-muted); font-size: .8rem; text-decoration: none; &:hover { color: var(--color-accent); } }
    .studio-body { display: flex; flex: 1; overflow: hidden; }
    .clip-panel { width: 280px; flex-shrink: 0; border-right: 1px solid var(--color-border); overflow-y: auto; background: var(--color-surface); }
    .clip-loading { color: var(--color-muted); font-size: .85rem; padding: 1rem; }
    .clip-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 20; }
    .clip-backdrop.visible { display: block; }
    .player-panel { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    .empty-player { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-muted); font-size: .9rem; }
    .export-panel-wrapper { flex-shrink: 0; overflow-y: auto; }
    @media (max-width: 1024px) {
      .sidebar-toggle { display: inline-flex; align-items: center; justify-content: center; }
      .clip-panel { position: fixed; top: 49px; left: 0; bottom: 0; width: min(82vw, 320px); transform: translateX(-101%); transition: transform 180ms ease; z-index: 30; }
      .clip-panel.open { transform: translateX(0); }
      .export-panel-wrapper { display: none; }
    }
    /* New styles for proposal banner and review panel: */
    .proposal-banner {
      display: flex; align-items: center; gap: .75rem;
      padding: .5rem 1.25rem;
      background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
      border-bottom: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
      font-size: .85rem;
    }
    .banner-btn {
      background: var(--color-accent); color: #fff; border: none;
      border-radius: 5px; padding: .25rem .7rem; cursor: pointer; font-size: .82rem;
    }
    .banner-dismiss {
      margin-left: auto; background: none; border: none;
      cursor: pointer; color: var(--color-muted); font-size: 1rem;
    }
    .review-panel-wrapper {
      flex-shrink: 0; overflow-y: auto;
      border-left: 1px solid var(--color-border);
    }
  `]
})
export class StudioComponent implements OnInit {
  readonly activeClip = signal<Clip | null>(null);
  readonly isSidebarOpen = signal(false);
  readonly isLoadingClips = signal(true);
  readonly pendingProposal = signal<StoryProposal | null>(null);
  readonly showReviewPanel = signal(false);

  private storyApi = inject(StoryApiService);

  readonly segmentTexts = computed(() => {
    const texts: Record<string, string> = {};
    for (const clip of this.clipService.clips()) {
      for (const seg of clip.segments) {
        texts[seg.id] = seg.text;
      }
    }
    return texts;
  });

  constructor(
    readonly clipService: ClipService,
    readonly projectService: ProjectService,
    private sseService: SseService,
  ) {}

  ngOnInit(): void {
    this.sseService.connect();
    this.projectService.load().subscribe({
      next: (project) => this.checkForProposal(project?.id),
    });
    this.clipService.loadAll().subscribe({
      next: (clips) => {
        if (clips.length) this.activeClip.set(clips[0]);
      },
      complete: () => this.isLoadingClips.set(false),
      error: () => this.isLoadingClips.set(false),
    });
  }

  private checkForProposal(projectId: string | undefined): void {
    if (!projectId) return;
    this.storyApi.getProposal(projectId).subscribe({
      next: (proposal) => this.pendingProposal.set(proposal),
      error: () => { /* 404 = no proposal, ignore */ },
    });
  }

  openReviewPanel(): void {
    this.showReviewPanel.set(true);
  }

  onCommit(events: StoryEvent[]): void {
    const projectId = this.projectService.project()?.id;
    if (!projectId) return;
    this.storyApi.commit(projectId, events).subscribe({
      next: () => {
        this.pendingProposal.set(null);
        this.showReviewPanel.set(false);
        // Reload clips to show the new story clips
        this.clipService.loadAll().subscribe({
          next: (clips) => {
            if (clips.length) this.activeClip.set(clips[0]);
          },
        });
      },
    });
  }

  onDiscard(): void {
    const projectId = this.projectService.project()?.id;
    if (!projectId) return;
    this.storyApi.discard(projectId).subscribe({
      next: () => {
        this.pendingProposal.set(null);
        this.showReviewPanel.set(false);
      },
    });
  }

  selectClip(clip: Clip): void {
    this.activeClip.set(clip);
    this.closeSidebar();
  }

  toggleSidebar(): void {
    this.isSidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }
}
```

**Important:** `ChangeDetectionStrategy` and `computed` are included in the import above. The existing `StudioComponent` did not set `changeDetection` — add it to match Angular best practices per the project's CLAUDE.md.

- [ ] **Step 3: Verify the app builds**

```bash
cd client && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/studio.component.ts client/src/app/features/studio/story-review-panel/story-api.service.ts
git commit -m "feat(reconstruct2story): wire review panel into Studio component"
```

---

## Self-Review Checklist

After all tasks are complete:

- [ ] Run `cd server && npm test` — all server tests pass
- [ ] Run `cd client && npm test` — all client tests pass
- [ ] Run `cd server && npm run dev` and verify `reconstruct2story` appears in `GET /api/plugins`
- [ ] Run `cd client && npm run build` — no TypeScript errors

---

## Manual Smoke Test

1. Create a new project, run Groq Whisper transcription on a short audio file
2. Run the pipeline again with `reconstruct2story` added after the transcription step, using your Copilot Studio endpoint
3. After the pipeline completes, open the Studio — the proposal banner should appear
4. Click "Review Story" — the side drawer opens with events and segments
5. Toggle a segment to rejected — it strikes through
6. Rename an event title — click edit, type new name, press Enter
7. Click "Commit Story" — clips in the sidebar update to show story-event clips
8. Run the pipeline a second time — a new proposal overwrites the previous one (no duplicate banners)
9. Click "Discard Story" — proposal clears, original clips are preserved (none remain since they were replaced in step 7 — verify by checking project state before step 7)
