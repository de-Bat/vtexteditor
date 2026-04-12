# Player V2 — Transcript Header/Footer Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore compact/polished transcript UI patterns from commit 552e982 (collapsible search, silence popover, icon-only smart cut, side label, chip-counts) into the current v2 player that has the full cut-region/effect system.

**Architecture:** Template-only changes in `txt-media-player-v2.component.ts` plus two new signals; one minimal SCSS addition (`chip-count`). All existing cut-region/effect logic and styles are untouched. The SCSS already contains all needed style rules from 552e982 — they just need the corresponding template elements.

**Tech Stack:** Angular 20 standalone components, signals, inline template

---

## Files

| File | Change |
|------|--------|
| `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts` | Add 2 signals; update template (4 targeted edits) |
| `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss` | Add `.chip-count` rule inside `.status-chip` |

---

## Task 1: Add `searchExpanded` and `silenceControlOpen` signals

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

- [ ] **Step 1: Locate the signals block**

Open the file and find the `/* ── Smart-Cut Signals ` section (around line 533). After `readonly smartCutOpen = signal(false);` add the two new signals.

- [ ] **Step 2: Add the signals**

Find this line:
```typescript
  /** Whether Smart Cut dropdown is open */
  readonly smartCutOpen = signal(false);
```

Replace with:
```typescript
  /** Whether Smart Cut dropdown is open */
  readonly smartCutOpen = signal(false);
  /** Whether the search input is expanded */
  readonly searchExpanded = signal(false);
  /** Whether the silence-interval popover is open */
  readonly silenceControlOpen = signal(false);
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat: add searchExpanded and silenceControlOpen signals to player v2"
```

---

## Task 2: Restore side label and content wrapper

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

The transcript `<section>` currently wraps its children directly. We need to add a 36px side label and a flex wrapper around the header/body/status-bar.

- [ ] **Step 1: Locate the transcript section opening**

Find this block (around line 197):
```html
  <!-- ═══════════ Right: Transcript Panel ═══════════ -->
  <section class="transcript-section">

    <!-- Header -->
    <div class="transcript-header">
```

- [ ] **Step 2: Add side label and open content wrapper**

Replace the block above with:
```html
  <!-- ═══════════ Right: Transcript Panel ═══════════ -->
  <section class="transcript-section">

    <!-- Vertical side label -->
    <div class="transcript-side-label"><span>TRANSCRIPT</span></div>

    <div class="transcript-content-wrapper">

    <!-- Header -->
    <div class="transcript-header">
```

- [ ] **Step 3: Close the content wrapper before the closing `</section>`**

Find (around line 493):
```html
  </section>
```

The line just before `</section>` is `</div>` (closing the `status-bar`). Replace the closing section sequence from:
```html
    </div>

  </section>
```
with:
```html
    </div>

    </div><!-- /.transcript-content-wrapper -->
  </section>
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat: restore transcript side label and content wrapper in player v2"
```

---

## Task 3: Update header row 1 — replace title group with icon badge

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

- [ ] **Step 1: Locate the title group**

Find this block (around line 203):
```html
      <div class="header-row1">
        <div class="hdr-title-group">
          <h2 class="transcript-title">Transcript</h2>
          <span class="auto-badge">AUTO-GEN</span>
        </div>
        <!-- Edit group -->
```

- [ ] **Step 2: Replace title group with icon badge + spacer**

Replace the block above with:
```html
      <div class="header-row1">
        <div class="hdr-group">
          <div class="auto-badge-icon" title="Auto-Generated Transcript">
            <span class="material-symbols-outlined">psychology</span>
          </div>
        </div>
        <div class="spacer"></div>
        <!-- Edit group -->
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat: replace transcript title group with icon badge in player v2 header"
```

---

