import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Project } from '../models/project.model';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProjectService {
  readonly project = signal<Project | null>(null);

  constructor(private api: ApiService) {}

  load(): Observable<Project> {
    return this.api.get<Project>('/project').pipe(tap((p) => this.project.set(p)));
  }

  update(partial: Partial<Project>): Observable<Project> {
    const current = this.project();
    if (!current) throw new Error('No project loaded');
    return this.api.put<Project>('/project', { ...current, ...partial }).pipe(
      tap((p) => this.project.set(p))
    );
  }
}
