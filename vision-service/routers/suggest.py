import json
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
        "um", "uh", "you know", "like", "basically",
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
                content = json.loads(data["message"]["content"])
                if not content.get("cut", True):
                    continue  # LLM says don't cut — suppress
                llm_conf = float(content.get("confidence", 0.5))
                boost = (llm_conf - 0.5) * 0.4
                candidate.confidence = round(max(0.0, min(1.0, candidate.confidence + boost)), 3)
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
