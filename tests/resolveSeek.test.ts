import { describe, it, expect } from 'vitest';
import { resolveSeek } from '../app/lib/timeshift/resolveSeek';

const win = { startMs: 5000, endMs: 6000 };
const ram = { startMs: 3000, endMs: 6000 };
const disk = { startMs: 1000, endMs: 6000 };

describe('resolveSeek', () => {
  it('window tier when target is inside the SourceBuffer window', () => {
    expect(resolveSeek(5500, win, ram, disk)).toEqual({ tier: 'window', targetMs: 5500 });
  });
  it('ram tier when inside the ring but outside the window', () => {
    expect(resolveSeek(3500, win, ram, disk)).toEqual({ tier: 'ram', targetMs: 3500 });
  });
  it('disk tier when before the ring but inside the disk buffer', () => {
    expect(resolveSeek(2000, win, ram, disk)).toEqual({ tier: 'disk', targetMs: 2000 });
  });
  it('clamps to the oldest buffered point', () => {
    expect(resolveSeek(1, win, ram, disk)).toEqual({ tier: 'disk', targetMs: 1000 });
    expect(resolveSeek(1, win, ram, null)).toEqual({ tier: 'ram', targetMs: 3000 });
  });
  it('clamps to live (ring end)', () => {
    expect(resolveSeek(99_999, win, ram, disk)).toEqual({ tier: 'window', targetMs: 6000 });
  });
  it('handles missing window (right after a rebuild)', () => {
    expect(resolveSeek(3500, null, ram, disk)).toEqual({ tier: 'ram', targetMs: 3500 });
  });
});
