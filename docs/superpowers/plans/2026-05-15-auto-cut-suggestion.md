# Auto Cut Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered cut suggestions — hybrid speech analysis (Python) + optional Ollama LLM scoring — surfaced as amber inline highlights in the transcript and a ranked side panel where users accept/reject per suggestion.

**Architecture:** Two-pass Python endpoint (`/suggest`) — Pass 1 runs synchronously (silence gaps, filler words EN+HE, Whisper low-confidence), Pass 2 calls Ollama if reachable. Node route `POST /api/clips/:clipId/suggest-cuts` proxies to Python and returns JSON. Angular `SuggestionService` holds ephemeral signal state; `SuggestionsPanelComponent` renders the ranked list; transcript highlights suggested words with a CSS class.

**Tech Stack:** FastAPI (Python), Express/TypeScript (Node), Angular 20+ signals, Ollama REST API (`/api/chat`), pytest, Angular TestBed.

---

## File Map

| Action | Path |
|---|---|
| Create | `vision-service/routers/suggest.py` |
| Modify | `vision-service/main.py` |
| Create | `server/src/routes/suggest.routes.ts` |
| Modify | `server/src/main.ts` |
| Create | `client/src/app/core/models/suggestion.model.ts` |
| Create | `client/src/app/features/studio/suggestions/suggestion.service.ts` |
| Create | `client/src/app/features/studio/suggestions/suggestion.service.spec.ts` |
| Create | `client/src/app/features/studio/suggestions-panel/suggestions-panel.component.ts` |
| Create | `client/src/app/features/studio/suggestions-panel/suggestions-panel.component.spec.ts` |
| Modify | `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` |
| Modify | `client/src/app/features/studio/studio.component.ts` |

---

## Task 1: Python Pass 1 — Speech Analysis Router

**Files:**
- Create: `vision-service/routers/suggest.py`
- Create: `vision-service/tests/test_suggest.py`

- [ ] **Step 1: Write failing tests for Pass 1**

```python
# vision-service/tests/test_suggest.py
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

BASE_WORDS = [
    {"id": "w1", "text": "So",      "startTime": 0.0,  "endTime": 0.4,  "probability": 0.95},
    {"id": "w2", "text": "um",      "startTime": 0.5,  "endTime": 0.7,  "probability": 0.90},
    {"id": "w3", "text": "I",       "startTime": 2.8,  "endTime": 3.0,  "probability": 0.98},
    {"id": "w4", "text": "think",   "startTime": 3.1,  "endTime": 3.4,  "probability": 0.30},
    {"id": "w5", "text": "כאילו",   "startTime": 3.5,  "endTime": 3.9,  "probability": 0.85},
    {"id": "w6", "text": "right",   "startTime": 3.95, "endTime": 4.2,  "probability": 0.92},
]

def test_silence_detected():
    resp = client.post("/suggest", json={
        "words": BASE_WORDS,
        "silenceThresholdMs": 500,
        "fillerLangs": ["en"],
        "ollamaEnabled": False,
        "ollamaModel": "llama3:8b",
        "ollamaBaseUrl": "http://localhost:11434",
    })
    assert resp.status_code == 200
    results = resp.json()
    silence = [r for r in results if r["reason"] == "silence"]
    assert len(silence) == 1
    assert silence[0]["wordIds"] == []  # silence gap has no wordIds
    assert silence[0]["durationMs"] == pytest.approx(2100, abs=50)

def test_filler_en_detected():
    resp = client.post("/suggest", json={
        "words": BASE_WORDS,
        "silenceThresholdMs": 500,
        "fillerLangs": ["en"],
        "ollamaEnabled": False,
        "ollamaModel": "llama3:8b",
        "ollamaBaseUrl": "http://localhost:11434",
    })
    results = resp.json()
    fillers = [r for r in results if r["reason"] == "filler-word"]
    texts = [r["text"].lower() for r in fillers]
    assert "um" in texts

def test_filler_he_detected():
    resp = client.post("/suggest", json={
        "words": BASE_WORDS,
        "silenceThresholdMs": 500,
        "fillerLangs": ["he"],
        "ollamaEnabled": False,
        "ollamaModel": "llama3:8b",
        "ollamaBaseUrl": "http://localhost:11434",
    })
    results = resp.json()
    fillers = [r for r in results if r["reason"] == "filler-word"]
    texts = [r["text"] for r in fillers]
    assert "כאילו" in texts

def test_no_filler_partial_match():
    words = [{"id": "w1", "text": "software", "startTime": 0.0, "endTime": 0.5, "probability": 0.99}]
    resp = client.post("/suggest", json={
        "words": words,
        "silenceThresholdMs": 500,
        "fillerLangs": ["en"],
        "ollamaEnabled": False,
        "ollamaModel": "llama3:8b",
        "ollamaBaseUrl": "http://localhost:11434",
    })
    results = resp.json()
    fillers = [r for r in results if r["reason"] == "filler-word"]
    assert len(fillers) == 0  # "so" in "software" must NOT match

def test_low_confidence_detected():
    resp = client.post("/suggest", json={
        "words": BASE_WORDS,
        "silenceThresholdMs": 500,
        "fillerLangs": [],
        "ollamaEnabled": False,
        "ollamaModel": "llama3:8b",
        "ollamaBaseUrl": "http://localhost:11434",
    })
    results = resp.json()
    low_conf = [r for r in results if r["reason"] == "low-confidence"]
    word_ids = [wid for r in low_conf for wid in r["wordIds"]]
    assert "w4" in word_ids  # probability 0.30 < 0.6

def test_no_probability_skips_low_confidence():
    words = [{"id": "w1", "text": "hello", "startTime": 0.0, "endTime": 0.5}]
    resp = client.post("/suggest", json={
        "words": words,
        "silenceThresholdMs": 500,
        "fillerLangs": [],
        "ollamaEnabled": False,
        "ollamaModel": "llama3:8b",
        "ollamaBaseUrl": "http://localhost:11434",
    })
    results = resp.json()
    low_conf = [r for r in results if r["reason"] == "low-confidence"]
    assert len(low_conf) == 0

def test_results_sorted_by_confidence_desc():
    resp = client.post("/suggest", json={
        "words": BASE_WORDS,
        "silenceThresholdMs": 500,
        "fillerLangs": ["en", "he"],
        "ollamaEnabled": False,
        "ollamaModel": "llama3:8b",
        "ollamaBaseUrl": "http://localhost:11434",
    })
    results = resp.json()
    confs = [r["confidence"] for r in results]
    assert confs == sorted(confs, reverse=True)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd vision-service
python -m pytest tests/test_suggest.py -v
```
Expected: `ModuleNotFoundError` or `404` — router not registered yet.

