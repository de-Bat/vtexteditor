import { Segment } from './segment.model';

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  showSilenceMarkers?: boolean;
}
