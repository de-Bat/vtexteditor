import { Word } from './word.model';
import { SegmentMetadata } from './segment-metadata.model';

export interface Segment {
  id: string;
  clipId: string;
  startTime: number;
  endTime: number;
  text: string;
  words: Word[];
  /** Flat string tags, e.g. ["speaker:Alice", "topic:intro"] */
  tags: string[];
  /** Structured metadata entries, keyed by source plugin Id (or 'user') */
  metadata?: Record<string, SegmentMetadata[]>;
}
