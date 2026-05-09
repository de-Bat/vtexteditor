from fastapi import FastAPI
from routers import detect

app = FastAPI(title="VTextStudio Vision Service")
app.include_router(detect.router)


@app.get("/health")
def health():
    return {"status": "ok"}
