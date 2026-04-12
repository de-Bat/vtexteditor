import { Segment } from './segment.model';
import { CutRegion } from './cut-region.model';
import { MetadataEntry } from './segment-metadata.model';

export interface Clip {
  id: string;
  projectId: string;
  name: string;
  startTime: number;
  endTime: number;
  segments: Segment[];
  cutRegions: CutRegion[];
  showSilenceMarkers?: boolean;
  /** Structured metadata entries for the entire clip */
  metadata?: Record<string, MetadataEntry[]>;
}
