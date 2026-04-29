// client/src/app/features/studio/txt-media-player/smart-effect.service.ts
import { Injectable, inject } from '@angular/core';
import { Clip } from '../../../core/models/clip.model';
import { CutRegion, EffectType } from '../../../core/models/cut-region.model';
import { SmartCutCacheService } from './smart-cut-cache.service';
import { SMART_CUT_AUTO_THRESHOLD, SMART_CUT_MAX_USABLE } from './smart-cut.constants';

export interface ResolvedEffect {
  effectType: Exclude<EffectType, 'smart'>;  // includes 'smart-cut' as a resolved target
  durationMs: number;
  resumeOffsetMs?: number;  // only present when effectType === 'smart-cut'
}

@Injectable({ providedIn: 'root' })
export class SmartEffectService {
  private readonly cache: SmartCutCacheService;

  constructor(cacheOverride?: SmartCutCacheService) {
    this.cache = cacheOverride ?? inject(SmartCutCacheService);
  }

  async resolve(clip: Clip, region: CutRegion): Promise<ResolvedEffect> {
    // Smart-cut: explicit or auto-upgraded from 'smart'
    if (region.effectType === 'smart-cut' || region.effectType === 'smart') {
      const cacheResult = await this.trySmartCut(clip, region);
      if (cacheResult) return cacheResult;
      if (region.effectType === 'smart-cut') {
        return { effectType: 'cross-cut', durationMs: 300 };
      }
      // fall through for 'smart' with no good cache hit
    }

    return this.resolveSync(clip, region);
  }

  private async trySmartCut(clip: Clip, region: CutRegion): Promise<ResolvedEffect | null> {
    const tBefore = this.getTBefore(clip, region);
    const tAfterCenter = this.getTAfterCenter(clip, region);
    if (tBefore === null || tAfterCenter === null) return null;

    const key = `${clip.id}|${region.id}|${tBefore.toFixed(4)}|${tAfterCenter.toFixed(4)}`;
    const cached = await this.cache.get(key);
    if (!cached) return null;

    const isAutoEligible = region.effectType === 'smart' && cached.score < SMART_CUT_AUTO_THRESHOLD;
    const isExplicit = region.effectType === 'smart-cut' && cached.score <= SMART_CUT_MAX_USABLE;
    if (!isAutoEligible && !isExplicit) return null;

    return { effectType: 'smart-cut' as Exclude<EffectType, 'smart'>, durationMs: 300, resumeOffsetMs: cached.resumeOffsetMs };
  }

  private resolveSync(clip: Clip, region: CutRegion): ResolvedEffect {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionWordSet = new Set(region.wordIds);
    const regionWords = allWords.filter(w => regionWordSet.has(w.id));

    if (!regionWords.length) return { effectType: 'clear-cut', durationMs: 0 };

    const regionStart = Math.min(...regionWords.map(w => w.startTime));
    const regionEnd = Math.max(...regionWords.map(w => w.endTime));
    const removedMs = (regionEnd - regionStart) * 1000;

    const segIds = new Set(regionWords.map(w => w.segmentId));
    if (segIds.size >= 2) return { effectType: 'cross-cut', durationMs: 350 };

    if (regionWords.some(w => /[.!?]$/.test(w.text.trim()))) {
      return { effectType: 'cross-cut', durationMs: 300 };
    }

    if (removedMs >= 1500) return { effectType: 'fade-in', durationMs: 400 };

    for (let i = 1; i < regionWords.length; i++) {
      if ((regionWords[i].startTime - regionWords[i - 1].endTime) >= 0.6) {
        return { effectType: 'fade-in', durationMs: 250 };
      }
    }

    if (region.wordIds.length <= 2 && removedMs <= 600) {
      return { effectType: 'clear-cut', durationMs: 0 };
    }

    return { effectType: 'clear-cut', durationMs: this.autoEffectDuration(removedMs) };
  }

  private getTBefore(clip: Clip, region: CutRegion): number | null {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionStart = region.startTime
      ?? Math.min(...region.wordIds.map(id => allWords.find(w => w.id === id)?.startTime ?? Infinity));
    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.endTime <= regionStart);
    return kept.length ? kept[kept.length - 1].endTime : null;
  }

  private getTAfterCenter(clip: Clip, region: CutRegion): number | null {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionEnd = region.endTime
      ?? Math.max(...region.wordIds.map(id => allWords.find(w => w.id === id)?.endTime ?? -Infinity));
    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.startTime >= regionEnd);
    return kept.length ? kept[0].startTime : null;
  }

  private autoEffectDuration(removedMs: number): number {
    return Math.max(150, Math.min(500, Math.round(removedMs * 0.1)));
  }
}
