import { dHash, hammingDistance } from './smart-cut-hash';

describe('dHash', () => {
  it('returns 0n for a flat uniform image (all pixels identical)', () => {
    const pixels = new Uint8Array(9 * 8).fill(128);
    expect(dHash(pixels)).toBe(0n);
  });

  it('returns same hash for identical inputs', () => {
    const pixels = new Uint8Array(9 * 8);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 17) % 256;
    expect(dHash(pixels)).toBe(dHash(new Uint8Array(pixels)));
  });

  it('returns a 64-bit value (≤ 0xFFFFFFFFFFFFFFFFn)', () => {
    const pixels = new Uint8Array(9 * 8);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 256;
    const h = dHash(pixels);
    expect(h).toBeGreaterThanOrEqual(0n);
    expect(h).toBeLessThanOrEqual(0xFFFF_FFFF_FFFF_FFFFn);
  });

  it('returns 0xFFFFFFFFFFFFFFFFn for strictly decreasing rows', () => {
    // Each pixel > right neighbour → every bit set
    const pixels = new Uint8Array(9 * 8);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 9; col++) {
        pixels[row * 9 + col] = 255 - col * 10;
      }
    }
    expect(dHash(pixels)).toBe(0xFFFF_FFFF_FFFF_FFFFn);
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance(0b1010n, 0b1010n)).toBe(0);
  });

  it('returns 1 for hashes differing by one bit', () => {
    expect(hammingDistance(0n, 1n)).toBe(1);
  });

  it('returns 64 for inverted 64-bit hash', () => {
    expect(hammingDistance(0n, 0xFFFF_FFFF_FFFF_FFFFn)).toBe(64);
  });

  it('returns 4 for hashes differing by 4 bits', () => {
    expect(hammingDistance(0b0000n, 0b1111n)).toBe(4);
  });
});
