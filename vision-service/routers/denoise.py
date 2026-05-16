import logging
import os
import tempfile

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

log = logging.getLogger("denoise")
router = APIRouter()

_df_model = None
_df_state = None


def _get_model():
    global _df_model, _df_state
    if _df_model is None:
        from df.enhance import init_df
        _df_model, _df_state, _ = init_df()
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

    from df.enhance import enhance, load_audio, save_audio

    model, df_state = _get_model()
    audio, _ = load_audio(req.audioPath, sr=df_state.sr())
    enhanced = enhance(model, df_state, audio)

    out_fd, out_path = tempfile.mkstemp(suffix="_denoised.wav", prefix="vts_")
    os.close(out_fd)
    save_audio(out_path, enhanced, df_state.sr())

    log.info("denoise | input=%s output=%s", req.audioPath, out_path)
    return DenoiseResponse(denoisedPath=out_path)
