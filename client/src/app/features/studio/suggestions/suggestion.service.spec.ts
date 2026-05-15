import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { SuggestionService } from './suggestion.service';
import { CutRegionService } from '../txt-media-player/cut-region.service';
import { ClipService } from '../../../core/services/clip.service';
import { Clip } from '../../../core/models/clip.model';
import { Suggestion } from '../../../core/models/suggestion.model';

const MOCK_CLIP: Clip = {
  id: 'clip1',
  name: 'Test',
  startTime: 0,
  endTime: 10,
  segments: [{
    id: 'seg1', clipId: 'clip1', startTime: 0, endTime: 10,
    text: 'hello world', tags: [],
    words: [
      { id: 'w1', segmentId: 'seg1', text: 'hello', startTime: 0, endTime: 0.5, isRemoved: false },
      { id: 'w2', segmentId: 'seg1', text: 'world', startTime: 0.6, endTime: 1.0, isRemoved: false },
    ],
  }],
  cutRegions: [],
} as unknown as Clip;

const MOCK_SUGGESTION: Suggestion = {
  id: 'sug1',
  clipId: 'clip1',
  wordIds: ['w1'],
  text: 'hello',
  reason: 'filler-word',
  reasonLabel: 'Filler word',
  confidence: 0.9,
  source: 'speech',
};

describe('SuggestionService', () => {
  let service: SuggestionService;
  let http: HttpTestingController;
  let clipService: ClipService;
  let cutRegionService: CutRegionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SuggestionService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(SuggestionService);
    http = TestBed.inject(HttpTestingController);
    clipService = TestBed.inject(ClipService);
    cutRegionService = TestBed.inject(CutRegionService);
    clipService.clips.set([MOCK_CLIP]);
  });

  afterEach(() => http.verify());

  it('populates suggestions after runAnalysis', () => {
    service.runAnalysis('clip1', {});
    const req = http.expectOne('/api/clips/clip1/suggest-cuts');
    expect(req.request.method).toBe('POST');
    req.flush([MOCK_SUGGESTION]);
    expect(service.suggestions()).toEqual([MOCK_SUGGESTION]);
    expect(service.status()).toBe('done');
  });

  it('clears prior suggestions when runAnalysis is called again', () => {
    service.runAnalysis('clip1', {});
    http.expectOne('/api/clips/clip1/suggest-cuts').flush([MOCK_SUGGESTION]);
    expect(service.suggestions().length).toBe(1);

    service.runAnalysis('clip1', {});
    expect(service.suggestions()).toEqual([]);
    expect(service.status()).toBe('running');
    http.expectOne('/api/clips/clip1/suggest-cuts').flush([]);
  });

  it('sets status to error on HTTP failure', () => {
    service.runAnalysis('clip1', {});
    http.expectOne('/api/clips/clip1/suggest-cuts').error(new ProgressEvent('error'));
    expect(service.status()).toBe('error');
  });

  it('reject removes suggestion from list', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    service.reject('sug1');
    expect(service.suggestions()).toEqual([]);
  });

  it('accept calls cut and removes suggestion from list', () => {
    service['_suggestions'].set([MOCK_SUGGESTION]);
    clipService.clips.set([MOCK_CLIP]);
    const cutSpy = vi.spyOn(cutRegionService, 'cut').mockReturnValue({
      clip: MOCK_CLIP,
      entry: { kind: 'cut', regionAfter: {} as any, regionsBefore: [] },
    });
    vi.spyOn(clipService, 'updateCutRegions').mockReturnValue({ subscribe: () => {} } as any);

    service.accept('sug1');

    expect(cutSpy).toHaveBeenCalledWith(MOCK_CLIP, ['w1'], 'clear-cut');
    expect(service.suggestions()).toEqual([]);
  });

  it('acceptAll accepts every pending suggestion', () => {
    const s2: Suggestion = { ...MOCK_SUGGESTION, id: 'sug2', wordIds: ['w2'] };
    service['_suggestions'].set([MOCK_SUGGESTION, s2]);
    clipService.clips.set([MOCK_CLIP]);
    vi.spyOn(cutRegionService, 'cut').mockReturnValue({
      clip: MOCK_CLIP,
      entry: { kind: 'cut', regionAfter: {} as any, regionsBefore: [] },
    });
    vi.spyOn(clipService, 'updateCutRegions').mockReturnValue({ subscribe: () => {} } as any);

    service.acceptAll();
    expect(service.suggestions()).toEqual([]);
  });

  it('acceptHighConfidence only accepts suggestions at or above threshold', () => {
    const low: Suggestion = { ...MOCK_SUGGESTION, id: 'sug-low', confidence: 0.5 };
    const high: Suggestion = { ...MOCK_SUGGESTION, id: 'sug-high', confidence: 0.9 };
    service['_suggestions'].set([low, high]);
    clipService.clips.set([MOCK_CLIP]);
    vi.spyOn(cutRegionService, 'cut').mockReturnValue({
      clip: MOCK_CLIP,
      entry: { kind: 'cut', regionAfter: {} as any, regionsBefore: [] },
    });
    vi.spyOn(clipService, 'updateCutRegions').mockReturnValue({ subscribe: () => {} } as any);

    service.acceptHighConfidence(0.8);
    expect(service.suggestions().length).toBe(1);
    expect(service.suggestions()[0].id).toBe('sug-low');
  });
});
