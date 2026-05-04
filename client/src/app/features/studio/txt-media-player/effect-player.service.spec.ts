// client/src/app/features/studio/txt-media-player/effect-player.service.spec.ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EffectPlayerService } from './effect-player.service';
import { SmartEffectService } from './smart-effect.service';
import { CutRegion } from '../../../core/models/cut-region.model';

function makeRegion(effectType: CutRegion['effectType'] = 'fade-in'): CutRegion {
  return { id: 'r1', wordIds: ['w0'], effectType, effectTypeOverridden: false, effectDuration: 200, durationFixed: false };
}

function mockSmartEffect(resolveWith: Awaited<ReturnType<SmartEffectService['resolve']>>) {
  return { resolve: vi.fn().mockResolvedValue(resolveWith) } as unknown as SmartEffectService;
}

describe('EffectPlayerService', () => {
  let svc: EffectPlayerService;

  beforeEach(() => {
    svc = new EffectPlayerService(mockSmartEffect({ effectType: 'clear-cut', durationMs: 0 }));
    vi.useFakeTimers();
  });

  afterEach(() => { vi.useRealTimers(); });

  describe('playEffect() return type → number (seekTo)', () => {
    it('clear-cut emits regionEnd immediately', async () => {
      const smartMock = mockSmartEffect({ effectType: 'clear-cut', durationMs: 0 });
      svc = new EffectPlayerService(smartMock);
      const region = makeRegion('clear-cut');
      let seekTo = -1;
      svc.playEffect(region, undefined, 5.5).subscribe(v => { seekTo = v; });
      await vi.runAllTimersAsync();
      expect(seekTo).toBe(5.5);
    });

    it('fade-in emits regionEnd after durationMs', async () => {
      const smartMock = mockSmartEffect({ effectType: 'fade-in', durationMs: 200 });
      svc = new EffectPlayerService(smartMock);
      const region = makeRegion('smart'); // resolves to fade-in via mock
      let seekTo = -1;
      svc.playEffect(region, {} as any, 8.0).subscribe(v => { seekTo = v; });
      await vi.advanceTimersByTimeAsync(200);
      expect(seekTo).toBe(8.0);
    });

    it('smart-cut with good cache hit emits regionEnd + resumeOffsetMs', async () => {
      const smartMock = mockSmartEffect({ effectType: 'smart-cut' as any, durationMs: 300, resumeOffsetMs: 0.025 });
      svc = new EffectPlayerService(smartMock);

      // Attach mock overlay canvas
      const canvas = { getContext: vi.fn(() => ({ drawImage: vi.fn() })) } as unknown as HTMLCanvasElement;
      svc.attachOverlayCanvas(canvas);

      // Attach mock video element
      const video = {
        currentTime: 10.0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLVideoElement;
      svc.attachElement(video as unknown as HTMLMediaElement);

      const region = makeRegion('smart');
      let seekTo = -1;
      svc.playEffect(region, {} as any, 10.5).subscribe(v => { seekTo = v; });
      await vi.runAllTimersAsync();
      // resumeOffsetMs = 0.025s → seekTo = 10.5 + 0.025 = 10.525
      expect(seekTo).toBeCloseTo(10.525, 3);
    });
  });

  describe('resetAll()', () => {
    it('sets videoOpacity to 1 and videoFilter to none', () => {
      svc.videoOpacity.set(0);
      svc.videoFilter.set('brightness(2)');
      svc.resetAll();
      expect(svc.videoOpacity()).toBe(1);
      expect(svc.videoFilter()).toBe('none');
    });
  });
});

describe('micro-fade — observable timing unchanged', () => {
  let svc: EffectPlayerService;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => { vi.useRealTimers(); });

  it('clear-cut still emits regionEnd synchronously', async () => {
    svc = new EffectPlayerService(mockSmartEffect({ effectType: 'clear-cut', durationMs: 0 }));
    const region = makeRegion('clear-cut');
    let seekTo = -1;
    svc.playEffect(region, undefined, 7.25).subscribe(v => { seekTo = v; });
    await vi.runAllTimersAsync();
    expect(seekTo).toBe(7.25);
  });

  it('fade-in still emits regionEnd after durationMs', async () => {
    svc = new EffectPlayerService(mockSmartEffect({ effectType: 'fade-in', durationMs: 300 }));
    const region = makeRegion('smart'); // mock resolves to fade-in
    let seekTo = -1;
    svc.playEffect(region, {} as any, 4.0).subscribe(v => { seekTo = v; });
    await vi.advanceTimersByTimeAsync(299);
    expect(seekTo).toBe(-1);
    await vi.advanceTimersByTimeAsync(1);
    expect(seekTo).toBe(4.0);
  });
});
