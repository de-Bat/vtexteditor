import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Project, ProjectSummary } from '../models/project.model';
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

  listAll(): Observable<ProjectSummary[]> {
    return this.api.get<ProjectSummary[]>('/projects');
  }

  open(id: string): Observable<Project> {
    return this.api.post<Project>(`/projects/${id}/open`, {}).pipe(
      tap((p) => this.project.set(p))
    );
  }

  deleteProject(id: string): Observable<void> {
    return this.api.delete<void>(`/projects/${id}`);
  }
}
