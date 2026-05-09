import cv2
import numpy as np
import os
import pytest
from unittest.mock import patch, MagicMock
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
    out_dir = str(tmp_path / "frames")
    with pytest.raises(ValueError):
        extract_frames_to_dir("/no/such/file.mp4", out_dir)


def test_extract_frames_empty_video_raises(tmp_path):
    """Test that a video with zero readable frames raises ValueError."""
    out_dir = str(tmp_path / "frames")

    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = True
    mock_cap.get.side_effect = lambda prop: {
        cv2.CAP_PROP_FPS: 30.0,
        cv2.CAP_PROP_FRAME_COUNT: 0,
        cv2.CAP_PROP_FRAME_WIDTH: 160,
        cv2.CAP_PROP_FRAME_HEIGHT: 120,
    }.get(prop, 0)
    mock_cap.read.return_value = (False, None)  # No frames readable

    with patch("utils.frames.cv2.VideoCapture", return_value=mock_cap):
        with pytest.raises(ValueError, match="no frames"):
            extract_frames_to_dir("/fake/video.mp4", out_dir)
