import { Clip } from './clip.model';
import { MediaInfo } from './project.model';

export interface PipelineContext {
  projectId: string;
  /** Absolute path to the uploaded media file */
  mediaPath: string;
  mediaInfo: MediaInfo;
  clips: Clip[];
  /** Arbitrary metadata passed between plugins */
  metadata: Record<string, unknown>;
}
