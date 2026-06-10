import { describe, it, expect } from 'vitest';
import { findSyncOffset, mp3FrameInfoAt } from '../app/lib/timeshift/frameSync';

// Minimal valid MP3 frame header: 0xFF 0xFB (MPEG1 Layer III, no CRC)
const MP3_SYNC = [0xff, 0xfb, 0x90, 0x00];
// Minimal ADTS header start: 0xFF 0xF1 (MPEG-4 AAC LC, no CRC)
const ADTS_SYNC = [0xff, 0xf1, 0x50, 0x80];

describe('findSyncOffset', () => {
  it('finds an mp3 sync word after garbage', () => {
    const bytes = new Uint8Array([0x12, 0x34, ...MP3_SYNC, 0xaa]);
    expect(findSyncOffset('audio/mpeg', bytes)).toBe(2);
  });
  it('finds an adts sync word after garbage', () => {
    const bytes = new Uint8Array([0x00, ...ADTS_SYNC]);
    expect(findSyncOffset('audio/aac', bytes)).toBe(1);
  });
  it('returns 0 when the chunk already starts on a sync word', () => {
    expect(findSyncOffset('audio/mpeg', new Uint8Array(MP3_SYNC))).toBe(0);
  });
  it('rejects 0xFF bytes that are not sync words', () => {
    // 0xFF 0x00 is not a sync; real sync later
    const bytes = new Uint8Array([0xff, 0x00, ...MP3_SYNC]);
    expect(findSyncOffset('audio/mpeg', bytes)).toBe(2);
  });
  it('returns -1 when no sync word exists', () => {
    expect(findSyncOffset('audio/mpeg', new Uint8Array([1, 2, 3]))).toBe(-1);
  });
  it('passes unknown content types through at offset 0', () => {
    expect(findSyncOffset('application/octet-stream', new Uint8Array([1, 2]))).toBe(0);
  });

  // Frame-length chain validation (rejects false 0xFFEx syncs).
  // 0xFB 0x90 = MPEG1 Layer III, 128 kbps, 44.1 kHz → 417-byte frame.
  const FRAME_LEN = 417;
  const mkFrame = () => {
    const f = new Uint8Array(FRAME_LEN);
    f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x00;
    return f;
  };

  it('accepts a real two-frame chain at offset 0', () => {
    const buf = new Uint8Array(FRAME_LEN * 2);
    buf.set(mkFrame(), 0);
    buf.set(mkFrame(), FRAME_LEN);
    expect(findSyncOffset('audio/mpeg', buf)).toBe(0);
  });

  it('skips a false sync whose next frame does not sync, finds the real chain', () => {
    // A lone header at 0 (followed by zeros, so no frame at +417), then a real
    // two-frame chain starting at 421.
    const start = FRAME_LEN + 4;
    const buf = new Uint8Array(start + FRAME_LEN * 2);
    buf[0] = 0xff; buf[1] = 0xfb; buf[2] = 0x90; buf[3] = 0x00; // false sync
    buf.set(mkFrame(), start);
    buf.set(mkFrame(), start + FRAME_LEN);
    expect(findSyncOffset('audio/mpeg', buf)).toBe(start);
  });

  it('rejects reserved bitrate/samplerate header bytes', () => {
    // 0xFF 0xFB 0x0C: bitrate index 0 (free) → not a valid frame.
    expect(findSyncOffset('audio/mpeg', new Uint8Array([0xff, 0xfb, 0x0c, 0x00]))).toBe(-1);
  });
});

describe('mp3FrameInfoAt', () => {
  it('parses bitrate, sample rate and duration from an MPEG1 Layer III header', () => {
    // 0xFF 0xFB 0x90: MPEG1 Layer III, 128 kbps, 44.1 kHz → 417-byte frame.
    const info = mp3FrameInfoAt(new Uint8Array(MP3_SYNC), 0);
    expect(info).not.toBeNull();
    expect(info!.lengthBytes).toBe(417);
    expect(info!.bitrateBps).toBe(128_000);
    expect(info!.sampleRate).toBe(44_100);
    expect(info!.samplesPerFrame).toBe(1152);
    expect(info!.durationMs).toBeCloseTo(1152 / 44_100 * 1000, 3);
  });

  it('parses an MPEG2 Layer III header (576 samples/frame)', () => {
    // 0xFF 0xF3 0x90: MPEG2 Layer III, 80 kbps, 22.05 kHz.
    const info = mp3FrameInfoAt(new Uint8Array([0xff, 0xf3, 0x90, 0x00]), 0);
    expect(info).not.toBeNull();
    expect(info!.bitrateBps).toBe(80_000);
    expect(info!.sampleRate).toBe(22_050);
    expect(info!.samplesPerFrame).toBe(576);
  });

  it('honors the byte offset', () => {
    const buf = new Uint8Array([0x00, 0x00, ...MP3_SYNC]);
    expect(mp3FrameInfoAt(buf, 0)).toBeNull();
    expect(mp3FrameInfoAt(buf, 2)?.bitrateBps).toBe(128_000);
  });

  it('returns null for non-headers and reserved fields', () => {
    expect(mp3FrameInfoAt(new Uint8Array([1, 2, 3, 4]), 0)).toBeNull();
    // bitrate index 0 (free) is rejected
    expect(mp3FrameInfoAt(new Uint8Array([0xff, 0xfb, 0x0c, 0x00]), 0)).toBeNull();
    // truncated buffer
    expect(mp3FrameInfoAt(new Uint8Array([0xff, 0xfb]), 0)).toBeNull();
  });
});
