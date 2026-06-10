// One upstream connection per station, shared by playback and metadata.
// Unifying them (a) halves per-station bandwidth vs the old two-connection
// model and (b) aligns song timestamps with the audio buffer to sub-second —
// two Icecast connections opened at different times sit 10–30s apart in the
// stream (burst-on-connect), which would make jump-to-song land sloppily.
//
// Chunks are stamped with MEDIA time (broadcast wall-clock of each chunk's
// newest sample, see MediaClock), not arrival time: Icecast delivers in
// bursts, so arrival stamps compress ~60s of burst-on-connect audio into a
// few seconds and jitter every burst. While the connect burst settles, live
// fan-out carries provisional arrival stamps; the RAM tail and the disk ring
// get the corrected back-stamps (ring appends are held until settle).
import { demuxIcy } from '../icy';
import { DiskRing, DISK_RING_DEFAULTS } from './diskRing';
import { MediaClock } from './mediaClock';
import { ensureCleanRoot } from './timeshiftDir';
import path from 'node:path';

const UA = 'Spun/0.1';
const LIVE_TAIL_BYTES = 128 * 1024; // burst budget for instant live joins
export const MAX_DISK_RINGS = 5;

export type AudioSubscriber = {
  /** wallClockMs is the chunk's media-time stamp — the broadcast wall-clock
   *  of its newest sample (provisional arrival time during the brief
   *  settling window after connect). */
  onChunk: (wallClockMs: number, bytes: Uint8Array) => void;
  onEnd: () => void;
};
export type TeeInfo = { contentType: string; hasMeta: boolean };
export type Fetcher = (url: string) => Promise<Response>;

const defaultFetcher: Fetcher = (url) =>
  fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': UA } });

type AudioRecord = { wallClock: number; bytes: Uint8Array };

export class StationTee {
  private audioSubs = new Set<AudioSubscriber>();
  private titleSubs = new Set<(title: string) => void>();
  private tail: AudioRecord[] = [];
  private tailTotal = 0;
  private info: TeeInfo | null = null;
  private readyPromise: Promise<TeeInfo>;
  private abort = new AbortController();
  private bytesSeen = 0;
  private startedAtMs = 0;
  private clock: MediaClock | null = null;
  // Records received while the media clock is still settling. They share
  // objects with `tail`, so the settle-time stamp rewrite corrects both; ring
  // appends are held here until the corrected stamps exist.
  private pending: AudioRecord[] | null = [];
  dead = false;
  ring: DiskRing | null = null;

  constructor(public url: string, fetcher: Fetcher = defaultFetcher) {
    this.readyPromise = this.run(fetcher);
  }

  private async run(fetcher: Fetcher): Promise<TeeInfo> {
    let upstream: Response;
    try {
      upstream = await fetcher(this.url);
    } catch (e) {
      this.die();
      throw new Error(`upstream fetch failed: ${String(e)}`);
    }
    if (!upstream.ok || !upstream.body) {
      this.die();
      throw new Error(`upstream returned ${upstream.status}`);
    }
    const metaInt = parseInt(upstream.headers.get('icy-metaint') || '', 10);
    const hasMeta = Number.isFinite(metaInt) && metaInt > 0;
    this.info = {
      contentType: upstream.headers.get('content-type') || 'audio/mpeg',
      hasMeta,
    };
    this.clock = new MediaClock({
      declaredKbps: declaredKbps(upstream.headers),
      contentType: this.info.contentType,
    });
    this.startedAtMs = Date.now();
    // Pump in the background; ready() resolves as soon as headers are known.
    void this.pump(upstream.body, hasMeta ? metaInt : 0);
    return this.info;
  }

  private async pump(body: ReadableStream<Uint8Array>, metaInt: number): Promise<void> {
    try {
      if (metaInt > 0) {
        for await (const ev of demuxIcy(body, metaInt)) {
          if (this.abort.signal.aborted) break;
          if (ev.kind === 'audio') this.onAudio(ev.bytes);
          else for (const cb of this.titleSubs) cb(ev.title);
        }
      } else {
        const reader = body.getReader();
        while (!this.abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          this.onAudio(value);
        }
        await reader.cancel().catch(() => {});
      }
    } catch { /* upstream died — fall through to die() */ }
    this.die();
  }

