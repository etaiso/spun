import { describe, it, expect } from 'vitest';
import {
  computeNextDelayMs,
  FINGERPRINT_INTERVAL_MS,
  MIN_DELAY_MS,
  MAX_COAST_MS,
  BOUNDARY_WINDOW_MS,
  BOUNDARY_POLL_MS,
  NOMATCH_DELAY_MS,
} from '../app/lib/recognitionSchedule';

describe('computeNextDelayMs', () => {
  it('probes sooner after a no-match (ad break / talk)', () => {
    expect(computeNextDelayMs({ matched: false, durationMs: null, offsetSec: null }))
      .toBe(NOMATCH_DELAY_MS);
  });

  it('falls back to the fixed cadence when duration is unknown', () => {
    expect(computeNextDelayMs({ matched: true, durationMs: null, offsetSec: 30 }))
      .toBe(FINGERPRINT_INTERVAL_MS);
    expect(computeNextDelayMs({ matched: true, durationMs: 200_000, offsetSec: null }))
      .toBe(FINGERPRINT_INTERVAL_MS);
  });

  it('coasts toward the predicted end when plenty of song is left', () => {
    // Caught 30s into a 200s song -> ~170s remaining. Wake ~BOUNDARY before end,
    // capped by MAX_COAST.
    const delay = computeNextDelayMs({ matched: true, durationMs: 200_000, offsetSec: 30 });
    expect(delay).toBe(MAX_COAST_MS); // 150s remaining-window > cap
  });

  it('is mid-song-aware: catching a song late schedules a short coast', () => {
    // Caught 150s into a 180s song -> 30s remaining -> coast 30-20 = 10s.
    const delay = computeNextDelayMs({ matched: true, durationMs: 180_000, offsetSec: 150 });
    expect(delay).toBe(10_000);
    expect(delay).toBeLessThan(FINGERPRINT_INTERVAL_MS); // beats the old flat poll
  });

  it('probes tightly when within the boundary window', () => {
    // 165s into a 180s song -> 15s remaining, inside the 20s window.
    expect(computeNextDelayMs({ matched: true, durationMs: 180_000, offsetSec: 165 }))
      .toBe(BOUNDARY_POLL_MS);
  });

  it('treats an overrun (radio edit, offset > duration) as the boundary', () => {
    // The live Heart 80s case: offset 294.8s but catalog duration 240s.
    const delay = computeNextDelayMs({ matched: true, durationMs: 240_067, offsetSec: 294.79 });
    expect(delay).toBe(BOUNDARY_POLL_MS); // negative remaining -> probe, don't go silent
  });

  it('never coasts below the floor or above the cap', () => {
    // Just past the boundary window -> tiny coast, floored.
    const justOver = computeNextDelayMs({
      matched: true, durationMs: BOUNDARY_WINDOW_MS + 1_000, offsetSec: 0,
    });
    expect(justOver).toBe(MIN_DELAY_MS);

    // Enormous duration -> capped.
    const huge = computeNextDelayMs({ matched: true, durationMs: 3_600_000, offsetSec: 0 });
    expect(huge).toBe(MAX_COAST_MS);
  });
});
