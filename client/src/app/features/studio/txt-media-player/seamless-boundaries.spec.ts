import { describe, it, expect } from 'vitest';
import { computeSeamlessBoundaries } from './seamless-boundaries';
import { Word } from '../../../core/models/word.model';

function w(id: string, start: number, end: number, removed = false): Word {
  return { id, segmentId: 's1', text: id, startTime: start, endTime: end, isRemoved: removed };
}

describe('computeSeamlessBoundaries', () => {
  it('snaps both edges when silence >= 40ms on each side', () => {
    // pre-silence: 1.15 - 1.0 = 150ms → snap to 1.075
    // post-silence: 3.1 - 3.0 = 100ms → snap to 3.05
    const words = [w('a', 0, 1.0), w('b', 1.15, 2.0), w('c', 2.1, 3.0), w('d', 3.1, 4.0)];
    const result = computeSeamlessBoundaries(words, ['b', 'c']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(1.075, 4); // 1.0 + (1.15-1.0)*0.5
    expect(result!.endTime).toBeCloseTo(3.05, 4);    // 3.0 + (3.1-3.0)*0.5
  });

  it('returns null when both silences < 40ms (no snap useful)', () => {
    const words = [w('a', 0, 1.0), w('b', 1.01, 2.0), w('c', 2.01, 3.0), w('d', 3.01, 4.0)];
    expect(computeSeamlessBoundaries(words, ['b', 'c'])).toBeNull();
  });

  it('snaps only the pre-cut edge when only that silence >= 40ms', () => {
    // pre: 1.1 - 1.0 = 100ms → snap; post: 3.005 - 3.0 = 5ms → no snap
    const words = [w('a', 0, 1.0), w('b', 1.1, 2.0), w('c', 2.1, 3.0), w('d', 3.005, 4.0)];
    const result = computeSeamlessBoundaries(words, ['b', 'c']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(1.05, 4);  // snapped
    expect(result!.endTime).toBeCloseTo(3.0, 4);     // = regionEnd, no snap
  });

  it('snaps only the post-cut edge when only that silence >= 40ms', () => {
    // pre: 1.005 - 1.0 = 5ms → no snap; post: 3.1 - 3.0 = 100ms → snap
    const words = [w('a', 0, 1.0), w('b', 1.005, 2.0), w('c', 2.1, 3.0), w('d', 3.1, 4.0)];
    const result = computeSeamlessBoundaries(words, ['b', 'c']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(1.005, 4); // = regionStart, no snap
    expect(result!.endTime).toBeCloseTo(3.05, 4);    // snapped
  });

  it('ignores isRemoved words when finding adjacent words', () => {
    // w_a is removed; wordBefore should be w_b (active)
    // pre: 2.2 - 2.0 = 200ms → snap to 2.1
    const words = [w('wa', 0, 0.5, true), w('wb', 1.0, 2.0), w('wc', 2.2, 3.0), w('wd', 3.1, 4.0)];
    const result = computeSeamlessBoundaries(words, ['wc']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(2.1, 4);   // 2.0 + (2.2-2.0)*0.5
    expect(result!.endTime).toBeCloseTo(3.05, 4);    // 3.0 + (3.1-3.0)*0.5
  });

  it('handles cut at start of clip (no wordBefore) — only snaps endTime', () => {
    // no wordBefore → startTime unchanged (= regionStart = 0)
    // post: 1.2 - 1.0 = 200ms → snap to 1.1
    const words = [w('wa', 0, 1.0), w('wb', 1.2, 2.0)];
    const result = computeSeamlessBoundaries(words, ['wa']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(0, 4);    // no change
    expect(result!.endTime).toBeCloseTo(1.1, 4);    // 1.0 + 0.2*0.5
  });

  it('handles cut at end of clip (no wordAfter) — only snaps startTime', () => {
    // pre: 2.2 - 2.0 = 200ms → snap to 2.1; no wordAfter
    const words = [w('wa', 0, 2.0), w('wb', 2.2, 3.0)];
    const result = computeSeamlessBoundaries(words, ['wb']);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeCloseTo(2.1, 4);  // snapped
    expect(result!.endTime).toBeCloseTo(3.0, 4);    // no wordAfter → = regionEnd
  });

  it('returns null for empty regionWordIds', () => {
    expect(computeSeamlessBoundaries([w('a', 0, 1)], [])).toBeNull();
  });

  it('returns null when regionWordIds not found in allWords', () => {
    expect(computeSeamlessBoundaries([w('a', 0, 1)], ['nonexistent'])).toBeNull();
  });
});
