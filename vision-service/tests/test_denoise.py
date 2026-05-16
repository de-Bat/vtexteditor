import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_denoise_missing_file_returns_400():
    resp = client.post("/denoise", json={"audioPath": "/nonexistent/path/audio.wav"})
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


import wave
import struct
import os


def _write_silence_wav(path: str, duration_s: float = 0.5, sample_rate: int = 16000) -> None:
    n_samples = int(duration_s * sample_rate)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(struct.pack("<" + "h" * n_samples, *([0] * n_samples)))


def test_denoise_returns_existing_wav(tmp_path):
    input_wav = str(tmp_path / "input.wav")
    _write_silence_wav(input_wav)

    resp = client.post("/denoise", json={"audioPath": input_wav})
    assert resp.status_code == 200
    data = resp.json()
    assert "denoisedPath" in data
    assert os.path.exists(data["denoisedPath"])
    assert data["denoisedPath"].endswith("_denoised.wav")
