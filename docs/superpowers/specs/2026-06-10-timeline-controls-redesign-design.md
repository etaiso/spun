# Timeline controls redesign — YouTube-live layout

**Date:** 2026-06-10
**Status:** Approved (picked live in browser preview from three built variants)

## Problem

The timeshift controls rendered a centered `[−30] [LIVE] [+30]` cluster where
the LIVE pill's content swapped between `● Live` and `-01:23 · Live`. The
width change shifted the step buttons sideways on every state change (the
"jump"), the pill used the danger-red token against the design system's
status-dot convention, and the step buttons were plain text.

## Decision

YouTube-live layout, no step buttons:

```
[========== timeline (scrubber) ==========]
[● LIVE]                          −03:24
```

- **Timeline** (unchanged): full-width scrubber — click/drag to seek, song
  ticks, discontinuity gaps, hover tooltip with wall-clock · behind-live.
- **LIVE toggle**, pinned left under the bar: fixed content (`● LIVE`) in
  every state, so it can never change size. State is expressed by color only,
  per the app's status conventions (brand purple, not danger red):
  - at edge: purple-tinted pill (`bg-brand-purple/10 text-brand-purple`),
    `pulse-soft` dot, disabled;
  - behind: outlined (`border-line`, ink-3), hover → purple, click returns
    to live.
  A `border-transparent` on the at-edge state keeps both boxes identical.
- **Behind-live readout**, pinned right on the same row: `fmtBehind` output
  (`−03:24`, `−1:02:24`), 11px semibold `tabular-nums` ink-3. Fades
  (opacity transition) rather than unmounting, `aria-hidden` since the LIVE
  button's `aria-label` carries the same information.

Nothing in the row can shift: each end is independent, the toggle is
intrinsically fixed-size, and the readout's growth only consumes empty middle
space. Verified by comparing `getBoundingClientRect` of the LIVE button across
live/behind states — byte-identical.

±30 stepping survives via the existing keyboard shortcuts (J / L, Shift+L for
live) and OS media-session seek handlers in `Player.tsx`; the explicit −30/+30
buttons were removed by user decision in favor of seeking on the timeline.

## Alternatives considered

Three live variants were built and compared in the running app: (a) centered
cluster with ghost icon buttons + purple pill, (b) centered cluster with
outlined buttons + red pill, (c) split row. The user first leaned (a), then
chose to drop the step buttons entirely — final design is (c)'s split layout
with (a)'s purple pill styling and no step buttons.

## Changes

- `app/components/TimeshiftControls.tsx` — new layout; `LiveButton` +
  `BehindReadout` replace `LivePill`/`StepButton`; `onSeekBy` prop removed.
- `app/components/Player.tsx` — stops passing `onSeekBy`.

No behavioral changes to the engine, seeking, or keyboard shortcuts. No new
unit tests (purely presentational; lib formatting already covered by
`tests/timeshiftFormat.test.ts`).
