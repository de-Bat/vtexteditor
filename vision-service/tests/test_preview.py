import base64
import json
import numpy as np
import cv2
import os
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient


def make_test_video(path: str, width=160, height=120, frame_count=10, fps=10):
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for _ in range(frame_count):
        out.write(np.ones((height, width, 3), dtype=np.uint8) * 128)
    out.release()


def write_test_mask(mask_dir: str, obj_id: str, width=160, height=120, frame_count=10):
    os.makedirs(mask_dir, exist_ok=True)
    masks = np.zeros((frame_count, height, width), dtype=bool)
    masks[:, height//4:3*height//4, width//4:3*width//4] = True
    frame_indices = np.arange(frame_count)
    np.savez_compressed(os.path.join(mask_dir, f"{obj_id}.npz"),
                        frame_indices=frame_indices, masks=masks)


def test_preview_returns_base64_png(tmp_path, monkeypatch):
    video_path = str(tmp_path / "v.mp4")
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)
    mask_dir = os.path.join(storage_root, "projects", "proj1", "vision", "sess1", "masks")
    make_test_video(video_path)
    write_test_mask(mask_dir, "obj1")

    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": video_path,
        "frameTime": 0.5,
        "projectId": "proj1",
        "maskSessionId": "sess1",
        "objects": [{"id": "obj1", "effect": "blur", "fillColor": None}],
    })

    assert response.status_code == 200
    data = response.json()
    assert "previewPng" in data
    # Verify it's valid base64 PNG
    img_bytes = base64.b64decode(data["previewPng"])
    assert img_bytes[:4] == b"\x89PNG"


def test_preview_fill_effect(tmp_path, monkeypatch):
    video_path = str(tmp_path / "v.mp4")
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)
    mask_dir = os.path.join(storage_root, "projects", "proj1", "vision", "sess1", "masks")
    make_test_video(video_path)
    write_test_mask(mask_dir, "obj1")

    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": video_path,
        "frameTime": 0.5,
        "projectId": "proj1",
        "maskSessionId": "sess1",
        "objects": [{"id": "obj1", "effect": "fill", "fillColor": "#ff0000"}],
    })
    assert response.status_code == 200


def test_preview_inpaint_effect(tmp_path, monkeypatch):
    video_path = str(tmp_path / "v.mp4")
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)
    mask_dir = os.path.join(storage_root, "projects", "proj1", "vision", "sess1", "masks")
    make_test_video(video_path)
    write_test_mask(mask_dir, "obj1")

    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": video_path,
        "frameTime": 0.5,
        "projectId": "proj1",
        "maskSessionId": "sess1",
        "objects": [{"id": "obj1", "effect": "inpaint", "fillColor": None}],
    })
    assert response.status_code == 200


def test_preview_bad_media_path(tmp_path, monkeypatch):
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)
    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": "/no/such/file.mp4",
        "frameTime": 0.5,
        "projectId": "proj1",
        "maskSessionId": "sess1",
        "objects": [],
    })
    assert response.status_code == 400


def test_preview_unknown_effect_returns_400(tmp_path, monkeypatch):
    video_path = str(tmp_path / "v.mp4")
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)
    mask_dir = os.path.join(storage_root, "projects", "proj1", "vision", "sess1", "masks")
    make_test_video(video_path)
    write_test_mask(mask_dir, "obj1")
    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": video_path,
        "frameTime": 0.5,
        "projectId": "proj1",
        "maskSessionId": "sess1",
        "objects": [{"id": "obj1", "effect": "pixelate", "fillColor": None}],
    })
    assert response.status_code == 400
