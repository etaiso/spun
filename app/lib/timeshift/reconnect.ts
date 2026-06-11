// Reconnect policy for the engine's /api/timeshift feed. Some upstreams
// (CDN-fronted Icecast, e.g. Glglz) drop every connection after a few minutes
// by design; the server tee dies with it and a fresh tee is created on the
// next acquire — so a drop is survivable by simply re-opening the stream.
// This module decides WHEN to re-open: exponential backoff across consecutive
// failures, give-up after a budget so a truly dead upstream still falls back
// to plain audio, and a "healthy connection" rule so periodic drops never
// exhaust the budget — only rapid flapping does. Pure (callers pass
// timestamps) so it's unit-testable.
export type ReconnectDecision =
  | { action: 'reconnect'; delayMs: number }
  | { action: 'give-up' };

export type ReconnectOpts = {
  baseDelayMs: number;  // first retry delay; doubles per consecutive failure
  maxDelayMs: number;   // backoff ceiling
  maxAttempts: number;  // consecutive failures before giving up
  healthyMs: number;    // a connection living this long resets the counter
};

export const RECONNECT_DEFAULTS: ReconnectOpts = {
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
  maxAttempts: 5,
  healthyMs: 60_000,
};

export class ReconnectPolicy {
  private attempts = 0;
  private connectedAtMs: number | null = null;

  constructor(private opts: ReconnectOpts = RECONNECT_DEFAULTS) {}

  /** Call when a stream (re)opens successfully. Does NOT reset the failure
   *  counter by itself — a flapping upstream that connects and immediately
   *  drops must keep eating into the budget. */
  connected(nowMs: number): void {
    this.connectedAtMs = nowMs;
  }

  /** Call when the stream ends or fails (including a failed re-open, where
   *  connected() never fired in between). */
  streamEnded(nowMs: number): ReconnectDecision {
    if (this.connectedAtMs !== null && nowMs - this.connectedAtMs >= this.opts.healthyMs) {
      this.attempts = 0; // lived long enough — this drop starts a fresh outage
    }
    this.connectedAtMs = null;
    if (this.attempts >= this.opts.maxAttempts) return { action: 'give-up' };
    const delayMs = Math.min(
      this.opts.baseDelayMs * 2 ** this.attempts,
      this.opts.maxDelayMs,
    );
    this.attempts++;
    return { action: 'reconnect', delayMs };
  }
}
