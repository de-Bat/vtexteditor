import { describe, it, expect, beforeEach } from 'vitest';
import { pipelineCacheService, clearPipelineCache } from './pipeline-cache.service';

describe('PipelineCacheService', () => {
  beforeEach(() => clearPipelineCache());

  it('returns null for unknown key', () => {
    expect(pipelineCacheService.get('no-such-key')).toBeNull();
  });

  it('has() returns false for unknown key', () => {
    expect(pipelineCacheService.has('no-such-key')).toBe(false);
  });

  it('stores and retrieves a value', () => {
    pipelineCacheService.set('k', { segments: [1, 2, 3] });
    expect(pipelineCacheService.get('k')).toEqual({ segments: [1, 2, 3] });
  });

  it('has() returns true after set', () => {
    pipelineCacheService.set('k', 42);
    expect(pipelineCacheService.has('k')).toBe(true);
  });

  it('overwrites existing entry', () => {
    pipelineCacheService.set('k', 'old');
    pipelineCacheService.set('k', 'new');
    expect(pipelineCacheService.get<string>('k')).toBe('new');
  });

  it('isolates keys', () => {
    pipelineCacheService.set('a', 1);
    pipelineCacheService.set('b', 2);
    expect(pipelineCacheService.get('a')).toBe(1);
    expect(pipelineCacheService.get('b')).toBe(2);
  });

  it('returns null after clearPipelineCache', () => {
    pipelineCacheService.set('k', 'v');
    clearPipelineCache();
    expect(pipelineCacheService.get('k')).toBeNull();
  });
});
