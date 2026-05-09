from ultralytics import YOLO

_model: YOLO | None = None


def get_yolo() -> YOLO:
    global _model
    if _model is None:
        _model = YOLO("yolov8n.pt")  # downloads on first use (~6MB)
    return _model
