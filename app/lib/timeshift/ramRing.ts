// The authoritative client-side buffer for the active station: 1 hour /
// 150 MB of original compressed chunks, each stamped with the broadcast
// wall-clock of its newest sample (media time, derived server-side — see
// lib/server/mediaClock.ts; briefly provisional arrival time while a fresh
// tee's connect burst settles). The MSE SourceBuffer holds only a small
// window of this (Chromium caps audio SourceBuffers ≈12 MB) — seeks outside
// that window re-append from here.
export type RingChunk = { wallClock: number; bytes: Uint8Array };
export type RamRingOpts = { maxMs: number; maxBytes: number; gapMs?: number };

export const RING_MAX_MS = 3_600_000;
export const RING_MAX_BYTES = 150 * 1024 * 1024;
// A discontinuity is a *real* hole in the audio (upstream dropped and the tee
// reconnected, losing whatever aired during the outage). It is detected as a
// jump in chunk stamps. With media-time stamps the gap is the UNRECOVERED
// part of an outage — a reconnect burst that re-covers the dropped span is
// back-stamped into place and closes the hole. The threshold still sits well
// above burst cadence: stamps are briefly arrival-based while a fresh tee
// settles, and Icecast delivers in periodic bursts (commonly every ~6 s), so
// naive small thresholds would flag fake gaps. Genuine unrecovered outages
// are much longer (tens of seconds) and still register.
export const DISCONTINUITY_GAP_MS = 30_000;

export class RamRing {
  private chunks: RingChunk[] = [];
  private bytes = 0;
  private gaps: { fromMs: number; toMs: number }[] = [];
  private gapMs: number;

  constructor(private opts: RamRingOpts = { maxMs: RING_MAX_MS, maxBytes: RING_MAX_BYTES }) {
    this.gapMs = opts.gapMs ?? DISCONTINUITY_GAP_MS;
  }

  push(wallClock: number, bytes: Uint8Array): void {
    const last = this.chunks[this.chunks.length - 1];
    if (last && wallClock - last.wallClock > this.gapMs) {
      this.gaps.push({ fromMs: last.wallClock, toMs: wallClock });
    }
    this.chunks.push({ wallClock, bytes });
    this.bytes += bytes.length;
    while (
      this.chunks.length > 1 &&
      (this.bytes > this.opts.maxBytes ||
        wallClock - this.chunks[0].wallClock > this.opts.maxMs)
    ) {
      this.bytes -= this.chunks.shift()!.bytes.length;
    }
    const start = this.chunks[0]?.wallClock ?? 0;
    this.gaps = this.gaps.filter(g => g.toMs >= start);
  }

  /** Index of the first chunk with wallClock >= ms (binary search), or -1. */
  indexAt(ms: number): number {
    let lo = 0, hi = this.chunks.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.chunks[mid].wallClock >= ms) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }

  *chunksFrom(index: number): Generator<RingChunk> {
    for (let i = index; i < this.chunks.length; i++) yield this.chunks[i];
  }

  chunkAt(index: number): RingChunk | undefined { return this.chunks[index]; }
  length(): number { return this.chunks.length; }
  startMs(): number | null { return this.chunks[0]?.wallClock ?? null; }
  endMs(): number | null { return this.chunks[this.chunks.length - 1]?.wallClock ?? null; }
  totalBytes(): number { return this.bytes; }
  discontinuities(): { fromMs: number; toMs: number }[] { return [...this.gaps]; }
  clear(): void { this.chunks = []; this.bytes = 0; this.gaps = []; }
}
