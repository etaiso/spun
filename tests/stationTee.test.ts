import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StationTee, _resetTeesForTest, acquireTee, releaseTee } from '../app/lib/server/stationTee';

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
