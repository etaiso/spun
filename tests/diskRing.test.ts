import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiskRing } from '../app/lib/server/diskRing';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spun-ring-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function drain(ring: DiskRing, fromMs: number) {
  return Array.from(ring.readFrom(fromMs));
}

describe('DiskRing', () => {
  it('round-trips appended chunks from a given wall clock', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 60, maxBytes: 1 << 20 });
    ring.append(1000, new Uint8Array([1]));
    ring.append(1500, new Uint8Array([2]));
    ring.append(2500, new Uint8Array([3])); // second segment (>= 1000ms later)
    const frames = drain(ring, 1400);
    // readFrom returns whole segments whose end >= fromMs, so the 1000ms frame
    // (same segment as 1500) is included; the caller trims by wallClock.
    expect(frames.map(f => f.wallClock)).toEqual([1000, 1500, 2500]);
    expect(drain(ring, 2400).map(f => f.wallClock)).toEqual([2500]);
    expect(drain(ring, 2600)).toEqual([]); // past the newest frame → nothing (live follows)
    ring.destroy();
  });

  it('reports startMs of the oldest retained byte', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 60, maxBytes: 1 << 20 });
    expect(ring.startMs()).toBeNull();
    ring.append(5000, new Uint8Array([1]));
    expect(ring.startMs()).toBe(5000);
    ring.destroy();
  });

  it('reports endMs of the newest persisted frame', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 60, maxBytes: 1 << 20 });
    expect(ring.endMs()).toBeNull();
    ring.append(5000, new Uint8Array([1]));
    expect(ring.endMs()).toBe(5000);
    ring.append(6500, new Uint8Array([2])); // rotates into a new segment
    expect(ring.endMs()).toBe(6500);
    ring.destroy();
  });

  it('GCs oldest segments past maxSegments', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 2, maxBytes: 1 << 20 });
    ring.append(1000, new Uint8Array([1]));
    ring.append(2001, new Uint8Array([2]));
    ring.append(3002, new Uint8Array([3])); // rotates to 3rd segment → seg 1 GC'd
    expect(ring.startMs()).toBe(2001);
    expect(drain(ring, 0).map(f => f.wallClock)).toEqual([2001, 3002]);
    ring.destroy();
  });

  it('GCs by byte budget', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 60, maxBytes: 60 });
    ring.append(1000, new Uint8Array(30)); // 42 bytes framed
    ring.append(2001, new Uint8Array(30)); // 2nd segment → 84 bytes total → GC 1st
    expect(ring.startMs()).toBe(2001);
    ring.destroy();
  });

  it('destroy removes the directory', () => {
    const sub = path.join(dir, 'x');
    const ring = new DiskRing(sub, { segmentMs: 1000, maxSegments: 2, maxBytes: 1 << 20 });
    ring.append(1, new Uint8Array([1]));
    ring.destroy();
    expect(fs.existsSync(sub)).toBe(false);
  });
});
