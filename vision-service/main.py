from fastapi import FastAPI

app = FastAPI(title="VTextStudio Vision Service")


@app.get("/health")
def health():
    return {"status": "ok"}
