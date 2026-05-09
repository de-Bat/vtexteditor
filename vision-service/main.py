from fastapi import FastAPI
from routers import detect, track

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)
app.include_router(track.router)


@app.get("/health")
def health():
    return {"status": "ok"}
