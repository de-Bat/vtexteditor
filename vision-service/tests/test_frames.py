import cv2
import numpy as np
import os
from utils.frames import extract_frames_to_dir


def make_test_video(path: str, width=160, height=120, frame_count=15, fps=15):
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    for i in range(frame_count):
        frame = np.full((height, width, 3), i * 10, dtype=np.uint8)
        out.write(frame)
    out.release()


def test_extract_frames_creates_jpegs(tmp_path):
    video_path = str(tmp_path / "v.mp4")
    out_dir = str(tmp_path / "frames")
    make_test_video(video_path, frame_count=15)

    info = extract_frames_to_dir(video_path, out_dir)

    jpeg_files = sorted(os.listdir(out_dir))
    assert len(jpeg_files) == 15
    assert jpeg_files[0] == "000000.jpg"
    assert jpeg_files[-1] == "000014.jpg"
    assert info["total_frames"] == 15
    assert info["fps"] == 15
    assert info["width"] == 160
    assert info["height"] == 120


def test_extract_frames_bad_path(tmp_path):
    from fastapi import HTTPException
    import pytest
    out_dir = str(tmp_path / "frames")
    with pytest.raises(HTTPException) as exc_info:
        extract_frames_to_dir("/no/such/file.mp4", out_dir)
    assert exc_info.value.status_code == 400
