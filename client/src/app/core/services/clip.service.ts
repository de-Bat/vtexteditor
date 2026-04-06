import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Clip } from '../models/clip.model';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ClipService {
  readonly clips = signal<Clip[]>([]);

  constructor(private api: ApiService) {}

  loadAll(): Observable<Clip[]> {
    return this.api.get<Clip[]>('/clips').pipe(tap((c) => this.clips.set(c)));
  }

  getById(id: string): Observable<Clip> {
    return this.api.get<Clip>(`/clips/${id}`);
  }

  updateWordStates(clipId: string, states: { id: string; isRemoved: boolean }[]): Observable<Clip> {
    return this.api.put<Clip>(`/clips/${clipId}/words`, { updates: states }).pipe(
      tap((updated) => {
        this.clips.update((list) => list.map((c) => (c.id === clipId ? updated : c)));
      })
    );
  }
}
