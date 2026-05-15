# Auto Cut Suggestion — Design Spec

**Date:** 2026-05-15
**Status:** Approved
**Scope:** VTextStudio — `client/`, `server/`, `vision-service/`

---

## Problem

Users must manually identify filler words, silence gaps, and low-value segments to remove. For long recordings this is tedious. The feature provides ranked cut suggestions derived from speech analysis and optional LLM content scoring, letting users accept or reject them individually or in bulk.

---

## Goals

1. Detect filler words (EN + HE), silence gaps, and low-confidence Whisper words via Python.
2. Optionally score candidates through a local Ollama LLM for content quality.
3. Surface suggestions as amber inline highlights in the transcript and a ranked side panel.
4. Accept converts to a normal cut region. Reject dismisses. Suggestions are ephemeral (not persisted).
5. Support Hebrew RTL text throughout.

---

## Non-Goals

- Auto-applying suggestions without user review.
- Persisting suggestions to `project.json`.
- Cloud LLM calls.
- Per-segment (coarse) granularity — granularity is word-span only, matching existing cut regions.

---

## Architecture

```
[Angular] "Suggest Cuts" button
    │
    ▼
POST /api/clips/:clipId/suggest-cuts   (Node server)
    │  sends clip words + settings
    ▼
POST /suggest   (Python vision-service)
    │
    ├─ Pass 1: Speech analysis (sync, fast)
    │     silence gaps, filler words (EN+HE), low-confidence words
    │     → SuggestionCandidate[]
    │
    └─ Pass 2: Ollama scoring (optional, skipped if unreachable)
          candidates + surrounding context → llama3:8b
          → confidence boost/suppress + reason string
    │
    ▼
Node merges results → SSE suggest:result → Angular SuggestionService
    │
    ├─ Transcript: amber underline on pending suggestion wordIds
    └─ SuggestionsPanel: ranked list, accept/reject per item + bulk actions
```

---

## Data Model

### New types (client + server shared)

```typescript
type SuggestionReason = 'filler-word' | 'silence' | 'low-confidence' | 'low-value-llm';

interface Suggestion {
  id: string;
  clipId: string;
  wordIds: string[];      // contiguous span, min 1
  text: string;           // display text of the span
  reason: SuggestionReason;
  reasonLabel: string;    // e.g. "Filler word", "Silence gap (2.1s)"
  confidence: number;     // 0–1
  source: 'speech' | 'llm' | 'both';
  durationMs?: number;    // silence gaps only
}
```

### Client-side state (ephemeral, not persisted)

```typescript
// SuggestionService signal state
interface SuggestionState {
  suggestions: Suggestion[];
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
}
```

Accepted suggestions are removed from the list and passed to the existing `cut()` method. Rejected are removed from the list only.

### Python service request

```typescript
interface SuggestCutsRequest {
  words: Array<{
    id: string;
    text: string;
    startTime: number;
    endTime: number;
    probability?: number;   // Whisper word-level confidence, 0–1
  }>;
  silenceThresholdMs: number;   // default 500
  fillerLangs: ('en' | 'he')[];
  ollamaEnabled: boolean;
  ollamaModel: string;          // default 'llama3:8b'
  ollamaBaseUrl: string;        // default 'http://localhost:11434'
}
```

---

## Python Vision-Service — `/suggest` Endpoint

New router: `routers/suggest.py`.

### Pass 1 — Speech Analysis

**Silence gaps:** Iterate word pairs. If `words[i+1].startTime - words[i].endTime >= silenceThresholdMs` → candidate with reason `silence`, confidence `0.99`.

**Filler words:**

```python
FILLERS = {
  'en': ['um', 'uh', 'you know', 'you know what i mean', 'like', 'basically',
         'literally', 'actually', 'so', 'right', 'i mean', 'kind of', 'sort of'],
  'he': ['אמ', 'אהה', 'כאילו', 'יעני', 'בעצם', 'נכון', 'אוקיי', 'תראה',
         'טוב', 'אז', 'אה', 'ממ', 'זאת אומרת', 'בקיצור'],
}
```

