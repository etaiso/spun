import { describe, it, expect } from 'vitest';
import { RamRing } from '../app/lib/timeshift/ramRing';

describe('RamRing', () => {
  it('stores chunks and reports range', () => {
    const r = new RamRing({ maxMs: 10_000, maxBytes: 1000 });
    r.push(1000, new Uint8Array(10));
    r.push(2000, new Uint8Array(10));
    expect(r.startMs()).toBe(1000);
    expect(r.endMs()).toBe(2000);
    expect(r.totalBytes()).toBe(20);
  });

  it('evicts by duration', () => {
    const r = new RamRing({ maxMs: 5_000, maxBytes: 1 << 20 });
    r.push(1000, new Uint8Array(1));
    r.push(7000, new Uint8Array(1)); // span 6000 > 5000 → evict first
    expect(r.startMs()).toBe(7000);
  });

  it('evicts by bytes', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 15 });
    r.push(1, new Uint8Array(10));
    r.push(2, new Uint8Array(10));
    expect(r.startMs()).toBe(2);
    expect(r.totalBytes()).toBe(10);
  });

  it('indexAt finds the first chunk at/after a wall clock', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20 });
    r.push(1000, new Uint8Array(1));
    r.push(2000, new Uint8Array(1));
    r.push(3000, new Uint8Array(1));
    expect(r.indexAt(1500)).toBe(1);
    expect(r.indexAt(2000)).toBe(1);
    expect(r.indexAt(99999)).toBe(-1);
    expect(r.indexAt(0)).toBe(0);
  });

  it('chunksFrom iterates from an index', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20 });
    r.push(1, new Uint8Array([1]));
    r.push(2, new Uint8Array([2]));
    expect([...r.chunksFrom(1)].map(c => c.wallClock)).toEqual([2]);
  });

  it('detects discontinuities (wall-clock jump beyond threshold)', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20, gapMs: 5000 });
    r.push(1000, new Uint8Array(1));
    r.push(2000, new Uint8Array(1));
    r.push(9000, new Uint8Array(1)); // 7s jump → discontinuity
    expect(r.discontinuities()).toEqual([{ fromMs: 2000, toMs: 9000 }]);
  });

  it('clear resets everything', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20 });
    r.push(1, new Uint8Array(1));
    r.clear();
    expect(r.startMs()).toBeNull();
    expect(r.totalBytes()).toBe(0);
  });
});
