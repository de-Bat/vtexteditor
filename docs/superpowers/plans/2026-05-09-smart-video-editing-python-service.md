# Smart Video Editing — Python Vision Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone FastAPI microservice that exposes YOLO object detection, SAM2 mask tracking, single-frame preview rendering, and masked video export — all callable over HTTP from the Express backend.

**Architecture:** FastAPI on port 3001 with four routers (detect, track, preview, export). YOLO and SAM2 models are singletons loaded on first use. Tracking uses SAM2 video predictor with bidirectional propagation from a keyframe; masks saved as `.npz` files to a caller-supplied directory. Streaming SSE responses for track and export progress.

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, Ultralytics (YOLOv8n), SAM2 (`sam2` pip package), OpenCV, NumPy, pytest, httpx

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `vision-service/main.py` | FastAPI app, router registration, health endpoint |
| Create | `vision-service/requirements.txt` | All Python dependencies |
| Create | `vision-service/models/__init__.py` | Empty |
| Create | `vision-service/models/yolo_model.py` | YOLOv8 singleton |
| Create | `vision-service/models/sam2_model.py` | SAM2 video predictor singleton |
| Create | `vision-service/utils/__init__.py` | Empty |
| Create | `vision-service/utils/frames.py` | Frame extraction from video |
| Create | `vision-service/utils/effects.py` | blur / fill / inpaint per mask |
| Create | `vision-service/routers/__init__.py` | Empty |
| Create | `vision-service/routers/detect.py` | POST /detect — YOLO scan |
| Create | `vision-service/routers/track.py` | POST /track — SAM2 propagation (SSE) |
| Create | `vision-service/routers/preview.py` | POST /preview — single masked frame |
| Create | `vision-service/routers/export.py` | POST /export-masked — full video (SSE) |
| Create | `vision-service/tests/test_health.py` | Health endpoint test |
| Create | `vision-service/tests/test_detect.py` | Detect endpoint (mocked YOLO) |
| Create | `vision-service/tests/test_track.py` | Track endpoint (mocked SAM2) |
| Create | `vision-service/tests/test_preview.py` | Preview endpoint (mocked masks) |
| Create | `vision-service/tests/test_export.py` | Export endpoint (mocked effects) |

---

## Task 1: Bootstrap — FastAPI app + health endpoint

**Files:**
- Create: `vision-service/main.py`
- Create: `vision-service/requirements.txt`
- Create: `vision-service/models/__init__.py`
- Create: `vision-service/routers/__init__.py`
- Create: `vision-service/utils/__init__.py`
- Create: `vision-service/tests/__init__.py`
- Create: `vision-service/tests/test_health.py`

- [ ] **Step 1: Write the failing test**

```python
# vision-service/tests/test_health.py
from fastapi.testclient import TestClient

def test_health():
    from main import app
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2: Create requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.30.0
ultralytics==8.2.0
opencv-python-headless==4.10.0.84
numpy==1.26.4
pytest==8.3.0
httpx==0.27.0
```

Install SAM2 separately (not on PyPI as a stable release):
```bash
pip install git+https://github.com/facebookresearch/sam2.git
```

Install all deps:
```bash
cd vision-service && pip install -r requirements.txt
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd vision-service && python -m pytest tests/test_health.py -v
```

Expected: `ModuleNotFoundError: No module named 'main'`

- [ ] **Step 4: Create empty module files**

```python
# vision-service/models/__init__.py
# vision-service/routers/__init__.py
# vision-service/utils/__init__.py
# vision-service/tests/__init__.py
```
(all empty)

- [ ] **Step 5: Create main.py**

```python
# vision-service/main.py
from fastapi import FastAPI

app = FastAPI(title="VTextStudio Vision Service")

@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd vision-service && python -m pytest tests/test_health.py -v
```

Expected: `PASSED`

- [ ] **Step 7: Verify server starts**

```bash
cd vision-service && uvicorn main:app --port 3001
```

