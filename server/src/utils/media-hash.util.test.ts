import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');

import fs from 'fs';
import { computeMediaHash } from './media-hash.util';

const mockStatSync = vi.mocked(fs.statSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadSync = vi.mocked(fs.readSync);
const mockCloseSync = vi.mocked(fs.closeSync);

const SAMPLE = 2 * 1024 * 1024; // 2 MB

describe('computeMediaHash', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads full file when size <= 4 MB', async () => {
    const fakeData = Buffer.alloc(100, 0xab);
    mockStatSync.mockReturnValue({ size: 100 } as fs.Stats);
    mockReadFileSync.mockReturnValue(fakeData);

    const hash = await computeMediaHash('/small.wav');

    expect(mockReadFileSync).toHaveBeenCalledWith('/small.wav');
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64); // SHA-256 hex
  });

  it('uses head+tail sampling for large files', async () => {
    const largeSize = SAMPLE * 2 + 1000;
    mockStatSync.mockReturnValue({ size: largeSize } as fs.Stats);
    mockOpenSync.mockReturnValue(3 as unknown as number);
    mockReadSync.mockReturnValue(SAMPLE);
    mockCloseSync.mockReturnValue(undefined);

    const hash = await computeMediaHash('/large.mp4');

    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockOpenSync).toHaveBeenCalledWith('/large.mp4', 'r');
    // Two positional reads: head at offset 0, tail at offset (size - SAMPLE)
    expect(mockReadSync).toHaveBeenCalledTimes(2);
    expect(mockReadSync).toHaveBeenNthCalledWith(1, 3, expect.any(Buffer), 0, SAMPLE, 0);
    expect(mockReadSync).toHaveBeenNthCalledWith(2, 3, expect.any(Buffer), 0, SAMPLE, largeSize - SAMPLE);
    expect(mockCloseSync).toHaveBeenCalledWith(3);
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
  });

  it('produces different hashes for different small file contents', async () => {
    mockStatSync.mockReturnValue({ size: 10 } as fs.Stats);
    mockReadFileSync
      .mockReturnValueOnce(Buffer.alloc(10, 0xaa))
      .mockReturnValueOnce(Buffer.alloc(10, 0xbb));

    const h1 = await computeMediaHash('/file1.wav');
    const h2 = await computeMediaHash('/file2.wav');

    expect(h1).not.toBe(h2);
  });

  it('produces the same hash for the same content', async () => {
    const data = Buffer.alloc(50, 0x42);
    mockStatSync.mockReturnValue({ size: 50 } as fs.Stats);
    mockReadFileSync.mockReturnValue(data);

    const h1 = await computeMediaHash('/a.wav');
    const h2 = await computeMediaHash('/a.wav');

    expect(h1).toBe(h2);
  });
});
