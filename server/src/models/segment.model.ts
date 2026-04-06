import { Word } from './word.model';

export interface Segment {
  id: string;
  clipId: string;
  startTime: number;
  endTime: number;
  text: string;
  words: Word[];
  /** Flat string tags, e.g. ["speaker:Alice", "topic:intro"] */
  tags: string[];
}
