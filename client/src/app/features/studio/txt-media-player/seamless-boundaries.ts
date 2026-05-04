import { Word } from '../../../core/models/word.model';
import { SILENCE_SNAP_MIN_MS, SILENCE_SNAP_FRACTION } from './smart-cut.constants';

export interface SeamlessBoundaries {
  startTime: number;
  endTime: number;
}

export function computeSeamlessBoundaries(
  allWords: Word[],
  regionWordIds: string[],
): SeamlessBoundaries | null {
  if (!regionWordIds.length) return null;

  const regionSet = new Set(regionWordIds);
  const regionWords = allWords.filter(w => regionSet.has(w.id));
  if (!regionWords.length) return null;

  const regionStart = Math.min(...regionWords.map(w => w.startTime));
  const regionEnd   = Math.max(...regionWords.map(w => w.endTime));

  const outsideActive = allWords.filter(w => !regionSet.has(w.id) && !w.isRemoved);

  const wordBefore = outsideActive
    .filter(w => w.endTime <= regionStart)
    .sort((a, b) => b.endTime - a.endTime)[0];

  const wordAfter = outsideActive
    .filter(w => w.startTime >= regionEnd)
    .sort((a, b) => a.startTime - b.startTime)[0];

  const preSilenceMs  = wordBefore ? (regionStart - wordBefore.endTime) * 1000 : 0;
  const postSilenceMs = wordAfter  ? (wordAfter.startTime - regionEnd)  * 1000 : 0;

  const snapStart = (preSilenceMs >= SILENCE_SNAP_MIN_MS && wordBefore)
    ? wordBefore.endTime + (regionStart - wordBefore.endTime) * SILENCE_SNAP_FRACTION
    : regionStart;

  const snapEnd = (postSilenceMs >= SILENCE_SNAP_MIN_MS && wordAfter)
    ? regionEnd + (wordAfter.startTime - regionEnd) * SILENCE_SNAP_FRACTION
    : regionEnd;

  if (snapStart === regionStart && snapEnd === regionEnd) return null;

  return { startTime: snapStart, endTime: snapEnd };
}
