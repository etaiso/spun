// Codec sync-word scanners. After a seek, MSE appends restart from an arbitrary
// chunk boundary which may fall mid-frame; trimming to the next frame boundary
// keeps the SourceBuffer parser happy. A naive "0xFF 0xEx" match produces false
// positives (any such byte pair looks like an MP3 header), and appending from a
// false sync makes the demuxer reject the whole append (CHUNK_DEMUXER append
// failed → playback stops). So for MP3 we parse the frame header, compute the
// frame length, and require the NEXT frame to sync at that offset — a real
// frame chain. ADTS AAC keeps the lighter 12-bit syncword check.

// Bitrate (kbps) by bitrate index. Index 0 = free, 15 = bad (both invalid here).
const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]; // MPEG1 Layer III
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];      // MPEG2 / 2.5 Layer III
// Sample rate (Hz) by version field (3=MPEG1, 2=MPEG2, 0=MPEG2.5) and SR index.
const MP3_SAMPLERATES: Record<number, number[]> = {
  3: [44100, 48000, 32000, 0],
  2: [22050, 24000, 16000, 0],
  0: [11025, 12000, 8000, 0],
};

export type Mp3FrameInfo = {
  lengthBytes: number;
  bitrateBps: number;
  sampleRate: number;
  samplesPerFrame: number;
  durationMs: number;
};

/** Parsed header of the MPEG-audio Layer III frame starting at bytes[i], or
 *  null if those bytes aren't a valid Layer III header. The bitrate field is
 *  what lets the server derive a media clock for CBR streams (duration of N
 *  bytes = N·8/bitrate). */
export function mp3FrameInfoAt(bytes: Uint8Array, i: number): Mp3FrameInfo | null {
  if (i + 2 >= bytes.length) return null;
  const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null; // 11-bit frame sync
  const version = (b1 >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
  const layer = (b1 >> 1) & 0x03;   // 1=Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIdx = (b2 >> 4) & 0x0f;
  const srIdx = (b2 >> 2) & 0x03;
  if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null; // free/bad/reserved
  const bitrate = (version === 3 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIdx] * 1000;
  const sampleRate = MP3_SAMPLERATES[version][srIdx];
  if (!bitrate || !sampleRate) return null;
  const padding = (b2 >> 1) & 0x01;
  const samplesPerFrame = version === 3 ? 1152 : 576; // Layer III
  const len = Math.floor((samplesPerFrame / 8) * bitrate / sampleRate) + padding;
  if (len <= 4) return null;
  return {
    lengthBytes: len,
    bitrateBps: bitrate,
    sampleRate,
    samplesPerFrame,
    durationMs: (samplesPerFrame / sampleRate) * 1000,
  };
}

/** Length in bytes of the MPEG-audio Layer III frame whose header starts at
 *  bytes[i], or 0 if those bytes aren't a valid Layer III header. */
function mp3FrameLength(bytes: Uint8Array, i: number): number {
  return mp3FrameInfoAt(bytes, i)?.lengthBytes ?? 0;
}

/** First valid MP3 frame offset. A candidate is accepted only when the next
 *  frame also syncs at the computed length; if the buffer ends before the next
 *  frame, a well-formed header is trusted. Returns -1 if none. */
function findMp3Sync(bytes: Uint8Array): number {
  for (let i = 0; i + 1 < bytes.length; i++) {
    const len = mp3FrameLength(bytes, i);
    if (len === 0) continue;
    const next = i + len;
    if (next + 2 >= bytes.length) return i;        // can't verify the chain — trust it
    if (mp3FrameLength(bytes, next) > 0) return i;  // real frame chain
    // otherwise a false sync — keep scanning
  }
  return -1;
}

function isAdtsSync(b0: number, b1: number): boolean {
  // 0xFF + 0b1111xxx0 (syncword 0xFFF, layer must be 00)
  return b0 === 0xff && (b1 & 0xf6) === 0xf0;
}

/** Offset of the first codec frame boundary in `bytes`, or -1 if none.
 *  Unknown content types return 0 (no alignment needed/possible). */
export function findSyncOffset(contentType: string, bytes: Uint8Array): number {
  const ct = contentType.toLowerCase();
  if (ct.includes('mpeg') || ct.includes('mp3')) return findMp3Sync(bytes);
  if (ct.includes('aac')) {
    for (let i = 0; i + 1 < bytes.length; i++) if (isAdtsSync(bytes[i], bytes[i + 1])) return i;
    return -1;
  }
  return 0;
}
