import json
import numpy as np
import cv2
import os
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


def make_test_video(path: str, width=160, height=120, frame_count=30, fps=15):
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for _ in range(frame_count):
        out.write(np.zeros((height, width, 3), dtype=np.uint8))
    out.release()


def parse_sse_events(content: bytes) -> list[dict]:
    events = []
    for line in content.decode().splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def test_track_returns_sse_stream_and_saves_masks(tmp_path):
    video_path = str(tmp_path / "v.mp4")
    make_test_video(video_path, frame_count=30)

    # Mock SAM2 predictor
    mock_mask = np.ones((1, 120, 160), dtype=bool)
    mock_state = {}

    def fake_propagate(state, start_frame_idx=0, reverse=False):
        for i in range(3):
            yield i, [0], [mock_mask]

    mock_predictor = MagicMock()
    mock_predictor.init_state.return_value = mock_state
    mock_predictor.propagate_in_video.side_effect = fake_propagate

    storage_root = str(tmp_path / "storage")
    os.environ["STORAGE_ROOT"] = storage_root

    with patch("routers.track.get_sam2", return_value=mock_predictor):
        from main import app
        client = TestClient(app)
        response = client.post("/track", json={
            "mediaPath": video_path,
            "frameTime": 0.5,
            "objects": [{"id": "obj1", "bbox": [0.1, 0.1, 0.3, 0.4]}],
            "projectId": "proj1",
            "maskSessionId": "sess1",
        })

    assert response.status_code == 200
    events = parse_sse_events(response.content)
    assert any(e.get("type") == "complete" for e in events)

    # Mask file written to STORAGE_ROOT/projects/proj1/vision/sess1/masks/
    mask_dir = os.path.join(storage_root, "projects", "proj1", "vision", "sess1", "masks")
    mask_file = os.path.join(mask_dir, "obj1.npz")
    assert os.path.exists(mask_file)
    data = np.load(mask_file)
    assert "frame_indices" in data
    assert "masks" in data


def test_track_bad_media_path(tmp_path):
    storage_root = str(tmp_path / "storage")
    os.environ["STORAGE_ROOT"] = storage_root
    from main import app
    client = TestClient(app)
    response = client.post("/track", json={
        "mediaPath": "/no/such.mp4",
        "frameTime": 0.0,
        "objects": [{"id": "o1", "bbox": [0.1, 0.1, 0.2, 0.2]}],
        "projectId": "proj1",
        "maskSessionId": "sess1",
    })
    assert response.status_code == 400
