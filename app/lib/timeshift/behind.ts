// Steady behind-live readout, derived from playback physics instead of raw
// chunk stamps.
//
// The raw value (smoothed live edge − timeMap playhead wall-clock) inherits
// the arrival jitter of the server's per-chunk Date.now() stamps (±0.5 s every
// burst), and creeps badly across an Icecast burst-on-connect zone, where a
// minute of past audio is stamped into a few seconds. Rounding that raw value
// makes the −MM:SS readout wobble constantly.
//
// Physics: playing at 1× keeps you a CONSTANT distance behind live; pausing or
// stalling grows it 1:1 with wall time; a seek shifts it by exactly the jump
// in audio.currentTime. So we advance the displayed value by
// (Δwall − Δct) — which captures all of those exactly — and fold in only a
// slow exponential correction toward the raw value (time constant TAU_SEC) so
// persistent stamp truth still wins without visible flicker.
const TAU_SEC = 15;

export class BehindSmoother {
  private ref: { behind: number; ct: number; perf: number } | null = null;

  /** rawBehindSec: stamp-derived behind-live; ctSec: audio.currentTime;
   *  perfMs: performance.now(). Returns the smoothed behind-live seconds. */
  update(rawBehindSec: number, ctSec: number, perfMs: number): number {
    if (this.ref === null) {
      this.ref = { behind: rawBehindSec, ct: ctSec, perf: perfMs };
      return rawBehindSec;
    }
    const r = this.ref;
    const wallE = (perfMs - r.perf) / 1000;
    const ctE = ctSec - r.ct;
    let behind = r.behind + (wallE - ctE);
    const alpha = 1 - Math.exp(-Math.max(0, wallE) / TAU_SEC);
    behind += (rawBehindSec - behind) * alpha;
    behind = Math.max(0, behind);
    this.ref = { behind, ct: ctSec, perf: perfMs };
    return behind;
  }

  /** Forget the reference (MediaSource rebuild — ct restarts near zero). */
  reset(): void {
    this.ref = null;
  }
}
