import { Segment } from './segment.model';
import { MetadataEntry } from './segment-metadata.model';

export type EffectType = 'hard-cut' | 'fade' | 'cross-cut';

export interface CutRegion {
  id: string;
  wordIds: string[];
  startTime?: number; // Optional: for gaps without words
  endTime?: number;   // Optional: for gaps without words
  effectType: EffectType;
  effectTypeOverridden: boolean;
  effectDuration: number;
  durationFixed: boolean;
}

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
  language?: string;
}
