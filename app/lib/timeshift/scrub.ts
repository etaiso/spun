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
  return { next: scrubCommit(s.ms, nowMs), commitMs: s.ms };
}

// Direct-jump seek (song tick) with no drag phase: enter settling so the
// display holds the target until the engine playhead lands, exactly like a
// released drag — otherwise the handle flickers back to the stale pre-seek
// position on ram/disk-tier seeks.
export function scrubCommit(ms: number, nowMs: number): ScrubState {
  return { phase: 'settling', ms, sinceMs: nowMs };
}

// Pointer-cancel. During `dragging` this aborts without committing; during
// `settling` the seek is already committed — returning to idle just resumes
// tracking the engine immediately, which is harmless.
export function scrubCancel(): ScrubState {
  return IDLE;
}

/** Engine tick while settling. Returns the SAME object when nothing changes
 *  so a React setState with the result can bail out.
 *
 *  The landed check is symmetric (Math.abs) on purpose: until the seek
 *  completes, the engine still reports the PRE-seek playhead, which can sit
 *  far on either side of the target (ahead after a backward drag from live,
 *  behind after a forward drag). Overshoot past the target is bounded by the
 *  engine's live-snap band (LIVE_ENTER_SEC = 5 s < tolerance), and the
 *  timeout is the backstop for anything pathological. */
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
