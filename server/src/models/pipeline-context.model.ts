import { Clip } from './clip.model';
import { MediaInfo } from './project.model';
import { InputRequest, InputResponse } from './input-request.model';

export interface PipelineCache {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
}

export interface PipelineContext {
  projectId: string;
  /** Absolute path to the uploaded media file */
  mediaPath: string;
  mediaInfo: MediaInfo;
  /** SHA-256 head+tail hash of the media file — stable cache key ingredient */
  mediaHash: string;
  clips: Clip[];
  /** Arbitrary metadata passed between plugins */
  metadata: Record<string, unknown>;
  /** Generic key-value cache provided by the pipeline service */
  cache: PipelineCache;
  /** Callback to report granular progress updates (e.g. LLM streaming) */
  reportProgress?: (message: string, progress?: number, estimatedRemainingMs?: number) => void;
  /** Pause execution and ask the user for input via the processing panel */
  requestInput: (request: Omit<InputRequest, 'requestId' | 'pluginId'>) => Promise<InputResponse>;
}