- [ ] **Step 3: Create `vision-service/routers/suggest.py`**

```python
import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

log = logging.getLogger("suggest")
router = APIRouter()

FILLERS: dict[str, list[str]] = {
    "en": [
        "um", "uh", "you know", "you know what i mean", "like", "basically",
        "literally", "actually", "so", "right", "i mean", "kind of", "sort of",
        "well", "okay", "anyway",
    ],
    "he": [
        "אמ", "אהה", "כאילו", "יעני", "בעצם", "נכון", "אוקיי", "תראה",
        "טוב", "אז", "אה", "ממ", "זאת אומרת", "בקיצור",
    ],
}

LOW_CONFIDENCE_THRESHOLD = 0.6


class WordInput(BaseModel):
    id: str
    text: str
    startTime: float
    endTime: float
    probability: Optional[float] = None


class SuggestRequest(BaseModel):
    words: list[WordInput]
    silenceThresholdMs: float = 500
    fillerLangs: list[str] = ["en"]
    ollamaEnabled: bool = True
    ollamaModel: str = "llama3:8b"
    ollamaBaseUrl: str = "http://localhost:11434"


class SuggestionResult(BaseModel):
    id: str
    wordIds: list[str]
    text: str
    reason: str
    reasonLabel: str
    confidence: float
    source: str
    durationMs: Optional[float] = None


def _build_filler_set(langs: list[str]) -> list[str]:
    result: list[str] = []
    for lang in langs:
        result.extend(FILLERS.get(lang, []))
    return sorted(result, key=len, reverse=True)  # longest first for multi-word matching


def _pass1_speech(words: list[WordInput], silence_ms: float, filler_langs: list[str]) -> list[SuggestionResult]:
    candidates: list[SuggestionResult] = []
    filler_list = _build_filler_set(filler_langs)

    # Silence gaps
    for i in range(len(words) - 1):
        gap_ms = (words[i + 1].startTime - words[i].endTime) * 1000
        if gap_ms >= silence_ms:
            candidates.append(SuggestionResult(
                id=str(uuid.uuid4()),
                wordIds=[],
                text=f"{gap_ms / 1000:.1f}s silence",
                reason="silence",
                reasonLabel=f"Silence gap ({gap_ms / 1000:.1f}s)",
                confidence=0.99,
                source="speech",
                durationMs=round(gap_ms, 1),
            ))

    # Filler words — sliding window 1-4 tokens
    i = 0
    while i < len(words):
        matched = False
        for filler in filler_list:
            tokens = filler.split()
            n = len(tokens)
            if i + n > len(words):
                continue
            span_texts = [words[i + j].text.lower() for j in range(n)]
            if span_texts == tokens:
                span_ids = [words[i + j].id for j in range(n)]
                span_text = " ".join(w.text for w in words[i:i + n])
                candidates.append(SuggestionResult(
                    id=str(uuid.uuid4()),
                    wordIds=span_ids,
                    text=span_text,
                    reason="filler-word",
                    reasonLabel="Filler word",
                    confidence=0.90,
                    source="speech",
                ))
                i += n
                matched = True
                break
        if not matched:
            # Low confidence
            w = words[i]
            if w.probability is not None and w.probability < LOW_CONFIDENCE_THRESHOLD:
                candidates.append(SuggestionResult(
                    id=str(uuid.uuid4()),
                    wordIds=[w.id],
                    text=w.text,
                    reason="low-confidence",
                    reasonLabel=f"Low confidence ({w.probability:.0%})",
                    confidence=round(1.0 - w.probability, 3),
                    source="speech",
                ))
            i += 1

    return candidates


async def _pass2_ollama(
    candidates: list[SuggestionResult],
    words: list[WordInput],
    base_url: str,
    model: str,
) -> list[SuggestionResult]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.get(f"{base_url}/api/tags")
    except Exception:
        log.info("Ollama unreachable — skipping Pass 2")
        return candidates

    word_map = {w.id: w for w in words}
    segment_text = " ".join(w.text for w in words)

    surviving: list[SuggestionResult] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        for candidate in candidates:
            if not candidate.wordIds:
                # Silence — keep as-is; LLM not useful here
                surviving.append(candidate)
                continue

            candidate_text = candidate.text
            prompt = (
                f"You are a video editor assistant. Given a transcript and a flagged phrase, "
                f"decide if it should be cut. Reply with JSON only: "
                f'{{\"cut\": true/false, \"confidence\": 0.0-1.0, \"reason\": \"<8 words\"}}. '
                f"The transcript may be Hebrew, English, or mixed.\n\n"
                f"Phrase: \"{candidate_text}\"\n"
                f"Context: \"{segment_text}\""
            )

            try:
                resp = await client.post(
                    f"{base_url}/api/chat",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": False,
                        "format": "json",
                    },
                )
                data = resp.json()
                import json as _json
                content = _json.loads(data["message"]["content"])
                if not content.get("cut", True):
                    continue  # LLM says don't cut — suppress
                llm_conf = float(content.get("confidence", 0.5))
                boost = (llm_conf - 0.5) * 0.4
                candidate.confidence = round(min(1.0, candidate.confidence + boost), 3)
                candidate.source = "both"
                reason = content.get("reason", "")
                if reason:
                    candidate.reasonLabel = f"{candidate.reasonLabel} · {reason}"
            except Exception as exc:
                log.warning("Ollama call failed for candidate %s: %s", candidate.id, exc)

            surviving.append(candidate)

    return surviving


@router.post("/suggest", response_model=list[SuggestionResult])
async def suggest(req: SuggestRequest) -> list[SuggestionResult]:
    log.info("suggest | words=%d langs=%s ollama=%s", len(req.words), req.fillerLangs, req.ollamaEnabled)

    candidates = _pass1_speech(req.words, req.silenceThresholdMs, req.fillerLangs)
    log.info("pass1 candidates=%d", len(candidates))

    if req.ollamaEnabled and candidates:
        candidates = await _pass2_ollama(candidates, req.words, req.ollamaBaseUrl, req.ollamaModel)
        log.info("pass2 survivors=%d", len(candidates))

    candidates.sort(key=lambda c: c.confidence, reverse=True)
    return candidates
```

