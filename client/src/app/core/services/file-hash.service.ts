import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CacheCheckResult {
  exists: boolean;
}

@Injectable({ providedIn: 'root' })
export class FileHashService {
  private readonly api = inject(ApiService);

  async computeHash(file: File): Promise<string> {
    // For large files, loading the full content into memory causes OOM.
    // Instead, sample the first 2 MB + last 2 MB + file size.
    // This is sufficient for deduplication: two files with the same size and
    // identical head/tail bytes are virtually guaranteed to be the same file.
    const SAMPLE = 2 * 1024 * 1024; // 2 MB per sample

    let buffer: ArrayBuffer;
    if (file.size <= SAMPLE * 2) {
      buffer = await file.arrayBuffer();
    } else {
      const head = await file.slice(0, SAMPLE).arrayBuffer();
      const tail = await file.slice(file.size - SAMPLE).arrayBuffer();
      // Append an 8-byte little-endian representation of the file size so that
      // two files with the same head/tail bytes but different sizes don't collide.
      const combined = new Uint8Array(head.byteLength + tail.byteLength + 8);
      combined.set(new Uint8Array(head), 0);
      combined.set(new Uint8Array(tail), head.byteLength);
      new DataView(combined.buffer).setBigUint64(head.byteLength + tail.byteLength, BigInt(file.size), true);
      buffer = combined.buffer;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  checkCache(hash: string): Observable<CacheCheckResult> {
    return this.api.get<CacheCheckResult>(`/media/check/${hash}`);
  }
}
