# Timeline Scrubber UX (Drag + Size) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the timeshift timeline a real scrubber — always-visible 14px handle on a 6px bar, draggable with seek-on-release — per the approved spec `docs/superpowers/specs/2026-06-10-timeline-scrubber-ux-design.md`.

**Architecture:** A new pure state machine (`app/lib/timeshift/scrub.ts`) models the three display phases — `idle` (track engine playhead), `dragging` (track pointer), `settling` (hold drop position until the engine playhead lands, so the handle never flickers back). `TimeshiftControls.tsx` wires DOM pointer events (with pointer capture) to that machine and commits seeks through the existing `onSeekTo(wallClockMs)` callback. No engine/server changes.

**Tech Stack:** Next.js 16 (App Router, client component), React 19, Tailwind 4, Vitest (node env, pure-function tests in `tests/`).

---

## Before you start

- Work in this worktree. It has **no `node_modules`** yet:

```bash
npm install
npm test
```

Expected: install succeeds; the existing vitest suite passes (all green). If the baseline is red, stop and report — do not build on a broken baseline.

- **AGENTS.md note:** this repo runs a breaking-changes Next.js. The change touches only an existing `'use client'` component; before Task 2, skim `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` to confirm client-component conventions still match what the file already does (it does today — this is a confirm step, not a learn step).

## File structure

| File | Responsibility |
|---|---|
| `app/lib/timeshift/scrub.ts` (create) | Pure scrub state machine: which position the bar displays; when a release commits a seek. No DOM, no React. |
| `tests/timeshiftScrub.test.ts` (create) | Unit tests for the state machine. |
| `app/components/TimeshiftControls.tsx` (modify) | Pointer-event wiring, pointer capture, aria-valuetext, and the visual sizing (6px bar, 14px always-visible handle, 24px hit area). |

---

### Task 1: Pure scrub state machine

**Files:**
- Create: `app/lib/timeshift/scrub.ts`
- Test: `tests/timeshiftScrub.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/timeshiftScrub.test.ts` with exactly:

```ts
import { describe, it, expect } from 'vitest';
import {
  IDLE, SETTLE_TIMEOUT_MS, SETTLE_TOLERANCE_MS,
  scrubStart, scrubMove, scrubRelease, scrubCancel, scrubSettle, displayMs,
  type ScrubState,
} from '../app/lib/timeshift/scrub';

const T0 = 1_750_000_000_000; // arbitrary epoch-ms base

describe('scrub state machine', () => {
  it('starts dragging at the pointer position', () => {
    const s = scrubStart(T0);
    expect(s).toEqual({ phase: 'dragging', ms: T0 });
    expect(displayMs(s)).toBe(T0);
  });

  it('tracks pointer moves while dragging', () => {
    const s = scrubMove(scrubStart(T0), T0 + 5000);
    expect(displayMs(s)).toBe(T0 + 5000);
  });

  it('ignores moves when not dragging', () => {
    expect(scrubMove(IDLE, T0)).toBe(IDLE);
    const settling: ScrubState = { phase: 'settling', ms: T0, sinceMs: 0 };
    expect(scrubMove(settling, T0 + 1)).toBe(settling);
  });

  it('release commits the drop position and holds it (settling)', () => {
    const { next, commitMs } = scrubRelease(scrubStart(T0), 123);
    expect(commitMs).toBe(T0);
    expect(next).toEqual({ phase: 'settling', ms: T0, sinceMs: 123 });
    // the display keeps showing the drop position — no flicker back
    expect(displayMs(next)).toBe(T0);
  });

  it('release without a drag commits nothing', () => {
    expect(scrubRelease(IDLE, 123)).toEqual({ next: IDLE, commitMs: null });
  });

  it('cancel aborts without committing', () => {
    expect(scrubCancel()).toBe(IDLE);
  });

  it('settling releases once the playhead lands near the target', () => {
    const { next } = scrubRelease(scrubStart(T0), 0);
    expect(scrubSettle(next, T0 + SETTLE_TOLERANCE_MS - 1, 100)).toBe(IDLE);
  });

  it('keeps holding while the playhead is still far away', () => {
    const { next } = scrubRelease(scrubStart(T0), 0);
    // same reference back, so a React setState with it can bail out
    expect(scrubSettle(next, T0 + SETTLE_TOLERANCE_MS + 1, 100)).toBe(next);
  });

  it('settling releases on timeout even if the playhead never lands', () => {
    const { next } = scrubRelease(scrubStart(T0), 0);
    expect(scrubSettle(next, null, SETTLE_TIMEOUT_MS)).toBe(IDLE);
  });

  it('settle is a no-op outside the settling phase', () => {
    expect(scrubSettle(IDLE, T0, 0)).toBe(IDLE);
    const dragging = scrubStart(T0);
    expect(scrubSettle(dragging, T0, 0)).toBe(dragging);
  });

  it('display tracks the engine when idle', () => {
    expect(displayMs(IDLE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/timeshiftScrub.test.ts
```

