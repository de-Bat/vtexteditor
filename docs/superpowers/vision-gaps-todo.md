# Vision Feature — Remaining Gaps

Audit date: 2026-05-09. All blocking and non-blocking gaps resolved.

---

## Intentional Deviations (documented, not fixed)

### GAP-7 — Signal names differ from spec

Spec defines 7 specific signals; implementation uses `panelState` + flat signals. `session: signal<VisionSession | null>` absent.

**Decision:** Intentional — current approach cleaner, not worth retrofitting.

---

## Out of Scope (v1 — do not implement)

Per spec section 7:
- Multiple detection sessions per clip
- Object class filtering ("detect faces only")
- Real-time live preview during playback scrub
- Undo/redo for vision edits
- Persisting `VisionSession` to `project.json`
- Audio-aware masking
- Mobile layout for Vision Panel
- Cancellable track/export operations
