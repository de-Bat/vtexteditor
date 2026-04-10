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
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  checkCache(hash: string): Observable<CacheCheckResult> {
    return this.api.get<CacheCheckResult>(`/media/check/${hash}`);
  }
}
