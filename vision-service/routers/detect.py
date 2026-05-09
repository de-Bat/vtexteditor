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
        cap.release()
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
