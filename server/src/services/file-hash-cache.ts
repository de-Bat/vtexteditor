const cache = new Map<string, string>();

export function lookupHash(hash: string): string | undefined {
  return cache.get(hash);
}

export function registerHash(hash: string, filePath: string): void {
  cache.set(hash, filePath);
}

/** Only for use in tests — clears all entries. */
export function clearCache(): void {
  cache.clear();
}
