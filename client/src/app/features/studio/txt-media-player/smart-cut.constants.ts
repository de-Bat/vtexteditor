import type { SceneType } from '../../../core/models/clip.model';

export const SMART_CUT_WINDOW_MS = 150;
export const SMART_CUT_FRAME_INTERVAL_MS = 16;
export const SMART_CUT_MIN_WINDOW_MS = 60;
export const SMART_CUT_MIN_REGION_MS = 100;
export const SMART_CUT_AUTO_THRESHOLD = 12;
export const SMART_CUT_MAX_USABLE = 24;
export const SMART_CUT_THUMB_WIDTH = 160;
export const SMART_CUT_THUMB_HEIGHT = 90;
export const SMART_CUT_THUMB_QUALITY = 0.6;
export const SMART_CUT_WORKER_TIMEOUT_MS = 10_000;
export const SMART_CUT_IDB_DB_NAME = 'vtextstudio-smart-cut';
export const SMART_CUT_IDB_STORE = 'results';
export const SMART_CUT_IDB_MAX_ENTRIES = 500;
export const SMART_CUT_IDB_MAX_BYTES = 50 * 1024 * 1024;
export const SMART_CUT_OVERLAY_FADE_MS = 200;
export const SMART_CUT_AUDIO_FADEOUT_MS = 60;
export const SMART_CUT_AUDIO_FADEIN_MS = 200;
export const SMART_CUT_SEEK_TIMEOUT_MS = 200;
export const SMART_CUT_DEBOUNCE_MS = 250;
export const SMART_CUT_PREVIEW_PREROLL_MS = 500;
export const SMART_CUT_PREVIEW_POSTROLL_MS = 500;
export const SMART_CUT_WORD_BUFFER_MS = 50;
export const SILENCE_SNAP_MIN_MS   = 40;
export const SILENCE_SNAP_FRACTION = 0.5;
export const CUT_MICRO_FADE_MS     = 30;

export interface SmartCutRoi {
  x: number;  // normalized 0–1 from left
  y: number;  // normalized 0–1 from top
  w: number;  // normalized 0–1 width
  h: number;  // normalized 0–1 height
}

export const SMART_CUT_ROI: Record<SceneType, SmartCutRoi | undefined> = {
  'talking-head': { x: 0.10, y: 0.00, w: 0.80, h: 0.60 },
  'two-shot': undefined,
};