## Task 4: Update header row 2 — collapsible search, silence popover, icon-only smart cut

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`

Replace the entire `header-row2` div (comment + opening `<div>` through its closing `</div>` at the end of row 2, which is the `</div>` on the line just before `</div>` that closes `transcript-header`).

- [ ] **Step 1: Locate the exact block to replace**

Find this exact string (around line 242 — starts at the row-2 comment, ends at the line that closes `header-row2`):
```html
      <!-- Row 2: search + silence interval + Smart Cut dropdown -->
      <div class="header-row2">
        <div class="search-wrap">
          <span class="material-symbols-outlined search-icon">search</span>
          <input
            type="text"
            class="search-input"
            placeholder="Search transcript..."
            [value]="searchQuery()"
            (input)="searchQuery.set($any($event.target).value)"
          />
        </div>
        <div class="silence-interval-wrap">
          <span class="material-symbols-outlined si-icon">timer</span>
          <input type="number" class="si-input" min="0.1" max="5" step="0.1"
            [value]="silenceIntervalSec()"
            (change)="silenceIntervalSec.set(+$any($event.target).value)"
            title="Min silence interval (sec)"
          />
          <span class="si-unit">s</span>
        </div>
        <!-- Smart Cut dropdown -->
        <div class="smart-cut-wrap">
          <button class="smart-cut-trigger" (click)="smartCutOpen.set(!smartCutOpen())" [class.open]="smartCutOpen()" title="Smart Cut">
            <span class="material-symbols-outlined">content_cut</span>
            Smart Cut
            <span class="material-symbols-outlined sc-caret">expand_more</span>
          </button>
          @if (smartCutOpen()) {
            <div class="smart-cut-dropdown" role="dialog" aria-label="Smart Cut options">
              <div class="sc-section-title">Filler Words — EN</div>
              <div class="sc-chips">
                @for (fw of FILLER_WORDS_EN; track fw) {
                  <button class="sc-chip" [class.selected]="selectedFillers().has(fw)" (click)="toggleFiller(fw)">{{ fw }}</button>
                }
              </div>
              <div class="sc-section-title sc-section-he">Filler Words — עב</div>
              <div class="sc-chips">
                @for (fw of FILLER_WORDS_HE; track fw) {
                  <button class="sc-chip sc-chip-he" [class.selected]="selectedFillers().has(fw)" (click)="toggleFiller(fw)">{{ fw }}</button>
                }
              </div>
              <div class="sc-toggles">
                <button class="sc-toggle" [class.active]="highlightFillers()" (click)="highlightFillers.set(!highlightFillers())" title="Highlight fillers">
                  <span class="material-symbols-outlined">visibility</span>
                  Fillers
                </button>
                <button class="sc-toggle" [class.active]="highlightSilence()" (click)="highlightSilence.set(!highlightSilence())" title="Highlight silence-adjacent words">
                  <span class="material-symbols-outlined">hourglass_empty</span>
                  Silence
                </button>
              </div>
              <button class="sc-apply-btn" (click)="applySmartCut()">Apply Smart Cut</button>
            </div>
          }
        </div>
        <!-- Effect type selector for new cuts -->
        <div class="effect-pills-wrap" role="group" aria-label="Default cut effect type">
          <button class="effect-pill" [class.active]="defaultEffectType() === 'hard-cut'"
            (click)="setDefaultEffect('hard-cut')" title="Hard Cut — instant remove">
            <span class="material-symbols-outlined" style="font-size:1rem">content_cut</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'fade'"
            (click)="setDefaultEffect('fade')" title="Fade — audio/video fade at cut boundary">
            <span class="material-symbols-outlined" style="font-size:1rem">blur_on</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'cross-cut'"
            (click)="setDefaultEffect('cross-cut')" title="Cross-Cut — audio crossfade (preview ≈ export)">
            <span class="material-symbols-outlined" style="font-size:1rem">shuffle</span>
          </button>
        </div>
      </div>
