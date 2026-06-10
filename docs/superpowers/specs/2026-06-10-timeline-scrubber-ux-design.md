# Timeline Scrubber UX (Drag + Size) — Design

**Date:** 2026-06-10
**Status:** Approved for planning

## Summary

Make the timeshift timeline a real scrubber: the handle is always visible,
sized to be grabbed, and **draggable** — audio seeks once, on release. Today
the timeline only supports click-to-seek, the bar is a slim 4px, and the
playhead is a 10px dot that appears only on hover, so scrubbing is neither
discoverable nor comfortable.

Chosen visual (from live variant review in the brainstorm companion):
**fixed sizes, no hover growth** — 6px bar, 14px always-visible handle.

## Scope

Only `app/components/TimeshiftControls.tsx` changes. The timeshift engine,
seek tiers, server routes, and the `onSeekTo(wallClockMs)` callback are
untouched — drag commits through the same API the click path already uses.
The LIVE pill, behind-live readout, song ticks, discontinuity gaps, and
keyboard shortcuts (`J`/`L`/`Shift+L`) keep their current behavior.

## Interaction

- **Drag-to-scrub, seek on release.** Pointer-down on the timeline starts a
  drag and takes pointer capture. While dragging, the handle and fill follow
  the pointer and the tooltip shows the existing `wall-clock · −behind`
  format; audio keeps playing at its current position. Pointer-up seeks to
  the drop position via `onSeekTo`.
- **While dragging, the displayed position is the scrub position**, not the
  engine playhead — engine state updates must not yank the handle during a
  drag. After release, the display holds the drop position until the
  engine's playhead reflects the seek (no flicker back to the old
  position), then resumes tracking engine state.
- **Click degenerates to today's behavior.** A pointer-down + up without
  movement is just a drag of zero distance: it seeks at that point. No
  separate click path.
- **Pointer capture** means the drag continues tracking (clamped to the bar)
  even when the pointer leaves the bar vertically; release anywhere commits.
- **Song ticks** keep click-to-jump (`startedAt − 3 s`) exactly as today; a
  drag cannot start on a tick.
- **Hover (not dragging)** keeps the current tooltip + position line.

## Visuals

- Bar height: 4px → **6px**. No hover/drag growth — sizes are constant.
- Handle: **14px, always visible** (replaces the 10px hover-only dot),
  brand-purple fill with a subtle shadow, vertically centered on the bar.
- Hit area: the pointer target stays ~24px tall (vertical padding around the
  6px bar), independent of the visual thickness.
- Everything else (colors, ticks, LIVE pill, readout, gaps) unchanged.

## Accessibility

- The container already has `role="slider"` with percent-based
  `aria-valuenow`; add **`aria-valuetext`** ("Live" / "2:34 behind live",
  via the existing `fmtBehind`) so screen readers announce position
  meaningfully.

## Testing

- Pointer → fraction → wall-clock mapping and clamping are already pure
  (`frac`, `pointOnBar`); they gain no new math. If drag state handling
  grows beyond trivial, extract it as a pure helper and unit-test per the
  project's reducer pattern.
- End-to-end verification in the running app via preview tools: drag lands
  where dropped, click-to-seek unchanged, handle doesn't jump during drag
  while live edge advances, tick jump still works, snap-to-live works,
  tooltip correct at both bar edges.

## Out of scope

- Buffer persistence across station switches — already works for tracked
  stations (disk rings); untracked stations starting empty is by design.
- Continuous seeking while dragging (audio chasing the handle) — rejected
  in favor of seek-on-release.
- Hover-growth animations — explicitly removed by user choice.
- Any change to step/keyboard seeking or Media Session handlers.
