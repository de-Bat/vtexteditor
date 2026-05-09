import pytest
import numpy as np
import cv2
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


def make_test_video(path: str, width=320, height=240, frames=30, fps=30):
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for _ in range(frames):
        out.write(np.zeros((height, width, 3), dtype=np.uint8))
    out.release()


def make_mock_yolo_results(label="person", conf=0.92, x1=50, y1=60, x2=150, y2=200):
    box = MagicMock()
    box.xyxy = [MagicMock(tolist=lambda: [float(x1), float(y1), float(x2), float(y2)])]
    box.cls = [MagicMock()]
    box.cls[0].__int__ = lambda self: 0
    box.conf = [MagicMock()]
    box.conf[0].__float__ = lambda self: conf
    result = MagicMock()
    result.boxes = [box]
    result.names = {0: label}
    return [result]


def test_detect_returns_objects(tmp_path):
    video_path = str(tmp_path / "test.mp4")
    make_test_video(video_path)

    with patch("routers.detect.get_yolo") as mock_get:
        mock_get.return_value = MagicMock(
            return_value=make_mock_yolo_results("person", 0.92, 50, 60, 150, 200)
        )
        from main import app
        client = TestClient(app)
        response = client.post("/detect", json={"mediaPath": video_path, "frameTime": 0.0})

    assert response.status_code == 200
    objects = response.json()
    assert len(objects) == 1
    assert objects[0]["label"] == "person"
    assert objects[0]["confidence"] == pytest.approx(0.92, abs=0.01)
    bbox = objects[0]["bbox"]
    # bbox should be normalized [x, y, w, h] in 0-1 range
    assert all(0.0 <= v <= 1.0 for v in bbox)
    assert len(bbox) == 4


def test_detect_bad_media_path():
    from main import app
    client = TestClient(app)
    response = client.post("/detect", json={"mediaPath": "/no/such/file.mp4", "frameTime": 0.0})
    assert response.status_code == 400


def test_detect_empty_frame_returns_empty(tmp_path):
    video_path = str(tmp_path / "empty.mp4")
    make_test_video(video_path)

    with patch("routers.detect.get_yolo") as mock_get:
        mock_results = MagicMock()
        mock_results.boxes = []
        mock_results.names = {}
        mock_get.return_value = MagicMock(return_value=[mock_results])
        from main import app
        client = TestClient(app)
        response = client.post("/detect", json={"mediaPath": video_path, "frameTime": 0.0})

    assert response.status_code == 200
    assert response.json() == []
