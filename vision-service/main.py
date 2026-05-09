from fastapi import FastAPI
from routers import detect, track, preview

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)
app.include_router(track.router)
app.include_router(preview.router)


@app.get("/health")
def health():
    return {"status": "ok"}
