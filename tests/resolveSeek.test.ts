import { describe, it, expect } from 'vitest';
import { resolveSeek, resolveNearLiveSeek } from '../app/lib/timeshift/resolveSeek';

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

// Wall-clock anchors are arrival-stamped: chunks of one delivery burst share
// ~the same stamp, so wall→buffer lookups near the buffered end collapse onto
// the live frame (a click at "−10 s" lands at LIVE). Near-live seeks must
// resolve as AUDIO-seconds back from the buffered end instead.
describe('resolveNearLiveSeek', () => {
  const base = {
    edgeMs: 1_000_000,      // smoothed display live edge
    newestMs: 998_000,      // newest data stamp (G = 2 s)
    bufStartSec: 10,        // SourceBuffer window, buffer-time seconds
    bufEndSec: 100,
    fullyAppended: true,
    liveEnterSec: 5,
  };
  const resolve = (targetMs: number, over: Partial<typeof base> = {}) => {
    const a = { ...base, ...over };
    return resolveNearLiveSeek(targetMs, a.edgeMs, a.newestMs, a.bufStartSec, a.bufEndSec, a.fullyAppended, a.liveEnterSec);
  };

  it('lands a near-live click at audio distance from the buffered end', () => {
    // −10 s behind the display edge, gap G = 2 s → 8 audio-seconds back
    expect(resolve(990_000)).toEqual({ bufferTime: 92, snapLive: false });
  });

  it('snaps to live inside the live-enter band', () => {
    expect(resolve(996_000)).toEqual({ bufferTime: 100, snapLive: true }); // −4 s < enter 5
  });

  it('clamps to the buffered end when the click is inside the unarrived gap', () => {
    // −6 s behind edge but G = 7 s: requested point has not arrived yet
    expect(resolve(994_000, { newestMs: 993_000 })).toEqual({ bufferTime: 100, snapLive: false });
  });

  it('returns null for deep targets where stamp interpolation is sound', () => {
    expect(resolve(975_000)).toBeNull(); // −25 s — beyond the near-live zone
  });

  it('returns null when the append loop is capped behind live', () => {
    expect(resolve(990_000, { fullyAppended: false })).toBeNull();
  });

  it('returns null when the landing falls before the window start', () => {
    expect(resolve(990_000, { bufStartSec: 95 })).toBeNull();
  });
});
