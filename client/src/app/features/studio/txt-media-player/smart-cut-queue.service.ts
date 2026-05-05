import { Injectable, signal, inject, InjectionToken, Inject, Optional } from '@angular/core';
import { Clip, SceneType } from '../../../core/models/clip.model';
import { CutRegion } from '../../../core/models/cut-region.model';
import { SmartCutCacheService } from './smart-cut-cache.service';
import { SmartCutExtractor } from './smart-cut-extractor';
import { SMART_CUT_DEBOUNCE_MS, SMART_CUT_MAX_USABLE, SMART_CUT_ROI, SMART_CUT_WINDOW_MS } from './smart-cut.constants';

export type SmartCutStatus = 'queued' | 'computing' | 'done' | 'error' | 'unsupported';

export type ExtractorFactory = (clipId: string) => SmartCutExtractor;

export const SMART_CUT_CACHE_OVERRIDE = new InjectionToken<SmartCutCacheService>('SMART_CUT_CACHE_OVERRIDE');
export const SMART_CUT_EXTRACTOR_FACTORY = new InjectionToken<ExtractorFactory>('SMART_CUT_EXTRACTOR_FACTORY');

interface QueueItem { region: CutRegion; clip: Clip; }

@Injectable({ providedIn: 'root' })
export class SmartCutQueueService {
  private readonly statusMap = signal<Record<string, SmartCutStatus>>({});
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingQueue: QueueItem[] = [];
  private isProcessing = false;
  private readonly cache: SmartCutCacheService;
  private extractors = new Map<string, SmartCutExtractor>();
  private readonly extractorFactory: ExtractorFactory;
  private invalidatedRegions = new Set<string>();
  private pendingCacheChecks = new Map<string, QueueItem>();

  constructor(
    @Optional() @Inject(SMART_CUT_CACHE_OVERRIDE) cacheOverride?: SmartCutCacheService,
    @Optional() @Inject(SMART_CUT_EXTRACTOR_FACTORY) extractorFactoryOverride?: ExtractorFactory,
  ) {
    this.cache = cacheOverride ?? inject(SmartCutCacheService);
    this.extractorFactory = extractorFactoryOverride
      ?? ((clipId) => SmartCutExtractor.create(`/api/clips/${clipId}/stream`));
  }

  private getExtractor(clipId: string): SmartCutExtractor {
    if (!this.extractors.has(clipId)) {
      this.extractors.set(clipId, this.extractorFactory(clipId));
    }
    return this.extractors.get(clipId)!;
  }

  enqueue(region: CutRegion, clip: Clip): void {
    // Cancel any in-flight debounce or cache check for this region
    const existing = this.debounceTimers.get(region.id);
    if (existing) { clearTimeout(existing); this.debounceTimers.delete(region.id); }
    this.pendingCacheChecks.delete(region.id);

    const tBefore = this.getTBefore(clip, region);
    const tAfterCenter = this.getTAfterCenter(clip, region);

    if (tBefore === null || tAfterCenter === null) {
      this.updateStatus(region.id, 'unsupported');
      return;
    }

    const cacheKey = `${clip.id}|${region.id}|${tBefore.toFixed(4)}|${tAfterCenter.toFixed(4)}`;
    this.pendingCacheChecks.set(region.id, { region, clip });

    // Check cache before showing 'queued' — avoids blink when result is already computed
    this.cache.get(cacheKey).then(cached => {
      if (!this.pendingCacheChecks.has(region.id)) return; // superseded by newer call/invalidation
      this.pendingCacheChecks.delete(region.id);
      if (this.invalidatedRegions.has(region.id)) { this.invalidatedRegions.delete(region.id); return; }

      if (cached) {
        this.updateStatus(region.id, cached.score > SMART_CUT_MAX_USABLE ? 'error' : 'done');
        return;
      }

      this.scheduleExtraction(region, clip);
    }).catch(() => {
      if (!this.pendingCacheChecks.has(region.id)) return;
      this.pendingCacheChecks.delete(region.id);
      this.scheduleExtraction(region, clip);
    });
  }

  private scheduleExtraction(region: CutRegion, clip: Clip): void {
    this.updateStatus(region.id, 'queued');
    const timer = setTimeout(() => {
      this.debounceTimers.delete(region.id);
      this.pendingQueue.push({ region, clip });
      this.processNext();
    }, SMART_CUT_DEBOUNCE_MS);
    this.debounceTimers.set(region.id, timer);
  }