Match against lowercased word text (single words) and 2–4 word sliding windows. Confidence `0.90`.

**Low-confidence words:** `word.probability < 0.6` → reason `low-confidence`, confidence `1 - word.probability`.

### Pass 2 — Ollama Scoring (optional)

Attempt `GET http://ollamaBaseUrl/api/tags`. If unreachable or `ollamaEnabled=false`, skip.

For each candidate, build a context window: the full text of the containing segment, with the candidate span marked in brackets. If the candidate spans multiple segments, include both segments.

Prompt (sent once per candidate batch, structured JSON mode):

```
You are a video editor assistant. Given a transcript excerpt and a flagged phrase, 
decide if it should be cut. Reply with JSON: {"cut": true/false, "confidence": 0.0-1.0, "reason": "string"}.
Keep "reason" under 8 words. The transcript may be in Hebrew, English, or mixed — handle all.

Phrase: "{candidate.text}"
Context: "{context}"
```

Merge: if LLM says `cut=true`, boost candidate confidence by `(llm.confidence - 0.5) * 0.4`. If `cut=false`, suppress (remove candidate). Update `source` to `'both'` or `'speech'` accordingly.

### Response

```python
class SuggestionResult(BaseModel):
    id: str
    word_ids: list[str]
    text: str
    reason: str        # 'filler-word' | 'silence' | 'low-confidence' | 'low-value-llm'
    reason_label: str
    confidence: float
    source: str        # 'speech' | 'llm' | 'both'
    duration_ms: Optional[float]
```

Sort by confidence descending.

---

## Node Server — `/api/clips/:clipId/suggest-cuts`

New route in `server/src/routes/suggest.ts`.

```
POST /api/clips/:clipId/suggest-cuts
Body: { silenceThresholdMs?: number, fillerLangs?: string[], ollamaEnabled?: boolean, ollamaModel?: string }
```

1. Load project, find clip, collect all words (not removed) with `probability` field if present.
2. Read `ollamaBaseUrl` from app settings (`settings.ollamaBaseUrl`, default `http://localhost:11434`) — same pattern as Whisper base URL.
3. Forward to `POST vision-service/suggest` with full word list + settings.
4. Stream result back via existing SSE infrastructure: `suggest:result` (payload: `Suggestion[]`) or `suggest:error`.

No new SSE channel needed — reuse existing project SSE connection (`/api/projects/:id/events`).

---

## Angular Client

### New: `SuggestionService`

`client/src/app/features/studio/suggestions/suggestion.service.ts`

```typescript
// Signals
readonly suggestions = signal<Suggestion[]>([]);
readonly status = signal<'idle' | 'running' | 'done' | 'error'>('idle');
readonly error = signal<string | undefined>(undefined);

// Methods
runAnalysis(clipId: string, opts: SuggestOptions): void
accept(suggestionId: string): void   // calls existing cut() on wordIds
reject(suggestionId: string): void
acceptAll(): void                     // accepts all pending
acceptHighConfidence(threshold = 0.8): void
dismissAll(): void
```

`runAnalysis` calls `POST /api/clips/:clipId/suggest-cuts`, listens for SSE `suggest:result`, populates `suggestions` signal.

### New: `SuggestionsPanelComponent`

`client/src/app/features/studio/suggestions-panel/suggestions-panel.component.ts`

- Standalone, `OnPush`, added as a new tab alongside Vision/Notes panels.
- Shows "Suggest Cuts" trigger button at top (with Ollama toggle and settings).
- Ranked list of suggestion cards: text (with `dir="auto"` for RTL), reason label, confidence bar, Accept/Reject buttons.
- Bulk action row: "Accept High Confidence (≥80%)", "Accept All", "Dismiss All".
- Clicking a suggestion row emits `focusSuggestion` output → parent scrolls transcript to first wordId.
- Progress spinner while `status === 'running'`.
- Empty state: "No suggestions yet. Click 'Suggest Cuts' to analyse this clip."

