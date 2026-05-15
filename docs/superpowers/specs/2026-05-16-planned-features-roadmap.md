# Planned Features Roadmap

**Date:** 2026-05-16
**Status:** Queued — implement in order (dependencies noted)
**Hardware target:** RTX 4060 (8GB VRAM), 32GB RAM

---

## Feature 1 — Audio Denoising (export-time)

**What:** DeepFilterNet cleans voice track at export. Removes background noise, hum, echo.

**How:**
- Python vision-service: add `POST /denoise` endpoint
- DeepFilterNet model (tiny, real-time capable) — runs on GPU via CUDA
- Input: audio file path. Output: denoised WAV written to temp dir
- Export pipeline: optionally run denoise before ffmpeg mux
- UI: toggle in Export Panel ("Enhance audio")

**Stack:** DeepFilterNet (`pip install deepfilternet`), vision-service FastAPI, Angular export panel

**Effort:** Medium. No new Angular components — just export option + Python endpoint.

---

## Feature 2 — Speaker Diarization

**What:** Identify who's talking per word/segment. Color-code transcript by speaker.

**How:**
- Python vision-service: add `POST /diarize` endpoint
- pyannote.audio 3.x (`pip install pyannote.audio`) — GPU-accelerated
- Returns: `[{ speaker: "SPEAKER_00", startTime, endTime }]`
- Server maps diarization segments → words → assigns `speakerId` field to each word
- Client: transcript renders speaker color per word; segment timeline bars colored by speaker
- Model requires HuggingFace token (user must supply via settings)

**Stack:** pyannote.audio, FastAPI, Angular transcript component, word model (`speakerId: string`)

**Effort:** Medium-high. Touches word model, transcript rendering, settings (HF token).

**Dependencies:** None, but waveform feature helps users visually verify speaker segments.

---

## Feature 3 — Auto Thumbnail Generator

**What:** Extract best frame from clip as thumbnail — face-detected, composition-scored.

**How:**
- Python vision-service: add `POST /thumbnail` endpoint
- Candidate frames sampled every 2s from clip
- YOLOv8 (already loaded) detects faces → score by: face present, centered, eyes open (heuristic)
- If no face: score by edge density (busy vs. blank)
- Best frame extracted via ffmpeg at that timestamp → returned as base64 PNG
- UI: "Generate Thumbnail" button in clip list / export panel → shows preview, click to save

**Stack:** YOLOv8 (already in vision-service), OpenCV, FastAPI, Angular clip-list component

**Effort:** Low-medium. Reuses existing YOLO model — just new endpoint + small UI.

**Dependencies:** Speaker diarization not required. Can implement any time after waveform.

---

## Feature 4 — Background Removal / Virtual Background

**What:** Segment speaker from background using SAM2 (already loaded). Replace BG with color/blur/image.

**How:**
- Extends existing vision-service SAM2 pipeline
- User clicks person in Vision Panel → SAM2 tracks person mask across all frames
- Export: cv2 applies mask per frame — background replaced with solid color or blurred copy
- UI: Virtual BG panel in Vision Panel — color picker + blur slider + image upload
- Separate from object-removal (which removes objects) — this replaces BG behind person

**Stack:** SAM2 (already loaded), cv2, ffmpeg, Angular vision panel

**Effort:** Medium. SAM2 tracking already exists — mainly new export path + UI controls.

**Dependencies:** Smart video editing feature (vision panel) already built.

---

## Feature 5 — Color Grading / LUT

**What:** Apply a `.cube` LUT file at export for consistent color grade.

**How:**
- Server: `POST /api/export` accepts optional `lutPath` param
- ffmpeg `lut3d=file=<path>` filter applied in export pipeline
- Built-in LUT presets (cinema, warm, cool, desaturated) bundled in `server/assets/luts/`
- User can upload custom `.cube` file
- UI: "Color Grade" section in Export Panel — preset picker + custom upload

**Stack:** ffmpeg `lut3d` filter (no ML), Express file upload, Angular export panel

**Effort:** Low. Pure ffmpeg — no GPU, no new Python endpoints. Fastest to ship.

**Dependencies:** None. Can implement any time.

---

## Suggested Implementation Order

| # | Feature | Why this order |
|---|---------|----------------|
| 1 | Audio Denoising | Export pipeline change; sets pattern for other export options |
| 2 | Speaker Diarization | Touches word model — do before thumbnail (uses speaker info) |
| 3 | Auto Thumbnail | Reuses YOLO already loaded; no model infra changes |
| 4 | Background Removal | Extends SAM2 tracking already in place |
| 5 | Color Grading | Pure ffmpeg, zero ML — fast win at any point |

Color grading (5) can be pulled forward at any time — it has zero dependencies.
