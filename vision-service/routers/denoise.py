import logging
import os
import tempfile

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log = logging.getLogger("denoise")
router = APIRouter()

_df_model = None
_df_state = None
_df_enhance = None
_df_load_audio = None
_df_save_audio = None


def _get_model():
    global _df_model, _df_state, _df_enhance, _df_load_audio, _df_save_audio
    if _df_model is None:
        from df.enhance import init_df, enhance, load_audio, save_audio
        _df_model, _df_state, _ = init_df()
        _df_enhance = enhance
        _df_load_audio = load_audio
        _df_save_audio = save_audio
        log.info("DeepFilterNet model loaded")
    return _df_model, _df_state


class DenoiseRequest(BaseModel):
    audioPath: str


class DenoiseResponse(BaseModel):
    denoisedPath: str


@router.post("/denoise", response_model=DenoiseResponse)
def denoise(req: DenoiseRequest) -> DenoiseResponse:
    if not os.path.exists(req.audioPath):
        raise HTTPException(status_code=400, detail=f"audioPath not found: {req.audioPath}")

    model, df_state = _get_model()

    try:
        audio, _ = _df_load_audio(req.audioPath, sr=df_state.sr())
        enhanced = _df_enhance(model, df_state, audio)

        out_fd, out_path = tempfile.mkstemp(suffix="_denoised.wav", prefix="vts_")
        os.close(out_fd)
        _df_save_audio(out_path, enhanced, df_state.sr())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Audio processing failed: {exc}") from exc

    log.info("denoise | input=%s output=%s", req.audioPath, out_path)
    return DenoiseResponse(denoisedPath=out_path)
