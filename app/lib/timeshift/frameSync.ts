// Codec sync-word scanners. After a seek, MSE appends restart from an arbitrary
// chunk boundary which may fall mid-frame; trimming to the next sync word keeps
// the SourceBuffer parser happy. MP3: 11 set bits + valid version/layer.
// ADTS AAC: 12 set bits + layer 00.

function isMp3Sync(b0: number, b1: number): boolean {
  // 0xFF + 0b111xxxxx, and reject reserved version (0b01) / reserved layer (0b00)
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  return version !== 0x01 && layer !== 0x00;
}

function isAdtsSync(b0: number, b1: number): boolean {
  // 0xFF + 0b1111xxx0 (syncword 0xFFF, layer must be 00)
  return b0 === 0xff && (b1 & 0xf6) === 0xf0;
}

/** Offset of the first codec frame boundary in `bytes`, or -1 if none.
 *  Unknown content types return 0 (no alignment needed/possible). */
export function findSyncOffset(contentType: string, bytes: Uint8Array): number {
  const ct = contentType.toLowerCase();
  const check = ct.includes('mpeg') || ct.includes('mp3') ? isMp3Sync
    : ct.includes('aac') ? isAdtsSync
    : null;
  if (!check) return 0;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (check(bytes[i], bytes[i + 1])) return i;
  }
  return -1;
}
