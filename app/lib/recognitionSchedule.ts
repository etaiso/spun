// Adaptive timing for the fingerprint fallback (see app/api/now-playing/route.ts).
//
// A Shazam match tells us where in the song we landed (`offsetSec`) and, via an
// iTunes lookup, the full track length (`durationMs`). Together they predict how
// long until the song ends — so instead of re-fingerprinting on a blind fixed
// interval, we coast quietly until the song is nearly over, then probe tightly
// to catch the switch. This is mid-song-aware: catching a track 2:30 into a 3:00
// song schedules the next poll ~30s out, not a flat 60s later.
//
// Metadata stations don't use any of this — their titles are pushed live; the
// fallback (and this scheduler) only run when broadcast metadata isn't naming
// the song.

// Re-fingerprint cadence when we can't predict the end (no duration, or a
// metadata-named song where the timer is just a dormant safety net).
export const FINGERPRINT_INTERVAL_MS = 60_000;
// A fingerprint captures ~6s of audio plus recognition; polling faster than
// this just produces overlapping no-op attempts.
export const MIN_DELAY_MS = 10_000;
// Cap a single coast so a bogus/huge duration (e.g. an hour-long mix matched to
// a short catalog edit, or vice-versa) can't silence recognition for too long.
export const MAX_COAST_MS = 120_000;
// When the predicted remaining time is within this window we consider ourselves
// "at the boundary" and probe tightly to catch the actual switch.
export const BOUNDARY_WINDOW_MS = 20_000;
// Cadence while bracketing a predicted boundary, until the song actually changes.
export const BOUNDARY_POLL_MS = 12_000;
// After a no-match (ad break / talk segment), probe sooner than the flat
// fallback so the next song is caught promptly without hammering the recognizer.
export const NOMATCH_DELAY_MS = 30_000;

export type FingerprintOutcome = {
  // Did this attempt identify a song?
  matched: boolean;
  // Full track length in ms, if resolved (null when unknown).
  durationMs: number | null;
  // Seconds into the song the sample matched (null when unknown).
  offsetSec: number | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * How long to wait before the next fingerprint attempt, given the last one's
 * outcome. Pure — all timing policy lives here so it can be unit-tested.
 */
export function computeNextDelayMs(outcome: FingerprintOutcome): number {
  if (!outcome.matched) return NOMATCH_DELAY_MS;

  // Matched, but no length to predict against — fall back to the fixed cadence.
  if (outcome.durationMs == null || outcome.offsetSec == null) {
    return FINGERPRINT_INTERVAL_MS;
  }

  const remainingMs = outcome.durationMs - outcome.offsetSec * 1000;

  // At or past the predicted end — including radio edits where the broadcast
  // runs longer than the catalog track, so offset overshoots duration and
  // remaining goes negative. Probe tightly to catch the switch.
  if (remainingMs <= BOUNDARY_WINDOW_MS) return BOUNDARY_POLL_MS;

  // Coast: wake just before the predicted end to start bracketing it.
  return clamp(remainingMs - BOUNDARY_WINDOW_MS, MIN_DELAY_MS, MAX_COAST_MS);
}
