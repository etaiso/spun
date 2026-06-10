// Media-time stamps for tee audio chunks. Stamping chunks with Date.now() at
// receive lies whenever delivery isn't realtime — Icecast's burst-on-connect
// packs ~60 s of past audio into a few wall-clock seconds (measured: 70.6 s of
// audio carrying 13.5 s of stamp span), which made behind-live creep and
// jump-to-song land sloppily inside burst zones. Instead, a chunk's stamp is
// the broadcast wall-clock of its newest sample, derived from audio duration:
//
//   - While the connect burst is still draining ("settling"), stamps are
//     provisional arrival times. Once delivery drops to realtime, the burst is
//     back-stamped: its newest chunk ends "now", and stamps walk backwards by
//     each chunk's duration (clamped so no chunk is stamped after it arrived —
//     broadcast precedes arrival, always).
//   - After settle, the clock advances by each chunk's duration, clamped to
//     never exceed Date.now() (re-anchoring there), and never decreasing.
//
// Duration comes from the stream byte rate: declared icy-br first, then a
// validated MP3 frame-header sniff, then a post-settle measured rate, then a
// 128 kbps fallback. Time is injected (nowMs) so the class stays pure.
import { findSyncOffset, mp3FrameInfoAt } from '../timeshift/frameSync';

export type MediaClockOpts = {
  /** Stream bitrate in kbps as declared by icy-br / ice-audio-info. */
  declaredKbps?: number | null;
  /** Upstream content type — gates the MP3 header sniff. */
  contentType?: string;
  /** Min observation time since first audio before a natural settle. */
  settleObserveMs?: number;
  /** Trailing window for the delivery-rate check. */
  settleWindowMs?: number;
  /** Audio the window may carry beyond its wall span and still count as
   *  realtime (absorbs one delivery lump of burst cadence). */
  settleSlackMs?: number;
  /** Give up waiting for a natural settle this long after first audio. */
  forceSettleMs?: number;
  /** Force settle past this many buffered (unstamped) bytes. */
  maxPendingBytes?: number;
  /** Assumed kbps when nothing is declared, sniffable, or measured yet. */
  fallbackKbps?: number;
};

export type StampResult = {
  /** Stamp for this chunk (provisional while settling). */
  stampMs: number;
  /** Non-null exactly once — on the settle-triggering call: corrected stamps
   *  for every chunk fed so far, oldest→newest (last entry == stampMs). */
  backStamps: number[] | null;
};

const KBPS_MIN = 8;
const KBPS_MAX = 2048;
const SNIFF_CAP_BYTES = 8_192;
const MEASURE_AFTER_MS = 10_000; // observe this long before trusting bytes/sec

export class MediaClock {
  private declaredBps: number | null;
  private sniffedBps: number | null = null;
  private sniffBuf: Uint8Array | null;
  private records: { arrivalMs: number; byteLen: number }[] = [];
  private pendingBytes = 0;
  private firstAudioMs: number | null = null;
  private lastStampMs = -Infinity;
  private mediaMs = 0;
  private settledAtMs = 0;
  private bytesSinceSettle = 0;
  private isSettled = false;

  private readonly settleObserveMs: number;
  private readonly settleWindowMs: number;
  private readonly settleSlackMs: number;
  private readonly forceSettleMs: number;
  private readonly maxPendingBytes: number;
  private readonly fallbackBps: number;

  constructor(opts: MediaClockOpts = {}) {
    const kbps = opts.declaredKbps;
    this.declaredBps =
      typeof kbps === 'number' && kbps >= KBPS_MIN && kbps <= KBPS_MAX
        ? (kbps * 1000) / 8
        : null;
    const ct = (opts.contentType || '').toLowerCase();
    const sniffable = ct.includes('mpeg') || ct.includes('mp3');
    this.sniffBuf = this.declaredBps === null && sniffable ? new Uint8Array(0) : null;
    this.settleObserveMs = opts.settleObserveMs ?? 8_000;
    this.settleWindowMs = opts.settleWindowMs ?? 8_000;
    this.settleSlackMs = opts.settleSlackMs ?? 4_000;
    this.forceSettleMs = opts.forceSettleMs ?? 25_000;
    this.maxPendingBytes = opts.maxPendingBytes ?? 32 * 1024 * 1024;
    this.fallbackBps = ((opts.fallbackKbps ?? 128) * 1000) / 8;
  }

  get settled(): boolean {
    return this.isSettled;
  }

