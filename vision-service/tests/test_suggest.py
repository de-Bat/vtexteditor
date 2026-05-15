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