Expected: FAIL — cannot resolve `../app/lib/timeshift/scrub` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `app/lib/timeshift/scrub.ts` with exactly:

```ts
// Pure state model for the timeline scrubber (drag-to-scrub, seek on
// release). The component owns DOM pointer events; this module owns which
// position the bar DISPLAYS and when a released drag commits a seek:
//   idle     — display tracks the engine playhead
//   dragging — display tracks the pointer; audio is untouched until release
//   settling — seek issued; display holds the drop position until the engine
//              playhead lands near it, so the handle never flickers back
export type ScrubState =
  | { phase: 'idle' }
  | { phase: 'dragging'; ms: number }
  | { phase: 'settling'; ms: number; sinceMs: number };

export const IDLE: ScrubState = { phase: 'idle' };

// Wider than the engine's live-enter band (LIVE_ENTER_SEC = 5 s): a drop
// near the live edge snaps to live, which can land the playhead several
// seconds past the literal target — that still counts as "landed".
export const SETTLE_TOLERANCE_MS = 8000;
// Safety valve so a failed or clamped seek can never freeze the display.
export const SETTLE_TIMEOUT_MS = 2000;

export function scrubStart(ms: number): ScrubState {
  return { phase: 'dragging', ms };
}

export function scrubMove(s: ScrubState, ms: number): ScrubState {
  return s.phase === 'dragging' ? { phase: 'dragging', ms } : s;
}

export function scrubRelease(
  s: ScrubState, nowMs: number,
): { next: ScrubState; commitMs: number | null } {
  if (s.phase !== 'dragging') return { next: s, commitMs: null };
  return { next: { phase: 'settling', ms: s.ms, sinceMs: nowMs }, commitMs: s.ms };
}

export function scrubCancel(): ScrubState {
  return IDLE;
}

/** Engine tick while settling. Returns the SAME object when nothing changes
 *  so a React setState with the result can bail out. */
export function scrubSettle(
  s: ScrubState, playheadMs: number | null, nowMs: number,
): ScrubState {
  if (s.phase !== 'settling') return s;
  const landed =
    playheadMs !== null && Math.abs(playheadMs - s.ms) < SETTLE_TOLERANCE_MS;
  const timedOut = nowMs - s.sinceMs >= SETTLE_TIMEOUT_MS;
  return landed || timedOut ? IDLE : s;
}

/** Wall-clock the bar should display, or null to track the engine playhead. */
export function displayMs(s: ScrubState): number | null {
  return s.phase === 'idle' ? null : s.ms;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/timeshiftScrub.test.ts
```

Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/timeshift/scrub.ts tests/timeshiftScrub.test.ts
git commit -m "feat(timeshift): pure scrub state model for drag-to-scrub"
```

---

### Task 2: Drag-to-scrub wiring in TimeshiftControls

**Files:**
- Modify: `app/components/TimeshiftControls.tsx` (imports + the `Timeline` function, currently lines 1–145; `TimeshiftControls`, `LiveButton`, `BehindReadout` are untouched)

- [ ] **Step 1: AGENTS.md compliance — skim the client-component guide**

Read `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`. Confirm the file's existing `'use client'` + named-export pattern is still correct. No code change expected from this step.

- [ ] **Step 2: Update the imports**

In `app/components/TimeshiftControls.tsx`, replace the two import lines:

```ts
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LIVE_ENTER_SEC, type TimeshiftState } from '@/app/lib/timeshift/engine';
```

with:

```ts
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LIVE_ENTER_SEC, type TimeshiftState } from '@/app/lib/timeshift/engine';
import { IDLE, displayMs, scrubCancel, scrubMove, scrubRelease, scrubSettle, scrubStart, type ScrubState } from '@/app/lib/timeshift/scrub';
```

- [ ] **Step 3: Replace the `Timeline` function**

Replace the entire `function Timeline(...) { ... }` with the version below. Behavior changes only — the visual classes/sizes are intentionally still today's (Task 3 changes them). What changed: pointer-down starts a captured drag instead of seeking; pointer-move feeds the drag (or the mouse hover preview, as today); pointer-up commits via `onSeekTo` (a click is just a zero-length drag); pointer-cancel aborts; the displayed fill/handle position comes from the scrub machine while it's active; `aria-valuetext` announces the displayed position.

```tsx
function Timeline({ state, onSeekTo, ticks, height }: {
  state: TimeshiftState; onSeekTo: (ms: number) => void;
  ticks: TimeshiftControlsProps['ticks']; height: number;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  // Scrub state lives in BOTH a ref and useState: pointer events stream
  // faster than renders, and pointerup must commit the exact position of the
  // last pointermove — a useState read from the event closure can be one
  // move stale. The ref is authoritative; the state mirror drives rendering.
  const [scrub, setScrubState] = useState<ScrubState>(IDLE);
  const scrubRef = useRef<ScrubState>(scrub);
  const setScrub = useCallback((next: ScrubState) => {
    if (next === scrubRef.current) return; // scrubSettle returns same ref on no-op
    scrubRef.current = next;
    setScrubState(next);
  }, []);

  const { bufferStartMs, liveEdgeMs, playheadMs, atLiveEdge } = state;
  const span = (liveEdgeMs ?? 0) - (bufferStartMs ?? 0);
  const frac = useCallback((ms: number) =>
    span > 0 ? Math.min(1, Math.max(0, (ms - (bufferStartMs ?? 0)) / span)) : 1,
    [bufferStartMs, span]);

  // Release the post-seek display hold once the engine playhead catches up.
  useEffect(() => {
    setScrub(scrubSettle(scrubRef.current, playheadMs, Date.now()));
  }, [playheadMs, setScrub]);

  const dispMs = displayMs(scrub);
  // The playhead trails the advancing live edge by decode latency, which would
  // leave a permanent unfilled tail — at LIVE the bar is simply full.
  const fillFrac = dispMs !== null
    ? frac(dispMs)
    : atLiveEdge ? 1 : frac(playheadMs ?? liveEdgeMs ?? 0);

  const pointOnBar = (e: ReactPointerEvent): { x: number; ms: number } | null => {
    const el = barRef.current;
    if (!el || bufferStartMs === null || liveEdgeMs === null) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    return { x, ms: bufferStartMs + (x / r.width) * span };
  };

  const onDown = (e: ReactPointerEvent) => {
    const p = pointOnBar(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(scrubStart(p.ms));
    setHover(p); // tooltip follows the drag for every pointer type
  };

  const onMove = (e: ReactPointerEvent) => {
    const p = pointOnBar(e);
    if (!p) return;
    if (scrubRef.current.phase === 'dragging') {
      setScrub(scrubMove(scrubRef.current, p.ms));
      setHover(p);
    } else if (e.pointerType === 'mouse') {
      setHover(p); // hover preview is a mouse affordance
    }
  };

  const onUp = (e: ReactPointerEvent) => {
    const { next, commitMs } = scrubRelease(scrubRef.current, Date.now());
    setScrub(next);
    if (commitMs !== null) onSeekTo(commitMs);
    if (e.pointerType !== 'mouse') setHover(null);
  };

  const onCancel = () => {
    setScrub(scrubCancel());
    setHover(null);
  };

  const onLeave = () => {
    // Pointer capture still delivers boundary events — keep the tooltip alive
    // mid-drag when the pointer strays off the bar.
    if (scrubRef.current.phase !== 'dragging') setHover(null);
  };

  // Clamp the tooltip inside the bar once its rendered width is known.
  useLayoutEffect(() => {
    const tip = tipRef.current, bar = barRef.current;
    if (!tip || !bar || hover === null) return;
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(hover.x, half), Math.max(half, bar.clientWidth - half));
    tip.style.left = `${x}px`;
  }, [hover]);

  // Show as soon as there's any buffer (even seconds) so the scrubber is present
  // from first load while it fills — frac() clamps to the live edge until then.
  if (bufferStartMs === null || liveEdgeMs === null) return null;
  const hoverBehindSec = hover ? Math.max(0, (liveEdgeMs - hover.ms) / 1000) : 0;
  const dispBehindSec = Math.max(0, (liveEdgeMs - (dispMs ?? playheadMs ?? liveEdgeMs)) / 1000);
  const shownLive = dispMs === null ? atLiveEdge : dispBehindSec < LIVE_ENTER_SEC;
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Rewind position"
      aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(fillFrac * 100)}
      aria-valuetext={shownLive ? 'Live' : `${fmtBehind(dispBehindSec)} behind live`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onPointerLeave={onLeave}
      className="relative w-full cursor-pointer group/tl"
      style={{ height: height + 8, paddingTop: 4, paddingBottom: 4 }}
    >
      {/* base track: the whole seekable buffer, always reads filled */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-brand-purple)]/20" style={{ height }}>
        {/* strong fill up to the displayed position (100% at LIVE) */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-[var(--color-brand-purple)]/55"
          style={{ width: `${fillFrac * 100}%` }}
        />
        {/* discontinuity breaks */}
        {state.discontinuities.map(g => (
          <div key={g.fromMs}
            className="absolute top-0 h-full bg-[var(--color-bg)]"
            style={{ left: `${frac(g.fromMs) * 100}%`, width: `${Math.max(0.5, (frac(g.toMs) - frac(g.fromMs)) * 100)}%` }} />
        ))}
        {/* song ticks */}
        {ticks.filter(t => t.atMs >= bufferStartMs && t.atMs <= liveEdgeMs).map(t => (
          <button
            key={t.atMs}
            title={t.title}
            aria-label={`Jump to ${t.title}`}
            onPointerDown={(e) => { e.stopPropagation(); onSeekTo(t.atMs - 3000); }}
            className="absolute top-1/2 -translate-y-1/2 w-[3px] h-[150%] rounded bg-[var(--color-brand-pink)]/70 hover:bg-[var(--color-brand-pink)] cursor-pointer"
            style={{ left: `${frac(t.atMs) * 100}%` }}
          />
        ))}
        {/* hover position line */}
        {hover && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-px h-[200%] bg-[var(--color-ink)]/50 pointer-events-none"
            style={{ left: hover.x }}
          />
        )}
        {/* playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--color-ink)] shadow opacity-0 group-hover/tl:opacity-100 transition-opacity"
          style={{ left: `calc(${fillFrac * 100}% - 5px)` }}
        />
      </div>
      {/* hover tooltip: broadcast wall-clock · behind-live */}
      {hover && (
        <div
          ref={tipRef}
          className="absolute bottom-full mb-1.5 -translate-x-1/2 px-2 py-1 rounded-md bg-[var(--color-ink)] text-[var(--color-bg)] text-[10px] font-semibold tabular-nums whitespace-nowrap pointer-events-none shadow-lg z-10"
          style={{ left: hover.x }}
        >
          {hoverBehindSec < LIVE_ENTER_SEC
            ? 'Live'
            : `${fmtWallClock(hover.ms)} · ${fmtBehind(hoverBehindSec)}`}
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer:

- The old `seekFromPointer` function is gone — do not leave it behind; `npm run lint` flags unused declarations.
- Song ticks still `stopPropagation()` on pointer-down, which is exactly what guarantees "a drag cannot start on a tick" (the container's `onDown` never fires).
- A tick press is followed by a pointer-up on the container; `scrubRelease` is in `idle` then and commits nothing — no double seek.

- [ ] **Step 4: Run the full suite + lint**

```bash
npm test
npm run lint
```

Expected: all tests PASS (component has no unit tests — the suite guards the scrub module and everything pre-existing); lint clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/TimeshiftControls.tsx
git commit -m "feat(timeshift): drag-to-scrub with seek-on-release on the timeline"
```

---

### Task 3: Visual sizing — 6px bar, 14px always-visible handle, 24px hit area

**Files:**
- Modify: `app/components/TimeshiftControls.tsx` (three small edits inside the code from Task 2)

- [ ] **Step 1: Bar height 4 → 6**

In the `TimeshiftControls` component (top of the file), change:

```tsx
<Timeline state={props.state} onSeekTo={props.onSeekTo} ticks={props.ticks} height={4} />
```

to:

```tsx
<Timeline state={props.state} onSeekTo={props.onSeekTo} ticks={props.ticks} height={6} />
```

- [ ] **Step 2: Hit area 12px → 24px, drop the hover-group**

In `Timeline`'s root `<div>`, change:

```tsx
      className="relative w-full cursor-pointer group/tl"
      style={{ height: height + 8, paddingTop: 4, paddingBottom: 4 }}
```

to:

```tsx
      className="relative w-full cursor-pointer"
      style={{ height: 24 }}
```

(The track and all children are absolutely centered with `top-1/2`, so the padding had no layout effect; the container height IS the pointer target. `group/tl` existed only to reveal the handle on hover — the handle is about to become permanent.)

- [ ] **Step 3: Handle — 14px, always visible, brand purple**

Change the playhead element:

```tsx
        {/* playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--color-ink)] shadow opacity-0 group-hover/tl:opacity-100 transition-opacity"
          style={{ left: `calc(${fillFrac * 100}% - 5px)` }}
        />
```

to:

```tsx
        {/* scrub handle — always visible, fixed size (spec: no hover growth) */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[var(--color-brand-purple)] shadow"
          style={{ left: `${fillFrac * 100}%` }}
        />
```

(`w-3.5` = 14px; centering via `-translate-x-1/2` replaces the manual `- 5px` offset, so the handle stays centered at any size.)

- [ ] **Step 4: Run suite + lint**

```bash
npm test
npm run lint
```

Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/TimeshiftControls.tsx
git commit -m "style(timeshift): bigger always-visible scrubber (6px bar, 14px handle)"
```

---

### Task 4: End-to-end verification in the running app

**Files:** none (verification only)

Per project memory: this worktree runs its OWN preview server with `autoPort` — never reuse another session's server on port 3000.

- [ ] **Step 1: Start the preview**

Use the `preview_start` tool on this worktree (auto port). Wait for the Next.js dev server to be ready.

- [ ] **Step 2: Get a buffered timeline**

In the app, start playing any MP3/AAC station (the default station list works). Let it play ~2 minutes so the RAM ring has a visible buffer and, ideally, one song-boundary tick appears.

- [ ] **Step 3: Verify with preview tools**

Check each item; use `preview_snapshot` / `preview_inspect` / `preview_click` and `preview_console_logs` after each interaction (no console errors allowed):

1. **Handle always visible:** without hovering, `preview_inspect` the playhead element — opacity 1, 14px (`w-3.5`), bar track height 6px, slider container height 24px.
2. **Drag lands where dropped:** drag the handle (pointer down → move left ~30% → up). The behind-live readout shows a non-zero `−mm:ss`, the LIVE pill dims, and audio position changes once, on release.
3. **No yank during drag:** hold a drag without releasing for ~5 s while live advances — the handle stays under the pointer.
4. **No flicker after release:** after pointer-up the handle stays at the drop position (settling hold), then tracks the engine.
5. **Click still seeks:** click (no drag) at ~50% of the bar — seeks there.
6. **Tick jump unchanged:** click a pink song tick — playback jumps to that song (tooltip shows its title on hover).
7. **Snap to live:** click the LIVE pill — bar fills to 100%, pill lights up.
8. **Tooltip at edges:** hover at the far-left and far-right of the bar — tooltip stays inside the bar and reads `wall-clock · −behind` (or `Live` at the right edge).

- [ ] **Step 4: Share proof**

`preview_screenshot` of the player with the new scrubber (mid-drag if possible) for the final report.

---

## Self-review (done during planning)

- **Spec coverage:** drag-with-capture → Task 2 `onDown`; seek-on-release & click-degenerates → `onUp`/`scrubRelease`; no-yank-during-drag → `displayMs` overriding `fillFrac`; hold-until-landed → `settling` + `scrubSettle` (tolerance 8 s covers near-live snap, 2 s timeout is the safety valve); ticks unchanged → preserved `stopPropagation`; hover unchanged → mouse-only path kept; 6px/14px/24px/no-growth → Task 3; `aria-valuetext` → Task 2; pure-helper tests → Task 1; e2e checks → Task 4.
- **Placeholders:** none — every code step shows the full code.
- **Type consistency:** `ScrubState`/`IDLE`/`scrubStart`/`scrubMove`/`scrubRelease`/`scrubCancel`/`scrubSettle`/`displayMs` identical across Task 1 tests, Task 1 implementation, and Task 2 imports/usage.