### Modified: Transcript word rendering

In `txt-media-player-v2.component.ts` / transcript template:

- Inject `SuggestionService`.
- Compute `suggestedWordIds = computed(() => new Set(suggestions().flatMap(s => s.wordIds)))`.
- Each word span: if `suggestedWordIds().has(word.id)` → add CSS class `word--suggested`.
- `word--suggested` style: `border-bottom: 2px solid var(--suggestion-amber); background: var(--suggestion-amber-bg);`
- Silence suggestions: annotate the existing silence chip/pill with amber border.
- Hebrew words have `dir="auto"` already via Unicode bidi — no additional change needed.

### Settings exposed in panel

| Setting | Default | Notes |
|---|---|---|
| Silence threshold | 500ms | Range 200–2000ms |
| Languages | en + he | Checkboxes |
| Use Ollama | true (if reachable) | Disabled with tooltip if unreachable |
| Ollama model | llama3:8b | Text input |
| Ollama base URL | http://localhost:11434 | Read from app settings; not editable in panel |
| Confidence filter | 0% (show all) | Slider — hides suggestions below threshold in panel |

---

## Hebrew Support

- Filler word list covers common Hebrew fillers (see Pass 1 above).
- All suggestion text rendered with `dir="auto"` — browser resolves RTL automatically.
- Transcript highlight CSS (`border-bottom`) works identically on LTR and RTL text.
- Ollama prompt explicitly states Hebrew/mixed input is expected.
- Reason labels are English only (UI language is EN throughout the app).

---

## Edge Cases

| Case | Handling |
|---|---|
| Ollama unreachable | Pass 1 results returned with `source: 'speech'`; panel shows "LLM unavailable" notice |
| Word has no `probability` field (SRT import) | Skip low-confidence pass; silence + fillers still run |
| Zero candidates after Pass 1 | Return empty list; panel shows "No suggestions found" |
| User edits transcript while analysis running | `runAnalysis` re-run resets list; stale suggestions from prior run cleared immediately on new run |
| Suggestion wordIds removed by user before accepting | Accept is a no-op if words already removed |
| Filler word matches partial word (e.g. "so" in "software") | Match against full word boundary only (exact token match) |

---

## New Files

| File | Purpose |
|---|---|
| `client/src/app/features/studio/suggestions-panel/suggestions-panel.component.ts` | Panel component |
| `client/src/app/core/models/suggestion.model.ts` | `Suggestion` type |
| `client/src/app/features/studio/suggestions/suggestion.service.ts` | Analysis + state |
| `server/src/routes/suggest.ts` | API route |
| `vision-service/routers/suggest.py` | Python two-pass analysis |

## Modified Files

| File | Change |
|---|---|
| `client/.../txt-media-player-v2.component.ts` | Inject SuggestionService, render `word--suggested` class |
| `client/.../studio.component.ts` | Add SuggestionsPanel tab |
| `server/src/app.ts` | Register suggest route |
| `vision-service/main.py` | Register suggest router |

---

## Testing

| Test | Coverage |
|---|---|
| `suggestion.service.spec.ts` | `accept()` calls `cut()` with correct wordIds; `reject()` removes from list; `acceptAll()` processes all; `runAnalysis()` resets prior suggestions |
| `suggestions-panel.component.spec.ts` | Renders suggestion cards; bulk action buttons call service methods; focusSuggestion emits on card click |
| `suggest.py` (pytest) | Silence detection at boundary; filler match exact token; no match on partial word; low-confidence threshold; Ollama timeout → graceful skip |
| Manual | Hebrew transcript → Hebrew fillers detected and highlighted correctly; RTL word underline renders; Ollama unavailable → panel shows notice with Pass 1 results only |
