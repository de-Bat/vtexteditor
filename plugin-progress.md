# Plugin Panel — Implementation Progress

## Status: READY TO EXECUTE (Task 1 not yet started)

## Branch & Worktree
- **Branch:** `feature/plugin-panel`
- **Worktree:** `.worktrees/plugin-panel` (baseline compiles clean)

## Key Design Decisions
- Remove Metadata button from studio header nav
- Add Plugins button (same `export-toggle-btn` style, puzzle-piece SVG icon)
- Plugin panel = right sidebar; collapsed 0px, expanded 400px (pipeline only) or 750px (pipeline + output viewer)
- Left column: vertical pipeline diagram with Angular CDK DnD reordering
- Right column: output viewer with Clips / Segments / Metadata tabs — only visible when a completed step node is selected
- Output actions: "Save to Notebook" (POST /api/notebooks) + "Use as Working Data" (activateOutput → reload clips)
- Notebook panel is a **separate future feature** — plugin panel only triggers save/activate, does not manage notebooks
- `metadataPanelOpen` decoupled from parent (was `input()` + `output()`) → becomes internal `signal(false)` in `TxtMediaPlayerV2Component`
- Panel width change driven by `outputPanelOpen` output event from `PluginPanelComponent` → `StudioComponent` sets `pluginsPanelWidth.set($event ? 750 : 400)`

## Artifacts
- **Spec:** `docs/superpowers/specs/2026-04-27-plugin-panel-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-27-plugin-panel.md`

## Task Status

| # | Task | Status |
|---|------|--------|
| 1 | Add `PluginStepOutput` + `PipelineOutput` to `plugin.model.ts` | ⬜ pending |
| 2 | Add `getOutputs()` + `activateOutput()` to `plugin.service.ts` | ⬜ pending |
| 3 | Decouple metadata panel from parent; remove Metadata header button | ⬜ pending |
| 4 | Create `PluginPanelComponent` (full code in plan) | ⬜ pending |
| 5 | Wire into `StudioComponent` (Plugins button, sidebar, resizer) | ⬜ pending |

## Resume Instructions

Tell Claude:

> "Continue plugin panel implementation. Plan: `docs/superpowers/plans/2026-04-27-plugin-panel.md`. Worktree: `.worktrees/plugin-panel`, branch: `feature/plugin-panel`. Use subagent-driven development. Start with Task 1."

## Execution Method
Subagent-driven development: fresh subagent per task, two-stage review (spec compliance → code quality) after each task before proceeding.
