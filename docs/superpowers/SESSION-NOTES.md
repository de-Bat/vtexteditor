# Smart Cut — Session Notes (2026-04-29)

## Status: Ready to implement

Design approved. Plan written. Zero code written yet.

---

## Artifacts

| File | Purpose |
|------|---------|
| `docs/superpowers/specs/2026-04-29-smart-cut-design.md` | Full design spec (approved) |
| `docs/superpowers/plans/2026-04-29-smart-cut.md` | 12-task implementation plan |

---

## What the feature does

When playback hits a cut region:
1. Background worker already found best resume frame within ±150ms window (dHash pixel similarity)
2. Canvas overlay freezes on last pre-cut frame
3. Audio ramps down (60ms), video seeks to matched frame, audio ramps back up (200ms), overlay fades out
4. Result: ~260ms transition that looks like no cut happened

---

## How to continue

Open `docs/superpowers/plans/2026-04-29-smart-cut.md` and execute tasks top to bottom.

Invoke skill: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`

---

## Task summary (all 12 pending)

| # | Task | Key output |
|---|------|-----------|
| 1 | Constants + EffectType | `smart-cut.constants.ts`, add `'smart-cut'` to EffectType |
| 2 | Hash utilities (TDD) | `smart-cut-hash.ts` — dHash + Hamming |
| 3 | Web worker | `smart-cut.worker.ts` — compares frames, returns best offset + thumbnails |
| 4 | Cache service (TDD) | `smart-cut-cache.service.ts` — IndexedDB + LRU; install `fake-indexeddb` |
| 5 | Extractor (TDD) | `smart-cut-extractor.ts` — hidden video, seek, capture, post to worker |
| 6 | Queue service (TDD) | `smart-cut-queue.service.ts` — debounce 250ms, concurrency=1, status signal |
| 7 | SmartEffectService async | Make `resolve()` async; inject cache; add smart-cut branch |
| 8 | EffectPlayerService | `playSmartCut()` + overlay canvas; `playEffect()` returns `Observable<number>` |
| 9 | Component wiring | Overlay canvas, `applyJumpCut` fix, `queue.invalidate()` calls |
| 10 | Settings | `smartCutAutoUpgrade` + `smartCutWindowMs` signals (localStorage) |
| 11 | UI | Status dots, hover thumbnails, preview button, Shift+P, Frame Match pill |
| 12 | Tests + smoke | Full test run + 5 manual smoke tests |

---

## Critical implementation notes

**`playEffect()` return type changes** from `Observable<void>` → `Observable<number>` (seekTo).  
`applyJumpCut` in `txt-media-player-v2.component.ts` must change:
```typescript
// OLD
.subscribe({ complete: () => { this.effectInProgress.set(false); this.mediaPlayer.seek(end); }})
// NEW
.subscribe({ next: (seekTo) => { this.effectInProgress.set(false); this.mediaPlayer.seek(seekTo); }})
```

**`SmartEffectService.resolve()` becomes async** — all callers need `await` / `switchMap`.

**`SmartCutQueueService`** uses lazy extractor factory (one hidden video per clip ID):
```typescript
private extractorFactory = (clipId: string) => SmartCutExtractor.create(`/api/clips/${clipId}/stream`);
```

**Cache key format:** `${clip.id}|${region.id}|${tBefore.toFixed(4)}|${tAfterCenter.toFixed(4)}`

**Score thresholds:**
- < 12 → auto-promote `'smart'` → `'smart-cut'` (green dot)
- 12–24 → usable only if user explicitly picks `'smart-cut'` (yellow dot)
- > 24 → fallback to cross-cut (red dot)

---

## Test setup

- Runner: Vitest 4 via `ng test`
- Single file: `ng test --include="**/filename.spec.ts"`
- IDB tests: `fake-indexeddb` (installed in Task 4: `npm install --save-dev fake-indexeddb`)
- No TestBed — services instantiated directly with constructor overrides for DI mocking
