import json
import os
import shutil
import tempfile

import numpy as np
import torch
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from models.sam2_model import get_sam2
from utils.frames import extract_frames_to_dir

router = APIRouter()


class TrackObject(BaseModel):
    id: str
    bbox: list[float]  # [x, y, w, h] normalized 0-1


class TrackRequest(BaseModel):
    mediaPath: str
    frameTime: float = Field(..., ge=0.0, description="Timestamp in seconds")
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
    # Validate media path before streaming
    import cv2
    cap = cv2.VideoCapture(req.mediaPath)
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Cannot open media file")
    cap.release()

    def generate():
        frame_dir = tempfile.mkdtemp(prefix="sam2_frames_")
        mask_output_dir = _mask_dir(req.projectId, req.maskSessionId)
        try:
            yield _sse({"type": "progress", "percent": 0, "phase": "extracting"})

            try:
                info = extract_frames_to_dir(req.mediaPath, frame_dir)
            except ValueError as exc:
                yield _sse({"type": "error", "message": str(exc)})
                return

            total_frames = info["total_frames"]
            fps = info["fps"]
            w, h = info["width"], info["height"]
            keyframe_idx = min(int(req.frameTime * fps), total_frames - 1)

            yield _sse({"type": "progress", "percent": 25, "phase": "tracking"})

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
                        raw = mask_logits[oi] > 0
                        if isinstance(raw, torch.Tensor):
                            mask = raw.squeeze().cpu().numpy().astype(bool)
                        else:
                            mask = np.asarray(raw).squeeze().astype(bool)
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
                        raw = mask_logits[oi] > 0
                        if isinstance(raw, torch.Tensor):
                            mask = raw.squeeze().cpu().numpy().astype(bool)
                        else:
                            mask = np.asarray(raw).squeeze().astype(bool)
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

        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})
        finally:
            shutil.rmtree(frame_dir, ignore_errors=True)

    return StreamingResponse(generate(), media_type="text/event-stream")
