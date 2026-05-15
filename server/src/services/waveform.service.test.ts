import { describe, it, expect } from 'vitest';
import { waveformService } from './waveform.service';

describe('WaveformService.computePeaks', () => {
  it('returns empty array for empty samples', () => {
    const result = waveformService.computePeaks(new Int16Array(0));
    expect(result).toEqual([]);
  });

  it('normalizes peaks so maximum value is 1', () => {
    // 800 samples = 2 chunks of 400 at 8kHz/50ms
    const samples = new Int16Array(800);
    // chunk 0: all zeros (silence)
    // chunk 1: all max value 1000
    for (let i = 400; i < 800; i++) samples[i] = 1000;

    const peaks = waveformService.computePeaks(samples);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBe(0);   // silent chunk normalizes to 0
    expect(peaks[1]).toBe(1);   // loudest chunk normalizes to 1
  });

  it('produces one peak per 400 samples', () => {
    const samples = new Int16Array(2000).fill(500);
    const peaks = waveformService.computePeaks(samples);
    // 2000 / 400 = 5 chunks
    expect(peaks).toHaveLength(5);
  });

  it('handles partial final chunk', () => {
    // 600 samples = 1 full chunk (400) + 1 partial (200)
    const samples = new Int16Array(600).fill(300);
    const peaks = waveformService.computePeaks(samples);
    expect(peaks).toHaveLength(2);
    // Both chunks same amplitude → both normalize to 1
    expect(peaks[0]).toBeCloseTo(1);
    expect(peaks[1]).toBeCloseTo(1);
  });

  it('all-silence input returns all-zero peaks', () => {
    const samples = new Int16Array(800).fill(0);
    const peaks = waveformService.computePeaks(samples);
    // max is 0 → clamped to 1 → all peaks are 0/1 = 0
    expect(peaks.every(p => p === 0)).toBe(true);
  });
});
