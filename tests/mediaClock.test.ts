import { describe, it, expect } from 'vitest';
import { MediaClock } from '../app/lib/server/mediaClock';

// 128 kbps → 16 000 bytes/sec. A chunk of N bytes carries N/16 ms of audio.
const KBPS = 128;
const BPS = 16_000;

/** Bytes carrying `sec` seconds of audio at the declared 128 kbps. */
const secBytes = (sec: number) => sec * BPS;

/** Build a valid MP3 frame chain (MPEG1 Layer III, 64 kbps, 44.1 kHz →
 *  208-byte frames). 64 kbps is deliberately ≠ the 128 kbps fallback so tests
 *  can tell a successful sniff apart from the default. */
function mp3Chain64kbps(frames = 2): Uint8Array {
  const FRAME_LEN = 208;
  const out = new Uint8Array(FRAME_LEN * frames);
  for (let i = 0; i < frames; i++) {
    out[i * FRAME_LEN] = 0xff;
    out[i * FRAME_LEN + 1] = 0xfb;
    out[i * FRAME_LEN + 2] = 0x50; // bitrate idx 5 → 64 kbps, 44.1 kHz
  }
  return out;
}

/** Drive a clock through a minimal natural settle: 2 s of audio every 2 s
 *  (exact realtime) from t=0 to t=8 000. Settles on the t=8 000 chunk with the
 *  anchor at 8 000. Returns the back-stamps. */
function settleAtRealtime(clock: MediaClock): number[] {
  let back: number[] | null = null;
  for (let t = 0; t <= 8_000; t += 2_000) {
    back = clock.stamp(secBytes(2), t).backStamps;
  }
  expect(back).not.toBeNull();
  return back!;
}

describe('MediaClock: settling phase', () => {
  it('hands out provisional arrival stamps before settle', () => {
    const clock = new MediaClock({ declaredKbps: KBPS });
    // a burst: 5 s of audio every 100 ms — way past realtime
    expect(clock.stamp(secBytes(5), 1_000)).toEqual({ stampMs: 1_000, backStamps: null });
    expect(clock.stamp(secBytes(5), 1_100)).toEqual({ stampMs: 1_100, backStamps: null });
    expect(clock.settled).toBe(false);
  });

  it('keeps provisional stamps monotonic when the wall clock steps back', () => {
    const clock = new MediaClock({ declaredKbps: KBPS });
    expect(clock.stamp(secBytes(1), 5_000).stampMs).toBe(5_000);
    expect(clock.stamp(secBytes(1), 4_000).stampMs).toBe(5_000);
  });
});

describe('MediaClock: settle + back-stamp', () => {
  it('back-stamps a connect burst by audio duration (newest = now)', () => {
    // The measured pathology, scaled: 70 s of audio delivered in 1.3 s, then
    // realtime lumps of 6 s. Physically the burst's newest audio ends at the
    // connect instant (t≈0), so the walk-back must land its last chunk at 0.
    const clock = new MediaClock({ declaredKbps: KBPS });
    for (let i = 0; i < 14; i++) {
      expect(clock.stamp(secBytes(5), i * 100).backStamps).toBeNull();
    }
    expect(clock.stamp(secBytes(6), 6_000).backStamps).toBeNull(); // only 6 s observed
    const r = clock.stamp(secBytes(6), 12_000); // window drained → settle
    expect(clock.settled).toBe(true);
    expect(r.stampMs).toBe(12_000);
    const expected: number[] = [];
    for (let i = 0; i < 14; i++) expected.push(-65_000 + i * 5_000); // burst ends at 0
    expected.push(6_000, 12_000);
    expect(r.backStamps).toEqual(expected);
  });

  it('clamps every back-stamp to its own arrival time', () => {
    // Slower-than-realtime delivery (1 s of audio every 2 s): arrival stamps
    // were already honest, and a chunk must never be stamped after it arrived.
    const clock = new MediaClock({ declaredKbps: KBPS });
    let back: number[] | null = null;
    for (let t = 0; t <= 8_000; t += 2_000) {
      back = clock.stamp(secBytes(1), t).backStamps;
    }
    expect(back).toEqual([0, 2_000, 4_000, 6_000, 8_000]);
  });

  it('force-settles after forceSettleMs of sustained burst', () => {
    const clock = new MediaClock({ declaredKbps: KBPS, forceSettleMs: 3_000 });
    let back: number[] | null = null;
    let n = 0;
    for (let t = 0; t <= 3_000 && back === null; t += 300) {
      back = clock.stamp(secBytes(5), t).backStamps;
      n++;
    }
    expect(clock.settled).toBe(true);
    expect(back).toHaveLength(n);
  });

  it('force-settles when pending bytes exceed the cap', () => {
    const clock = new MediaClock({ declaredKbps: KBPS, maxPendingBytes: 200_000 });
    expect(clock.stamp(80_000, 0).backStamps).toBeNull();
    expect(clock.stamp(80_000, 100).backStamps).toBeNull();
    const r = clock.stamp(80_000, 200); // 240 000 pending ≥ cap
    expect(r.backStamps).toHaveLength(3);
    expect(clock.settled).toBe(true);
  });
});

