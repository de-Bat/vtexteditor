# Design System Document

## 1. Overview & Creative North Star: "The Editorial Timeline"
The North Star for this design system is **"The Editorial Timeline."** We are moving away from the cluttered, "knobs-and-dials" look of legacy video editors and toward a high-end, editorial experience. The goal is to treat video transcription and editing with the same reverence as a prestige print magazine.

To break the "template" look, we utilize **Intentional Asymmetry**. Rather than a perfectly centered grid, we lean into wide margins for the transcript and condensed, high-density utility bars for the timeline. We emphasize **Tonal Depth** over lines—surfaces should feel like they are carved out of a single piece of obsidian, rather than boxes drawn on a screen.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a deep, nocturnal base (`background: #0e0e10`) to keep the user's focus entirely on the video content and text.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to section off the interface. No lines between the previewer, the transcript, and the timeline. 
- Boundaries are defined by shifting from `surface` to `surface-container-low` or `surface-container-high`.
- Use a 40px spacing gap (Vertical White Space) to denote major section breaks instead of a divider.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of "Synthetic Glass."
- **Base Layer:** `surface` (#0e0e10) - The primary workspace.
- **Sunken Content (The Transcript):** Use `surface-container-lowest` (#000000) to create a "well" for text entry.
- **Floating Utilities:** Use `surface-bright` (#2c2c2f) with a `backdrop-blur` for panels that sit above the timeline.

### The "Glass & Gradient" Rule
Main actions (Export, Cut, Process) should not be flat. Use a subtle linear gradient from `primary` (#ba9eff) to `primary_dim` (#8455ef) at a 135-degree angle. This provides a "holographic" depth that feels premium and intentional.

---

## 3. Typography: Precision & Character
We use a tri-font system to balance technical precision with editorial elegance.

*   **Display & Headlines (Manrope):** High-end and modern. Use `display-md` for project titles. The wide aperture of Manrope keeps the dark theme feeling airy.
*   **Body & Transcription (Inter):** The workhorse. Inter is chosen for its high X-height, essential for reading long-form transcripts. 
*   **Utility & Labels (Space Grotesk):** Use `label-md` for timecodes and technical metadata. Its mono-spaced feel suggests "technical precision" without being a boring typewriter font.

**Transcription Treatment:** 
- Active text: `on_surface` (#f6f3f5).
- 'Deleted' content: Use `tertiary_container` (#fd4e4d) as a background highlight with a `strikethrough` and 40% opacity on the text. This makes the "cut" feel like a physical strike on a film negative.

---

## 4. Elevation & Depth
Depth is achieved through **Tonal Layering**, not shadows.

*   **The Layering Principle:** To lift a card (e.g., a video clip thumbnail), place a `surface-container-high` element on top of a `surface-container-low` background. 
*   **Ambient Shadows:** For floating menus, use a shadow with a 32px blur, 0px offset, and 6% opacity using the `primary` color (#ba9eff) as the shadow tint. This creates a "glow" rather than a "drop shadow."
*   **The Ghost Border Fallback:** If a button needs to stand out against a similar surface, use a "Ghost Border": `outline_variant` (#48474a) at 15% opacity.

---

## 5. Components

### Buttons
*   **Primary (Action):** Gradient from `primary` to `primary_dim`. Roundedness: `md` (0.375rem). No border.
*   **Secondary (Utility):** `surface_container_highest` background with `on_surface` text.
*   **Tertiary (Destructive):** Text-only using `tertiary` (#ff716a), no container unless hovered.

### Transcription Blocks
*   **Active Word:** `primary_container` background with `on_primary_container` text. `sm` (0.125rem) corner radius to keep it sharp.
*   **Deleted Segment:** `error_container` (#a70138) at 20% opacity with a `strikethrough` across the `body-md` text.

### The Timeline (Custom Component)
*   **Playhead:** A 2px line of `secondary` (#9093ff) with a `surface_tint` glow.
*   **Clips:** Use `surface_container_high`. Separate clips with 2px of empty space (the background color) rather than a border.

### Input Fields
*   **Style:** Minimalist. No bottom line. Use `surface_container_low` as the fill. 
*   **Focus State:** The "Ghost Border" becomes 100% opacity `primary`.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use `spaceGrotesk` for all numbers (timecodes, frame rates). It ensures numerical alignment.
*   **Do** lean into `surface-container-lowest` for the main video preview area to make colors pop.
*   **Do** use `9999px` (full) roundedness for "Status" chips only (e.g., "Rendering," "Live").

### Don't:
*   **Don't** use 1px dividers. If you feel you need a line, use a 8px padding increase instead.
*   **Don't** use pure white (#FFFFFF) for text. Always use `on_surface` (#f6f3f5) to prevent eye strain in dark mode.
*   **Don't** use standard "Red" for errors. Use the calibrated `error` (#ff6e84) which is tuned for dark-theme vibrations.