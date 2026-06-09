'use client';

// MSE playback engine for the active station. Pulls the framed /api/timeshift
// stream, keeps the authoritative RamRing (1 hr), and feeds a SourceBuffer
// ('sequence' mode) a sliding window around the playhead. Seeks resolve
// fastest-tier-first (resolveSeek). Every failure path calls onFallback() —
// the Player then reverts to today's plain <audio> + /api/stream.
import { FrameDecoder } from './framing';
import { findSyncOffset } from './frameSync';
import { RamRing } from './ramRing';
import { TimeMap } from './timeMap';
import { resolveSeek, type Range } from './resolveSeek';

const AHEAD_MAX_SEC = 45;      // stop appending this far ahead of the playhead
const BEHIND_KEEP_SEC = 180;   // evict SourceBuffer data older than this
const STATE_TICK_MS = 500;
// "At live" is hysteretic, not a bare threshold: upstream delivers in ~6 s
// bursts, so behind-live naturally sawtooths 0–~6 s at the edge. Without
// hysteresis the LIVE pill would flicker between "● Live" and "−00:0x". Enter
// the live state below ENTER, only leave it above EXIT — the band is wider than
// one burst so the sawtooth can't toggle it.
const LIVE_ENTER_SEC = 5;
const LIVE_EXIT_SEC = 12;

export type TimeshiftState = {
  active: true;
  behindSec: number;            // 0 at the live edge
  atLiveEdge: boolean;          // hysteretic "at live" flag — drives the LIVE pill
  playheadMs: number | null;    // wall clock at the playhead
  liveEdgeMs: number | null;
  bufferStartMs: number | null; // oldest seekable (disk-aware)
  ramStartMs: number | null;
  ramBytes: number;
  sourceBufferAhead: number;    // seconds buffered ahead of playhead
  lastSeekTier: 'window' | 'ram' | 'disk' | null;
  discontinuities: { fromMs: number; toMs: number }[];
  contentType: string;
};

export type EngineOpts = {
  streamUrl: string;
  stationId: string;
  onState: (s: TimeshiftState) => void;
  onFallback: (reason: string) => void;
};

function mseMime(contentType: string): string | null {
  const ct = contentType.toLowerCase();
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'audio/mpeg';
  if (ct.includes('aac')) return 'audio/aac';
  return null;
}

export class TimeshiftEngine {
  private ring = new RamRing();
  private timeMap = new TimeMap();
  private mediaSource: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private fetchAbort: AbortController | null = null;
  private appendCursor = 0;          // ring index of the next chunk to append
  private appendedWallClocks: number[] = []; // wallClock per in-flight append
  // True only until the first chunk after a (re)build is appended. Gates the
  // codec frame-sync trim, which must happen exactly ONCE per build — trimming
  // every chunk would discard the leading bytes that complete the previous
  // chunk's trailing partial frame, corrupting the stream (decodes to a
  // SourceBuffer error on playback even though it buffers fine while paused).
  private needAlign = true;
  // Smoothed live-edge clock. Upstream (Icecast) delivers audio in bursts — a
  // ~6 s chunk lands at one instant, so ring.endMs() (newest arrival wall-clock)
  // lurches forward in 6 s steps and sits flat between bursts. Using it directly
  // makes "behind live" and the scrubber jump back and forth. Instead we track
  // the newest chunk's wall-clock plus the perf-clock moment it arrived, then
  // advance the live edge by real elapsed time — re-anchoring on each new burst
  // (which lands ~where the estimate already is, so no visible jump).
  private liveWallClock = 0;
  private livePerf = 0;
  private liveSticky = true; // hysteretic "at live edge" — see LIVE_ENTER/EXIT
  private contentType = '';
  private mime = '';
  private diskStartMs: number | null = null;
  private lastSeekTier: TimeshiftState['lastSeekTier'] = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private objectUrl: string | null = null;

  constructor(private audio: HTMLAudioElement, private opts: EngineOpts) {}

  /** Resolves true when MSE playback is wired up; false → caller uses the
   *  plain path (no error UI — this is the format gate). */
  async start(): Promise<boolean> {
    if (typeof MediaSource === 'undefined') return false;
    try {
      const ok = await this.openStream('live');
      if (!ok) return false;
      await this.buildMediaSource(/* fromIndex */ 0);
      this.stateTimer = setInterval(() => this.publishState(), STATE_TICK_MS);
      return true;
    } catch (e) {
      this.fail(`start: ${String(e)}`);
      return false;
    }
  }

