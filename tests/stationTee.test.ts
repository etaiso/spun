import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StationTee, _resetTeesForTest, acquireTee, releaseTee } from '../app/lib/server/stationTee';
import { DiskRing, DISK_RING_DEFAULTS } from '../app/lib/server/diskRing';

function icyResponse(chunks: Uint8Array[], headers: Record<string, string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(ch); /* stays open */ },
  });
  return new Response(body, { headers });
}

beforeEach(() => _resetTeesForTest());

describe('StationTee', () => {
  it('fans audio out to subscribers and reports content type', async () => {
    // metaint 4: [4 audio][len=0] repeating
    const chunk = new Uint8Array([1, 2, 3, 4, 0, 5, 6, 7, 8, 0]);
    const fetcher = vi.fn(async () =>
      icyResponse([chunk], { 'icy-metaint': '4', 'content-type': 'audio/mpeg' }));
    const tee = new StationTee('http://x/stream', fetcher);
    const info = await tee.ready();
    expect(info.contentType).toBe('audio/mpeg');
    expect(info.hasMeta).toBe(true);

    const got: number[] = [];
    tee.subscribeAudio({ onChunk: (_wc, b) => got.push(...b), onEnd: () => {} });
    await vi.waitFor(() => expect(got).toEqual([1, 2, 3, 4, 5, 6, 7, 8]));
    tee.shutdown();
  });

  it('replays the RAM tail to late subscribers (live-join burst)', async () => {
    const fetcher = vi.fn(async () =>
      icyResponse([new Uint8Array([9, 9, 9])], { 'content-type': 'audio/aac' })); // no metaint → raw
    const tee = new StationTee('http://x/2', fetcher);
    await tee.ready();
    await vi.waitFor(() => expect(tee.tailBytes()).toBe(3));
    const got: number[] = [];
    tee.subscribeAudio({ onChunk: (_wc, b) => got.push(...b), onEnd: () => {} });
    expect(got).toEqual([9, 9, 9]); // tail delivered synchronously on subscribe
    tee.shutdown();
  });

  it('delivers titles to title subscribers', async () => {
    // [2 audio]["StreamTitle='Hi';" metadata block]
    const payload = new TextEncoder().encode("StreamTitle='Hi';");
    const padded = Math.ceil(payload.length / 16) * 16;
    const meta = new Uint8Array(1 + padded);
    meta[0] = padded / 16; meta.set(payload, 1);
    const chunk = new Uint8Array([7, 7, ...meta]);
    const fetcher = vi.fn(async () =>
      icyResponse([chunk], { 'icy-metaint': '2', 'content-type': 'audio/mpeg' }));
    const tee = new StationTee('http://x/3', fetcher);
    const titles: string[] = [];
    tee.subscribeTitles(t => titles.push(t));
    await tee.ready();
    await vi.waitFor(() => expect(titles).toEqual(['Hi']));
    tee.shutdown();
  });

  it('registry refcounts: same tee while held, new tee after full release', async () => {
    const fetcher = vi.fn(async () =>
      icyResponse([new Uint8Array([1])], { 'content-type': 'audio/mpeg' }));
    const a = acquireTee('http://x/4', { fetcher });
    const b = acquireTee('http://x/4', { fetcher });
    expect(b).toBe(a);
    releaseTee('http://x/4');
    releaseTee('http://x/4');
    const c = acquireTee('http://x/4', { fetcher });
    expect(c).not.toBe(a);
    releaseTee('http://x/4');
  });

  it('ignores a stale release from a superseded (dead) tee', async () => {
    const fetcher = vi.fn(async () =>
      icyResponse([new Uint8Array([1])], { 'content-type': 'audio/mpeg' }));
    const url = 'http://x/5';

    // Acquire A, then kill it so acquireTee will replace it on next acquire.
    const a = acquireTee(url, { fetcher });
    a.shutdown();
    expect(a.dead).toBe(true);

    // Next acquire sees the dead entry and installs a fresh tee B (refs = 1).
    const b = acquireTee(url, { fetcher });
    expect(b).not.toBe(a);

    // A stale holder of A releases with the instance it held. This must NOT
    // touch B's refs — otherwise B would be shut down out from under its live
    // holder. Re-acquiring must still return the same live B.
    releaseTee(url, a);
    const stillB = acquireTee(url, { fetcher });
    expect(stillB).toBe(b);     // B is alive (refs now 2)
    expect(b.dead).toBe(false);

    // The live releases for B do decrement and eventually shut it down.
    releaseTee(url, b);         // refs 2 -> 1
    expect(b.dead).toBe(false);
    releaseTee(url, b);         // refs 1 -> 0, shutdown
    expect(b.dead).toBe(true);
    const fresh = acquireTee(url, { fetcher });
    expect(fresh).not.toBe(b);  // entry was deleted, brand-new tee
    releaseTee(url, fresh);
  });
});

// ---- media-time stamping ---------------------------------------------------
//
// Scenario shape (mirrors the measured burst-on-connect pathology, at 32 kbps
// = 4 000 bytes/sec so the 128 KB RAM tail retains burst chunks):
//   connect at T0, then 14×20 000 B chunks (5 s of audio each, 70 s total)
//   arriving 100 ms apart — a 70 s backlog squeezed into 1.3 s of wall clock —
//   then realtime lumps of 24 000 B (6 s) at T0+6 000 and T0+12 000. The
//   second lump drains the rate window and triggers settle: the burst's
//   newest audio ends at the connect instant, so back-stamps walk down to T0
//   and 65 s further back (chunk ends at -65 s, -60 s, …, 0).
const T0 = 1_000_000;
const BURST_STAMPS = Array.from({ length: 14 }, (_, i) => T0 - 65_000 + i * 5_000);
const SETTLED_STAMPS = [...BURST_STAMPS, T0 + 6_000, T0 + 12_000];