```

- [ ] **Step 2: Replace with the complete restored row 2**

Replace the entire block above with:

```html
      <!-- Row 2: search + silence + Smart Cut + effect pills -->
      <div class="header-row2">
        <!-- Collapsible search -->
        <div class="search-wrap" [class.expanded]="searchExpanded()">
          <button class="hdr-btn search-trigger" (click)="searchExpanded.set(!searchExpanded())" title="Search">
            <span class="material-symbols-outlined">search</span>
          </button>
          <input
            type="text"
            class="search-input"
            placeholder="Search transcript..."
            [value]="searchQuery()"
            (input)="searchQuery.set($any($event.target).value)"
          />
        </div>

        <div class="spacer"></div>

        <!-- Silence interval popover -->
        <div class="silence-control-wrap">
          <button class="hdr-btn" [class.active]="silenceControlOpen()"
            (click)="silenceControlOpen.set(!silenceControlOpen())" title="Min silence interval">
            <span class="material-symbols-outlined">timer</span>
          </button>
          @if (silenceControlOpen()) {
            <div class="silence-dropdown popover">
              <div class="si-header">
                <span class="si-label">Min Gap</span>
                <div class="si-value">
                  <input type="number" class="si-input" min="0.1" max="5" step="0.1"
                    [value]="silenceIntervalSec()"
                    (change)="silenceIntervalSec.set(+$any($event.target).value)"
                  />
                  <span class="si-unit">s</span>
                </div>
              </div>
              <input type="range" class="si-slider" min="0.1" max="5" step="0.1"
                [value]="silenceIntervalSec()"
                (input)="silenceIntervalSec.set(+$any($event.target).value)"
              />
            </div>
          }
        </div>

        <!-- Smart Cut (icon-only) -->
        <div class="smart-cut-wrap">
          <button class="hdr-btn" [class.active]="smartCutOpen()" (click)="smartCutOpen.set(!smartCutOpen())" title="Smart Cut">
            <span class="material-symbols-outlined">auto_fix_high</span>
          </button>
          @if (smartCutOpen()) {
            <div class="smart-cut-dropdown" role="dialog" aria-label="Smart Cut options">
              <div class="sc-section-title">Filler Words — EN</div>
              <div class="sc-chips">
                @for (fw of FILLER_WORDS_EN; track fw) {
                  <button class="sc-chip" [class.selected]="selectedFillers().has(fw)" (click)="toggleFiller(fw)">{{ fw }}</button>
                }
              </div>
              <div class="sc-section-title sc-section-he">Filler Words — עב</div>
              <div class="sc-chips">
                @for (fw of FILLER_WORDS_HE; track fw) {
                  <button class="sc-chip sc-chip-he" [class.selected]="selectedFillers().has(fw)" (click)="toggleFiller(fw)">{{ fw }}</button>
                }
              </div>
              <div class="sc-toggles">
                <button class="sc-toggle" [class.active]="highlightFillers()" (click)="highlightFillers.set(!highlightFillers())" title="Highlight fillers">
                  <span class="material-symbols-outlined">visibility</span>
                  Fillers
                </button>
                <button class="sc-toggle" [class.active]="highlightSilence()" (click)="highlightSilence.set(!highlightSilence())" title="Highlight silence-adjacent words">
                  <span class="material-symbols-outlined">hourglass_empty</span>
                  Silence
                </button>
              </div>
              <button class="sc-apply-btn" (click)="applySmartCut()">Apply Smart Cut</button>
            </div>
          }
        </div>

        <!-- Effect type selector for new cuts (unchanged) -->
        <div class="effect-pills-wrap" role="group" aria-label="Default cut effect type">
          <button class="effect-pill" [class.active]="defaultEffectType() === 'hard-cut'"
            (click)="setDefaultEffect('hard-cut')" title="Hard Cut — instant remove">
            <span class="material-symbols-outlined" style="font-size:1rem">content_cut</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'fade'"
            (click)="setDefaultEffect('fade')" title="Fade — audio/video fade at cut boundary">
            <span class="material-symbols-outlined" style="font-size:1rem">blur_on</span>
          </button>
          <button class="effect-pill" [class.active]="defaultEffectType() === 'cross-cut'"
            (click)="setDefaultEffect('cross-cut')" title="Cross-Cut — audio crossfade (preview ≈ export)">
            <span class="material-symbols-outlined" style="font-size:1rem">shuffle</span>
          </button>
        </div>
      </div>
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git commit -m "feat: restore collapsible search, silence popover, icon-only smart cut in player v2"
```

---

## Task 5: Update status bar — chip-count spans

**Files:**
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts`
- Modify: `client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss`

