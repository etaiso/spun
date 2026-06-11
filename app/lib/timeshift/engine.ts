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
import { resolveSeek, resolveNearLiveSeek, type Range } from './resolveSeek';
import { LiveEdgeEstimator } from './liveEdge';
import { BehindSmoother } from './behind';
import { LiveBandEstimator } from './liveBand';
import { ReconnectPolicy } from './reconnect';

const AHEAD_MAX_SEC = 45;      // stop appending this far ahead of the playhead
const BEHIND_KEEP_SEC = 180;   // evict SourceBuffer data older than this
const STATE_TICK_MS = 500;
// "At live" is hysteretic, not a bare threshold: bursty upstreams make
// behind-live sawtooth 0–~6 s at the edge, which would flicker the LIVE pill
// without one. Enter the live state below the band's enter value, only leave
// it above exit. The band adapts to each station's measured delivery cadence
// (see LiveBandEstimator) — smooth stations narrow it so near-live positions
// like −00:01 stay pinpointable; bursty ones keep the wide default.

export type TimeshiftState = {
  active: true;
  behindSec: number;            // 0 at the live edge
  atLiveEdge: boolean;          // hysteretic "at live" flag — drives the LIVE pill
  liveEnterSec: number;         // adaptive band: behind less than this renders as "Live"
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
  // HLS playlists ('audio/mpegurl', 'application/vnd.apple.mpegurl') must not
  // match the 'mpeg' substring below: the playlist text is not a continuous
  // stream — the feed ends after one file, which the engine would treat as an
  // upstream drop and reconnect-loop until it falls back.
  if (ct.includes('mpegurl')) return null;
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
  // Smoothed, monotone live-edge clock — see LiveEdgeEstimator for why naive
  // re-anchoring makes the behind-live readout sawtooth.
  private liveEdge = new LiveEdgeEstimator();
  // Physics-derived behind-live readout — see BehindSmoother for why the raw
  // stamp-based value jitters and creeps.
  private behind = new BehindSmoother();
  // Per-station near-live band, measured from arrival cadence — see LiveBandEstimator.
  private liveBand = new LiveBandEstimator();
  private liveSticky = true; // hysteretic "at live edge" — see the band comment above
  // Rebuilds (ram/disk seeks) must not overlap: a second buildMediaSource while
  // the first is mid-flight corrupts the append stream (CHUNK_DEMUXER append
  // failed). While building, a new seek is coalesced into pendingSeekMs and
  // applied once the current rebuild settles (latest target wins).
  private building = false;
  private pendingSeekMs: number | null = null;
  private contentType = '';
  private mime = '';
  private diskStartMs: number | null = null;
  private lastSeekTier: TimeshiftState['lastSeekTier'] = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private objectUrl: string | null = null;
  // Some upstreams (CDN-fronted Icecast) drop every connection after a few
  // minutes; the server tee dies and a fresh one is created on the next
  // /api/timeshift open. So a stream ending is NOT terminal: re-open with
  // backoff and only fail() (→ plain-audio fallback) when the policy gives up,
  // so periodic drops never burn the Player's retry budget.
  private reconnect = new ReconnectPolicy();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Stamps of the first chunk of each stream connection. A reconnected
  // upstream resumes at an arbitrary byte offset, so when the append loop
  // reaches such a chunk it must re-run the frame-sync trim (needAlign) —
  // the junction is a permanent byte discontinuity in the ring, so this also
  // re-fires when a seek rebuild re-appends across it.
  private realignWallClocks = new Set<number>();

  constructor(private audio: HTMLAudioElement, private opts: EngineOpts) {}

  /** Resolves true when MSE playback is wired up; false → caller uses the
   *  plain path (no error UI — this is the format gate). */
  async start(): Promise<boolean> {
    if (typeof MediaSource === 'undefined') return false;
    try {
      const ok = await this.openStream('live');
      if (!ok) return false;
      if (this.stopped) return false; // torn down during the async openStream (Strict Mode remount)
      this.building = true;
      await this.buildMediaSource(/* fromIndex */ 0);
      this.afterBuild();
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
    // A deliberate (re)open supersedes any reconnect waiting on its backoff
    // timer — without this, the timer would later fire and abort this stream.
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.fetchAbort?.abort();
    this.fetchAbort = new AbortController();
    const url = `/api/timeshift?url=${encodeURIComponent(this.opts.streamUrl)}` +
      `&sid=${encodeURIComponent(this.opts.stationId)}&from=${from}`;
    const res = await fetch(url, { signal: this.fetchAbort.signal });
    // Torn down while the fetch was in flight (stop() aborts the PREVIOUS
    // controller, not the one this call just installed) — drop the response
    // body, or the server keeps streaming to a reader nobody drains.
    if (this.stopped) {
      this.fetchAbort.abort();
      return false;
    }
    if (!res.ok || !res.body) throw new Error(`timeshift route ${res.status}`);
    this.contentType = res.headers.get('x-upstream-content-type') || '';
    const mime = mseMime(this.contentType);
    if (!mime || !MediaSource.isTypeSupported(mime)) {
      this.fetchAbort.abort();
      return false; // format gate — silent fallback
    }
    this.mime = mime;
    this.reconnect.connected(performance.now());
    const bufStart = res.headers.get('x-buffer-start');
    this.diskStartMs = bufStart ? Number(bufStart) : null;
    if (from !== 'live') {
      this.ring.clear(); // disk seek replays through to live
      this.realignWallClocks.clear(); // ring stamps gone — marks are stale
      this.liveEdge.reset(); // re-anchored from the replayed frames below
    }
    void this.pump(res.body, this.fetchAbort.signal);
    return true;
  }

  private async pump(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const dec = new FrameDecoder();
    // A reconnect's opening burst can overlap what the ring already holds
    // (the server tee survived and replays its RAM tail): such frames are
    // SKIPPED — appending them would duplicate audio. An overlap also proves
    // the byte stream dovetails with what we already consumed (same tee, same
    // chunk sequence), so no frame-sync realign is needed. Only when the first
    // genuinely new frame arrives with NO overlap (fresh tee, or the outage
    // outran the replay tail) is the connection a byte discontinuity that the
    // append loop must re-align at.
    let pendingRealign = true;
    let sawOverlap = false;
    try {
      while (!signal.aborted && !this.stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        this.liveBand.push(performance.now());
        for (const f of dec.push(value)) {
          // The dedup window is ONLY the connection's opening replay (until
          // the first accepted frame). In-flow frames must never be skipped:
          // while a fresh tee's clock settles, burst chunks carry equal
          // provisional arrival stamps, and a stamp-based skip there would
          // silently drop audio bytes — a corrupt seam the decoder trips
          // over minutes later.
          if (pendingRealign) {
            const end = this.ring.endMs();
            if (end !== null && f.wallClock <= end) { sawOverlap = true; continue; }
            if (!sawOverlap) this.realignWallClocks.add(f.wallClock);
            pendingRealign = false;
          }
          this.ring.push(f.wallClock, f.payload);
        }
        const end = this.ring.endMs();
        if (end !== null) this.liveEdge.push(end, performance.now());
        this.tryAppend();
      }
    } catch (e) {
      if (!signal.aborted && !this.stopped) this.scheduleReconnect(`stream error: ${String(e)}`);
      return;
    }
    // Clean end: the upstream dropped and the server tee died with it. A fresh
    // tee is created on the next open — reconnect rather than letting the
    // SourceBuffer drain into a stall.
    if (!signal.aborted && !this.stopped) this.scheduleReconnect('stream ended');
  }

  /** Ask the policy for a backoff delay and re-open the live stream after it;
   *  fail() to plain audio only when the policy gives up. The ring is kept —
   *  history stays seekable and any unrecovered wall-clock gap is rendered as
   *  a discontinuity. */
  private scheduleReconnect(reason: string): void {
    const decision = this.reconnect.streamEnded(performance.now());
    if (decision.action === 'give-up') {
      this.fail(`reconnect exhausted: ${reason}`);
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reopenLive();
    }, decision.delayMs);
  }

  private async reopenLive(): Promise<void> {
    if (this.stopped) return;
    try {
      const ok = await this.openStream('live');
      // The format gate can't transiently fail (same station, same codec) —
      // if it does, the content type really changed under us; fall back.
      if (!ok) this.fail('reconnect: format gate');
    } catch (e) {
      this.scheduleReconnect(`reopen failed: ${String(e)}`);
    }
  }

  /** (Re)create the MediaSource pipeline appending from a ring index. Used on
   *  start and for ram/disk-tier seeks (recreate > surgical SourceBuffer
   *  remove/re-append — simpler and immune to 'sequence' timestamp drift). */
  private buildMediaSource(fromIndex: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // A stopped engine must never touch the shared <audio> element. In React
      // Strict Mode (dev) the Player mounts twice, so a torn-down engine's
      // in-flight start() could otherwise clobber the live engine's src.
      if (this.stopped) { resolve(); return; }
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      const ms = new MediaSource();
      this.mediaSource = ms;
      this.sb = null;
      this.timeMap.reset();
      this.behind.reset(); // ct restarts near zero with the new SourceBuffer
      this.appendCursor = fromIndex;
      this.appendedWallClocks = [];
      this.needAlign = true;
      this.objectUrl = URL.createObjectURL(ms);
      const wasPaused = this.audio.paused;
      this.audio.src = this.objectUrl;
      ms.addEventListener('sourceopen', () => {
        if (this.stopped) { resolve(); return; }
        try {
          const sb = ms.addSourceBuffer(this.mime);
          sb.mode = 'sequence';
          this.sb = sb;
          // Pass `sb` so the handlers can ignore stale events: a seek rebuilds
          // the MediaSource, detaching this SourceBuffer, but a pending append's
          // updateend/error can still fire afterward.
          sb.addEventListener('updateend', () => this.onUpdateEnd(sb));
          sb.addEventListener('error', () => { if (!this.stopped && sb === this.sb) this.fail('sourcebuffer error'); });
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
    // Crossing into a new connection's bytes (reconnect junction) — the
    // upstream resumed at an arbitrary byte offset, so re-run the frame-sync
    // trim exactly as after a (re)build. Trimming alone is not enough: the
    // OLD connection's final chunk likely ended mid-frame and that partial
    // frame is still pending inside the SourceBuffer's segment parser —
    // followed by our trimmed (clean) bytes it decodes as garbage and errors
    // the media element. abort() is the spec mechanism to drop the pending
    // partial input and reset the parser. (No-op risk: sb isn't updating here
    // — guarded above — and buffered data is unaffected.)
    if (this.realignWallClocks.has(chunk.wallClock) && !this.needAlign) {
      try { sb.abort(); } catch { /* detached — the rebuild path handles it */ }
      this.needAlign = true;
    }
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
      // remove() is async like append: if eviction just started one, this
      // append must wait. Its updateend re-enters tryAppend, the eviction cut
      // is then a no-op, and the append proceeds. Without this bail the
      // appendBuffer below throws InvalidStateError the first time the
      // playhead crosses BEHIND_KEEP_SEC — which used to kill the engine
      // ~3 minutes into every uninterrupted playback.
      if (sb.updating) return;
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

  private onUpdateEnd(sb: SourceBuffer): void {
    // Ignore events from a SourceBuffer that's been superseded (seek rebuild) or
    // torn down — reading .buffered on a removed SourceBuffer throws.
    if (this.stopped || sb !== this.sb) return;
    const wc = this.appendedWallClocks.shift();
    let buffered: TimeRanges;
    try { buffered = sb.buffered; } catch { return; }
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
    // A rebuild is in flight — remember the latest target and apply it when the
    // current rebuild finishes, rather than starting an overlapping one.
    if (this.building) { this.pendingSeekMs = targetMs; return; }
    try {
      // Near-live targets resolve as audio distance from the buffered end —
      // wall-clock anchors are degenerate there (see resolveNearLiveSeek).
      const sb = this.sb;
      const edge = this.smoothLiveEdgeMs();
      const newest = this.ring.endMs();
      if (sb && sb.buffered.length > 0 && edge !== null && newest !== null) {
        const near = resolveNearLiveSeek(
          targetMs, edge, newest,
          sb.buffered.start(0), sb.buffered.end(sb.buffered.length - 1),
          this.appendCursor >= this.ring.length(),
          this.liveBand.band(performance.now()).enterSec,
        );
        if (near !== null) {
          // A deliberate seek overrides the hysteresis: snap the pill to LIVE
          // inside the enter band, and drop it when seeking behind — without
          // this, a click just outside the band keeps the stale sticky flag
          // until the exit threshold.
          this.liveSticky = near.snapLive;
          this.audio.currentTime = near.bufferTime;
          this.lastSeekTier = 'window';
          this.publishState();
          return;
        }
      }
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
        if (idx >= 0) {
          this.building = true;
          void this.buildMediaSource(idx)
            .then(() => this.afterBuild())
            .catch(e => { this.building = false; this.fail(String(e)); });
        }
      } else {
        // disk: re-open the stream from the target; ring is cleared and
        // rebuilt from the replayed history through to live.
        this.building = true;
        void this.openStream(plan.targetMs)
          .then(() => this.buildMediaSource(0))
          .then(() => this.afterBuild())
          .catch(e => { this.building = false; this.fail(String(e)); });
      }
      this.publishState();
    } catch (e) {
      this.fail(`seek: ${String(e)}`);
    }
  }

  /** Clear the build lock and apply any seek that arrived while rebuilding. */
  private afterBuild(): void {
    this.building = false;
    if (this.pendingSeekMs !== null && !this.stopped) {
      const t = this.pendingSeekMs;
      this.pendingSeekMs = null;
      this.seekToWallClock(t);
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

  /** Live edge for DISPLAY (behind-live readout, scrubber right edge):
   *  monotone 1×-real-time estimate (LiveEdgeEstimator), so bursty upstream
   *  delivery neither lurches nor regresses the UI. Never below actual newest
   *  data. Seeks/goLive still use ring.endMs() (real data), not this estimate. */
  private smoothLiveEdgeMs(): number | null {
    const newest = this.ring.endMs();
    if (newest === null) return null;
    const est = this.liveEdge.estimateAt(performance.now());
    return Math.max(est ?? newest, newest);
  }

  getState(): TimeshiftState {
    const playheadMs = this.playheadWallClock();
    const liveEdgeMs = this.smoothLiveEdgeMs();
    const sb = this.sb;
    const ahead = sb && sb.buffered.length > 0
      ? Math.max(0, sb.buffered.end(sb.buffered.length - 1) - this.audio.currentTime)
      : 0;
    const rawBehind = playheadMs !== null && liveEdgeMs !== null
      ? Math.max(0, (liveEdgeMs - playheadMs) / 1000) : 0;
    const behindSec = playheadMs !== null && liveEdgeMs !== null
      ? this.behind.update(rawBehind, this.audio.currentTime, performance.now())
      : rawBehind;
    // Hysteresis so the LIVE pill doesn't flicker on the burst sawtooth.
    const band = this.liveBand.band(performance.now());
    if (this.liveSticky) { if (behindSec > band.exitSec) this.liveSticky = false; }
    else { if (behindSec < band.enterSec) this.liveSticky = true; }
    return {
      active: true,
      behindSec,
      atLiveEdge: this.liveSticky,
      liveEnterSec: band.enterSec,
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
    // Deliberately loud: fallback means the user loses rewind for the session
    // (or burns a retry) — the reason must be visible in the field.
    console.warn('[timeshift] engine failed:', reason);
    this.stop();
    this.opts.onFallback(reason);
  }

  stop(): void {
    this.stopped = true;
    if (this.stateTimer) clearInterval(this.stateTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.fetchAbort?.abort();
    if (this.objectUrl) {
      // Don't revoke a blob that's still the element's src — doing so errors the
      // media element. If another engine has already taken over the element
      // (src differs), it's safe to revoke; otherwise leave it for GC once the
      // next src is set.
      if (this.audio.src !== this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.ring.clear();
  }
}
