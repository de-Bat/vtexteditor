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


def _export_paths(project_id: str, export_id: str, session_id: str) -> tuple[str, str]:
    storage_root = os.environ.get("STORAGE_ROOT", "storage")
    mask_dir = os.path.join(storage_root, "projects", project_id, "vision", session_id, "masks")
    output_path = os.path.join(storage_root, "projects", project_id, "exports", f"{export_id}-masked.mp4")
    return mask_dir, output_path


def _load_all_masks(mask_dir: str, objects: list[ExportObject]) -> dict[str, dict[int, np.ndarray]]:
    """Load all mask NPZ files into {obj_id: {frame_idx: bool mask}} lookup."""
    lookup: dict[str, dict[int, np.ndarray]] = {}
    for obj in objects:
        npz_path = os.path.join(mask_dir, f"{obj.id}.npz")
        if not os.path.exists(npz_path):
            continue
        data = np.load(npz_path)
        lookup[obj.id] = {int(fi): data["masks"][i] for i, fi in enumerate(data["frame_indices"])}
    return lookup


@router.post("/export-masked")
def export_masked(req: ExportRequest):
    # Validate media path before streaming so we can return HTTP 400
    cap_check = cv2.VideoCapture(req.mediaPath)
    if not cap_check.isOpened():
        raise HTTPException(status_code=400, detail="Cannot open media file")
    cap_check.release()

    def generate():
        mask_dir, output_path = _export_paths(req.projectId, req.exportId, req.maskSessionId)

        cap = cv2.VideoCapture(req.mediaPath)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Load masks before opening writer — if mask load fails, no partial file created
        try:
            mask_lookup = _load_all_masks(mask_dir, req.objects)
        except Exception as exc:
            cap.release()
            yield _sse({"type": "error", "message": f"Failed to load masks: {exc}"})
            return

        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        writer = cv2.VideoWriter(
            output_path,
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (w, h),
        )

        completed = False
        try:
            for frame_idx in range(total_frames):
                ret, frame = cap.read()
                if not ret:
                    break

                result = frame.copy()
                for obj in req.objects:
                    mask = mask_lookup.get(obj.id, {}).get(frame_idx)
                    if mask is not None:
                        try:
                            result = apply_effect(result, mask, obj.effect, obj.fillColor)
                        except ValueError:
                            pass  # skip unknown effects silently during export

                writer.write(result)

                if frame_idx % 10 == 0:
                    pct = int((frame_idx / max(total_frames, 1)) * 100)
                    yield _sse({"type": "progress", "percent": pct})

            completed = True
        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})
        finally:
            cap.release()
            writer.release()

        if completed:
            yield _sse({"type": "complete", "percent": 100, "exportId": req.exportId})

    return StreamingResponse(generate(), media_type="text/event-stream")
