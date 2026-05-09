import json
import os
import numpy as np
import cv2
from fastapi.testclient import TestClient


def make_test_video(path: str, width=160, height=120, frame_count=20, fps=10):
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for _ in range(frame_count):
        out.write(np.ones((height, width, 3), dtype=np.uint8) * 128)
    out.release()


def write_test_mask(mask_dir: str, obj_id: str, width=160, height=120, frame_count=20):
    os.makedirs(mask_dir, exist_ok=True)
    masks = np.zeros((frame_count, height, width), dtype=bool)
    masks[:, height//4:3*height//4, width//4:3*width//4] = True
    np.savez_compressed(
        os.path.join(mask_dir, f"{obj_id}.npz"),
        frame_indices=np.arange(frame_count),
        masks=masks,
    )


def parse_sse_events(content: bytes) -> list[dict]:
    return [
        json.loads(line[6:])
        for line in content.decode().splitlines()
        if line.startswith("data: ")
    ]


def test_export_masked_creates_video(tmp_path, monkeypatch):
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)

    video_path = str(tmp_path / "src.mp4")
    make_test_video(video_path)

    # Pre-create mask at the path Python will resolve
    mask_dir = os.path.join(storage_root, "projects", "proj1", "vision", "sess1", "masks")
    write_test_mask(mask_dir, "obj1")

    from main import app
    client = TestClient(app)
    response = client.post("/export-masked", json={
        "mediaPath": video_path,
        "projectId": "proj1",
        "exportId": "exp1",
        "maskSessionId": "sess1",
        "objects": [{"id": "obj1", "effect": "blur", "fillColor": None}],
    })

    assert response.status_code == 200
    events = parse_sse_events(response.content)
    assert any(e.get("type") == "complete" for e in events)
    output_path = os.path.join(storage_root, "projects", "proj1", "exports", "exp1-masked.mp4")
    assert os.path.exists(output_path)
    # Verify the output is a valid video
    cap = cv2.VideoCapture(output_path)
    assert cap.isOpened()
    assert int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) > 0
    cap.release()


def test_export_bad_media_path(tmp_path, monkeypatch):
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)
    from main import app
    client = TestClient(app)
    response = client.post("/export-masked", json={
        "mediaPath": "/no/such.mp4",
        "projectId": "proj1",
        "exportId": "exp1",
        "maskSessionId": "sess1",
        "objects": [],
    })
    assert response.status_code == 400


def test_export_no_mask_for_object_passes_through(tmp_path, monkeypatch):
    """When an object has no mask file, its frames are passed through unmodified."""
    storage_root = str(tmp_path / "storage")
    monkeypatch.setenv("STORAGE_ROOT", storage_root)

    video_path = str(tmp_path / "src.mp4")
    make_test_video(video_path)
    # No mask files written — mask_dir doesn't even exist

    from main import app
    client = TestClient(app)
    response = client.post("/export-masked", json={
        "mediaPath": video_path,
        "projectId": "proj1",
        "exportId": "exp2",
        "maskSessionId": "sess1",
        "objects": [{"id": "obj_no_mask", "effect": "blur", "fillColor": None}],
    })

    assert response.status_code == 200
    events = parse_sse_events(response.content)
    assert any(e.get("type") == "complete" for e in events)
    output_path = os.path.join(storage_root, "projects", "proj1", "exports", "exp2-masked.mp4")
    assert os.path.exists(output_path)
