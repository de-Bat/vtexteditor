import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { PluginMeta, PipelineStep } from '../models/plugin.model';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

export interface PipelineRunResult {
  jobId: string;
}

@Injectable({ providedIn: 'root' })
export class PluginService {
  readonly plugins = signal<PluginMeta[]>([]);

  constructor(private api: ApiService) {}

  loadAll(): Observable<PluginMeta[]> {
    return this.api.get<PluginMeta[]>('/plugins').pipe(tap((p) => this.plugins.set(p)));
  }

  runPipeline(projectId: string, steps: PipelineStep[]): Observable<PipelineRunResult> {
    return this.api.post<PipelineRunResult>('/plugins/pipeline/run', { projectId, steps });
  }
}