- [ ] **Step 1: Locate the status bar in the template** (around line 459)

Find:
```html
    <!-- Status Bar (replaces action footer) -->
    <div class="status-bar">
      @if (selectedCount()) {
        <span class="status-chip">
          <span class="material-symbols-outlined">select_all</span>
          {{ selectedCount() }} selected
        </span>
      }
      @if (removedCount()) {
        <span class="status-chip status-removed">
          <span class="material-symbols-outlined">content_cut</span>
          {{ removedCount() }} removed
        </span>
      }
      @if (jumpCutMode()) {
        <span class="status-chip status-mode">
          <span class="material-symbols-outlined">auto_awesome</span>
          Jump Cut
        </span>
      }
      @if (highlightFillers()) {
        <span class="status-chip status-filler">
          <span class="material-symbols-outlined">visibility</span>
          Fillers
        </span>
      }
      @if (highlightSilence()) {
        <span class="status-chip status-silence">
          <span class="material-symbols-outlined">hourglass_empty</span>
          Silence
        </span>
      }
    </div>
```

- [ ] **Step 2: Replace status bar content**

Replace the entire block above with:
```html
    <!-- Status Bar (replaces action footer) -->
    <div class="status-bar">
      @if (selectedCount()) {
        <span class="status-chip" [title]="selectedCount() + ' selected'">
          <span class="material-symbols-outlined">select_all</span>
          <span class="chip-count">{{ selectedCount() }}</span>
        </span>
      }
      @if (removedCount()) {
        <span class="status-chip status-removed" [title]="removedCount() + ' removed'">
          <span class="material-symbols-outlined">content_cut</span>
          <span class="chip-count">{{ removedCount() }}</span>
        </span>
      }
      @if (jumpCutMode()) {
        <span class="status-chip status-mode" title="Jump Cut Mode Active">
          <span class="material-symbols-outlined">auto_awesome</span>
        </span>
      }
      @if (highlightFillers()) {
        <span class="status-chip status-filler" title="Highlighting Fillers">
          <span class="material-symbols-outlined">visibility</span>
        </span>
      }
      @if (highlightSilence()) {
        <span class="status-chip status-silence" title="Highlighting Silence">
          <span class="material-symbols-outlined">hourglass_empty</span>
        </span>
      }
    </div>
```

- [ ] **Step 3: Add `.chip-count` rule to SCSS**

Open `txt-media-player-v2.component.scss`. Find the `.status-chip` block (around line 1213):
```scss
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--surface-container);
  font-family: 'Space Grotesk', sans-serif;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--on-surface-variant);

  .material-symbols-outlined {
    font-size: 12px;
  }
```

Add `.chip-count` inside the block, after the `.material-symbols-outlined` rule:
```scss
  .material-symbols-outlined {
    font-size: 12px;
  }

  .chip-count {
    font-variant-numeric: tabular-nums;
    min-width: 12px;
    text-align: center;
  }
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.ts
git add client/src/app/features/studio/txt-media-player-v2/txt-media-player-v2.component.scss
git commit -m "feat: restore chip-count spans in status bar and add chip-count SCSS rule"
```

---

## Acceptance Verification

After all tasks are complete, manually verify in the browser:

1. **Side label** — vertical "TRANSCRIPT" text visible on left edge of transcript panel.
2. **Search** — clicking the search icon expands the input with a smooth width animation; clicking again collapses it; typing filters words in the transcript.
3. **Silence popover** — clicking the timer icon opens a popover with a number input and a range slider; both controls update `silenceIntervalSec`; popover closes on re-click.
4. **Smart Cut button** — shows only the `auto_fix_high` icon (no text, no caret); clicking opens the existing filler-words dropdown unchanged.
5. **Status bar** — selected count and removed count show as `[icon] [number]` with tooltips; jump cut / fillers / silence chips show icon-only with tooltips.
6. **Effect system** — removing a word, clicking the filler badge to open the per-word effect popover, and changing effect type all work as before.
7. **Timeline overlays** — striped cut-region overlays still appear on the timeline for cuts with fade/cross-cut effect.
