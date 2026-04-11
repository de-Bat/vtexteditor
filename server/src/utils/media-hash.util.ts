import { createHash } from 'crypto';
import fs from 'fs';

const SAMPLE = 2 * 1024 * 1024; // 2 MB — matches client-side FileHashService

/**
 * Compute a stable SHA-256 hash of a media file using head+tail sampling.
 * Algorithm matches the client-side FileHashService so that client-computed
 * and server-computed hashes are identical for the same file.
 *
 * Files <= 4 MB: full content is hashed.
 * Files > 4 MB:  first 2 MB + last 2 MB + 8-byte little-endian file size.
 */
export async function computeMediaHash(filePath: string): Promise<string> {
  const { size } = fs.statSync(filePath);

  if (size <= SAMPLE * 2) {
    const buffer = fs.readFileSync(filePath);
    return createHash('sha256').update(buffer).digest('hex');
  }

  const head = Buffer.alloc(SAMPLE);
  const tail = Buffer.alloc(SAMPLE);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, head, 0, SAMPLE, 0);
  fs.readSync(fd, tail, 0, SAMPLE, size - SAMPLE);
  fs.closeSync(fd);

  // 8-byte little-endian file size — prevents collision between files with
  // identical head/tail bytes but different total lengths.
  const sizeBytes = Buffer.alloc(8);
  sizeBytes.writeBigUInt64LE(BigInt(size), 0);

  return createHash('sha256')
    .update(head)
    .update(tail)
    .update(sizeBytes)
    .digest('hex');
}
