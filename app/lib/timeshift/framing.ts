// Wire/disk format for timeshift audio: every chunk is framed as
// [f64 LE wallClockMs][u32 LE payloadLen][payload]. The in-band wall clock is
// what lets the client map buffer positions to real time exactly (seeks,
// jump-to-song) for both burst (historical) and live bytes.
// Shared by server (disk ring, /api/timeshift) and client (engine) — keep this
// file free of Node and DOM imports.

export const FRAME_HEADER_BYTES = 12;

export type Frame = { wallClock: number; payload: Uint8Array };

export function encodeFrame(wallClockMs: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  const dv = new DataView(out.buffer);
  dv.setFloat64(0, wallClockMs, true);
  dv.setUint32(8, payload.length, true);
  out.set(payload, FRAME_HEADER_BYTES);
  return out;
}

/** Incremental decoder — handles frames split across arbitrary chunk
 *  boundaries. push() returns every complete frame available so far. */
export class FrameDecoder {
  // Annotated (not inferred) so it stays Uint8Array<ArrayBufferLike> — matches
  // the push() param type; an inferred `new Uint8Array(0)` would be the
  // narrower Uint8Array<ArrayBuffer> and reject the assignment below.
  private buf: Uint8Array = new Uint8Array(0);

  push(bytes: Uint8Array): Frame[] {
    if (this.buf.length === 0) {
      this.buf = bytes;
    } else {
      const next = new Uint8Array(this.buf.length + bytes.length);
      next.set(this.buf, 0);
      next.set(bytes, this.buf.length);
      this.buf = next;
    }
    const frames: Frame[] = [];
    let off = 0;
    while (this.buf.length - off >= FRAME_HEADER_BYTES) {
      const dv = new DataView(this.buf.buffer, this.buf.byteOffset + off, FRAME_HEADER_BYTES);
      const wallClock = dv.getFloat64(0, true);
      const len = dv.getUint32(8, true);
      if (this.buf.length - off < FRAME_HEADER_BYTES + len) break;
      // slice() (copy) so frames stay valid after we compact the buffer
      frames.push({ wallClock, payload: this.buf.slice(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len) });
      off += FRAME_HEADER_BYTES + len;
    }
    if (off > 0) this.buf = this.buf.slice(off);
    return frames;
  }
}
