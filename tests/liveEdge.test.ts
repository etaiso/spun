import { describe, it, expect } from 'vitest';
import { LiveEdgeEstimator } from '../app/lib/timeshift/liveEdge';

describe('LiveEdgeEstimator', () => {
  it('returns null before any data', () => {
    expect(new LiveEdgeEstimator().estimateAt(1_000)).toBeNull();
  });

  it('anchors on the first push', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    expect(e.estimateAt(1_000)).toBe(50_000);
  });

  it('advances at 1x real time between bursts', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    expect(e.estimateAt(3_500)).toBe(52_500);
  });

  it('does not regress when a burst arrives with lagging stamps', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);   // estimate at t=5000 → 54_000
    e.push(53_000, 5_000);   // stamps 1 s behind the estimate — must be ignored
    expect(e.estimateAt(5_000)).toBe(54_000);
    expect(e.estimateAt(6_000)).toBe(55_000); // still smooth afterwards
  });

  it('jumps forward when data outruns the estimate', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    e.push(56_000, 5_000);   // estimate was 54_000 — data ahead, re-anchor
    expect(e.estimateAt(5_000)).toBe(56_000);
  });

  it('is monotone across a mixed burst sequence', () => {
    const e = new LiveEdgeEstimator();
    let prev = -Infinity;
    const bursts: [number, number][] = [
      [50_000, 1_000], [50_900, 2_000], [53_500, 3_000], [53_600, 4_500], [58_000, 6_000],
    ];
    for (const [end, t] of bursts) {
      e.push(end, t);
      const est = e.estimateAt(t)!;
      expect(est).toBeGreaterThanOrEqual(prev);
      prev = est;
    }
  });

  it('reset forgets the anchor so a replayed stream can re-anchor lower', () => {
    const e = new LiveEdgeEstimator();
    e.push(50_000, 1_000);
    e.reset();
    expect(e.estimateAt(2_000)).toBeNull();
    e.push(10_000, 3_000);
    expect(e.estimateAt(3_000)).toBe(10_000);
  });
});
