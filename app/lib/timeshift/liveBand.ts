/** Adaptive near-live band, sized to each station's measured delivery cadence.
 *
 * Icecast-style upstreams differ wildly: some burst ~6 s of audio at a time
 * (behind-live sawtooths 0–6 s at the edge, and positions closer than one
 * burst aren't playable without stalling), others pace continuously in
 * sub-second chunks. The LIVE enter/exit hysteresis used to be hardcoded to
 * the worst case (5/12 s), which needlessly collapses the readout to "Live"
 * on smooth stations where parking at −00:01 is genuinely possible.
 *
 * This estimator watches data-arrival times and derives the band from the
 * largest recent inter-arrival gap. It only ever NARROWS from the defaults:
 * adaptation starts after a minimum observation period, an arrival drought
 * counts as a gap immediately (so a stalling station snaps back to the wide
 * band), and old spikes age out of a rolling window so a transient hiccup
 * doesn't pin the band wide forever.
 */
export const LIVE_ENTER_SEC = 5; // default band — also the adaptive ceiling
export const LIVE_EXIT_SEC = 12;

const MIN_ENTER_SEC = 0.8;       // floor: keeps the pill steady through sub-second jitter
const GAP_MARGIN_SEC = 0.5;      // headroom above the measured worst gap
const EXIT_RATIO = LIVE_EXIT_SEC / LIVE_ENTER_SEC; // preserve the default hysteresis shape
const WINDOW_MS = 120_000;       // gap spikes older than this stop counting
const MIN_OBSERVED_MS = 30_000;  // stay at defaults until the cadence is established

export type LiveBand = { enterSec: number; exitSec: number };

export class LiveBandEstimator {
  private gaps: Array<{ t: number; gapMs: number }> = [];
  private firstPushMs: number | null = null;
  private lastPushMs: number | null = null;

  /** Record a data arrival (performance.now() ms). */
  push(nowPerfMs: number): void {
    if (this.lastPushMs === null) {
      this.firstPushMs = nowPerfMs;
    } else {
      this.gaps.push({ t: nowPerfMs, gapMs: nowPerfMs - this.lastPushMs });
      while (this.gaps.length && this.gaps[0].t < nowPerfMs - WINDOW_MS) this.gaps.shift();
    }
    this.lastPushMs = nowPerfMs;
  }

  /** Current band. The time since the last arrival counts as a gap, so a
   *  quiet stream widens back to the defaults without waiting for data. */
  band(nowPerfMs: number): LiveBand {
    const defaults = { enterSec: LIVE_ENTER_SEC, exitSec: LIVE_EXIT_SEC };
    if (this.firstPushMs === null || this.lastPushMs === null) return defaults;
    if (nowPerfMs - this.firstPushMs < MIN_OBSERVED_MS) return defaults;
    let maxGapMs = nowPerfMs - this.lastPushMs;
    for (const g of this.gaps) {
      if (g.t >= nowPerfMs - WINDOW_MS && g.gapMs > maxGapMs) maxGapMs = g.gapMs;
    }
    const enterSec = Math.min(Math.max(maxGapMs / 1000 + GAP_MARGIN_SEC, MIN_ENTER_SEC), LIVE_ENTER_SEC);
    const exitSec = Math.min(enterSec * EXIT_RATIO, LIVE_EXIT_SEC);
    return { enterSec, exitSec };
  }
}
