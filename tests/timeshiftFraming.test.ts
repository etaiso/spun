import { describe, it, expect } from 'vitest';
import { encodeFrame, FrameDecoder, FRAME_HEADER_BYTES } from '../app/lib/timeshift/framing';

describe('timeshift framing', () => {
  it('round-trips a single frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeFrame(1717939200123, payload);
    expect(frame.length).toBe(FRAME_HEADER_BYTES + 4);
    const dec = new FrameDecoder();
    const out = dec.push(frame);
    expect(out).toHaveLength(1);
    expect(out[0].wallClock).toBe(1717939200123);
    expect(Array.from(out[0].payload)).toEqual([1, 2, 3, 4]);
  });

  it('reassembles frames split across arbitrary push boundaries', () => {
    const a = encodeFrame(1000, new Uint8Array([9, 9]));
    const b = encodeFrame(2000, new Uint8Array([7]));
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0); joined.set(b, a.length);
    const dec = new FrameDecoder();
    const got: number[] = [];
    // push 1 byte at a time — worst case fragmentation
    for (let i = 0; i < joined.length; i++) {
      for (const f of dec.push(joined.subarray(i, i + 1))) got.push(f.wallClock);
    }
    expect(got).toEqual([1000, 2000]);
  });

  it('yields multiple frames from one push', () => {
    const a = encodeFrame(1, new Uint8Array(10));
    const b = encodeFrame(2, new Uint8Array(20));
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0); joined.set(b, a.length);
    const dec = new FrameDecoder();
    expect(dec.push(joined).map(f => f.payload.length)).toEqual([10, 20]);
  });
});
