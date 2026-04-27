import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { PluginMeta, PipelineStep, PipelineOutput } from '../models/plugin.model';
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

  getOutputs(jobId: string): Observable<PipelineOutput> {
    return this.api.get<PipelineOutput>(`/plugins/pipeline/${jobId}/outputs`);
  }

  activateOutput(projectId: string, jobId: string, stepIndex: number): Observable<void> {
    return this.api.post<void>(`/plugins/pipeline/${jobId}/activate`, { projectId, stepIndex });
  }

  submitInput(requestId: string, response: { skipped: boolean; values: Record<string, unknown> }): Observable<{ ok: boolean }> {
    return this.api.post<{ ok: boolean }>(`/plugins/input/${requestId}`, response);
  }
}
