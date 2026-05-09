import threading

from ultralytics import YOLO

_model: YOLO | None = None
_lock = threading.Lock()


def get_yolo() -> YOLO:
    global _model
    if _model is None:
        with _lock:
            if _model is None:  # double-checked locking
                _model = YOLO("yolov8n.pt")  # downloads on first use (~6MB)
    return _model