Expected: `Application startup complete.` — then Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add vision-service/
git commit -m "feat(vision): bootstrap FastAPI service with health endpoint"
```

---

## Task 2: YOLO detect endpoint

**Files:**
- Create: `vision-service/models/yolo_model.py`
- Create: `vision-service/routers/detect.py`
- Modify: `vision-service/main.py`
- Create: `vision-service/tests/test_detect.py`

- [ ] **Step 1: Write the failing test**

```python
# vision-service/tests/test_detect.py
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vision-service && python -m pytest tests/test_detect.py -v
```

Expected: `ImportError: cannot import name 'get_yolo' from 'routers.detect'`

- [ ] **Step 3: Create YOLO singleton**

```python
# vision-service/models/yolo_model.py
from ultralytics import YOLO

_model: YOLO | None = None


def get_yolo() -> YOLO:
    global _model
    if _model is None:
        _model = YOLO("yolov8n.pt")  # downloads on first use (~6MB)
    return _model
```

- [ ] **Step 4: Create detect router**

```python
# vision-service/routers/detect.py
import uuid
import cv2
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models.yolo_model import get_yolo

router = APIRouter()


class DetectRequest(BaseModel):
    mediaPath: str
    frameTime: float  # seconds


class DetectedObject(BaseModel):
    id: str
    label: str
    confidence: float
    bbox: list[float]  # [x, y, w, h] normalized 0-1


@router.post("/detect", response_model=list[DetectedObject])
def detect(req: DetectRequest) -> list[DetectedObject]:
    cap = cv2.VideoCapture(req.mediaPath)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open media: {req.mediaPath}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(req.frameTime * fps))
    ret, frame = cap.read()
    cap.release()

    if not ret:
        raise HTTPException(status_code=400, detail=f"Cannot read frame at {req.frameTime}s")

    h, w = frame.shape[:2]
    model = get_yolo()
    results = model(frame, verbose=False)[0]

    objects: list[DetectedObject] = []
    for box in results.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        objects.append(
            DetectedObject(
                id=str(uuid.uuid4()),
                label=results.names[int(box.cls[0])],
                confidence=round(float(box.conf[0]), 3),
                bbox=[x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h],
            )
        )
    return objects
```

- [ ] **Step 5: Register router in main.py**

```python
# vision-service/main.py
from fastapi import FastAPI
from routers import detect

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd vision-service && python -m pytest tests/test_detect.py tests/test_health.py -v
```

Expected: all `PASSED`

- [ ] **Step 7: Commit**

```bash
git add vision-service/
git commit -m "feat(vision): add YOLO object detection endpoint"
```

---

## Task 3: Frame extraction utility + SAM2 model singleton

**Files:**
- Create: `vision-service/utils/frames.py`
- Create: `vision-service/models/sam2_model.py`
- Create: `vision-service/tests/test_frames.py`

- [ ] **Step 1: Write the failing test**

```python
# vision-service/tests/test_frames.py
import cv2
import numpy as np
import os
from utils.frames import extract_frames_to_dir


def make_test_video(path: str, width=160, height=120, frame_count=15, fps=15):
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for i in range(frame_count):
        frame = np.full((height, width, 3), i * 10, dtype=np.uint8)
        out.write(frame)
    out.release()


def test_extract_frames_creates_jpegs(tmp_path):
    video_path = str(tmp_path / "v.mp4")
    out_dir = str(tmp_path / "frames")
    make_test_video(video_path, frame_count=15)

    info = extract_frames_to_dir(video_path, out_dir)

    jpeg_files = sorted(os.listdir(out_dir))
    assert len(jpeg_files) == 15
    assert jpeg_files[0] == "000000.jpg"
    assert jpeg_files[-1] == "000014.jpg"
    assert info["total_frames"] == 15
    assert info["fps"] == 15
    assert info["width"] == 160
    assert info["height"] == 120


def test_extract_frames_bad_path(tmp_path):
    from fastapi import HTTPException
    import pytest
    out_dir = str(tmp_path / "frames")
    with pytest.raises(HTTPException) as exc_info:
        extract_frames_to_dir("/no/such/file.mp4", out_dir)
    assert exc_info.value.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vision-service && python -m pytest tests/test_frames.py -v
