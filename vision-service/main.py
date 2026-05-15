import logging
import sys

import torch
import torchvision.ops as _tvops
from fastapi import FastAPI

# torchvision on Python 3.14 ships CPU-only NMS kernel; patch so CUDA tensors
# are handled by moving to CPU for NMS only (negligible overhead at typical
# detection counts).
_orig_nms = _tvops.nms
def _nms_cuda_safe(boxes, scores, iou_threshold):
    if boxes.is_cuda:
        return _orig_nms(boxes.cpu(), scores.cpu(), iou_threshold).to(boxes.device)
    return _orig_nms(boxes, scores, iou_threshold)
_tvops.nms = _nms_cuda_safe
from routers import detect, track, preview, export, suggest
from utils.device import get_device

logging.basicConfig(
    stream=sys.stdout,
    level=logging.DEBUG,
    format="%(asctime)s.%(msecs)03d [vision] %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)
app.include_router(track.router)
app.include_router(preview.router)
app.include_router(export.router)
app.include_router(suggest.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stats")
def stats():
    device = get_device()
    gpu_name: str | None = None
    cuda_version: str | None = None
    vram_total_mb: int | None = None
    if device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        cuda_version = torch.version.cuda
        props = torch.cuda.get_device_properties(0)
        vram_total_mb = props.total_memory // (1024 * 1024)
    return {
        "device": device,
        "gpuName": gpu_name,
        "cudaVersion": cuda_version,
        "vramTotalMb": vram_total_mb,
        "torchVersion": torch.__version__,
        "yoloModel": "yolov8n",
    }
