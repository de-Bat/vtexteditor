/**
 * Compute dHash from a 9×8 grayscale pixel buffer (72 values, row-major).
 * For each row, compare pixel[col] > pixel[col+1] for col 0..7 → 64-bit hash.
 */
export function dHash(pixels: Uint8Array): bigint {
  let hash = 0n;
  let bit = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (pixels[row * 9 + col] > pixels[row * 9 + col + 1]) {
        hash |= (1n << bit);
      }
      bit++;
    }
  }
  return hash;
}

/** Hamming distance between two 64-bit hashes (number of differing bits). */
export function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}
