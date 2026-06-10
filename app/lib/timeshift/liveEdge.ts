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
