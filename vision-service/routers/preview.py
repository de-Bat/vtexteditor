import base64
import os

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from utils.effects import apply_effect
from utils.validation import validate_id, validate_path_within

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
    usedInpaintFallback: bool = False


def _mask_dir(project_id: str, session_id: str) -> str:
    validate_id(project_id, "projectId")
    validate_id(session_id, "maskSessionId")
    storage_root = os.environ.get("STORAGE_ROOT", "storage")
    result = os.path.join(storage_root, "projects", project_id, "vision", session_id, "masks")
    validate_path_within(result, storage_root)
    return result


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
    for obj in req.objects:
        validate_id(obj.id, f"objects[].id ({obj.id!r})")

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
    used_inpaint_fallback = False
    for obj in req.objects:
        mask = _load_mask_for_frame(mask_dir, obj.id, frame_idx)
        if mask is None:
            continue
        try:
            result, fallback = apply_effect(result, mask, obj.effect, obj.fillColor)
            if fallback:
                used_inpaint_fallback = True
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    _, png_bytes = cv2.imencode(".png", result)
    return PreviewResponse(
        previewPng=base64.b64encode(png_bytes).decode(),
        usedInpaintFallback=used_inpaint_fallback,
    )
