import { describe, it, expect } from 'vitest';
import { LiveBandEstimator, LIVE_ENTER_SEC, LIVE_EXIT_SEC } from '../app/lib/timeshift/liveBand';

/** Push arrivals every `gapMs` from t0 until t1, returning the last push time. */
function pace(e: LiveBandEstimator, gapMs: number, t0: number, t1: number): number {
  let t = t0;
  for (; t <= t1; t += gapMs) e.push(t);
  return t - gapMs;
}

describe('LiveBandEstimator', () => {
  it('returns the default band before any data', () => {
    const e = new LiveBandEstimator();
    expect(e.band(1_000)).toEqual({ enterSec: LIVE_ENTER_SEC, exitSec: LIVE_EXIT_SEC });
  });

  it('keeps the default band while the observation window is short', () => {
    const e = new LiveBandEstimator();
    const last = pace(e, 300, 0, 10_000); // smooth, but only 10 s observed
    expect(e.band(last)).toEqual({ enterSec: LIVE_ENTER_SEC, exitSec: LIVE_EXIT_SEC });
  });

  it('narrows the band for a smoothly-paced station', () => {
    const e = new LiveBandEstimator();
    const last = pace(e, 300, 0, 40_000); // 0.3 s chunks for 40 s
    const band = e.band(last);
    expect(band.enterSec).toBeCloseTo(0.8, 5); // floor: 0.3 + 0.5
    expect(band.exitSec).toBeCloseTo(0.8 * 2.4, 5);
    expect(band.exitSec).toBeGreaterThan(band.enterSec);
  });

  it('keeps the default band for ~6 s Icecast burst pacing', () => {
    const e = new LiveBandEstimator();
    const last = pace(e, 6_000, 0, 60_000);
    expect(e.band(last)).toEqual({ enterSec: LIVE_ENTER_SEC, exitSec: LIVE_EXIT_SEC });
  });

  it('scales the band to mid-rate pacing', () => {
    const e = new LiveBandEstimator();
    const last = pace(e, 2_000, 0, 60_000);
    const band = e.band(last);
    expect(band.enterSec).toBeCloseTo(2.5, 5); // 2 + 0.5
    expect(band.exitSec).toBeCloseTo(6, 5);    // 2.5 × 2.4
  });

  it('widens immediately when arrivals go quiet (pending gap counts)', () => {
    const e = new LiveBandEstimator();
    const last = pace(e, 300, 0, 40_000); // earned a narrow band
    const band = e.band(last + 8_000);    // then 8 s of silence
    expect(band.enterSec).toBe(LIVE_ENTER_SEC);
    expect(band.exitSec).toBe(LIVE_EXIT_SEC);
  });

  it('ages old gap spikes out of the rolling window', () => {
    const e = new LiveBandEstimator();
    e.push(0);
    e.push(4_000); // one 4 s spike early on
    const last = pace(e, 300, 4_300, 140_000); // then smooth for >2 min
    const band = e.band(last);
    expect(band.enterSec).toBeCloseTo(0.8, 5); // spike fell out of the window
  });

  it('never narrows below the floor even for near-continuous arrivals', () => {
    const e = new LiveBandEstimator();
    const last = pace(e, 50, 0, 40_000);
    expect(e.band(last).enterSec).toBeCloseTo(0.8, 5);
  });

  it('never widens beyond the defaults for very slow bursts', () => {
    const e = new LiveBandEstimator();
    const last = pace(e, 10_000, 0, 120_000);
    expect(e.band(last)).toEqual({ enterSec: LIVE_ENTER_SEC, exitSec: LIVE_EXIT_SEC });
  });
});
