import cv2
import numpy as np


def apply_blur(frame: np.ndarray, mask: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(frame, (51, 51), 0)
    mask_3ch = np.stack([mask, mask, mask], axis=-1)
    return np.where(mask_3ch, blurred, frame)


def apply_fill(frame: np.ndarray, mask: np.ndarray, hex_color: str) -> np.ndarray:
    hex_color = hex_color.lstrip("#")
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    color_frame = np.full_like(frame, (b, g, r))  # OpenCV BGR
    mask_3ch = np.stack([mask, mask, mask], axis=-1)
    return np.where(mask_3ch, color_frame, frame)


_lama_instance = None
_lama_available: bool | None = None  # None = not yet probed


def _get_lama():
    global _lama_instance, _lama_available
    if _lama_available is None:
        try:
            from simple_lama_inpainting import SimpleLama  # type: ignore[import]
            _lama_instance = SimpleLama()
            _lama_available = True
        except ImportError:
            _lama_available = False
    return _lama_instance if _lama_available else None


def apply_inpaint(frame: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, bool]:
    """Returns (result, used_fallback). used_fallback=True when LaMa unavailable."""
    lama = _get_lama()
    if lama is not None:
        from PIL import Image  # type: ignore[import]
        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)
        mask_pil = Image.fromarray((mask * 255).astype(np.uint8))
        result_pil = lama(pil_img, mask_pil)
        return cv2.cvtColor(np.array(result_pil), cv2.COLOR_RGB2BGR), False
    mask_uint8 = (mask * 255).astype(np.uint8)
    return cv2.inpaint(frame, mask_uint8, inpaintRadius=5, flags=cv2.INPAINT_TELEA), True


def apply_effect(
    frame: np.ndarray,
    mask: np.ndarray,
    effect: str,
    fill_color: str | None = None,
) -> tuple[np.ndarray, bool]:
    """Returns (result_frame, used_inpaint_fallback)."""
    if effect == "blur":
        return apply_blur(frame, mask), False
    elif effect == "fill":
        color = fill_color or "#000000"
        return apply_fill(frame, mask, color), False
    elif effect == "inpaint":
        return apply_inpaint(frame, mask)
    raise ValueError(f"Unknown effect: {effect!r}")
