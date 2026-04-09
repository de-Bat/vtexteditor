import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { StoryEvent, StoryProposal } from '../../../core/models/story-proposal.model';

@Injectable({ providedIn: 'root' })
export class StoryApiService {
  private api = inject(ApiService);
  // ApiService prepends /api — so base path here is without /api
  private base = '/plugins/reconstruct2story';

  getProposal(projectId: string): Observable<StoryProposal> {
    return this.api.get<StoryProposal>(`${this.base}/proposal/${projectId}`);
  }

  commit(projectId: string, events: StoryEvent[]): Observable<{ clipCount: number }> {
    return this.api.post<{ clipCount: number }>(
      `${this.base}/commit/${projectId}`,
      { events },
    );
  }

  discard(projectId: string): Observable<{ ok: boolean }> {
    return this.api.delete<{ ok: boolean }>(`${this.base}/proposal/${projectId}`);
  }
}