  private onAudio(bytes: Uint8Array): void {
    const { stampMs, backStamps } = this.clock!.stamp(bytes.length, Date.now(), bytes);
    const rec: AudioRecord = { wallClock: stampMs, bytes };
    this.bytesSeen += bytes.length;
    this.tail.push(rec);
    this.tailTotal += bytes.length;
    while (this.tailTotal > LIVE_TAIL_BYTES && this.tail.length > 1) {
      this.tailTotal -= this.tail.shift()!.bytes.length;
    }
    if (this.pending) {
      this.pending.push(rec);
      if (backStamps) {
        // The clock just settled: rewrite the held records with their
        // corrected stamps (also fixes the shared tail entries), then flush
        // to the ring — but only frames newer than what it already holds, so
        // a reconnect burst doesn't re-record audio the previous tee
        // persisted (stamps stay strictly increasing; any remaining gap is a
        // genuine unrecovered outage, which the client renders as a
        // discontinuity).
        const recs = this.pending;
        this.pending = null;
        for (let i = 0; i < recs.length; i++) recs[i].wallClock = backStamps[i];
        const after = this.ring?.endMs() ?? -Infinity;
        if (this.ring) {
          for (const r of recs) {
            if (r.wallClock > after) this.ring.append(r.wallClock, r.bytes);
          }
        }
      }
    } else {
      this.ring?.append(stampMs, bytes);
    }
    for (const sub of this.audioSubs) sub.onChunk(rec.wallClock, bytes);
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.abort.abort();
    for (const sub of this.audioSubs) sub.onEnd();
    this.audioSubs.clear();
    this.titleSubs.clear();
    // NOTE: the ring is NOT destroyed here — it survives reconnects (the
    // wall-clock gap between old and new tee frames IS the discontinuity
    // marker the client renders). Rings die on untrack/cap-evict/boot-wipe.
  }

  ready(): Promise<TeeInfo> { return this.readyPromise; }

  /** Subscribe to audio; the RAM tail is replayed synchronously first so a
   *  live join starts with an instant burst. Once the media clock has
   *  settled, tail entries carry corrected (back-stamped) media-time stamps.
   *  Returns an unsubscribe fn. */
  subscribeAudio(sub: AudioSubscriber): () => void {
    for (const t of this.tail) sub.onChunk(t.wallClock, t.bytes);
    this.audioSubs.add(sub);
    return () => this.audioSubs.delete(sub);
  }

  subscribeTitles(cb: (title: string) => void): () => void {
    this.titleSubs.add(cb);
    return () => this.titleSubs.delete(cb);
  }

  contentType(): string | null { return this.info?.contentType ?? null; }
  tailBytes(): number { return this.tailTotal; }
  bytesPerSec(): number {
    const sec = (Date.now() - this.startedAtMs) / 1000;
    return sec > 0 ? Math.round(this.bytesSeen / sec) : 0;
  }
  subscriberCount(): number { return this.audioSubs.size + this.titleSubs.size; }
  shutdown(): void { this.die(); }
}

// ---- registry ----------------------------------------------------------

type Entry = { tee: StationTee; refs: number };
const tees = new Map<string, Entry>();
const rings = new Map<string, DiskRing>(); // keyed by station id

export function acquireTee(url: string, opts?: { fetcher?: Fetcher }): StationTee {
  let entry = tees.get(url);
  if (!entry || entry.tee.dead) {
    entry = { tee: new StationTee(url, opts?.fetcher), refs: 0 };
    tees.set(url, entry);
  }
  entry.refs++;
  return entry.tee;
}

export function releaseTee(url: string, tee?: StationTee): void {
  const entry = tees.get(url);
  if (!entry) return;
  // A dead tee gets replaced in the registry by acquireTee, but its old
  // holders still call releaseTee(url) on teardown. If we let those decrement
  // the fresh entry's refs we'd corrupt the live tee's count (premature
  // shutdown or leak). When the caller passes the instance it acquired and it
  // no longer matches the registry entry, the release targets a superseded
  // (already dead + shut down) tee — ignore it.
  if (tee && entry.tee !== tee) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.tee.shutdown();
    tees.delete(url);
  }
}

/** Attach (or create) the disk ring for a tracked station and wire it to the
 *  given tee. Caps at MAX_DISK_RINGS — beyond it, no ring (live-only). */
export function attachRing(stationId: string, tee: StationTee): void {
  let ring = rings.get(stationId);
  if (!ring) {
    if (rings.size >= MAX_DISK_RINGS) return;
    const root = ensureCleanRoot();
    ring = new DiskRing(path.join(root, sanitize(stationId)), DISK_RING_DEFAULTS);
    rings.set(stationId, ring);
  }
  tee.ring = ring;
}

export function getRing(stationId: string): DiskRing | undefined {
  return rings.get(stationId);
}

export function deleteRing(stationId: string): void {
  rings.get(stationId)?.destroy();
  rings.delete(stationId);
}

export function deleteAllRings(): void {
  for (const id of [...rings.keys()]) deleteRing(id);
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/** Stream bitrate (kbps) as declared by the upstream headers: icy-br, or the
 *  bitrate field of ice-audio-info. Null when absent — MediaClock then sniffs
 *  MP3 headers or measures. Sanity bounds live in MediaClock. */
function declaredKbps(headers: Headers): number | null {
  const br = parseInt(headers.get('icy-br') || '', 10);
  if (Number.isFinite(br) && br > 0) return br;
  const m = (headers.get('ice-audio-info') || '').match(/(?:^|;)\s*(?:ice-)?bitrate=(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export function teeStats() {
  return [...tees.entries()].map(([url, e]) => ({
    url,
    subscribers: e.tee.subscriberCount(),
    bytesPerSec: e.tee.bytesPerSec(),
    contentType: e.tee.contentType(),
  }));
}

export function ringStats() {
  return [...rings.entries()].map(([stationId, r]) => ({ stationId, ...r.stats() }));
}

export function _resetTeesForTest(): void {
  for (const e of tees.values()) e.tee.shutdown();
  tees.clear();
  deleteAllRings();
}
