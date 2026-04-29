import {
  SMART_CUT_WORD_BUFFER_MS,
  SMART_CUT_FRAME_INTERVAL_MS,
  SMART_CUT_MIN_WINDOW_MS,
  SMART_CUT_SEEK_TIMEOUT_MS,
} from './smart-cut.constants';
import type { WorkerRequest, WorkerResult, WorkerError } from './smart-cut.worker';

export interface ExtractionRequest {
  id: string;
  tBefore: number;        // seconds: anchor frame timestamp
  tAfterCenter: number;   // seconds: center of search window
  windowMs: number;       // half-window in ms (default 150)
  clipId: string;
}

export interface ExtractionResult {
  resumeOffsetMs: number;
  score: number;
  preThumb: Blob;
  postThumb: Blob;
}

export class SmartCutExtractor {
  constructor(
    private readonly video: HTMLVideoElement,
    private readonly worker: Worker,
  ) {}

  /** Factory for production use. Creates a hidden video + real worker. */
  static create(videoSrc: string): SmartCutExtractor {
    const video = document.createElement('video');
    video.src = videoSrc;
    video.muted = true;
    video.preload = 'auto';
    video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(video);

    const worker = new Worker(
      new URL('./smart-cut.worker', import.meta.url),
      { type: 'module' }
    );
    return new SmartCutExtractor(video, worker);
  }

  async extract(req: ExtractionRequest): Promise<ExtractionResult> {
    const halfMs = req.windowMs;

    // Clamp to keep buffer from adjacent speech
    const clampedStart = req.tAfterCenter - (halfMs - SMART_CUT_WORD_BUFFER_MS) / 1000;
    const clampedEnd   = req.tAfterCenter + (halfMs - SMART_CUT_WORD_BUFFER_MS) / 1000;

    const actualWindowMs = (clampedEnd - clampedStart) * 1000;
    if (actualWindowMs < SMART_CUT_MIN_WINDOW_MS) {
      throw new Error(`smart-cut: clamped window ${actualWindowMs}ms < min ${SMART_CUT_MIN_WINDOW_MS}ms`);
    }

    const candidateTimestamps: number[] = [];
    for (let t = clampedStart; t <= clampedEnd + 0.001; t += SMART_CUT_FRAME_INTERVAL_MS / 1000) {
      candidateTimestamps.push(parseFloat(t.toFixed(4)));
    }

    const anchor = await this.captureFrame(req.tBefore);
    const candidates: ImageBitmap[] = [];
    for (const t of candidateTimestamps) {
      candidates.push(await this.captureFrame(t));
    }

    return new Promise<ExtractionResult>((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<WorkerResult | WorkerError>) => {
        const data = event.data;
        if ('error' in data) { reject(new Error(data.error)); return; }
        resolve({
          resumeOffsetMs: data.resumeOffsetMs,
          score: data.score,
          preThumb: data.preThumb,
          postThumb: data.postThumb,
        });
      };

      const workerReq: WorkerRequest = {
        id: req.id,
        anchor,
        candidates,
        candidateTimestamps,
        centerTimestamp: req.tAfterCenter,
      };
      this.worker.postMessage(workerReq, [anchor, ...candidates]);
    });
  }

  destroy(): void {
    this.worker.terminate();
    this.video.removeEventListener('seeked', this._onSeeked);
    this.video.remove?.();
  }

  private _onSeeked: () => void = () => {};

  private captureFrame(timestamp: number): Promise<ImageBitmap> {
    return new Promise<ImageBitmap>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`seek timeout at ${timestamp}`)),
        SMART_CUT_SEEK_TIMEOUT_MS * 5,
      );

      const onSeeked = async () => {
        clearTimeout(timeout);
        this.video.removeEventListener('seeked', onSeeked);
        try {
          // OffscreenCanvas for frame capture at 64×64
          const canvas = new OffscreenCanvas(64, 64);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(this.video as unknown as CanvasImageSource, 0, 0, 64, 64);
          const bitmap = await createImageBitmap(canvas);
          resolve(bitmap);
        } catch (err) {
          reject(err);
        }
      };

      this.video.addEventListener('seeked', onSeeked);
      this.video.currentTime = timestamp;
    });
  }
}
