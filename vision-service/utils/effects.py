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


def apply_inpaint(frame: np.ndarray, mask: np.ndarray) -> np.ndarray:
    mask_uint8 = (mask * 255).astype(np.uint8)
    return cv2.inpaint(frame, mask_uint8, inpaintRadius=5, flags=cv2.INPAINT_TELEA)


def apply_effect(
    frame: np.ndarray,
    mask: np.ndarray,
    effect: str,
    fill_color: str | None = None,
) -> np.ndarray:
    if effect == "blur":
        return apply_blur(frame, mask)
    elif effect == "fill":
        color = fill_color or "#000000"
        return apply_fill(frame, mask, color)
    elif effect == "inpaint":
        return apply_inpaint(frame, mask)
    return frame
