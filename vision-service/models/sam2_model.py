import os
import pathlib
import threading
import torch

_predictor = None
_lock = threading.Lock()


def get_sam2():
    """Lazy-load SAM2 video predictor (thread-safe). Requires SAM2 installed and checkpoint present."""
    global _predictor
    if _predictor is not None:
        return _predictor
    with _lock:
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
            str(pathlib.Path(__file__).parent.parent / "checkpoints" / "sam2_hiera_small.pt"),
        )
        config = os.environ.get("SAM2_CONFIG", "sam2_hiera_small.yaml")
        device = "cuda" if torch.cuda.is_available() else "cpu"

        _predictor = build_sam2_video_predictor(config, checkpoint, device=device)
        return _predictor