```

Expected: `ImportError: cannot import name 'extract_frames_to_dir'`

- [ ] **Step 3: Create frame extraction utility**

```python
# vision-service/utils/frames.py
import os
import cv2
from fastapi import HTTPException


def extract_frames_to_dir(media_path: str, out_dir: str) -> dict:
    """Extract all frames as JPEGs to out_dir. Returns video metadata."""
    cap = cv2.VideoCapture(media_path)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open media: {media_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    os.makedirs(out_dir, exist_ok=True)

    for i in range(total_frames):
        ret, frame = cap.read()
        if not ret:
            break
        cv2.imwrite(os.path.join(out_dir, f"{i:06d}.jpg"), frame)

    cap.release()

    return {
        "total_frames": total_frames,
        "fps": fps,
        "width": width,
        "height": height,
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd vision-service && python -m pytest tests/test_frames.py -v
```

Expected: all `PASSED`

- [ ] **Step 5: Create SAM2 model singleton**

```python
# vision-service/models/sam2_model.py
import os
import torch

_predictor = None


def get_sam2():
    """Lazy-load SAM2 video predictor. Requires SAM2 installed and checkpoint present."""
    global _predictor
    if _predictor is not None:
        return _predictor

    try:
        from sam2.build_sam import build_sam2_video_predictor
    except ImportError as e:
        raise RuntimeError(
            "SAM2 not installed. Run: pip install git+https://github.com/facebookresearch/sam2.git"
        ) from e

    checkpoint = os.environ.get(
        "SAM2_CHECKPOINT",
        os.path.join(os.path.dirname(__file__), "..", "checkpoints", "sam2_hiera_small.pt"),
    )
    config = os.environ.get("SAM2_CONFIG", "sam2_hiera_small.yaml")
    device = "cuda" if torch.cuda.is_available() else "cpu"

    _predictor = build_sam2_video_predictor(config, checkpoint, device=device)
    return _predictor
```

Note: download the SAM2 checkpoint before running the track endpoint:
```bash
mkdir -p vision-service/checkpoints
cd vision-service/checkpoints
wget https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_small.pt
```

- [ ] **Step 6: Commit**

```bash
git add vision-service/
git commit -m "feat(vision): add frame extraction utility and SAM2 model singleton"
```

---

## Task 4: SAM2 track endpoint (SSE streaming)

**Files:**
- Create: `vision-service/routers/track.py`
- Modify: `vision-service/main.py`
- Create: `vision-service/tests/test_track.py`

- [ ] **Step 1: Write the failing test**

```python
# vision-service/tests/test_track.py
import json
import numpy as np
import cv2
import os
from unittest.mock import patch, MagicMock, call
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
    mask_dir = str(tmp_path / "masks")
    make_test_video(video_path, frame_count=30)

    # Mock SAM2 predictor
    mock_mask = np.ones((1, 120, 160), dtype=bool)
    mock_state = {}

    def fake_propagate(state, start_frame_idx=0, reverse=False):
        for i in range(3):
            yield i, ["obj1"], [mock_mask]

    mock_predictor = MagicMock()
    mock_predictor.init_state.return_value = mock_state
    mock_predictor.propagate_in_video.side_effect = fake_propagate

    import os
    os.environ["STORAGE_ROOT"] = str(tmp_path / "storage")

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
    import os
    mask_dir = os.path.join(str(tmp_path / "storage"), "projects", "proj1", "vision", "sess1", "masks")
    mask_file = os.path.join(mask_dir, "obj1.npz")
    assert os.path.exists(mask_file)
    data = np.load(mask_file)
    assert "frame_indices" in data
    assert "masks" in data


def test_track_bad_media_path(tmp_path):
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vision-service && python -m pytest tests/test_track.py -v
```

Expected: `ImportError` or `404`

- [ ] **Step 3: Create track router**

```python
# vision-service/routers/track.py
import json
import os
import shutil
import tempfile

import numpy as np
import torch
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models.sam2_model import get_sam2
from utils.frames import extract_frames_to_dir

router = APIRouter()


class TrackObject(BaseModel):
    id: str
    bbox: list[float]  # [x, y, w, h] normalized 0-1


class TrackRequest(BaseModel):
    mediaPath: str
    frameTime: float
    objects: list[TrackObject]
    projectId: str
    maskSessionId: str


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _mask_dir(project_id: str, session_id: str) -> str:
    storage_root = os.environ.get("STORAGE_ROOT", "storage")
    return os.path.join(storage_root, "projects", project_id, "vision", session_id, "masks")


@router.post("/track")
def track(req: TrackRequest):
    def generate():
        frame_dir = tempfile.mkdtemp(prefix="sam2_frames_")
        mask_output_dir = _mask_dir(req.projectId, req.maskSessionId)
        try:
            yield _sse({"type": "progress", "percent": 0, "phase": "extracting"})

            info = extract_frames_to_dir(req.mediaPath, frame_dir)
            total_frames = info["total_frames"]
            fps = info["fps"]
            w, h = info["width"], info["height"]
            keyframe_idx = int(req.frameTime * fps)
            keyframe_idx = min(keyframe_idx, total_frames - 1)

            yield _sse({"type": "progress", "percent": 25, "phase": "tracking"})

            # Pixel-space bounding boxes
            prompts = [
                {
                    "obj_id": obj.id,
                    "box": np.array(
                        [obj.bbox[0] * w, obj.bbox[1] * h,
                         (obj.bbox[0] + obj.bbox[2]) * w,
                         (obj.bbox[1] + obj.bbox[3]) * h],
                        dtype=np.float32,
                    ),
                }
                for obj in req.objects
            ]

            predictor = get_sam2()
            os.makedirs(mask_output_dir, exist_ok=True)

            # {obj_id: {frame_idx: bool mask (H, W)}}
            all_masks: dict[str, dict[int, np.ndarray]] = {obj.id: {} for obj in req.objects}

            device = "cuda" if torch.cuda.is_available() else "cpu"
            with torch.inference_mode(), torch.autocast(device, dtype=torch.bfloat16):
                # Forward pass
                state = predictor.init_state(video_path=frame_dir)
                for p in prompts:
                    predictor.add_new_points_or_box(
                        inference_state=state,
                        frame_idx=keyframe_idx,
                        obj_id=p["obj_id"],
                        box=p["box"],
                    )

                remaining_forward = max(total_frames - keyframe_idx, 1)
                for i, (frame_idx, obj_ids, mask_logits) in enumerate(
                    predictor.propagate_in_video(state, start_frame_idx=keyframe_idx)
                ):
                    for oi, obj_id in enumerate(obj_ids):
                        mask = (mask_logits[oi] > 0).squeeze().cpu().numpy().astype(bool)
                        all_masks[str(obj_id)][frame_idx] = mask
                    pct = 25 + int((i / remaining_forward) * 35)
                    yield _sse({"type": "progress", "percent": min(pct, 60), "phase": "forward"})

                # Backward pass
                state = predictor.init_state(video_path=frame_dir)
                for p in prompts:
                    predictor.add_new_points_or_box(
                        inference_state=state,
                        frame_idx=keyframe_idx,
                        obj_id=p["obj_id"],
                        box=p["box"],
                    )

                remaining_backward = max(keyframe_idx, 1)
                for i, (frame_idx, obj_ids, mask_logits) in enumerate(
                    predictor.propagate_in_video(state, start_frame_idx=keyframe_idx, reverse=True)
                ):
                    for oi, obj_id in enumerate(obj_ids):
                        mask = (mask_logits[oi] > 0).squeeze().cpu().numpy().astype(bool)
                        all_masks[str(obj_id)][frame_idx] = mask
                    pct = 60 + int((i / remaining_backward) * 30)
                    yield _sse({"type": "progress", "percent": min(pct, 90), "phase": "backward"})

            # Save masks
            for obj_id, frame_masks in all_masks.items():
                if not frame_masks:
                    continue
                frame_indices = sorted(frame_masks.keys())
                mask_array = np.stack([frame_masks[fi] for fi in frame_indices])
                np.savez_compressed(
                    os.path.join(mask_output_dir, f"{obj_id}.npz"),
                    frame_indices=np.array(frame_indices),
                    masks=mask_array,
                )

            yield _sse({"type": "complete", "percent": 100})

        except HTTPException as exc:
            yield _sse({"type": "error", "message": exc.detail})
        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})
        finally:
            shutil.rmtree(frame_dir, ignore_errors=True)

    return StreamingResponse(generate(), media_type="text/event-stream")
