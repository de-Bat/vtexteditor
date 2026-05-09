export interface DetectedObject {
  id: string;
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, w, h] normalized 0–1
  maskEnabled: boolean;
  effect: 'blur' | 'inpaint' | 'fill';
  fillColor: string;
}

export interface VisionSession {
  projectId: string;
  clipId: string;
  frameTime: number;
  detectedObjects: DetectedObject[];
  trackingComplete: boolean;
  maskSessionId: string | null; // used to build maskOutputDir on server
  previewFrameUrl: string | null; // base64 data URL
}

export type VisionPanelState =
  | 'offline'
  | 'idle'
  | 'detecting'
  | 'detected'
  | 'tracking'
  | 'preview'
  | 'exporting'
  | 'export-done';

export interface TrackedRange {
  startSec: number;
  endSec: number;
}

export interface TrackSseEvent {
  type: 'progress' | 'complete' | 'error' | 'warning';
  percent?: number;
  phase?: string;
  framesProcessed?: number;
  totalFrames?: number;
  firstFrameIdx?: number;
  lastFrameIdx?: number;
  fps?: number;
  message?: string;
}

export interface ExportSseEvent {
  type: 'progress' | 'complete' | 'error';
  percent?: number;
  outputPath?: string;
  message?: string;
}
