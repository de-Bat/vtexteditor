export type TransitionEffect = 'hard-cut' | 'fade-to-black' | 'fade-to-white' | 'cross-dissolve' | 'dip-to-color';

export const TRANSITION_EFFECTS: TransitionEffect[] = [
  'hard-cut', 'fade-to-black', 'fade-to-white', 'cross-dissolve', 'dip-to-color',
];

export const TRANSITION_LABELS: Record<TransitionEffect, string> = {
  'hard-cut': 'Hard Cut',
  'fade-to-black': 'Fade to Black',
  'fade-to-white': 'Fade to White',
  'cross-dissolve': 'Cross Dissolve',
  'dip-to-color': 'Dip to Color',
};

export interface ClipTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  effect: TransitionEffect;
  durationMs: number;
  pauseMs: number;
  color?: string;
}
