import { describe, it, expect } from 'vitest';
import { TimeMap } from '../app/lib/timeshift/timeMap';

describe('TimeMap', () => {
  it('interpolates wall clock between anchors', () => {
    const m = new TimeMap();
    m.addAnchor(0, 10_000);   // buffer 0s ↔ wall 10s
    m.addAnchor(10, 20_000);  // buffer 10s ↔ wall 20s
    expect(m.wallClockAt(5)).toBe(15_000);
    expect(m.bufferTimeAt(15_000)).toBe(5);
  });

  it('clamps outside the anchored range', () => {
    const m = new TimeMap();
    m.addAnchor(0, 10_000);
    m.addAnchor(10, 20_000);
    expect(m.wallClockAt(-5)).toBe(10_000);
    expect(m.wallClockAt(99)).toBe(20_000);
  });

  it('returns null with no anchors', () => {
    const m = new TimeMap();
    expect(m.wallClockAt(0)).toBeNull();
    expect(m.bufferTimeAt(0)).toBeNull();
  });

  it('reset clears anchors', () => {
    const m = new TimeMap();
    m.addAnchor(0, 1);
    m.reset();
    expect(m.wallClockAt(0)).toBeNull();
  });

  it('caps anchor count (keeps newest)', () => {
    const m = new TimeMap(10);
    for (let i = 0; i < 100; i++) m.addAnchor(i, i * 1000);
    expect(m.wallClockAt(99)).toBe(99_000);
  });
});
