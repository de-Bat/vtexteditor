export type TransitionEffect = 'hard-cut' | 'fade-to-black' | 'fade-to-white' | 'cross-dissolve' | 'dip-to-color';

export const TRANSITION_EFFECTS: TransitionEffect[] = [
  'hard-cut', 'fade-to-black', 'fade-to-white', 'cross-dissolve', 'dip-to-color',
];

export interface ClipTransition {
  id: string;
  fromClipId: string;
  toClipId: string;
  effect: TransitionEffect;
  durationMs: number;
  pauseMs: number;
  color?: string;
}
