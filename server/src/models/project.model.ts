import { Clip } from './clip.model';
import { PipelineStep } from './plugin.model';

export interface ProjectSummary {
  id: string;
  name: string;
  mediaPath: string;
  mediaType: 'video' | 'audio';
  mediaInfo: MediaInfo | null;
  pipelineConfig: PipelineStep[];
  createdAt: string;
  updatedAt: string;
  clipCount: number;
  segmentCount: number;
  wordCount: number;
  hasTranscription: boolean;
  transcriptionPlugin: string | null;
}

export interface EditAction {
  type: 'remove' | 'restore';
  wordIds: string[];
  timestamp: string; // ISO 8601
}

export interface MediaInfo {
  duration: number; // seconds
  format: string;   // e.g. "mp4"
  codec: string;
  videoCodec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  sampleRate?: number;
}

export interface Project {
  id: string;
  name: string;
  /** Relative path within storage/uploads/ */
  mediaPath: string;
  mediaType: 'video' | 'audio';
  mediaInfo: MediaInfo | null;
  clips: Clip[];
  pipelineConfig: PipelineStep[];
  editHistory: EditAction[];
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
