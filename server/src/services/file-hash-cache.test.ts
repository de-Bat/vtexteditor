import { describe, it, expect, beforeEach } from 'vitest';
import { lookupHash, registerHash, clearCache } from './file-hash-cache';

describe('file-hash-cache', () => {
  beforeEach(() => clearCache());

  it('returns undefined for unknown hash', () => {
    expect(lookupHash('abc123')).toBeUndefined();
  });

  it('returns filePath after registering a hash', () => {
    registerHash('abc123', '/storage/uploads/file.mp4');
    expect(lookupHash('abc123')).toBe('/storage/uploads/file.mp4');
  });

  it('overwrites an existing entry on re-register', () => {
    registerHash('abc123', '/storage/uploads/old.mp4');
    registerHash('abc123', '/storage/uploads/new.mp4');
    expect(lookupHash('abc123')).toBe('/storage/uploads/new.mp4');
  });

  it('isolates entries by hash', () => {
    registerHash('hash-a', '/a.mp4');
    registerHash('hash-b', '/b.mp4');
    expect(lookupHash('hash-a')).toBe('/a.mp4');
    expect(lookupHash('hash-b')).toBe('/b.mp4');
  });
});
