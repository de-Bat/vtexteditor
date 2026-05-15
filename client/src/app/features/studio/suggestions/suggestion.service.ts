import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Suggestion, SuggestOptions } from '../../../core/models/suggestion.model';
import { ClipService } from '../../../core/services/clip.service';
import { CutRegionService } from '../txt-media-player/cut-region.service';

@Injectable({ providedIn: 'root' })
export class SuggestionService {
  private readonly http = inject(HttpClient);
  private readonly clipService = inject(ClipService);
  private readonly cutRegionService = inject(CutRegionService);

  readonly _suggestions = signal<Suggestion[]>([]);
  readonly suggestions = this._suggestions.asReadonly();

  readonly status = signal<'idle' | 'running' | 'done' | 'error'>('idle');
  readonly error = signal<string | undefined>(undefined);

  readonly suggestedWordIds = computed(
    () => new Set(this._suggestions().flatMap((s) => s.wordIds))
  );

  runAnalysis(clipId: string, opts: SuggestOptions): void {
    this._suggestions.set([]);
    this.status.set('running');
    this.error.set(undefined);

    this.http
      .post<Suggestion[]>(`/api/clips/${clipId}/suggest-cuts`, {
        silenceThresholdMs: opts.silenceThresholdMs ?? 500,
        fillerLangs: opts.fillerLangs ?? ['en', 'he'],
        ollamaEnabled: opts.ollamaEnabled ?? true,
        ollamaModel: opts.ollamaModel ?? 'llama3:8b',
      })
      .subscribe({
        next: (results) => {
          this._suggestions.set(results.map((r) => ({ ...r, clipId })));
          this.status.set('done');
        },
        error: (err: { message?: string }) => {
          this.status.set('error');
          this.error.set(err?.message ?? 'Analysis failed');
        },
      });
  }

  accept(suggestionId: string): void {
    const suggestion = this._suggestions().find((s) => s.id === suggestionId);
    if (!suggestion) return;

    if (suggestion.wordIds.length > 0) {
      const clip = this.clipService.clips().find((c) => c.id === suggestion.clipId);
      if (clip) {
        const { clip: updatedClip } = this.cutRegionService.cut(clip, suggestion.wordIds, 'clear-cut');
        this.clipService.applyLocalUpdate(updatedClip);
        this.clipService.updateCutRegions(updatedClip.id, updatedClip.cutRegions ?? []).subscribe();
      }
    }

    this._suggestions.update((list) => list.filter((s) => s.id !== suggestionId));
  }

  reject(suggestionId: string): void {
    this._suggestions.update((list) => list.filter((s) => s.id !== suggestionId));
  }

  acceptAll(): void {
    const ids = this._suggestions().map((s) => s.id);
    ids.forEach((id) => this.accept(id));
  }

  acceptHighConfidence(threshold = 0.8): void {
    const ids = this._suggestions()
      .filter((s) => s.confidence >= threshold)
      .map((s) => s.id);
    ids.forEach((id) => this.accept(id));
  }

  dismissAll(): void {
    this._suggestions.set([]);
  }
}