- [ ] **Step 4: Register router in `vision-service/main.py`**

Add to imports line and `include_router` calls:

```python
from routers import detect, track, preview, export, suggest   # add suggest

# after existing include_router calls:
app.include_router(suggest.router)
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd vision-service
python -m pytest tests/test_suggest.py -v
```
Expected: all 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add vision-service/routers/suggest.py vision-service/tests/test_suggest.py vision-service/main.py
git commit -m "feat(vision): add /suggest endpoint — Pass 1 speech analysis + Pass 2 Ollama scoring"
```

---

## Task 2: Node Server Route

**Files:**
- Create: `server/src/routes/suggest.routes.ts`
- Modify: `server/src/main.ts`

- [ ] **Step 1: Create `server/src/routes/suggest.routes.ts`**

```typescript
import { Router, Request, Response } from 'express';
import { projectService } from '../services/project.service';
import { settingsService } from '../services/settings.service';
import { VisionService } from '../services/vision.service';

const router = Router();

const SAFE_ID = /^[a-zA-Z0-9_\-]{1,64}$/;

router.post('/:clipId/suggest-cuts', async (req: Request, res: Response) => {
  const { clipId } = req.params;
  if (!SAFE_ID.test(clipId)) {
    res.status(400).json({ error: 'Invalid clipId' });
    return;
  }

  const project = await projectService.getActive();
  if (!project) {
    res.status(404).json({ error: 'No active project' });
    return;
  }

  const clip = project.clips?.find((c) => c.id === clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found' });
    return;
  }

  const words = clip.segments
    .flatMap((seg) => seg.words)
    .filter((w) => !w.isRemoved)
    .map((w) => ({
      id: w.id,
      text: w.text,
      startTime: w.startTime,
      endTime: w.endTime,
      ...(w.probability !== undefined ? { probability: w.probability } : {}),
    }));

  const {
    silenceThresholdMs = 500,
    fillerLangs = ['en', 'he'],
    ollamaEnabled = true,
    ollamaModel = 'llama3:8b',
  } = req.body as {
    silenceThresholdMs?: number;
    fillerLangs?: string[];
    ollamaEnabled?: boolean;
    ollamaModel?: string;
  };

  const ollamaBaseUrl =
    settingsService.get('OLLAMA_BASE_URL') ?? 'http://localhost:11434';

  try {
    const upstream = await globalThis.fetch(
      `${VisionService.getBaseUrl()}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          words,
          silenceThresholdMs,
          fillerLangs,
          ollamaEnabled,
          ollamaModel,
          ollamaBaseUrl,
        }),
      }
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch {
    res.status(502).json({ error: 'Vision service unavailable' });
  }
});

export default router;
```

- [ ] **Step 2: Register in `server/src/main.ts`**

Add the import and route after the existing vision route:

```typescript
import suggestRoutes from './routes/suggest.routes';

// after: app.use('/api/vision', visionRoutes);
app.use('/api/clips', suggestRoutes);
```

Note: `suggestRoutes` mounts on `/api/clips` which already hosts the existing `clipRoutes`. The new handler is for `/:clipId/suggest-cuts` — no conflict with existing clip routes since that path doesn't exist yet. However, to avoid ambiguity keep both `clipRoutes` and `suggestRoutes` registered on `/api/clips`. Express matches routes in order; the existing `clipRoutes` handlers use specific sub-paths that won't collide.

- [ ] **Step 3: Smoke-test the route**

Start the server and test with curl (replace `<clipId>` with a real clip id from your project):

```bash
curl -s -X POST http://localhost:3000/api/clips/<clipId>/suggest-cuts \
  -H "Content-Type: application/json" \
  -d '{"silenceThresholdMs":500,"fillerLangs":["en","he"],"ollamaEnabled":false}' | jq .
```

Expected: JSON array of suggestion objects, or `[]` if no suggestions found.

- [ ] **Step 4: Add `OLLAMA_BASE_URL` to known setting keys in `server/src/services/settings.service.ts`**

```typescript
export const KNOWN_SETTING_KEYS = [
  'OPENAI_API_KEY',
  'WHISPER_BASE_URL',
  'WHISPER_MODEL',
  'WHISPER_LANGUAGE',
  'SHOW_SILENCE_MARKERS',
  'SEGMENT_BY_SPEECH',
  'GROQ_API_KEY',
  'OLLAMA_BASE_URL',   // add this line
] as const;
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/suggest.routes.ts server/src/main.ts server/src/services/settings.service.ts
git commit -m "feat(server): add POST /api/clips/:clipId/suggest-cuts route"
```

---

## Task 3: Angular Model + Service

**Files:**
- Create: `client/src/app/core/models/suggestion.model.ts`
- Create: `client/src/app/features/studio/suggestions/suggestion.service.ts`
- Create: `client/src/app/features/studio/suggestions/suggestion.service.spec.ts`

- [ ] **Step 1: Create `client/src/app/core/models/suggestion.model.ts`**

```typescript
export type SuggestionReason = 'filler-word' | 'silence' | 'low-confidence' | 'low-value-llm';
export type SuggestionSource = 'speech' | 'llm' | 'both';

export interface Suggestion {
  id: string;
  clipId: string;
  wordIds: string[];
  text: string;
  reason: SuggestionReason;
  reasonLabel: string;
  confidence: number;
  source: SuggestionSource;
  durationMs?: number;
}

export interface SuggestOptions {
  silenceThresholdMs?: number;
  fillerLangs?: string[];
  ollamaEnabled?: boolean;
  ollamaModel?: string;
}
```

- [ ] **Step 2: Write failing tests for `SuggestionService`**

```typescript
// client/src/app/features/studio/suggestions/suggestion.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SuggestionService } from './suggestion.service';
import { CutRegionService } from '../txt-media-player/cut-region.service';
import { ClipService } from '../../../core/services/clip.service';
import { Clip } from '../../../core/models/clip.model';
import { Suggestion } from '../../../core/models/suggestion.model';

const MOCK_CLIP: Clip = {
  id: 'clip1',
  name: 'Test',
  startTime: 0,
  endTime: 10,
  segments: [{
    id: 'seg1', clipId: 'clip1', startTime: 0, endTime: 10,
    text: 'hello world', tags: [],
    words: [
      { id: 'w1', segmentId: 'seg1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false },
      { id: 'w2', segmentId: 'seg1', text: 'world', startTime: 0.6, endTime: 1.0, isRemoved: false },
    ],
  }],
  cutRegions: [],
} as unknown as Clip;

const MOCK_SUGGESTION: Suggestion = {
  id: 'sug1',
  clipId: 'clip1',
  wordIds: ['w1'],
  text: 'hello',
  reason: 'filler-word',
  reasonLabel: 'Filler word',
  confidence: 0.9,
  source: 'speech',
};

describe('SuggestionService', () => {
  let service: SuggestionService;
  let http: HttpTestingController;
  let clipService: ClipService;
  let cutRegionService: CutRegionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SuggestionService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(SuggestionService);
    http = TestBed.inject(HttpTestingController);
    clipService = TestBed.inject(ClipService);
    cutRegionService = TestBed.inject(CutRegionService);
    clipService.clips.set([MOCK_CLIP]);
  });

  afterEach(() => http.verify());

  it('populates suggestions after runAnalysis', () => {
    service.runAnalysis('clip1', {});
    const req = http.expectOne('/api/clips/clip1/suggest-cuts');
    expect(req.request.method).toBe('POST');
    req.flush([MOCK_SUGGESTION]);
    expect(service.suggestions()).toEqual([MOCK_SUGGESTION]);
    expect(service.status()).toBe('done');
  });

  it('clears prior suggestions when runAnalysis is called again', () => {
    service.runAnalysis('clip1', {});
    http.expectOne('/api/clips/clip1/suggest-cuts').flush([MOCK_SUGGESTION]);
    expect(service.suggestions().length).toBe(1);

    service.runAnalysis('clip1', {});
    expect(service.suggestions()).toEqual([]);
    expect(service.status()).toBe('running');
    http.expectOne('/api/clips/clip1/suggest-cuts').flush([]);
  });

  it('sets status to error on HTTP failure', () => {
    service.runAnalysis('clip1', {});
    http.expectOne('/api/clips/clip1/suggest-cuts').error(new ProgressEvent('error'));
    expect(service.status()).toBe('error');
  });

  it('reject removes suggestion from list', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    service.reject('sug1');
    expect(service.suggestions()).toEqual([]);
  });

  it('accept calls cut and removes suggestion from list', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    clipService.clips.set([MOCK_CLIP]);
    const cutSpy = spyOn(cutRegionService, 'cut').and.returnValue({
      clip: MOCK_CLIP,
      entry: { kind: 'cut', regionAfter: {} as any, regionsBefore: [] },
    });
    spyOn(clipService, 'updateCutRegions').and.returnValue({ subscribe: () => {} } as any);

    service.accept('sug1');

    expect(cutSpy).toHaveBeenCalledWith(MOCK_CLIP, ['w1'], 'clear-cut');
    expect(service.suggestions()).toEqual([]);
  });

  it('acceptAll accepts every pending suggestion', () => {
    const s2: Suggestion = { ...MOCK_SUGGESTION, id: 'sug2', wordIds: ['w2'] };
    service['_suggestions'].set([MOCK_SUGGESTION, s2]);
    clipService.clips.set([MOCK_CLIP]);
    spyOn(cutRegionService, 'cut').and.returnValue({
      clip: MOCK_CLIP,
      entry: { kind: 'cut', regionAfter: {} as any, regionsBefore: [] },
    });
    spyOn(clipService, 'updateCutRegions').and.returnValue({ subscribe: () => {} } as any);

    service.acceptAll();
    expect(service.suggestions()).toEqual([]);
  });

  it('acceptHighConfidence only accepts suggestions at or above threshold', () => {
    const low: Suggestion = { ...MOCK_SUGGESTION, id: 'sug-low', confidence: 0.5 };
    const high: Suggestion = { ...MOCK_SUGGESTION, id: 'sug-high', confidence: 0.9 };
    service['_suggestions'].set([low, high]);
    clipService.clips.set([MOCK_CLIP]);
    spyOn(cutRegionService, 'cut').and.returnValue({
      clip: MOCK_CLIP,
      entry: { kind: 'cut', regionAfter: {} as any, regionsBefore: [] },
    });
    spyOn(clipService, 'updateCutRegions').and.returnValue({ subscribe: () => {} } as any);

    service.acceptHighConfidence(0.8);
    expect(service.suggestions().length).toBe(1);
    expect(service.suggestions()[0].id).toBe('sug-low');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd client
npx ng test --include="**/suggestion.service.spec.ts" --watch=false
```
Expected: errors about `SuggestionService` not existing.

- [ ] **Step 4: Create `client/src/app/features/studio/suggestions/suggestion.service.ts`**

```typescript
import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { Suggestion, SuggestOptions } from '../../../core/models/suggestion.model';
import { ClipService } from '../../../core/services/clip.service';
import { CutRegionService } from '../txt-media-player/cut-region.service';

@Injectable({ providedIn: 'root' })
export class SuggestionService {
  private readonly http = inject(HttpClient);
  private readonly clipService = inject(ClipService);
  private readonly cutRegionService = inject(CutRegionService);

  readonly _suggestions = signal<Suggestion[]>([]);
  readonly suggestions = this._suggestions.asReadonly();

  readonly status = signal<'idle' | 'running' | 'done' | 'error'>('idle');
  readonly error = signal<string | undefined>(undefined);

  readonly suggestedWordIds = computed(
    () => new Set(this._suggestions().flatMap((s) => s.wordIds))
  );

  runAnalysis(clipId: string, opts: SuggestOptions): void {
    this._suggestions.set([]);
    this.status.set('running');
    this.error.set(undefined);

    this.http
      .post<Suggestion[]>(`/api/clips/${clipId}/suggest-cuts`, {
        silenceThresholdMs: opts.silenceThresholdMs ?? 500,
        fillerLangs: opts.fillerLangs ?? ['en', 'he'],
        ollamaEnabled: opts.ollamaEnabled ?? true,
        ollamaModel: opts.ollamaModel ?? 'llama3:8b',
      })
      .subscribe({
        next: (results) => {
          this._suggestions.set(results.map((r) => ({ ...r, clipId })));
          this.status.set('done');
        },
        error: (err) => {
          this.status.set('error');
          this.error.set(err?.message ?? 'Analysis failed');
        },
      });
  }

  accept(suggestionId: string): void {
    const suggestion = this._suggestions().find((s) => s.id === suggestionId);
    if (!suggestion) return;

    if (suggestion.wordIds.length > 0) {
      const clip = this.clipService.clips().find((c) => c.id === suggestion.clipId);
      if (clip) {
        const { clip: updatedClip } = this.cutRegionService.cut(clip, suggestion.wordIds, 'clear-cut');
        this.clipService.applyLocalUpdate(updatedClip);
        this.clipService.updateCutRegions(updatedClip.id, updatedClip.cutRegions ?? []).subscribe();
      }
    }

    this._suggestions.update((list) => list.filter((s) => s.id !== suggestionId));
  }

  reject(suggestionId: string): void {
    this._suggestions.update((list) => list.filter((s) => s.id !== suggestionId));
  }

  acceptAll(): void {
    const ids = this._suggestions().map((s) => s.id);
    ids.forEach((id) => this.accept(id));
  }

  acceptHighConfidence(threshold = 0.8): void {
    const ids = this._suggestions()
      .filter((s) => s.confidence >= threshold)
      .map((s) => s.id);
    ids.forEach((id) => this.accept(id));
  }

  dismissAll(): void {
    this._suggestions.set([]);
  }
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd client
npx ng test --include="**/suggestion.service.spec.ts" --watch=false
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/app/core/models/suggestion.model.ts \
        client/src/app/features/studio/suggestions/suggestion.service.ts \
        client/src/app/features/studio/suggestions/suggestion.service.spec.ts
git commit -m "feat(client): add Suggestion model and SuggestionService"
```

---

## Task 4: SuggestionsPanelComponent

**Files:**
- Create: `client/src/app/features/studio/suggestions-panel/suggestions-panel.component.ts`
- Create: `client/src/app/features/studio/suggestions-panel/suggestions-panel.component.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// client/src/app/features/studio/suggestions-panel/suggestions-panel.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SuggestionsPanelComponent } from './suggestions-panel.component';
import { SuggestionService } from '../suggestions/suggestion.service';
import { Suggestion } from '../../../core/models/suggestion.model';

const MOCK_SUGGESTION: Suggestion = {
  id: 'sug1', clipId: 'clip1', wordIds: ['w1'], text: 'um',
  reason: 'filler-word', reasonLabel: 'Filler word',
  confidence: 0.9, source: 'speech',
};

describe('SuggestionsPanelComponent', () => {
  let fixture: ComponentFixture<SuggestionsPanelComponent>;
  let service: SuggestionService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuggestionsPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(SuggestionsPanelComponent);
    service = TestBed.inject(SuggestionService);
    fixture.detectChanges();
  });

  it('shows empty state when no suggestions', () => {
    service['_suggestions'].set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No suggestions yet');
  });

  it('renders a card for each suggestion', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('.suggestion-card');
    expect(cards.length).toBe(1);
  });

  it('emits focusSuggestion with first wordId when card is clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    let emitted: string | undefined;
    fixture.componentInstance.focusSuggestion.subscribe((id: string) => emitted = id);
    fixture.nativeElement.querySelector('.suggestion-card').click();
    expect(emitted).toBe('w1');
  });

  it('calls service.accept when accept button clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const spy = spyOn(service, 'accept');
    fixture.nativeElement.querySelector('.btn-accept').click();
    expect(spy).toHaveBeenCalledWith('sug1');
  });

  it('calls service.reject when reject button clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const spy = spyOn(service, 'reject');
    fixture.nativeElement.querySelector('.btn-reject').click();
    expect(spy).toHaveBeenCalledWith('sug1');
  });

  it('calls service.acceptHighConfidence when "Accept High Confidence" clicked', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    fixture.detectChanges();
    const spy = spyOn(service, 'acceptHighConfidence');
    fixture.nativeElement.querySelector('.btn-accept-high').click();
    expect(spy).toHaveBeenCalledWith(0.8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd client
npx ng test --include="**/suggestions-panel.component.spec.ts" --watch=false
```
Expected: errors about component not existing.

- [ ] **Step 3: Create `client/src/app/features/studio/suggestions-panel/suggestions-panel.component.ts`**

```typescript
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { SuggestionService } from '../suggestions/suggestion.service';
import { SuggestOptions } from '../../../core/models/suggestion.model';

@Component({
  selector: 'app-suggestions-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="suggestions-panel" role="complementary" aria-label="Cut suggestions">

      <!-- Trigger header -->
      <div class="panel-header">
        <div class="header-row">
          <span class="panel-label">SUGGESTIONS</span>
          @if (svc.status() === 'running') {
            <span class="status-badge status-badge--running">Analysing…</span>
          } @else if (svc.status() === 'done') {
            <span class="status-badge">{{ svc.suggestions().length }} found</span>
          }
        </div>

        <!-- Settings -->
        <div class="settings-row">
          <label class="setting-label">
            <input type="checkbox" [checked]="ollamaEnabled()" (change)="ollamaEnabled.set($any($event.target).checked)" />
            Use Ollama
          </label>
          <label class="setting-label">
            <input type="checkbox" [checked]="useHebrew()" (change)="useHebrew.set($any($event.target).checked)" />
            Hebrew fillers
          </label>
        </div>

        <button
          class="btn-run"
          [disabled]="!clipId() || svc.status() === 'running'"
          (click)="runAnalysis()"
          aria-label="Run cut suggestion analysis"
        >
          ✦ Suggest Cuts
        </button>

        @if (svc.status() === 'error') {
          <p class="error-msg" role="alert">{{ svc.error() }}</p>
        }
      </div>

      <!-- Bulk actions -->
      @if (svc.suggestions().length > 0) {
        <div class="bulk-row">
          <button class="btn-bulk btn-accept-high" (click)="svc.acceptHighConfidence(0.8)">
            Accept ≥80%
          </button>
          <button class="btn-bulk" (click)="svc.acceptAll()">Accept All</button>
          <button class="btn-bulk btn-dismiss" (click)="svc.dismissAll()">Dismiss All</button>
        </div>
      }

      <!-- Suggestion list -->
      @if (svc.suggestions().length === 0 && svc.status() !== 'running') {
        <p class="empty-msg">
          @if (svc.status() === 'idle') {
            No suggestions yet. Click "Suggest Cuts" to analyse this clip.
          } @else {
            No suggestions found.
          }
        </p>
      }

      <div class="suggestion-list">
        @for (s of svc.suggestions(); track s.id) {
          <div
            class="suggestion-card"
            [class.suggestion-card--silence]="s.reason === 'silence'"
            [class.suggestion-card--llm]="s.source === 'llm' || s.source === 'both'"
            (click)="onCardClick(s)"
            role="button"
            [attr.aria-label]="'Suggestion: ' + s.text"
            tabindex="0"
            (keydown.enter)="onCardClick(s)"
          >
            <div class="card-top">
              <span class="card-text" dir="auto">{{ s.text }}</span>
              <span
                class="card-confidence"
                [class.conf-high]="s.confidence >= 0.8"
                [class.conf-med]="s.confidence >= 0.6 && s.confidence < 0.8"
                [class.conf-low]="s.confidence < 0.6"
              >{{ (s.confidence * 100).toFixed(0) }}%</span>
            </div>
            <div class="card-reason">{{ s.reasonLabel }}</div>
            <div class="card-actions">
              <button
                class="btn-accept"
                (click)="$event.stopPropagation(); svc.accept(s.id)"
                aria-label="Accept suggestion"
              >✓ Accept</button>
              <button
                class="btn-reject"
                (click)="$event.stopPropagation(); svc.reject(s.id)"
                aria-label="Reject suggestion"
              >✗ Reject</button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .suggestions-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-size: 0.8rem;
    }
    .panel-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-muted);
    }
    .status-badge {
      font-size: 0.65rem;
      padding: 2px 6px;
      border-radius: 8px;
      background: var(--color-surface-alt);
      color: var(--color-muted);
      border: 1px solid var(--color-border);
    }
    .status-badge--running {
      color: var(--color-accent);
      border-color: var(--color-accent);
      background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    }
    .settings-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .setting-label {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.72rem;
      color: var(--color-text-secondary);
      cursor: pointer;
      input { cursor: pointer; accent-color: var(--color-accent); }
    }
    .btn-run {
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 5px 12px;
      font-size: 0.78rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      &:disabled { opacity: 0.4; cursor: default; }
      &:not(:disabled):hover { opacity: 0.85; }
    }
    .error-msg {
      color: var(--color-error, #e05c5c);
      font-size: 0.72rem;
      margin: 0;
    }
    .bulk-row {
      display: flex;
      gap: 5px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .btn-bulk {
      font-size: 0.68rem;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--color-border);
      background: var(--color-surface-alt);
      color: var(--color-text-secondary);
      cursor: pointer;
      font-family: inherit;
      &:hover { color: var(--color-text); border-color: var(--color-accent); }
    }
    .btn-accept-high {
      background: color-mix(in srgb, #22c55e 10%, transparent);
      color: #22c55e;
      border-color: color-mix(in srgb, #22c55e 30%, transparent);
    }
    .btn-dismiss { color: var(--color-muted); }
    .empty-msg {
      padding: 1rem;
      color: var(--color-muted);
      text-align: center;
      line-height: 1.5;
    }
    .suggestion-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0;
    }
    .suggestion-card {
      padding: 8px 12px;
      border-bottom: 1px solid var(--color-border);
      border-left: 3px solid #f59e0b;
      cursor: pointer;
      &:hover { background: var(--color-surface-alt); }
      &:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
    }
    .suggestion-card--silence { border-left-color: #3b82f6; }
    .suggestion-card--llm { border-left-color: #a78bfa; }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
      margin-bottom: 2px;
    }
    .card-text {
      font-size: 0.78rem;
      color: var(--color-text);
      font-style: italic;
      flex: 1;
    }
    .card-confidence {
      font-size: 0.7rem;
      font-weight: 700;
      flex-shrink: 0;
    }
    .conf-high { color: #22c55e; }
    .conf-med  { color: #f59e0b; }
    .conf-low  { color: var(--color-muted); }
    .card-reason {
      font-size: 0.65rem;
      color: var(--color-muted);
      margin-bottom: 6px;
    }
    .card-actions {
      display: flex;
      gap: 5px;
    }
    .btn-accept, .btn-reject {
      font-size: 0.65rem;
      padding: 2px 7px;
      border-radius: 3px;
      border: 1px solid;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-accept {
      background: color-mix(in srgb, #22c55e 12%, transparent);
      color: #22c55e;
      border-color: color-mix(in srgb, #22c55e 30%, transparent);
      &:hover { background: color-mix(in srgb, #22c55e 25%, transparent); }
    }
    .btn-reject {
      background: color-mix(in srgb, #ef4444 12%, transparent);
      color: #ef4444;
      border-color: color-mix(in srgb, #ef4444 30%, transparent);
      &:hover { background: color-mix(in srgb, #ef4444 25%, transparent); }
    }
  `],
})
export class SuggestionsPanelComponent {
  readonly svc = inject(SuggestionService);

  readonly focusSuggestion = output<string>();
  readonly clipId = input<string | null>(null);
  readonly ollamaEnabled = signal(true);
  readonly useHebrew = signal(true);

  runAnalysis(): void {
    const id = this.clipId();
    if (!id) return;
    const langs = ['en'];
    if (this.useHebrew()) langs.push('he');
    const opts: SuggestOptions = {
      fillerLangs: langs,
      ollamaEnabled: this.ollamaEnabled(),
    };
    this.svc.runAnalysis(id, opts);
  }

  onCardClick(s: { wordIds: string[] }): void {
    const firstId = s.wordIds[0];
    if (firstId) this.focusSuggestion.emit(firstId);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd client
npx ng test --include="**/suggestions-panel.component.spec.ts" --watch=false
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/suggestions-panel/suggestions-panel.component.ts \
        client/src/app/features/studio/suggestions-panel/suggestions-panel.component.spec.ts
git commit -m "feat(client): add SuggestionsPanelComponent"
```

---

## Task 5: Transcript Word Highlighting

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

The transcript renders word spans. We need to add a `word--suggested` CSS class when a word's id is in `suggestedWordIds`.

- [ ] **Step 1: Inject `SuggestionService` in `txt-media-player-v2.component.ts`**

Add to imports at the top of the file:

```typescript
import { SuggestionService } from '../suggestions/suggestion.service';
```

Add injection inside the component class (after existing inject calls):

```typescript
readonly suggestionService = inject(SuggestionService);
```

- [ ] **Step 2: Expose `suggestedWordIds` computed**

The service already exposes `suggestedWordIds` as a computed signal. Reference it directly in the template via `suggestionService.suggestedWordIds()`.

- [ ] **Step 3: Add `word--suggested` class to word spans in the template**

Find the word span in the template (search for `word.text` or `word.isRemoved`). The word span currently looks similar to:

```html
<span
  class="word"
  [class.word--removed]="word.isRemoved"
  [class.word--active]="isActiveWord(word)"
  ...
>
```

Add the suggested class binding:

```html
[class.word--suggested]="suggestionService.suggestedWordIds().has(word.id)"
```

- [ ] **Step 4: Add CSS for `.word--suggested` in the component styles**

Add alongside the existing word styles:

```css
.word--suggested {
  border-bottom: 2px solid #f59e0b;
  background: color-mix(in srgb, #f59e0b 12%, transparent);
  border-radius: 2px;
}
```

- [ ] **Step 5: Smoke-test visually**

1. Start the dev server: `cd client && npx ng serve`
2. Open a project with a transcript.
3. Open browser console and call: `window.ng.getComponent(document.querySelector('app-suggestions-panel')).svc._suggestions.set([{id:'x',clipId:'clip1',wordIds:['<first-word-id>'],text:'test',reason:'filler-word',reasonLabel:'Test',confidence:0.9,source:'speech'}])`
4. Verify the targeted word gets amber underline in the transcript.

- [ ] **Step 6: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat(client): highlight suggested words in transcript with word--suggested class"
```

---

## Task 6: Studio Integration

**Files:**
- Modify: `client/src/app/features/studio/studio.component.ts`

Add the `SuggestionsPanelComponent` as a resizable panel alongside the existing panels, and wire `clipId` and `focusSuggestion`.

- [ ] **Step 1: Add imports to `studio.component.ts`**

```typescript
import { SuggestionsPanelComponent } from './suggestions-panel/suggestions-panel.component';
```

Add to the `imports` array of `@Component`:

```typescript
SuggestionsPanelComponent,
```

- [ ] **Step 2: Add panel state signals**

Inside `StudioComponent` class, add:

```typescript
readonly showSuggestionsPanel = signal(false);
readonly suggestionsPanelWidth = signal(280);
private isResizingSuggestions = false;
```

- [ ] **Step 3: Add toggle button to the header nav**

Add after the existing Notifications button in the template's `<nav class="studio-nav">`:

```html
<button
  class="export-toggle-btn"
  type="button"
  [class.active]="showSuggestionsPanel()"
  (click)="showSuggestionsPanel.update(v => !v)"
  title="Toggle Suggestions Panel"
  aria-label="Toggle cut suggestions panel"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
  <span>Suggest</span>
</button>
```

- [ ] **Step 4: Add panel and resizer to the template body**

Add after the Vision panel resizer/panel block (order 8.5 / 1.5 in LTR/RTL):

```html
<!-- Suggestions Panel Resizer -->
@if (showSuggestionsPanel()) {
  <div
    class="resizer suggestions-resizer"
    [style.order]="isRtl() ? 1.5 : 8.5"
    (mousedown)="startResizing('suggestions', $event)"
  ></div>
}

<!-- Suggestions Panel -->
@if (showSuggestionsPanel()) {
  <aside class="side-panel-wrapper suggestions-wrapper opened"
    [style.order]="isRtl() ? 1 : 9"
    [style.width.px]="suggestionsPanelWidth()">
    <app-suggestions-panel
      [clipId]="activeClipId()"
      (focusSuggestion)="onFocusSuggestion($event)"
    />
  </aside>
}
```

- [ ] **Step 5: Add suggestions-wrapper style**

In the component styles, inside `.side-panel-wrapper` add:

```css
&.suggestions-wrapper {
  border-left: 1px solid var(--color-border);
}
```

- [ ] **Step 6: Wire `clipId` input and `focusSuggestion` handler**

`SuggestionsPanelComponent.clipId` is already declared as `input<string | null>(null)` (defined in Task 4). The `[clipId]="activeClipId()"` binding in the template wires correctly. `runAnalysis()` already calls `this.clipId()` which works since `input()` returns a signal.

- [ ] **Step 7: Handle `focusSuggestion` in studio**

Add `startResizing` support for `'suggestions'` — in `startResizing()` method, add:

```typescript
} else if (side === 'suggestions') {
  this.isResizingSuggestions = true;
  this.startWidth = this.suggestionsPanelWidth();
}
```

In `onMouseMove()`, add:

```typescript
else if (this.isResizingSuggestions) {
  const newWidth = this.startWidth - delta;
  this.suggestionsPanelWidth.set(Math.max(240, Math.min(newWidth, 600)));
}
```

In `onMouseUp()`, add `|| this.isResizingSuggestions` to the condition and `this.isResizingSuggestions = false;` in the reset block.

Add `onFocusSuggestion` method. The player already seeks when `currentTime` changes — find the word's `startTime` and seek to it, which triggers the transcript's existing auto-scroll:

```typescript
onFocusSuggestion(wordId: string): void {
  const clip = this.activeClip();
  if (!clip) return;
  for (const seg of clip.segments) {
    const word = seg.words.find((w) => w.id === wordId);
    if (word) {
      this.mediaPlayer.seekTo(word.startTime);
      return;
    }
  }
}
```

Add `mediaPlayer` injection to `StudioComponent`:

```typescript
private readonly mediaPlayer = inject(MediaPlayerService);
```

Add `MediaPlayerService` to imports at top of file:

```typescript
import { MediaPlayerService } from './txt-media-player/media-player.service';
```

- [ ] **Step 8: Update `startResizing` type signature**

Change the method signature from:

```typescript
startResizing(side: 'left' | 'right' | 'plugin' | 'notifications' | 'vision', event: MouseEvent): void {
```

to:

```typescript
startResizing(side: 'left' | 'right' | 'plugin' | 'notifications' | 'vision' | 'suggestions', event: MouseEvent): void {
```

- [ ] **Step 9: End-to-end smoke test**

1. Start server + client: `cd server && npm run dev` / `cd client && npx ng serve`
2. Open a project with a transcript.
3. Click "Suggest" in header — panel opens.
4. Click "✦ Suggest Cuts" — spinner shows, then suggestion cards appear.
5. Verify amber highlights in transcript for suggested words.
6. Click a card → Accept → word gets removed (jump-cut region created).
7. Click a card → Reject → card disappears, word highlight clears.
8. Verify Hebrew filler words (כאילו, יעני, etc.) detected if present in transcript.

- [ ] **Step 10: Commit**

```bash
git add client/src/app/features/studio/studio.component.ts \
        client/src/app/features/studio/suggestions-panel/suggestions-panel.component.ts
git commit -m "feat(client): integrate SuggestionsPanel into studio — toggle button, panel, word highlights"
```
