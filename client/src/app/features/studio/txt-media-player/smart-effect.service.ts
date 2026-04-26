import { Injectable } from '@angular/core';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion, EffectType } from '../../../core/models/cut-region.model';

@Injectable({ providedIn: 'root' })
export class SmartEffectService {
  resolve(clip: Clip, region: CutRegion): { effectType: Exclude<EffectType, 'smart'>; durationMs: number } {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionWordSet = new Set(region.wordIds);
    const regionWords = allWords.filter(w => regionWordSet.has(w.id));

    if (!regionWords.length) return { effectType: 'clear-cut', durationMs: 0 };

    const regionStart = Math.min(...regionWords.map(w => w.startTime));
    const regionEnd = Math.max(...regionWords.map(w => w.endTime));
    const removedMs = (regionEnd - regionStart) * 1000;

    // Rule 1: cross-segment
    const segIds = new Set(regionWords.map(w => w.segmentId));
    if (segIds.size >= 2) return { effectType: 'cross-cut', durationMs: 350 };

    // Rule 2: sentence boundary
    if (regionWords.some(w => /[.!?]$/.test(w.text.trim()))) {
      return { effectType: 'cross-cut', durationMs: 300 };
    }

    // Rule 3: long pause
    if (removedMs >= 1500) return { effectType: 'fade-in', durationMs: 400 };

    // Rule 4: internal gap >= 0.6s
    for (let i = 1; i < regionWords.length; i++) {
      if ((regionWords[i].startTime - regionWords[i - 1].endTime) >= 0.6) {
        return { effectType: 'fade-in', durationMs: 250 };
      }
    }

    // Rule 5: short filler
    if (region.wordIds.length <= 2 && removedMs <= 600) {
      return { effectType: 'clear-cut', durationMs: 0 };
    }

    // Default
    return { effectType: 'clear-cut', durationMs: this.autoEffectDuration(removedMs) };
  }

  private autoEffectDuration(removedMs: number): number {
    return Math.max(150, Math.min(500, Math.round(removedMs * 0.1)));
  }
}
