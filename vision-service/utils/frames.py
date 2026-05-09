import os
import cv2
from fastapi import HTTPException


def extract_frames_to_dir(media_path: str, out_dir: str) -> dict:
    cap = cv2.VideoCapture(media_path)
    if not cap.isOpened():
        cap.release()
        raise HTTPException(status_code=400, detail="Cannot open media file")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    os.makedirs(out_dir, exist_ok=True)

    if total_frames <= 0:
        # CAP_PROP_FRAME_COUNT is unreliable for some codecs — fall back to reading until EOF
        frame_index = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            cv2.imwrite(os.path.join(out_dir, f"{frame_index:06d}.jpg"), frame)
            frame_index += 1
        total_frames = frame_index
    else:
        for i in range(total_frames):
            ret, frame = cap.read()
            if not ret:
                break
            cv2.imwrite(os.path.join(out_dir, f"{i:06d}.jpg"), frame)

    cap.release()

    if total_frames <= 0:
        raise HTTPException(status_code=400, detail="Video contains no readable frames")

    return {
        "total_frames": total_frames,
        "fps": fps,
        "width": width,
        "height": height,
    }