  /** Open (or re-open) the framed stream. from='live' or epoch ms. Returns
   *  false when the format gate fails (not an error). */
  private async openStream(from: 'live' | number): Promise<boolean> {
    this.fetchAbort?.abort();
    this.fetchAbort = new AbortController();
    const url = `/api/timeshift?url=${encodeURIComponent(this.opts.streamUrl)}` +
      `&sid=${encodeURIComponent(this.opts.stationId)}&from=${from}`;
    const res = await fetch(url, { signal: this.fetchAbort.signal });
    if (!res.ok || !res.body) throw new Error(`timeshift route ${res.status}`);
    this.contentType = res.headers.get('x-upstream-content-type') || '';
    const mime = mseMime(this.contentType);
    if (!mime || !MediaSource.isTypeSupported(mime)) {
      this.fetchAbort.abort();
      return false; // format gate — silent fallback
    }
    this.mime = mime;
    const bufStart = res.headers.get('x-buffer-start');
    this.diskStartMs = bufStart ? Number(bufStart) : null;
    if (from !== 'live') {
      this.ring.clear(); // disk seek replays through to live
      this.liveWallClock = 0; // re-derived from the replayed frames below
    }
    void this.pump(res.body, this.fetchAbort.signal);
    return true;
  }

  private async pump(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const dec = new FrameDecoder();
    try {
      while (!signal.aborted && !this.stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const f of dec.push(value)) this.ring.push(f.wallClock, f.payload);
        const end = this.ring.endMs();
        if (end !== null && end > this.liveWallClock) {
          this.liveWallClock = end;
          this.livePerf = performance.now();
        }
        this.tryAppend();
      }
    } catch (e) {
      if (!signal.aborted && !this.stopped) this.fail(`stream: ${String(e)}`);
    }
  }

  /** (Re)create the MediaSource pipeline appending from a ring index. Used on
   *  start and for ram/disk-tier seeks (recreate > surgical SourceBuffer
   *  remove/re-append — simpler and immune to 'sequence' timestamp drift). */
  private buildMediaSource(fromIndex: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      const ms = new MediaSource();
      this.mediaSource = ms;
      this.sb = null;
      this.timeMap.reset();
      this.appendCursor = fromIndex;
      this.appendedWallClocks = [];
      this.needAlign = true;
      this.objectUrl = URL.createObjectURL(ms);
      const wasPaused = this.audio.paused;
      this.audio.src = this.objectUrl;
      ms.addEventListener('sourceopen', () => {
        try {
          const sb = ms.addSourceBuffer(this.mime);
          sb.mode = 'sequence';
          this.sb = sb;
          sb.addEventListener('updateend', () => this.onUpdateEnd());
          sb.addEventListener('error', () => this.fail('sourcebuffer error'));
          this.tryAppend();
          if (!wasPaused) this.audio.play().catch(() => { /* gesture-gated */ });
          resolve();
        } catch (e) { reject(e); }
      }, { once: true });
    });
  }

  /** Append the next ring chunk when allowed: SourceBuffer idle, playhead not
   *  too far behind the append head (AHEAD_MAX), frame-aligned at (re)starts. */
  private tryAppend(): void {
    const sb = this.sb;
    if (!sb || sb.updating || this.stopped) return;
    if (this.appendCursor >= this.ring.length()) return;
    // Don't run unboundedly ahead of the playhead (12 MB Chromium quota).
    const buffered = sb.buffered;
    if (buffered.length > 0 &&
        buffered.end(buffered.length - 1) - this.audio.currentTime > AHEAD_MAX_SEC &&
        !this.audio.paused) {
      return; // timeupdate listener re-kicks us
    }
    let chunk = this.ring.chunkAt(this.appendCursor);
    if (!chunk) return;
    let bytes = chunk.bytes;
    if (this.needAlign) {
      // First append after a (re)build — align to a codec frame boundary so the
      // SourceBuffer parser starts on a clean frame. Skip past any chunks with
      // no sync offset (iteratively, to avoid deep recursion on a run of
      // sync-less chunks) until one aligns or the ring is exhausted. Once a
      // chunk is appended we must NOT trim again — later chunks carry the bytes
      // that complete each frame split across the chunk boundary.
      let off = findSyncOffset(this.contentType, bytes);
      while (off < 0) {
        this.appendCursor++;
        chunk = this.ring.chunkAt(this.appendCursor);
        if (!chunk) return;
        bytes = chunk.bytes;
        off = findSyncOffset(this.contentType, bytes);
      }
      bytes = bytes.subarray(off);
    }
    try {
      this.evictBehind();
      sb.appendBuffer(bytes as BufferSource);
      this.needAlign = false;
      this.appendedWallClocks.push(chunk.wallClock);
      this.appendCursor++;
    } catch (e) {
      if ((e as DOMException)?.name === 'QuotaExceededError') {
        this.evictBehind(true);
        // retried on the next updateend/tick
      } else {
        this.fail(`append: ${String(e)}`);
      }
    }
  }

  private onUpdateEnd(): void {
    const sb = this.sb;
    if (!sb) return;
    const wc = this.appendedWallClocks.shift();
    const buffered = sb.buffered;
    if (wc !== undefined && buffered.length > 0) {
      this.timeMap.addAnchor(buffered.end(buffered.length - 1), wc);
    }
    this.tryAppend();
  }

  private evictBehind(aggressive = false): void {
    const sb = this.sb;
    if (!sb || sb.updating) return;
    const buffered = sb.buffered;
    if (buffered.length === 0) return;
    const keep = aggressive ? 30 : BEHIND_KEEP_SEC;
    const cut = this.audio.currentTime - keep;
    if (cut > buffered.start(0)) {
      try { sb.remove(buffered.start(0), cut); } catch { /* updating — later */ }
    }
  }

  // ---- public controls -------------------------------------------------

  seekBy(deltaSec: number): void {
    const playheadMs = this.playheadWallClock();
    if (playheadMs === null) return;
    this.seekToWallClock(playheadMs + deltaSec * 1000);
  }

  goLive(): void {
    const end = this.ring.endMs();
    if (end !== null) {
      this.liveSticky = true; // snap the pill to "Live" immediately on click
      this.seekToWallClock(end);
    }
  }

  seekToWallClock(targetMs: number): void {
    try {
      const win = this.windowRange();
      const ram: Range = this.ring.startMs() !== null
        ? { startMs: this.ring.startMs()!, endMs: this.ring.endMs()! } : null;
      const disk: Range = this.diskStartMs !== null && ram
        ? { startMs: this.diskStartMs, endMs: ram.endMs } : null;
      const plan = resolveSeek(targetMs, win, ram, disk);
      this.lastSeekTier = plan.tier;
      if (plan.tier === 'window') {
        const bt = this.timeMap.bufferTimeAt(plan.targetMs);
        if (bt !== null) this.audio.currentTime = bt;
      } else if (plan.tier === 'ram') {
        const idx = this.ring.indexAt(plan.targetMs);
        if (idx >= 0) void this.buildMediaSource(idx).catch(e => this.fail(String(e)));
      } else {
        // disk: re-open the stream from the target; ring is cleared and
        // rebuilt from the replayed history through to live.
        void this.openStream(plan.targetMs)
          .then(() => this.buildMediaSource(0))
          .catch(e => this.fail(String(e)));
      }
      this.publishState();
    } catch (e) {
      this.fail(`seek: ${String(e)}`);
    }
  }

  /** Call from the audio element's timeupdate — keeps the append loop fed. */
  onTimeUpdate(): void { this.tryAppend(); }

  // ---- state -------------------------------------------------------------

  private windowRange(): Range {
    const sb = this.sb;
    if (!sb || sb.buffered.length === 0) return null;
    const start = this.timeMap.wallClockAt(sb.buffered.start(0));
    const end = this.timeMap.wallClockAt(sb.buffered.end(sb.buffered.length - 1));
    return start !== null && end !== null ? { startMs: start, endMs: end } : null;
  }

  private playheadWallClock(): number | null {
    return this.timeMap.wallClockAt(this.audio.currentTime);
  }

  /** Live edge for DISPLAY (behind-live readout, scrubber right edge): the
   *  newest chunk's wall-clock advanced by real elapsed time, so bursty upstream
   *  delivery doesn't make the UI lurch. Never regresses below actual newest
   *  data. Seeks/goLive still use ring.endMs() (real data), not this estimate. */
  private smoothLiveEdgeMs(): number | null {
    const newest = this.ring.endMs();
    if (newest === null) return null;
    const est = this.liveWallClock + (performance.now() - this.livePerf);
    return Math.max(est, newest);
  }

  getState(): TimeshiftState {
    const playheadMs = this.playheadWallClock();
    const liveEdgeMs = this.smoothLiveEdgeMs();
    const sb = this.sb;
    const ahead = sb && sb.buffered.length > 0
      ? Math.max(0, sb.buffered.end(sb.buffered.length - 1) - this.audio.currentTime)
      : 0;
    const behindSec = playheadMs !== null && liveEdgeMs !== null
      ? Math.max(0, (liveEdgeMs - playheadMs) / 1000) : 0;
    // Hysteresis so the LIVE pill doesn't flicker on the burst sawtooth.
    if (this.liveSticky) { if (behindSec > LIVE_EXIT_SEC) this.liveSticky = false; }
    else { if (behindSec < LIVE_ENTER_SEC) this.liveSticky = true; }
    return {
      active: true,
      behindSec,
      atLiveEdge: this.liveSticky,
      playheadMs,
      liveEdgeMs,
      bufferStartMs: this.diskStartMs ?? this.ring.startMs(),
      ramStartMs: this.ring.startMs(),
      ramBytes: this.ring.totalBytes(),
      sourceBufferAhead: ahead,
      lastSeekTier: this.lastSeekTier,
      discontinuities: this.ring.discontinuities(),
      contentType: this.contentType,
    };
  }

  private publishState(): void {
    if (!this.stopped) this.opts.onState(this.getState());
  }

  private fail(reason: string): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onFallback(reason);
  }

  stop(): void {
    this.stopped = true;
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.fetchAbort?.abort();
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.ring.clear();
  }
}
