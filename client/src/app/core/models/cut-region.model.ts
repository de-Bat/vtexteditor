export type EffectType = 'hard-cut' | 'fade' | 'cross-cut';

export interface CutRegion {
  id: string;                   // crypto.randomUUID()
  wordIds: string[];            // ordered IDs of removed words (contiguous span within clip)
  effectType: EffectType;
  effectTypeOverridden: boolean; // true = user explicitly set; false = inherits global default
  effectDuration: number;       // ms; auto-calculated unless durationFixed
  durationFixed: boolean;       // true = user pinned, skip auto-recalc
}