```

- [ ] **Step 4: Register router in main.py**

```python
# vision-service/main.py
from fastapi import FastAPI
from routers import detect, track

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)
app.include_router(track.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Run tests**

```bash
cd vision-service && python -m pytest tests/test_track.py -v
```

Expected: all `PASSED`

- [ ] **Step 6: Commit**

```bash
git add vision-service/
git commit -m "feat(vision): add SAM2 track endpoint with SSE progress streaming"
```

---

## Task 5: Effect utilities + preview endpoint

**Files:**
- Create: `vision-service/utils/effects.py`
- Create: `vision-service/routers/preview.py`
- Modify: `vision-service/main.py`
- Create: `vision-service/tests/test_preview.py`

- [ ] **Step 1: Write the failing tests**

```python
# vision-service/tests/test_preview.py
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
    masks = np.ones((frame_count, height, width), dtype=bool)
    # mask covers center quarter
    masks[:, height//4:3*height//4, width//4:3*width//4] = True
    masks[:, :height//4] = False
    masks[:, 3*height//4:] = False
    frame_indices = np.arange(frame_count)
    np.savez_compressed(os.path.join(mask_dir, f"{obj_id}.npz"),
                        frame_indices=frame_indices, masks=masks)


def test_preview_returns_base64_png(tmp_path):
    video_path = str(tmp_path / "v.mp4")
    mask_dir = str(tmp_path / "masks")
    make_test_video(video_path)
    write_test_mask(mask_dir, "obj1")

    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": video_path,
        "frameTime": 0.5,
        "maskOutputDir": mask_dir,
        "objects": [{"id": "obj1", "effect": "blur", "fillColor": None}],
    })

    assert response.status_code == 200
    data = response.json()
    assert "previewPng" in data
    # Verify it's valid base64 PNG
    img_bytes = base64.b64decode(data["previewPng"])
    assert img_bytes[:4] == b"\x89PNG"


def test_preview_fill_effect(tmp_path):
    video_path = str(tmp_path / "v.mp4")
    mask_dir = str(tmp_path / "masks")
    make_test_video(video_path)
    write_test_mask(mask_dir, "obj1")

    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": video_path,
        "frameTime": 0.5,
        "maskOutputDir": mask_dir,
        "objects": [{"id": "obj1", "effect": "fill", "fillColor": "#ff0000"}],
    })
    assert response.status_code == 200


def test_preview_inpaint_effect(tmp_path):
    video_path = str(tmp_path / "v.mp4")
    mask_dir = str(tmp_path / "masks")
    make_test_video(video_path)
    write_test_mask(mask_dir, "obj1")

    from main import app
    client = TestClient(app)
    response = client.post("/preview", json={
        "mediaPath": video_path,
        "frameTime": 0.5,
        "maskOutputDir": mask_dir,
        "objects": [{"id": "obj1", "effect": "inpaint", "fillColor": None}],
    })
    assert response.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd vision-service && python -m pytest tests/test_preview.py -v
```

Expected: `ImportError` or `404`

- [ ] **Step 3: Create effect utilities**

```python
# vision-service/utils/effects.py
import cv2
import numpy as np


def apply_blur(frame: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Gaussian blur within mask region."""
    blurred = cv2.GaussianBlur(frame, (51, 51), 0)
    mask_3ch = np.stack([mask, mask, mask], axis=-1)
    return np.where(mask_3ch, blurred, frame)


def apply_fill(frame: np.ndarray, mask: np.ndarray, hex_color: str) -> np.ndarray:
    """Solid color fill within mask region."""
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    color_frame = np.full_like(frame, (b, g, r))  # OpenCV BGR
    mask_3ch = np.stack([mask, mask, mask], axis=-1)
    return np.where(mask_3ch, color_frame, frame)


def apply_inpaint(frame: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Inpainting using OpenCV TELEA algorithm."""
    mask_uint8 = (mask * 255).astype(np.uint8)
    return cv2.inpaint(frame, mask_uint8, inpaintRadius=5, flags=cv2.INPAINT_TELEA)


def apply_effect(
    frame: np.ndarray,
    mask: np.ndarray,
    effect: str,
    fill_color: str | None = None,
) -> np.ndarray:
    if effect == "blur":
        return apply_blur(frame, mask)
    elif effect == "fill":
        color = fill_color or "#000000"
        return apply_fill(frame, mask, color)
    elif effect == "inpaint":
        return apply_inpaint(frame, mask)
    return frame
```

- [ ] **Step 4: Create preview router**

```python
# vision-service/routers/preview.py
import base64
import os

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from utils.effects import apply_effect

router = APIRouter()


class PreviewObject(BaseModel):
    id: str
    effect: str          # "blur" | "fill" | "inpaint"
    fillColor: str | None = None


class PreviewRequest(BaseModel):
    mediaPath: str
    frameTime: float
    projectId: str
    maskSessionId: str
    objects: list[PreviewObject]


class PreviewResponse(BaseModel):
    previewPng: str  # base64-encoded PNG


def _load_mask_for_frame(mask_dir: str, obj_id: str, frame_idx: int) -> np.ndarray | None:
    """Return bool mask (H, W) for the given object at frame_idx, or None if not found."""
    npz_path = os.path.join(mask_dir, f"{obj_id}.npz")
    if not os.path.exists(npz_path):
        return None
    data = np.load(npz_path)
    frame_indices = data["frame_indices"].tolist()
    if frame_idx not in frame_indices:
        return None
    pos = frame_indices.index(frame_idx)
    return data["masks"][pos]


def _preview_mask_dir(project_id: str, session_id: str) -> str:
    storage_root = os.environ.get("STORAGE_ROOT", "storage")
    return os.path.join(storage_root, "projects", project_id, "vision", session_id, "masks")


@router.post("/preview", response_model=PreviewResponse)
def preview(req: PreviewRequest) -> PreviewResponse:
    cap = cv2.VideoCapture(req.mediaPath)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail=f"Cannot open media: {req.mediaPath}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_idx = int(req.frameTime * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        raise HTTPException(status_code=400, detail=f"Cannot read frame at {req.frameTime}s")

    mask_dir = _preview_mask_dir(req.projectId, req.maskSessionId)
    result = frame.copy()
    for obj in req.objects:
        mask = _load_mask_for_frame(mask_dir, obj.id, frame_idx)
        if mask is None:
            continue
        result = apply_effect(result, mask, obj.effect, obj.fillColor)

    _, png_bytes = cv2.imencode(".png", result)
    return PreviewResponse(previewPng=base64.b64encode(png_bytes).decode())
```

- [ ] **Step 5: Register router in main.py**

```python
# vision-service/main.py
from fastapi import FastAPI
from routers import detect, track, preview

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)
app.include_router(track.router)
app.include_router(preview.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run tests**

```bash
cd vision-service && python -m pytest tests/test_preview.py -v
```

Expected: all `PASSED`

- [ ] **Step 7: Commit**

```bash
git add vision-service/
git commit -m "feat(vision): add effect utilities and preview frame endpoint"
```

---

## Task 6: Masked video export endpoint (SSE streaming)

**Files:**
- Create: `vision-service/routers/export.py`
- Modify: `vision-service/main.py`
- Create: `vision-service/tests/test_export.py`

- [ ] **Step 1: Write the failing test**

```python
# vision-service/tests/test_export.py
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


def test_export_masked_creates_video(tmp_path):
    import os
    storage_root = str(tmp_path / "storage")
    os.environ["STORAGE_ROOT"] = storage_root

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


def test_export_bad_media_path(tmp_path):
    import os
    os.environ["STORAGE_ROOT"] = str(tmp_path / "storage")
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd vision-service && python -m pytest tests/test_export.py -v
```

Expected: `ImportError` or `404`

- [ ] **Step 3: Create export router**

```python
# vision-service/routers/export.py
import json
import os

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from utils.effects import apply_effect

router = APIRouter()


class ExportObject(BaseModel):
    id: str
    effect: str
    fillColor: str | None = None


class ExportRequest(BaseModel):
    mediaPath: str
    projectId: str
    exportId: str
    maskSessionId: str
    objects: list[ExportObject]


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _load_all_masks(mask_dir: str, objects: list[ExportObject]) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Returns {obj_id: (frame_indices, masks)} for each object with an existing mask file."""
    loaded = {}
    for obj in objects:
        npz_path = os.path.join(mask_dir, f"{obj.id}.npz")
        if os.path.exists(npz_path):
            data = np.load(npz_path)
            loaded[obj.id] = (data["frame_indices"], data["masks"])
    return loaded


def _export_paths(project_id: str, export_id: str, session_id: str) -> tuple[str, str]:
    storage_root = os.environ.get("STORAGE_ROOT", "storage")
    mask_dir = os.path.join(storage_root, "projects", project_id, "vision", session_id, "masks")
    output_path = os.path.join(storage_root, "projects", project_id, "exports", f"{export_id}-masked.mp4")
    return mask_dir, output_path


@router.post("/export-masked")
def export_masked(req: ExportRequest):
    def generate():
        mask_dir, output_path = _export_paths(req.projectId, req.exportId, req.maskSessionId)

        cap = cv2.VideoCapture(req.mediaPath)
        if not cap.isOpened():
            yield _sse({"type": "error", "message": f"Cannot open media: {req.mediaPath}"})
            return

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        writer = cv2.VideoWriter(
            output_path,
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (w, h),
        )

        # Pre-load all masks
        mask_data = _load_all_masks(mask_dir, req.objects)
        # Build fast lookup: obj_id -> {frame_idx: mask}
        mask_lookup: dict[str, dict[int, np.ndarray]] = {}
        for obj_id, (frame_indices, masks) in mask_data.items():
            mask_lookup[obj_id] = {int(fi): masks[i] for i, fi in enumerate(frame_indices)}

        try:
            for frame_idx in range(total_frames):
                ret, frame = cap.read()
                if not ret:
                    break

                result = frame.copy()
                for obj in req.objects:
                    frame_masks = mask_lookup.get(obj.id, {})
                    mask = frame_masks.get(frame_idx)
                    if mask is not None:
                        result = apply_effect(result, mask, obj.effect, obj.fillColor)

                writer.write(result)

                if frame_idx % 10 == 0:
                    pct = int((frame_idx / total_frames) * 100)
                    yield _sse({"type": "progress", "percent": pct})

        finally:
            cap.release()
            writer.release()

        yield _sse({"type": "complete", "percent": 100, "exportId": req.exportId})

    return StreamingResponse(generate(), media_type="text/event-stream")
```

- [ ] **Step 4: Register router in main.py**

```python
# vision-service/main.py
from fastapi import FastAPI
from routers import detect, track, preview, export

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)
app.include_router(track.router)
app.include_router(preview.router)
app.include_router(export.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Run all tests**

```bash
cd vision-service && python -m pytest tests/ -v
```

Expected: all `PASSED`

- [ ] **Step 6: Smoke-test the full service manually**

```bash
cd vision-service && uvicorn main:app --port 3001 --reload
# In another terminal:
curl http://localhost:3001/health
# Expected: {"status":"ok"}
```

- [ ] **Step 7: Commit**

```bash
git add vision-service/
git commit -m "feat(vision): add masked video export endpoint with SSE progress"
```