  invalidate(regionId: string): void {
    const timer = this.debounceTimers.get(regionId);
    if (timer) { clearTimeout(timer); this.debounceTimers.delete(regionId); }
    this.pendingCacheChecks.delete(regionId);
    this.pendingQueue = this.pendingQueue.filter(item => item.region.id !== regionId);
    const s = this.statusMap();
    const { [regionId]: _, ...rest } = s;
    this.statusMap.set(rest);
    this.invalidatedRegions.add(regionId);
  }

  invalidateClip(_clipId: string, regionIds: string[]): void {
    for (const regionId of regionIds) {
      this.invalidate(regionId);
    }
    // invalidate() adds each regionId to invalidatedRegions, but since we're
    // doing a full clip invalidation the caller will re-enqueue — remove from
    // the invalidated set so stale-guard doesn't suppress the new results.
    for (const regionId of regionIds) {
      this.invalidatedRegions.delete(regionId);
    }
  }

  getStatus(regionId: string): SmartCutStatus | null {
    return this.statusMap()[regionId] ?? null;
  }

  destroy(): void {
    this.extractors.forEach(extractor => extractor.destroy());
    this.extractors.clear();
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
    this.pendingCacheChecks.clear();
    this.pendingQueue = [];
  }

  readonly statusSignal = this.statusMap.asReadonly();

  private updateStatus(regionId: string, status: SmartCutStatus): void {
    this.statusMap.update(s => ({ ...s, [regionId]: status }));
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || !this.pendingQueue.length) return;
    this.isProcessing = true;
    const item = this.pendingQueue.shift()!;
    this.updateStatus(item.region.id, 'computing');

    try {
      const tBefore = this.getTBefore(item.clip, item.region);
      const tAfterCenter = this.getTAfterCenter(item.clip, item.region);

      if (tBefore === null || tAfterCenter === null) {
        if (!this.invalidatedRegions.has(item.region.id)) {
          this.updateStatus(item.region.id, 'unsupported');
        }
        this.invalidatedRegions.delete(item.region.id);
        return;
      }

      const cacheKey = `${item.clip.id}|${item.region.id}|${tBefore.toFixed(4)}|${tAfterCenter.toFixed(4)}`;
      const extractor = this.getExtractor(item.clip.id);

      const rawScene = item.region.sceneType ?? item.clip.sceneType ?? 'talking-head';
      const sceneType: SceneType = (rawScene === 'two-shot' ? 'two-shot' : 'talking-head') as SceneType;
      const roi = SMART_CUT_ROI[sceneType] ?? SMART_CUT_ROI['talking-head'];

      const result = await extractor.extract({
        id: item.region.id,
        tBefore,
        tAfterCenter,
        windowMs: SMART_CUT_WINDOW_MS,
        clipId: item.clip.id,
        roi,
      });

      if (!this.invalidatedRegions.has(item.region.id)) {
        const status: SmartCutStatus = result.score > SMART_CUT_MAX_USABLE ? 'error' : 'done';
        await this.cache.put(cacheKey, { ...result, computedAt: Date.now() });
        this.updateStatus(item.region.id, status);
      }
      this.invalidatedRegions.delete(item.region.id);
    } catch {
      if (!this.invalidatedRegions.has(item.region.id)) {
        this.updateStatus(item.region.id, 'error');
      }
      this.invalidatedRegions.delete(item.region.id);
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  private getTBefore(clip: Clip, region: CutRegion): number | null {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionStart = region.startTime
      ?? Math.min(...region.wordIds.map(id => allWords.find(w => w.id === id)?.startTime ?? Infinity));

    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.endTime <= regionStart);
    if (!kept.length) return null;
    return kept[kept.length - 1].endTime;
  }

  private getTAfterCenter(clip: Clip, region: CutRegion): number | null {
    const allWords = clip.segments.flatMap(s => s.words);
    const regionSet = new Set(region.wordIds);
    const regionEnd = region.endTime
      ?? Math.max(...region.wordIds.map(id => allWords.find(w => w.id === id)?.endTime ?? -Infinity));

    const kept = allWords.filter(w => !w.isRemoved && !regionSet.has(w.id) && w.startTime >= regionEnd);
    if (!kept.length) return null;
    return kept[0].startTime;
  }
}
