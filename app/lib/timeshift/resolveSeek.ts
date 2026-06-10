// Decides how a seek to a wall-clock target is served, fastest tier first:
//   window — target is in the live SourceBuffer → set currentTime (instant)
//   ram    — in the RAM ring → rebuild the SourceBuffer from memory (~100 ms)
//   disk   — before the ring but in the tracked station's disk ring → re-fetch
// Targets outside every buffer clamp to the nearest edge.
export type Range = { startMs: number; endMs: number } | null;
export type SeekPlan = { tier: 'window' | 'ram' | 'disk'; targetMs: number };

// Within this many seconds of the live edge, wall-clock targets must NOT be
// resolved through timeMap anchors: anchors are arrival-stamped, and chunks of
// one upstream burst share ~the same stamp, so the wall→buffer interpolation
// is ~flat across the newest burst — any near-live wall target collapses onto
// the live frame (a click at "−10 s" lands at LIVE and latches the pill).
// Two burst spans (~6 s each) of margin covers the degenerate region.
const NEAR_LIVE_SEC = 20;

/** Resolve a near-live wall-clock target as AUDIO seconds back from the
 *  buffered end — exact regardless of stamp quality. Returns null when the
 *  target is deep (stamp interpolation is sound there), the append loop is
 *  capped behind live (buffered end ≠ data end), or the landing leaves the
 *  window. snapLive marks targets inside the live-enter band. */
export function resolveNearLiveSeek(
  targetMs: number,
  edgeMs: number,        // smoothed display live edge (the scrubber's right edge)
  newestMs: number,      // newest data stamp (ring end)
  bufStartSec: number,   // SourceBuffer window, buffer-time seconds
  bufEndSec: number,
  fullyAppended: boolean, // buffered end IS the data end
  liveEnterSec: number,
): { bufferTime: number; snapLive: boolean } | null {
  if (!fullyAppended) return null;
  const behindSec = (edgeMs - targetMs) / 1000;
  if (behindSec > NEAR_LIVE_SEC) return null;
  if (behindSec <= liveEnterSec) return { bufferTime: bufEndSec, snapLive: true };
  // The stretch between the newest data and the display edge hasn't arrived
  // yet — clicks inside it clamp to the buffered end (G seconds behind).
  const gapSec = Math.max(0, (edgeMs - newestMs) / 1000);
  const bufferTime = bufEndSec - Math.max(0, behindSec - gapSec);
  if (bufferTime < bufStartSec) return null;
  return { bufferTime, snapLive: false };
}

export function resolveSeek(targetMs: number, win: Range, ram: Range, disk: Range): SeekPlan {
  const oldest = disk?.startMs ?? ram?.startMs ?? targetMs;
  const newest = ram?.endMs ?? targetMs;
  const t = Math.min(Math.max(targetMs, oldest), newest);
  if (win && t >= win.startMs && t <= win.endMs) return { tier: 'window', targetMs: t };
  if (ram && t >= ram.startMs && t <= ram.endMs) return { tier: 'ram', targetMs: t };
  if (disk && t >= disk.startMs && t <= disk.endMs) return { tier: 'disk', targetMs: t };
  // Between buffers (e.g. inside a discontinuity) — snap into the ram ring.
  return { tier: 'ram', targetMs: Math.max(t, ram?.startMs ?? t) };
}
