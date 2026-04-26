export type EffectType = 'clear-cut' | 'fade-in' | 'cross-cut' | 'smart';

export interface CutRegion {
  id: string;
  wordIds: string[];
  startTime?: number;
  endTime?: number;
  effectType: EffectType;
  effectTypeOverridden: boolean;
  effectDuration: number;
  durationFixed: boolean;
  pending?: boolean;
  pendingKind?: 'add' | 'remove';
  pendingTargetId?: string;
  resolvedEffectType?: Exclude<EffectType, 'smart'>;
}
