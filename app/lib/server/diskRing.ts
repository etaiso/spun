// Per-station ring of segment files. Each segment holds ~SEGMENT_MS of framed
// records (see lib/timeshift/framing.ts); rotation drops the oldest segment
// past the caps — that's the continuous GC bounding each station at ≤1 hour /
// ≤150 MB. Synchronous fs is fine here: appends are ~KB-sized and reads are
// ≤ a few MB per segment, all on a local disk.
import fs from 'node:fs';
import path from 'node:path';
import { encodeFrame, FrameDecoder, type Frame } from '../timeshift/framing';

export type DiskRingOpts = { segmentMs: number; maxSegments: number; maxBytes: number };
export const DISK_RING_DEFAULTS: DiskRingOpts = {
  segmentMs: 60_000,
  maxSegments: 60,
  maxBytes: 150 * 1024 * 1024,
};

type Segment = { file: string; startMs: number; endMs: number; bytes: number };

export class DiskRing {
  private segments: Segment[] = [];
  private fd: number | null = null;
  private disabled = false;

  constructor(private dir: string, private opts: DiskRingOpts = DISK_RING_DEFAULTS) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Append one chunk. Self-disables on fs errors (station becomes live-only)
   *  without ever throwing into the tee. */
  append(wallClockMs: number, payload: Uint8Array): void {
    if (this.disabled) return;
    try {
      const cur = this.segments[this.segments.length - 1];
      if (!cur || this.fd === null || wallClockMs - cur.startMs >= this.opts.segmentMs) {
        if (this.fd !== null) fs.closeSync(this.fd);
        const file = path.join(this.dir, `seg-${Math.round(wallClockMs)}.bin`);
        this.fd = fs.openSync(file, 'w');
        this.segments.push({ file, startMs: wallClockMs, endMs: wallClockMs, bytes: 0 });
      }
      const seg = this.segments[this.segments.length - 1];
      const frame = encodeFrame(wallClockMs, payload);
      fs.writeSync(this.fd!, frame);
      seg.endMs = wallClockMs;
      seg.bytes += frame.length;
      this.gc();
    } catch {
      this.selfDisable();
    }
  }

  private gc(): void {
    while (
      this.segments.length > this.opts.maxSegments ||
      this.segments.reduce((n, s) => n + s.bytes, 0) > this.opts.maxBytes
    ) {
      // never GC the segment we're writing into
      if (this.segments.length <= 1) break;
      const oldest = this.segments.shift()!;
      try { fs.rmSync(oldest.file, { force: true }); } catch { /* ignore */ }
    }
  }

  /** All frames from every segment whose range may overlap fromMs onward.
   *  Returns whole segments — the consumer trims by frame wallClock. Reads one
   *  segment file at a time (≤ a few MB each). */
  *readFrom(fromMs: number): Generator<Frame> {
    for (const seg of [...this.segments]) {
      // Skip segments entirely older than the request. The current segment's
      // endMs advances with each append, so live data is naturally included.
      if (seg.endMs < fromMs) continue;
      let bytes: Buffer | undefined;
      try { bytes = fs.readFileSync(seg.file); } catch { /* skip unreadable segment */ }
      if (!bytes) continue;
      const dec = new FrameDecoder();
      for (const f of dec.push(new Uint8Array(bytes))) yield f;
    }
  }

  /** Epoch ms of the oldest retained frame, or null when empty. */
  startMs(): number | null {
    return this.segments.length ? this.segments[0].startMs : null;
  }

  /** Epoch ms of the newest persisted frame, or null when empty. Lets the tee
   *  trim a back-stamped reconnect burst to only what the ring doesn't
   *  already hold. */
  endMs(): number | null {
    return this.segments.length ? this.segments[this.segments.length - 1].endMs : null;
  }

  stats(): { segments: number; bytes: number; startMs: number | null } {
    return {
      segments: this.segments.length,
      bytes: this.segments.reduce((n, s) => n + s.bytes, 0),
      startMs: this.startMs(),
    };
  }

  private selfDisable(): void {
    this.disabled = true;
    try { if (this.fd !== null) fs.closeSync(this.fd); } catch { /* ignore */ }
    this.fd = null;
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    this.segments = [];
  }

  /** Close + delete everything (untrack, cap eviction, toggle off). */
  destroy(): void { this.selfDisable(); }
}
