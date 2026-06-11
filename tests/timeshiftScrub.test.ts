import { describe, it, expect } from 'vitest';
import {
  IDLE, SETTLE_TIMEOUT_MS, SETTLE_TOLERANCE_MS,
  scrubStart, scrubMove, scrubRelease, scrubCancel, scrubCommit, scrubSettle, displayMs,
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

  it('keeps holding one tick before the timeout deadline (playhead unknown)', () => {
    const { next } = scrubRelease(scrubStart(T0), 0);
    expect(scrubSettle(next, null, SETTLE_TIMEOUT_MS - 1)).toBe(next);
  });

  it('settle is a no-op outside the settling phase', () => {
    expect(scrubSettle(IDLE, T0, 0)).toBe(IDLE);
    const dragging = scrubStart(T0);
    expect(scrubSettle(dragging, T0, 0)).toBe(dragging);
  });

  it('display tracks the engine when idle', () => {
    expect(displayMs(IDLE)).toBeNull();
  });

  it('commit enters settling directly and holds the target (tick jump)', () => {
    const s = scrubCommit(T0, 123);
    expect(s).toEqual({ phase: 'settling', ms: T0, sinceMs: 123 });
    // the display holds the jump target — no flicker back to the old playhead
    expect(displayMs(s)).toBe(T0);
  });

  it('committed settling releases once the playhead lands near the target', () => {
    const s = scrubCommit(T0, 0);
    expect(scrubSettle(s, T0 + SETTLE_TOLERANCE_MS - 1, 100)).toBe(IDLE);
  });

  it('committed settling keeps holding while the playhead is still far away', () => {
    const s = scrubCommit(T0, 0);
    expect(scrubSettle(s, T0 + SETTLE_TOLERANCE_MS + 1, 100)).toBe(s);
  });

  it('committed settling releases on timeout even if the playhead never lands', () => {
    const s = scrubCommit(T0, 0);
    expect(scrubSettle(s, null, SETTLE_TIMEOUT_MS)).toBe(IDLE);
  });
});
