import { describe, it, expect } from 'vitest';
import { BehindSmoother } from '../app/lib/timeshift/behind';

// Ticks arrive every 500 ms of perf time; while playing, ct advances 0.5 s per
// tick. raw is the jittery stamp-derived behind-live the smoother corrects.

describe('BehindSmoother', () => {
  it('anchors on the first update', () => {
    const s = new BehindSmoother();
    expect(s.update(30, 10, 0)).toBe(30);
  });

  it('holds steady through stamp jitter while playing', () => {
    const s = new BehindSmoother();
    s.update(30, 10, 0);
    let out = 0;
    for (let i = 1; i <= 40; i++) {
      const raw = 30 + (i % 2 === 0 ? 0.6 : -0.6); // ±0.6 s anchor jitter
      out = s.update(raw, 10 + i * 0.5, i * 500);
      expect(Math.abs(out - 30)).toBeLessThan(0.05);
    }
    expect(out).toBeGreaterThan(0);
  });

  it('grows 1:1 while paused (ct frozen, wall advancing)', () => {
    const s = new BehindSmoother();
    s.update(30, 10, 0);
    // paused: ct stays 10; raw grows with the wall clock too
    const out = s.update(40, 10, 10_000);
    expect(out).toBeCloseTo(40, 1);
  });

  it('applies a window-tier seek instantly (ct jump, no rebuild)', () => {
    const s = new BehindSmoother();
    s.update(5, 100, 0);
    // seek back 60 s: ct jumps to 40 between ticks; raw agrees
    const out = s.update(65, 40, 500);
    expect(out).toBeCloseTo(65.5, 0); // 5 + (0.5 wall − (−60) ct) ≈ 65.5, EMA pulls toward 65
  });

  it('glides smoothly and monotonically toward a persistent raw bias', () => {
    const s = new BehindSmoother();
    s.update(30, 10, 0);
    // stamp truth emerges: raw is actually 70 (burst-zone correction)
    let prev = 30;
    let out = 30;
    for (let i = 1; i <= 60; i++) {
      out = s.update(70, 10 + i * 0.5, i * 500);
      expect(out).toBeGreaterThanOrEqual(prev - 1e-9); // monotone, no oscillation
      prev = out;
    }
    expect(out).toBeGreaterThan(55); // converged most of the way within 30 s
    expect(out).toBeLessThan(70);
  });

  it('never returns a negative value', () => {
    const s = new BehindSmoother();
    s.update(0.2, 10, 0);
    const out = s.update(0, 10.5, 500);
    expect(out).toBeGreaterThanOrEqual(0);
  });

  it('reset() re-anchors at the next raw value', () => {
    const s = new BehindSmoother();
    s.update(30, 10, 0);
    s.reset();
    expect(s.update(7, 0, 1_000)).toBe(7);
  });
});
