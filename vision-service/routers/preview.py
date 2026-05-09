import base64
import os

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from utils.effects import apply_effect

router = APIRouter()


class PreviewObject(BaseModel):
    id: str
    effect: str          # "blur" | "fill" | "inpaint"
    fillColor: str | None = None


class PreviewRequest(BaseModel):
    mediaPath: str
    frameTime: float = Field(..., ge=0.0, description="Timestamp in seconds")
    projectId: str
    maskSessionId: str
    objects: list[PreviewObject]


class PreviewResponse(BaseModel):
    previewPng: str  # base64-encoded PNG


def _mask_dir(project_id: str, session_id: str) -> str:
    storage_root = os.environ.get("STORAGE_ROOT", "storage")
    return os.path.join(storage_root, "projects", project_id, "vision", session_id, "masks")


def _load_mask_for_frame(mask_dir: str, obj_id: str, frame_idx: int) -> np.ndarray | None:
    npz_path = os.path.join(mask_dir, f"{obj_id}.npz")
    if not os.path.exists(npz_path):
        return None
    data = np.load(npz_path)
    frame_indices = data["frame_indices"].tolist()
    if frame_idx not in frame_indices:
        return None
    pos = frame_indices.index(frame_idx)
    return data["masks"][pos]


@router.post("/preview", response_model=PreviewResponse)
def preview(req: PreviewRequest) -> PreviewResponse:
    cap = cv2.VideoCapture(req.mediaPath)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Cannot open media file")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_idx = int(req.frameTime * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, frame = cap.read()
    cap.release()

    if not ret:
        raise HTTPException(status_code=400, detail="Cannot read frame at requested time")

    mask_dir = _mask_dir(req.projectId, req.maskSessionId)
    result = frame.copy()
    for obj in req.objects:
        mask = _load_mask_for_frame(mask_dir, obj.id, frame_idx)
        if mask is None:
            continue
        try:
            result = apply_effect(result, mask, obj.effect, obj.fillColor)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    _, png_bytes = cv2.imencode(".png", result)
    return PreviewResponse(previewPng=base64.b64encode(png_bytes).decode())
