import { describe, it, expect } from 'vitest';
import { findSyncOffset } from '../app/lib/timeshift/frameSync';

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
});
