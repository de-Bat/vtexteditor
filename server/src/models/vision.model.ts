export interface DetectedObject {
  id: string;
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x, y, w, h] normalized 0-1
  maskEnabled: boolean;
  effect: 'blur' | 'inpaint' | 'fill';
  fillColor?: string;
  trackingId?: string;
}

export interface VisionDetectRequest {
  mediaPath: string;
  frameTime: number;
}

export interface VisionTrackRequest {
  mediaPath: string;
  frameTime: number;
  objects: Array<{ id: string; bbox: [number, number, number, number] }>;
  projectId: string;
  maskSessionId: string;
}

export interface VisionPreviewRequest {
  mediaPath: string;
  frameTime: number;
  projectId: string;
  maskSessionId: string;
  objects: Array<{ id: string; effect: string; fillColor: string | null }>;
}

export interface VisionExportRequest {
  mediaPath: string;
  projectId: string;
  exportId: string;
  maskSessionId: string;
  objects: Array<{ id: string; effect: string; fillColor: string | null }>;
}
