import { Segment } from './segment.model';

export type EffectType = 'hard-cut' | 'fade' | 'cross-cut';

export interface CutRegion {
  id: string;
  wordIds: string[];
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
}