describe('MediaClock: settled clock', () => {
  it('advances stamps by audio duration, immune to late-arrival jitter', () => {
    const clock = new MediaClock({ declaredKbps: KBPS });
    settleAtRealtime(clock); // anchor at 8 000
    // 1 s chunks with late-side arrival jitter — stamps tick exactly 1 000
    // apart; the jitter never leaks into the stamp spacing.
    expect(clock.stamp(secBytes(1), 9_050).stampMs).toBe(9_000);
    expect(clock.stamp(secBytes(1), 10_420).stampMs).toBe(10_000);
    expect(clock.stamp(secBytes(1), 11_303).stampMs).toBe(11_000);
  });

  it('re-anchors down to an early arrival (minimum observed delay wins)', () => {
    // The settle anchor carries whatever network delay its trigger chunk had.
    // A later chunk arriving with LESS delay proves the clock sat late: the
    // wall-clock clamp pins its stamp to the arrival, and the clock continues
    // from there — a one-off short tick, never a backwards jump.
    const clock = new MediaClock({ declaredKbps: KBPS });
    settleAtRealtime(clock); // anchor at 8 000
    expect(clock.stamp(secBytes(1), 9_000).stampMs).toBe(9_000);
    expect(clock.stamp(secBytes(1), 9_901).stampMs).toBe(9_901); // ideal 10 000 > now
    expect(clock.stamp(secBytes(1), 11_500).stampMs).toBe(10_901);
  });

  it('never stamps past the wall clock, and re-anchors after a clamp', () => {
    const clock = new MediaClock({ declaredKbps: KBPS });
    settleAtRealtime(clock); // anchor at 8 000
    // 5 s of audio arriving 1 s after the anchor: media clock would say
    // 13 000, but the wall clock is only at 9 000 → clamp.
    expect(clock.stamp(secBytes(5), 9_000).stampMs).toBe(9_000);
    // Next chunk advances from the clamped value, not the runaway ideal.
    expect(clock.stamp(secBytes(1), 10_500).stampMs).toBe(10_000);
  });

  it('stays monotonic when the wall clock steps backwards', () => {
    const clock = new MediaClock({ declaredKbps: KBPS });
    settleAtRealtime(clock); // anchor + last stamp at 8 000
    expect(clock.stamp(secBytes(1), 7_000).stampMs).toBe(8_000);
  });
});

describe('MediaClock: bitrate sources', () => {
  it('uses the declared icy-br bitrate', () => {
    const clock = new MediaClock({ declaredKbps: 192 });
    expect(clock.byteRate(0)).toBe(24_000);
  });

  it('ignores absurd declared bitrates', () => {
    expect(new MediaClock({ declaredKbps: 0 }).byteRate(0)).toBe(16_000);
    expect(new MediaClock({ declaredKbps: 99_999 }).byteRate(0)).toBe(16_000);
  });

  it('prefers the declared bitrate over a sniffable MP3 header', () => {
    const clock = new MediaClock({ declaredKbps: 192, contentType: 'audio/mpeg' });
    clock.stamp(416, 0, mp3Chain64kbps());
    expect(clock.byteRate(0)).toBe(24_000);
  });

  it('sniffs the bitrate from an MP3 frame chain when none is declared', () => {
    const clock = new MediaClock({ contentType: 'audio/mpeg' });
    expect(clock.byteRate(0)).toBe(16_000); // fallback before any data
    clock.stamp(416, 0, mp3Chain64kbps());
    expect(clock.byteRate(0)).toBe(8_000); // 64 kbps from the frame header
  });

  it('sniffs across chunk boundaries (header split mid-frame)', () => {
    const chain = mp3Chain64kbps();
    const clock = new MediaClock({ contentType: 'audio/mpeg' });
    clock.stamp(100, 0, chain.subarray(0, 100));
    expect(clock.byteRate(0)).toBe(16_000); // chain not yet verifiable
    clock.stamp(chain.length - 100, 50, chain.subarray(100));
    expect(clock.byteRate(50)).toBe(8_000);
  });

  it('does not lock a bitrate from an unverifiable header at the buffer end', () => {
    // A lone header followed by nothing: could be a false sync — wait.
    const clock = new MediaClock({ contentType: 'audio/mpeg' });
    clock.stamp(4, 0, new Uint8Array([0xff, 0xfb, 0x50, 0x00]));
    expect(clock.byteRate(0)).toBe(16_000);
  });

  it('measures bytes/sec post-settle when nothing is declared or sniffable', () => {
    const clock = new MediaClock({ contentType: 'audio/aac' });
    // Real rate: 16 000 bytes every 2 s = 8 000 B/s (64 kbps), but the
    // fallback assumes 16 000 B/s until measured.
    for (let t = 0; t <= 8_000; t += 2_000) clock.stamp(16_000, t);
    expect(clock.settled).toBe(true);
    for (let t = 10_000; t <= 16_000; t += 2_000) clock.stamp(16_000, t);
    expect(clock.byteRate(17_999)).toBe(16_000); // <10 s observed → fallback
    expect(clock.byteRate(18_000)).toBe(6_400);  // 64 000 B over 10 s
  });
});