describe('StationTee media-time stamps', () => {
  let dir: string;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); // Date only — keep microtasks real
    vi.setSystemTime(T0);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spun-tee-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function openTee(headers: Record<string, string>) {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const fetcher = vi.fn(async () => new Response(body, { headers }));
    const tee = new StationTee('http://x/media-time', fetcher);
    const got: { wc: number; len: number }[] = [];
    tee.subscribeAudio({ onChunk: (wc, b) => got.push({ wc, len: b.length }), onEnd: () => {} });
    // Enqueue one chunk at a fixed wall-clock instant and wait for the tee's
    // async pump to deliver it (microtask spin — no timers involved).
    const feed = async (byteLen: number, atMs: number) => {
      vi.setSystemTime(atMs);
      const want = got.length + 1;
      controller.enqueue(new Uint8Array(byteLen));
      for (let i = 0; i < 5_000 && got.length < want; i++) await Promise.resolve();
      expect(got.length).toBe(want);
    };
    return { tee, got, feed };
  }

  /** Drive the standard burst-then-settle scenario. */
  async function runBurstToSettle(feed: (b: number, at: number) => Promise<void>) {
    for (let i = 0; i < 14; i++) await feed(20_000, T0 + i * 100);
    await feed(24_000, T0 + 6_000);
    await feed(24_000, T0 + 12_000); // ← settle triggers here
  }

  it('stamps live fan-out provisionally, then replays a back-stamped tail to late joiners', async () => {
    const { tee, got, feed } = openTee({ 'content-type': 'audio/mpeg', 'icy-br': '32' });
    await tee.ready();
    await runBurstToSettle(feed);

    // The live subscriber saw provisional arrival stamps for the burst…
    const arrivals = Array.from({ length: 14 }, (_, i) => T0 + i * 100);
    expect(got.slice(0, 15).map(g => g.wc)).toEqual([...arrivals, T0 + 6_000]);
    // …and the settle-triggering chunk got its final media-time stamp.
    expect(got[15].wc).toBe(T0 + 12_000);

    // A late joiner replays the RAM tail with corrected stamps: the retained
    // entries are burst chunks 10–13 + both lumps, back-stamped by duration.
    const replay: number[] = [];
    tee.subscribeAudio({ onChunk: wc => { replay.push(wc); }, onEnd: () => {} });
    expect(replay).toEqual([T0 - 15_000, T0 - 10_000, T0 - 5_000, T0, T0 + 6_000, T0 + 12_000]);
    tee.shutdown();
  });

  it('holds ring appends while settling, then flushes the back-stamped burst', async () => {
    const { tee, feed } = openTee({ 'content-type': 'audio/mpeg', 'icy-br': '32' });
    const ring = new DiskRing(dir, DISK_RING_DEFAULTS);
    tee.ring = ring;
    await tee.ready();

    for (let i = 0; i < 14; i++) await feed(20_000, T0 + i * 100);
    await feed(24_000, T0 + 6_000);
    expect(ring.endMs()).toBeNull(); // nothing persisted before settle
    await feed(24_000, T0 + 12_000);

    const frames = Array.from(ring.readFrom(0));
    expect(frames.map(f => f.wallClock)).toEqual(SETTLED_STAMPS);
    expect(frames[0].payload.length).toBe(20_000);
    expect(frames[15].payload.length).toBe(24_000);

    // Post-settle chunks append directly, advancing by media duration.
    await feed(24_000, T0 + 18_000);
    expect(ring.endMs()).toBe(T0 + 18_000);
    tee.shutdown();
    ring.destroy();
  });

  it('trims the reconnect burst to frames newer than the ring already holds', async () => {
    // An earlier tee left audio through T0-10 000 in the ring. The new burst
    // re-covers that span — only the genuinely new frames may be appended, so
    // ring stamps stay strictly increasing and history replays without the
    // duplicated minute.
    const ring = new DiskRing(dir, DISK_RING_DEFAULTS);
    for (const wc of [T0 - 40_000, T0 - 30_000, T0 - 20_000, T0 - 10_000]) {
      ring.append(wc, new Uint8Array(9));
    }
    const { tee, feed } = openTee({ 'content-type': 'audio/mpeg', 'icy-br': '32' });
    tee.ring = ring;
    await tee.ready();
    await runBurstToSettle(feed);

    const stamps = Array.from(ring.readFrom(0)).map(f => f.wallClock);
    expect(stamps).toEqual([
      T0 - 40_000, T0 - 30_000, T0 - 20_000, T0 - 10_000, // old tee's frames
      T0 - 5_000, T0, T0 + 6_000, T0 + 12_000,            // only the new tail of the burst
    ]);
    tee.shutdown();
    ring.destroy();
  });

  it('keeps the wall-clock gap when an outage outlasts the burst coverage', async () => {
    // Old audio ends 120 s before the reconnect; the burst only reaches back
    // 70 s. The remaining 55 s hole stays visible as a stamp gap — that gap IS
    // the client's discontinuity marker.
    const ring = new DiskRing(dir, DISK_RING_DEFAULTS);
    ring.append(T0 - 120_000, new Uint8Array(9));
    const { tee, feed } = openTee({ 'content-type': 'audio/mpeg', 'icy-br': '32' });
    tee.ring = ring;
    await tee.ready();
    await runBurstToSettle(feed);

    const stamps = Array.from(ring.readFrom(0)).map(f => f.wallClock);
    expect(stamps).toEqual([T0 - 120_000, ...SETTLED_STAMPS]);
    tee.shutdown();
    ring.destroy();
  });
});
