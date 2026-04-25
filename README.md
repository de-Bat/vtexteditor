# VTextStudio

Text-based media editor.

## Requirements

### Node.js

Node.js 20+ required.

### FFmpeg

FFmpeg and FFprobe must be available on the system. The server auto-resolves them via `where` (Windows) / `which` (Unix). Override with environment variables if needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `FFMPEG_PATH` | auto-resolved from `PATH` | Absolute path to the `ffmpeg` binary |
| `FFPROBE_PATH` | auto-resolved from `PATH` | Absolute path to the `ffprobe` binary |

Example (`.env` or shell):

```bash
FFMPEG_PATH=/usr/local/bin/ffmpeg
FFPROBE_PATH=/usr/local/bin/ffprobe
```

### Server port

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the Express server listens on |

## Getting started

```bash
# Install dependencies
npm run install:all

# Start dev servers (server + client)
npm run dev
```

Client runs at `http://localhost:4200`, API server at `http://localhost:3000`.

## Whisper (transcription)

An OpenAI-compatible Whisper server is required for transcription. A Docker Compose file is provided:

```bash
docker compose -f docker-compose.whisper.yml up -d
```

Then set in the app's Settings panel:

- **WHISPER_BASE_URL** → `http://localhost:8000/v1`
- **model** → `Systran/faster-whisper-large-v3`