  /** Stream byte rate (bytes/sec) currently in use for duration math. */
  byteRate(nowMs: number): number {
    if (this.declaredBps !== null) return this.declaredBps;
    if (this.sniffedBps !== null) return this.sniffedBps;
    if (this.isSettled && nowMs - this.settledAtMs >= MEASURE_AFTER_MS && this.bytesSinceSettle > 0) {
      const measured = (this.bytesSinceSettle * 1000) / (nowMs - this.settledAtMs);
      return Math.min(Math.max(measured, (KBPS_MIN * 1000) / 8), (KBPS_MAX * 1000) / 8);
    }
    return this.fallbackBps;
  }

  /** Feed one audio chunk. `bytes` is only inspected while the MP3 sniff is
   *  still pending; pass it when available. */
  stamp(byteLen: number, nowMs: number, bytes?: Uint8Array): StampResult {
    if (this.firstAudioMs === null) this.firstAudioMs = nowMs;
    if (this.sniffBuf !== null && bytes) this.trySniff(bytes);

    if (!this.isSettled) {
      this.records.push({ arrivalMs: nowMs, byteLen });
      this.pendingBytes += byteLen;
      const elapsed = nowMs - this.firstAudioMs;
      const rate = this.byteRate(nowMs);
      let windowBytes = 0;
      for (let i = this.records.length - 1; i >= 0; i--) {
        if (this.records[i].arrivalMs <= nowMs - this.settleWindowMs) break;
        windowBytes += this.records[i].byteLen;
      }
      const windowDurMs = (windowBytes * 1000) / rate;
      const natural =
        elapsed >= this.settleObserveMs &&
        windowDurMs <= this.settleWindowMs + this.settleSlackMs;
      const forced =
        elapsed >= this.forceSettleMs || this.pendingBytes >= this.maxPendingBytes;
      if (natural || forced) {
        const backStamps = this.walkBack(rate);
        this.isSettled = true;
        this.settledAtMs = nowMs;
        this.bytesSinceSettle = 0;
        this.mediaMs = backStamps[backStamps.length - 1];
        this.lastStampMs = this.mediaMs;
        this.records = [];
        this.pendingBytes = 0;
        return { stampMs: this.mediaMs, backStamps };
      }
      const stampMs = Math.max(nowMs, this.lastStampMs);
      this.lastStampMs = stampMs;
      return { stampMs, backStamps: null };
    }

    const rate = this.byteRate(nowMs); // before counting this chunk's bytes
    this.bytesSinceSettle += byteLen;
    const durMs = (byteLen * 1000) / rate;
    let stampMs = Math.min(this.mediaMs + durMs, nowMs); // never stamp the future
    stampMs = Math.max(stampMs, this.lastStampMs);       // never go backwards
    this.mediaMs = stampMs;
    this.lastStampMs = stampMs;
    return { stampMs, backStamps: null };
  }

  /** Corrected stamps for the settling backlog: the newest chunk's audio ends
   *  at its arrival ("now"); every earlier chunk ends one chunk-duration
   *  before the next, but never after its own arrival. */
  private walkBack(rate: number): number[] {
    const n = this.records.length;
    const stamps = new Array<number>(n);
    stamps[n - 1] = this.records[n - 1].arrivalMs;
    for (let i = n - 2; i >= 0; i--) {
      const durNextMs = (this.records[i + 1].byteLen * 1000) / rate;
      stamps[i] = Math.min(stamps[i + 1] - durNextMs, this.records[i].arrivalMs);
    }
    return stamps;
  }

  /** Accumulate bytes until a chain-validated MP3 header yields a bitrate.
   *  A lone header at the buffer end is not trusted (could be a false sync);
   *  sniffing stops for good past SNIFF_CAP_BYTES without a verified chain. */
  private trySniff(bytes: Uint8Array): void {
    const buf = this.sniffBuf!;
    const next = new Uint8Array(Math.min(buf.length + bytes.length, SNIFF_CAP_BYTES));
    next.set(buf.subarray(0, Math.min(buf.length, next.length)), 0);
    if (next.length > buf.length) next.set(bytes.subarray(0, next.length - buf.length), buf.length);
    this.sniffBuf = next;
    const off = findSyncOffset('audio/mpeg', next);
    if (off >= 0) {
      const info = mp3FrameInfoAt(next, off)!;
      // findMp3Sync trusts an unverifiable header at the buffer end; only lock
      // the bitrate when the buffer actually covered the next frame's header.
      if (off + info.lengthBytes + 2 < next.length) {
        this.sniffedBps = info.bitrateBps / 8;
        this.sniffBuf = null;
        return;
      }
    }
    if (next.length >= SNIFF_CAP_BYTES) this.sniffBuf = null;
  }
}
