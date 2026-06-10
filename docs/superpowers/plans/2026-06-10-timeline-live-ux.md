# Timeshift Timeline Live UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the timeshift scrubber read like Netflix/YouTube Live — always-filled bar, hover tooltip with broadcast time + behind-live offset — and make the behind-live readout steady (no sawtooth).

**Architecture:** Three small units. (1) `app/lib/timeshift/format.ts`: pure time-format helpers, unit-tested. (2) `app/lib/timeshift/liveEdge.ts`: a `LiveEdgeEstimator` class extracted from the engine's inline smoothing — monotone, re-anchors only when data outruns the estimate; unit-tested; engine delegates to it. (3) `app/components/TimeshiftControls.tsx`: rendering changes (tinted base track, fill forced to 100% at LIVE, hover tooltip + hover line). Spec: `docs/superpowers/specs/2026-06-10-timeline-live-ux-design.md`.

**Tech Stack:** Next.js / React 19 client components, Tailwind v4 CSS-variable classes, vitest (`npm test` = `vitest run`).

**Important:** The `−` character in all format strings below is U+2212 (minus sign), not an ASCII hyphen — it matches the existing `fmtBehind`. Copy code blocks exactly.

---

### Task 1: Time-format helpers (`fmtBehind` fix + `fmtWallClock`)

**Files:**
- Create: `app/lib/timeshift/format.ts`
- Create: `tests/timeshiftFormat.test.ts`
- Modify: `app/components/TimeshiftControls.tsx:14-17` (delete local `fmtBehind`, import instead)

- [ ] **Step 1: Write the failing tests**

Create `tests/timeshiftFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtBehind, fmtWallClock } from '../app/lib/timeshift/format';

describe('fmtBehind', () => {
  it('formats minutes:seconds zero-padded', () => {
    expect(fmtBehind(204)).toBe('−03:24');
  });
  it('rounds total seconds first (119.6 s is −02:00, not −01:60)', () => {
    expect(fmtBehind(119.6)).toBe('−02:00');
  });
  it('shows an hours segment past one hour', () => {
    expect(fmtBehind(3744)).toBe('−1:02:24');
  });
  it('clamps negatives to zero', () => {
    expect(fmtBehind(-3)).toBe('−00:00');
  });
});

describe('fmtWallClock', () => {
  it('renders a locale time with seconds', () => {
    expect(fmtWallClock(Date.UTC(2026, 5, 10, 14, 32, 5))).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/timeshiftFormat.test.ts`
Expected: FAIL — cannot resolve `../app/lib/timeshift/format`.

- [ ] **Step 3: Implement the helpers**

Create `app/lib/timeshift/format.ts`:

```ts
// Time formatting shared by the timeshift UI (LIVE pill, scrubber tooltip).

/** Behind-live offset, e.g. −03:24, or −1:02:24 past one hour. Rounds TOTAL
 *  seconds first — naive `round(sec % 60)` renders 119.6 as "−01:60". */
export function fmtBehind(sec: number): string {
  const total = Math.round(Math.max(0, sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ms = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `−${h}:${ms}` : `−${ms}`;
}

/** Broadcast wall-clock at an epoch ms, locale-formatted with seconds. */
export function fmtWallClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/timeshiftFormat.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Swap the component's local copy for the import**

In `app/components/TimeshiftControls.tsx`, delete the local function (lines 14–17):

```ts
function fmtBehind(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `−${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
```

and add to the imports at the top:

```ts
import { fmtBehind } from '@/app/lib/timeshift/format';
```

(`fmtWallClock` gets imported in Task 3 — don't add it yet, the linter flags unused imports.)

- [ ] **Step 6: Run the full suite + lint**

Run: `npm test` then `npm run lint`
Expected: all tests pass; lint clean.

- [ ] **Step 7: Commit**

```bash
git add app/lib/timeshift/format.ts tests/timeshiftFormat.test.ts app/components/TimeshiftControls.tsx
git commit -m "fix(timeshift): correct behind-live rounding (-01:60) and add hour support"
```

---

### Task 2: `LiveEdgeEstimator` — steady behind-live offset

The engine's smoothed live edge re-anchors whenever fresh data stamps exceed the *last data stamp* (`engine.ts:147-151`). Bursty delivery routinely lands stamps behind the *extrapolated estimate*, so the re-anchor yanks the displayed edge backwards → the −MM:SS readout sawtooths. Extract the smoothing into a pure, testable class that re-anchors only when data is ahead of the estimate.

**Files:**
- Create: `app/lib/timeshift/liveEdge.ts`
- Create: `tests/liveEdge.test.ts`
- Modify: `app/lib/timeshift/engine.ts` (imports ~line 12, fields 68–76, openStream ~line 133, pump 147–151, smoothLiveEdgeMs 353–362)

- [ ] **Step 1: Write the failing tests**

Create `tests/liveEdge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LiveEdgeEstimator } from '../app/lib/timeshift/liveEdge';

describe('LiveEdgeEstimator', () => {
  it('returns null before any data', () => {
    expect(new LiveEdgeEstimator().estimateAt(1_000)).toBeNull();
  });

  it('anchors on the first push', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    expect(e.estimateAt(1_000)).toBe(50_000);
  });

  it('advances at 1x real time between bursts', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    expect(e.estimateAt(3_500)).toBe(52_500);
  });

  it('does not regress when a burst arrives with lagging stamps', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);   // estimate at t=5000 → 54_000
    e.push(53_000, 5_000);   // stamps 1 s behind the estimate — must be ignored
    expect(e.estimateAt(5_000)).toBe(54_000);
    expect(e.estimateAt(6_000)).toBe(55_000); // still smooth afterwards
  });

  it('jumps forward when data outruns the estimate', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    e.push(56_000, 5_000);   // estimate was 54_000 — data ahead, re-anchor
    expect(e.estimateAt(5_000)).toBe(56_000);
  });

  it('is monotone across a mixed burst sequence', () => {
    const e = new LiveEdgeEstimator();
    let prev = -Infinity;
    const bursts: [number, number][] = [
      [50_000, 1_000], [50_900, 2_000], [53_500, 3_000], [53_600, 4_500], [58_000, 6_000],
    ];
    for (const [end, t] of bursts) {
      e.push(end, t);
      const est = e.estimateAt(t)!;
      expect(est).toBeGreaterThanOrEqual(prev);
      prev = est;
    }
  });

  it('reset forgets the anchor so a replayed stream can re-anchor lower', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    e.reset();
    expect(e.estimateAt(2_000)).toBeNull();
    e.push(10_000, 3_000);
    expect(e.estimateAt(3_000)).toBe(10_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/liveEdge.test.ts`
Expected: FAIL — cannot resolve `../app/lib/timeshift/liveEdge`.

- [ ] **Step 3: Implement the estimator**

Create `app/lib/timeshift/liveEdge.ts`:

```ts
/** Smoothed, monotone live-edge clock for DISPLAY purposes.
 *
 * Upstream (Icecast) delivers audio in ~6 s bursts, so "newest buffered
 * wall-clock" lurches forward in steps and sits flat between bursts. The
 * naive fix — extrapolate from the last burst by elapsed real time and
 * re-anchor on every arrival — REGRESSES whenever a burst's stamps lag the
 * extrapolation (network delay), which makes the behind-live readout wobble
 * a few seconds back and forth.
 *
 * This estimator advances at exactly 1× real time and re-anchors only when
 * fresh data is AHEAD of the current estimate: monotone within a stream,
 * jumping only forward. `reset()` is for re-opened (disk-seek) streams,
 * whose replayed history legitimately starts in the past.
 */
export class LiveEdgeEstimator {
  private anchorMs: number | null = null;
  private anchorPerf = 0;

  /** Feed the newest buffered wall-clock (epoch ms) as data arrives. */
  push(endMs: number, nowPerf: number): void {
    const est = this.estimateAt(nowPerf);
    if (est === null || endMs > est) {
      this.anchorMs = endMs;
      this.anchorPerf = nowPerf;
    }
  }

  /** Current estimate (epoch ms), or null before any data. */
  estimateAt(nowPerf: number): number | null {
    return this.anchorMs === null ? null : this.anchorMs + (nowPerf - this.anchorPerf);
  }

  /** Forget the anchor (stream re-opened from history). */
  reset(): void {
    this.anchorMs = null;
    this.anchorPerf = 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/liveEdge.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Wire the estimator into the engine**

All edits in `app/lib/timeshift/engine.ts`.

(a) Add to the import block (after `import { resolveSeek, ... }`):

```ts
import { LiveEdgeEstimator } from './liveEdge';
```

(b) Replace the two fields and their comment (lines 68–76):

```ts
  // Smoothed live-edge clock. Upstream (Icecast) delivers audio in bursts — a
  // ~6 s chunk lands at one instant, so ring.endMs() (newest arrival wall-clock)
  // lurches forward in 6 s steps and sits flat between bursts. Using it directly
  // makes "behind live" and the scrubber jump back and forth. Instead we track
  // the newest chunk's wall-clock plus the perf-clock moment it arrived, then
  // advance the live edge by real elapsed time — re-anchoring on each new burst
  // (which lands ~where the estimate already is, so no visible jump).
  private liveWallClock = 0;
  private livePerf = 0;
```

with:

```ts
  // Smoothed, monotone live-edge clock — see LiveEdgeEstimator for why naive
  // re-anchoring makes the behind-live readout sawtooth.
  private liveEdge = new LiveEdgeEstimator();
```

(c) In `openStream()`, replace (line ~133):

```ts
      this.liveWallClock = 0; // re-derived from the replayed frames below
```

with:

```ts
      this.liveEdge.reset(); // re-anchored from the replayed frames below
```

(d) In `pump()`, replace (lines ~147–151):

```ts
        const end = this.ring.endMs();
        if (end !== null && end > this.liveWallClock) {
          this.liveWallClock = end;
          this.livePerf = performance.now();
        }
```

with:

```ts
        const end = this.ring.endMs();
        if (end !== null) this.liveEdge.push(end, performance.now());
```

(e) Replace `smoothLiveEdgeMs()` (lines ~353–362):

```ts
  /** Live edge for DISPLAY (behind-live readout, scrubber right edge): the
   *  newest chunk's wall-clock advanced by real elapsed time, so bursty upstream
   *  delivery doesn't make the UI lurch. Never regresses below actual newest
   *  data. Seeks/goLive still use ring.endMs() (real data), not this estimate. */
  private smoothLiveEdgeMs(): number | null {
    const newest = this.ring.endMs();
    if (newest === null) return null;
    const est = this.liveWallClock + (performance.now() - this.livePerf);
    return Math.max(est, newest);
  }
```

with:

```ts
  /** Live edge for DISPLAY (behind-live readout, scrubber right edge):
   *  monotone 1×-real-time estimate (LiveEdgeEstimator), so bursty upstream
   *  delivery neither lurches nor regresses the UI. Never below actual newest
   *  data. Seeks/goLive still use ring.endMs() (real data), not this estimate. */
  private smoothLiveEdgeMs(): number | null {
    const newest = this.ring.endMs();
    if (newest === null) return null;
    const est = this.liveEdge.estimateAt(performance.now());
    return Math.max(est ?? newest, newest);
  }
```

- [ ] **Step 6: Verify no stale references remain**

Run: `npx tsc --noEmit` (or `npm run lint` if no tsc script) and grep:

```bash
grep -n "liveWallClock\|livePerf" app/lib/timeshift/engine.ts
```

Expected: no matches; type-check/lint clean.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests pass (including the 7 new ones).

- [ ] **Step 8: Commit**

```bash
git add app/lib/timeshift/liveEdge.ts tests/liveEdge.test.ts app/lib/timeshift/engine.ts
git commit -m "fix(timeshift): monotone live-edge estimate so behind-live offset stops fluctuating"
```

---

### Task 3: Timeline rework — always-filled bar + hover tooltip

**Files:**
- Modify: `app/lib/timeshift/engine.ts:22` (export `LIVE_ENTER_SEC`)
- Modify: `app/components/TimeshiftControls.tsx` (the `Timeline` function + imports)

- [ ] **Step 1: Export the live-enter threshold from the engine**

In `app/lib/timeshift/engine.ts` line 22, change:

```ts
const LIVE_ENTER_SEC = 5;
```

to:

```ts
export const LIVE_ENTER_SEC = 5; // exported: the scrubber tooltip shows "Live" inside this band
```

- [ ] **Step 2: Rewrite the `Timeline` component**

In `app/components/TimeshiftControls.tsx`:

(a) Replace the React import line with:

```ts
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
```

(b) Replace the engine type import with:

```ts
import { LIVE_ENTER_SEC, type TimeshiftState } from '@/app/lib/timeshift/engine';
```

(c) Extend the format import to:

```ts
import { fmtBehind, fmtWallClock } from '@/app/lib/timeshift/format';
```

(d) Replace the entire `Timeline` function with:

```tsx
function Timeline({ state, onSeekTo, ticks, height }: {
  state: TimeshiftState; onSeekTo: (ms: number) => void;
  ticks: TimeshiftControlsProps['ticks']; height: number;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  const { bufferStartMs, liveEdgeMs, playheadMs, atLiveEdge } = state;
  const span = (liveEdgeMs ?? 0) - (bufferStartMs ?? 0);
  const frac = useCallback((ms: number) =>
    span > 0 ? Math.min(1, Math.max(0, (ms - (bufferStartMs ?? 0)) / span)) : 1,
    [bufferStartMs, span]);
  // The playhead trails the advancing live edge by decode latency, which would
  // leave a permanent unfilled tail — at LIVE the bar is simply full.
  const fillFrac = atLiveEdge ? 1 : frac(playheadMs ?? liveEdgeMs ?? 0);

  const pointOnBar = (e: ReactPointerEvent): { x: number; ms: number } | null => {
    const el = barRef.current;
    if (!el || bufferStartMs === null || liveEdgeMs === null) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    return { x, ms: bufferStartMs + (x / r.width) * span };
  };

  const seekFromPointer = (e: ReactPointerEvent) => {
    const p = pointOnBar(e);
    if (p) onSeekTo(p.ms);
  };

  const onMove = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return; // hover tooltip is a mouse affordance
    setHover(pointOnBar(e));
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
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Rewind position"
      aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(fillFrac * 100)}
      onPointerDown={seekFromPointer}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      className="relative w-full cursor-pointer group/tl"
      style={{ height: height + 8, paddingTop: 4, paddingBottom: 4 }}
    >
      {/* base track: the whole seekable buffer, always reads filled */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-brand-purple)]/20" style={{ height }}>
        {/* strong fill up to the playhead (100% at LIVE) */}
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
- `seekFromPointer` now reuses `pointOnBar` — same math as before, deduplicated.
- The old grey base (`bg-[var(--color-line)]`) becomes a purple tint at /20; the old /40 played tint becomes /55 so the two shades are distinguishable.
- The playhead dot and `aria-valuenow` use `fillFrac` so both sit at 100% when LIVE.
- The tooltip is a sibling of the track (not a child) so it isn't clipped by the track's `rounded-full` box; `bottom-full` floats it above the bar.

- [ ] **Step 3: Lint + full test suite**

Run: `npm run lint` then `npm test`
Expected: clean / all pass.

- [ ] **Step 4: Commit**

```bash
git add app/components/TimeshiftControls.tsx app/lib/timeshift/engine.ts
git commit -m "feat(timeshift): always-filled live timeline with hover timestamp tooltip"
```

---

### Task 4: Preview verification + tooltip variant pick (user checkpoint)

Per user preference: this worktree runs its OWN preview on its own port (autoPort) — never reuse another session's server on 3000.

**Files:**
- Modify (temporarily, then finalize): `app/components/TimeshiftControls.tsx`

- [ ] **Step 1: Start the preview and play a station**

Use `preview_start` (autoPort). Open the app, click a station to start playback, wait ~20 s for the buffer to accumulate. Confirm the timeline renders.

- [ ] **Step 2: Verify the always-filled bar at LIVE**

`preview_screenshot` of the player area. Expected: bar visually filled edge-to-edge in the strong tint (no empty tail), LIVE pill red.

- [ ] **Step 3: Verify the steady offset**

Click −30 twice (rewind ~60 s), then sample the pill text every ~2 s for ~30 s via `preview_eval` (read the LIVE-pill button's `textContent`). Expected: the −MM:SS value ticks monotonically/steadily (no backward jumps, no ±2–3 s wobble). Record the sampled sequence in the verification notes.

- [ ] **Step 4: Verify the two-tone rewound bar + tooltip**

While rewound: screenshot shows strong fill up to the playhead and the lighter tint ahead of it. Trigger the tooltip by dispatching a synthetic pointer event on the slider element via `preview_eval`:

```js
const bar = document.querySelector('[aria-label="Rewind position"]');
const r = bar.getBoundingClientRect();
bar.dispatchEvent(new PointerEvent('pointermove', {
  bubbles: true, pointerType: 'mouse',
  clientX: r.left + r.width * 0.5, clientY: r.top + r.height / 2,
}));
```

Screenshot. Expected: tooltip pill above the bar reading `HH:MM:SS · −MM:SS`, thin vertical hover line at the midpoint. Repeat with `r.width * 0.02` and `r.width * 0.98` — tooltip stays fully inside the bar (clamped). Repeat at `0.999` — tooltip reads `Live`.

- [ ] **Step 5: Put up both tooltip styling variants and ask the user to pick**

Temporarily render a second tooltip below the bar with variant-B styling so both are visible while hovering (duplicate the tooltip JSX, swap `bottom-full mb-1.5` → `top-full mt-1.5` and the class set):

- Variant A (default, implemented): `bg-[var(--color-ink)] text-[var(--color-bg)] ... shadow-lg` — solid dark pill.
- Variant B: `bg-[var(--color-bg)] text-[var(--color-ink)] border border-[var(--color-line)] shadow-md` — subtle bordered card.

Screenshot both, then ask the user (AskUserQuestion) which to keep. **This is a user checkpoint — do not proceed without an answer.**

- [ ] **Step 6: Apply the choice and clean up**

Keep the chosen variant's classes on the single above-bar tooltip; delete the temporary duplicate. Re-run `npm run lint && npm test`.

- [ ] **Step 7: Final screenshot + commit**

Screenshot the final state (rewound, tooltip visible). Then:

```bash
git add app/components/TimeshiftControls.tsx
git commit -m "feat(timeshift): apply chosen tooltip variant"
```

(Skip the commit if variant A was chosen and nothing changed.)
