import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./ffmpeg.util', () => ({
  splitAudioTrack: vi.fn(),
}));

import { chunkAndTranscribe, adjustTimestamps, RawSegment } from './chunked-transcription.util';
import { splitAudioTrack } from './ffmpeg.util';

const mockSplit = vi.mocked(splitAudioTrack);

const seg = (start: number, end: number, text = 'hi'): RawSegment => ({ start, end, text });
const segWithWords = (start: number, end: number): RawSegment => ({
  start,
  end,
  text: 'hello world',
  words: [
    { word: 'hello', start, end: start + 0.5 },
    { word: 'world', start: start + 0.5, end },
  ],
});

describe('adjustTimestamps', () => {
  it('returns segments unchanged when offset is 0', () => {
    const segs = [seg(1, 2), seg(3, 4)];
    expect(adjustTimestamps(segs, 0)).toEqual(segs);
  });

  it('adds offset to segment start and end', () => {
    const result = adjustTimestamps([seg(1, 2)], 300);
    expect(result[0].start).toBe(301);
    expect(result[0].end).toBe(302);
  });

  it('adds offset to word timestamps', () => {
    const result = adjustTimestamps([segWithWords(0, 1)], 300);
    expect(result[0].words![0].start).toBe(300);
    expect(result[0].words![0].end).toBe(300.5);
    expect(result[0].words![1].start).toBe(300.5);
    expect(result[0].words![1].end).toBe(301);
  });

  it('handles segments without words', () => {
    const result = adjustTimestamps([seg(5, 10)], 100);
    expect(result[0].words).toBeUndefined();
  });
});

describe('chunkAndTranscribe', () => {
  beforeEach(() => {
    mockSplit.mockReset();
  });

  it('skips splitting when fileDurationSecs <= chunkDurationSecs', async () => {
    const transcribeFn = vi.fn().mockResolvedValue([seg(0, 5)]);

    const result = await chunkAndTranscribe(
      '/audio.wav',
      transcribeFn,
      { chunkDurationSecs: 300, maxConcurrent: 3 },
      120,
    );

    expect(mockSplit).not.toHaveBeenCalled();
    expect(transcribeFn).toHaveBeenCalledOnce();
    expect(transcribeFn).toHaveBeenCalledWith('/audio.wav');
    expect(result).toEqual([seg(0, 5)]);
  });

  it('calls splitAudioTrack when fileDurationSecs > chunkDurationSecs', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
      { path: '/chunk-1.wav', startOffset: 300, index: 1, isOriginal: false },
    ]);
    const transcribeFn = vi.fn()
      .mockResolvedValueOnce([seg(0, 5)])
      .mockResolvedValueOnce([seg(0, 10)]);

    const result = await chunkAndTranscribe(
      '/audio.wav',
      transcribeFn,
      { chunkDurationSecs: 300, maxConcurrent: 3 },
      700,
    );

    expect(mockSplit).toHaveBeenCalledWith('/audio.wav', 300);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(seg(0, 5));
    expect(result[1].start).toBe(300);
    expect(result[1].end).toBe(310);
  });

  it('calls splitAudioTrack when fileDurationSecs is not provided', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
    ]);
    const transcribeFn = vi.fn().mockResolvedValue([seg(1, 2)]);

    await chunkAndTranscribe('/audio.wav', transcribeFn, { chunkDurationSecs: 300, maxConcurrent: 3 });

    expect(mockSplit).toHaveBeenCalledWith('/audio.wav', 300);
  });

  it('merges results from all chunks in order', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
      { path: '/chunk-1.wav', startOffset: 300, index: 1, isOriginal: false },
      { path: '/chunk-2.wav', startOffset: 600, index: 2, isOriginal: false },
    ]);
    const transcribeFn = vi.fn()
      .mockResolvedValueOnce([seg(0, 10, 'first')])
      .mockResolvedValueOnce([seg(0, 10, 'second')])
      .mockResolvedValueOnce([seg(0, 10, 'third')]);

    const result = await chunkAndTranscribe(
      '/audio.wav',
      transcribeFn,
      { chunkDurationSecs: 300, maxConcurrent: 3 },
    );

    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('first');
    expect(result[1].start).toBe(300);
    expect(result[1].text).toBe('second');
    expect(result[2].start).toBe(600);
    expect(result[2].text).toBe('third');
  });

  it('respects maxConcurrent limit', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
      { path: '/chunk-1.wav', startOffset: 300, index: 1, isOriginal: false },
      { path: '/chunk-2.wav', startOffset: 600, index: 2, isOriginal: false },
      { path: '/chunk-3.wav', startOffset: 900, index: 3, isOriginal: false },
    ]);

    let concurrent = 0;
    let maxObserved = 0;

    const slowTranscribe = async (): Promise<RawSegment[]> => {
      concurrent++;
      maxObserved = Math.max(maxObserved, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return [];
    };

    await chunkAndTranscribe('/audio.wav', slowTranscribe, { chunkDurationSecs: 300, maxConcurrent: 2 });

    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it('throws when transcribeFn rejects', async () => {
    mockSplit.mockResolvedValue([
      { path: '/chunk-0.wav', startOffset: 0, index: 0, isOriginal: false },
    ]);
    const transcribeFn = vi.fn().mockRejectedValue(new Error('API down'));

    await expect(
      chunkAndTranscribe('/audio.wav', transcribeFn, { chunkDurationSecs: 300, maxConcurrent: 3 }),
    ).rejects.toThrow('API down');
  });
});
