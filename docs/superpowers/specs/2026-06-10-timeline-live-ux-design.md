# Timeshift Timeline — Netflix/YouTube-Live UX & Steady Offset — Design

**Date:** 2026-06-10
**Status:** Approved for planning

## Summary

Rework the timeshift scrubber to read like Netflix/YouTube Live: the bar is
**always visibly filled** edge to edge (no empty tail while at LIVE), with a
**strong fill up to the playhead** when rewound and a **hover tooltip** showing
the broadcast wall-clock time and behind-live offset at the hovered point.
Additionally, make the **behind-live readout steady** — today it wobbles a few
seconds back and forth every network burst.

All UI work is in `app/components/TimeshiftControls.tsx`; the offset fix is a
small change in `app/lib/timeshift/engine.ts`. No server changes.

## Problems being fixed

1. **Empty tail at LIVE.** Fill width is
   `(playheadMs − bufferStartMs) / (liveEdgeMs − bufferStartMs)`. The playhead
   always trails the advancing live edge by a few seconds of decode/buffer
   latency, so even with `atLiveEdge === true` the bar renders ~85–95% filled.
2. **No way to see what time a bar position corresponds to.** Seeking is
   blind; ticks have titles but the bar itself has no time feedback.
3. **Fluctuating behind-live offset.** `smoothLiveEdgeMs()` extrapolates
   `liveWallClock + elapsed`, but `pump()` re-anchors whenever
   `end > liveWallClock` — comparing fresh data stamps to the **last data
   stamp**, not the current **estimate** (`engine.ts:147-151`). Bursty delivery
   routinely lands stamps behind the extrapolation, yanking the displayed edge
   backwards; `behindSec` saw-tooths by 1–3 s.
4. **`fmtBehind` rounding bug.** `Math.round(sec % 60)` renders 119.6 s as
   `−01:60`.

## Design

### Bar rendering (TimeshiftControls.tsx)

- **Base track:** light brand tint (`brand-purple` at low opacity) instead of
  grey `--color-line` — the whole seekable buffer always reads as filled.
- **Strong fill:** higher-opacity brand tint from buffer start to the
  playhead. When `state.atLiveEdge` is true, width is forced to **100%**;
  otherwise `frac(playheadMs)`. Rewound position stays scannable.
- **Kept unchanged:** click-to-seek, song ticks (pink markers + own
  tooltips), discontinuity gaps, playhead dot on hover, ARIA slider
  semantics, the −30 / LIVE / +30 cluster.

### Hover tooltip (TimeshiftControls.tsx)

- On `pointermove` over the bar (mouse pointers only), compute hovered
  fraction → wall-clock ms; store in local React state. Hide on
  `pointerleave`. No libraries.
- Render a floating pill above the bar at the hovered x, **clamped** to the
  bar's horizontal bounds so it never overflows the container.
- Content: `14:32:05 · −3:24` — broadcast wall-clock (`HH:MM:SS`, locale
  time) plus behind-live at that point. Hours appear when behind exceeds an
  hour (`−1:02:24`). Within the live-enter threshold of the edge it shows
  `Live`.
- A thin vertical hover line marks the hovered spot on the bar
  (YouTube-style).
- Two styling variants will be shown in the worktree preview for the user to
  pick: (a) solid dark pill, (b) subtle bordered card.

### Steady offset (engine.ts)

In `pump()`, re-anchor the smoothed live edge only when fresh data is ahead
of the current estimate:

```ts
const est = this.liveWallClock + (performance.now() - this.livePerf);
if (end > est) { this.liveWallClock = end; this.livePerf = performance.now(); }
```

The displayed live edge becomes monotone, advancing at exactly 1× real time
and jumping only forward when real data genuinely outruns the estimate.
`behindSec` then only changes for real reasons (pause, seek, stall). The
initial anchor (`liveWallClock === 0`, incl. after disk-seek reset) still
takes the first burst because any epoch stamp exceeds a fresh
`performance.now()`-based estimate. `smoothLiveEdgeMs()` keeps its
`Math.max(est, newest)` guard (harmless; est ≥ newest becomes invariant).
Seeks/goLive continue to use `ring.endMs()` (real data), not the estimate.

### fmtBehind fix (TimeshiftControls.tsx)

Round **total seconds first**, then split into h/m/s. Shared by the LIVE
pill and the tooltip; hours segment only when ≥ 1 h.

## Edge cases

- Zero/near-zero span on first load → fill 100%, tooltip shows `Live`.
- Touch pointers: no hover tooltip; tap-to-seek unchanged.
- Tooltip at extreme left/right: clamped, never clipped.
- Stream stall while at live edge: estimate keeps advancing (correct — the
  station is live; we're falling behind), `behindSec` grows, hysteretic pill
  exits LIVE as today.

## Testing & verification

- Component is render-only and untested today; no new unit tests for JSX.
- `fmtBehind`/time-format helpers: small pure functions — add unit tests
  (`tests/`, vitest) covering the `−01:60` regression and hour formatting.
- Manual verification in this worktree's own preview (per user preference:
  isolated port): live-edge full fill, rewound two-tone fill, tooltip
  content/clamping, steady offset over ≥ 60 s of observation, both tooltip
  variants presented for selection.

## Addendum (verification discovery): physics-derived behindSec

Preview verification showed the monotone live edge alone does not stop the
readout wobble: the **playhead** side jitters too. The server stamps chunks
with `Date.now()` at receive (`stationTee.ts`), so timeMap anchors inherit
±0.5 s arrival jitter — and after a tee (re)connect, Icecast's
burst-on-connect delivers ~60 s of past audio that gets stamped into a few
seconds, making the raw behind-live value creep upward for the first minute
of playback (measured: 70.6 s of audio carrying 13.5 s of stamp span).

Added `app/lib/timeshift/behind.ts` (`BehindSmoother`, unit-tested): the
displayed `behindSec` advances by `Δwall − Δct` — exactly constant while
playing at 1×, +1 s/s while paused/stalled, instant on `currentTime` jumps
(window-tier seeks) — plus a slow exponential correction (τ = 15 s) toward
the raw stamp-derived value so persistent truth still wins, smoothly. Reset
on MediaSource rebuilds. Verified in preview: zero flicker; seeks land
instantly; burst-zone correction glides monotonically instead of sawtoothing.

**Follow-up (separate change):** stamp chunks by media time in the server tee
(root cause) — also improves song-tick/seek alignment inside burst zones.

## Out of scope

- Drag-scrubbing with live tooltip follow (bar currently seeks on
  pointer-down only; unchanged).
- Engine/state shape changes, server changes, mobile-specific hover
  affordances.
