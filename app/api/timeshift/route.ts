import { NextRequest } from 'next/server';
import { acquireTee, releaseTee, getRing, deleteRing, deleteAllRings } from '@/app/lib/server/stationTee';
import { encodeFrame } from '@/app/lib/timeshift/framing';

// Generous backpressure cap for the live path: if a slow client lets the
// stream's internal queue fall this many chunks behind, we drop new live
// frames rather than buffer unbounded RAM. ~4096 ICY chunks is on the order of
// minutes of audio.
const LIVE_MAX_QUEUED_CHUNKS = 4096;

// Timeshift playback feed. Streams framed audio (see lib/timeshift/framing.ts):
// optionally a burst of disk-ring history from `from=<epochMs>`, then live
// chunks from the station tee, staying open until the client disconnects.
// This single endpoint is both the active station's playback feed and the
// switch-into-tracked-history feed.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  const sid = req.nextUrl.searchParams.get('sid') || '';
  const from = req.nextUrl.searchParams.get('from') || 'live';
  if (!raw) return new Response('missing url', { status: 400 });
  let url: URL;
  try { url = new URL(raw); } catch { return new Response('invalid url', { status: 400 }); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new Response('unsupported protocol', { status: 400 });
  }
  const urlStr = url.toString();

  // `from` is parsed once here so a malformed value is rejected before any tee
  // work. A non-finite number would otherwise reach readFrom() and dump the
  // whole ring.
  let fromMs: number | null = null;
  if (from !== 'live') {
    fromMs = Number(from);
    if (!Number.isFinite(fromMs)) return new Response('invalid from', { status: 400 });
  }

  const tee = acquireTee(urlStr);
  let info;
  try {
    info = await tee.ready();
  } catch (e) {
    releaseTee(urlStr, tee);
    return new Response(`upstream failed: ${String(e)}`, { status: 502 });
  }

  // getRing only READS the ring; rings are attached by /api/now-playing?ts=disk,
  // which the client always opens alongside playback. This route never attaches.
  const ring = sid ? getRing(sid) : undefined;
  const bufferStart = ring?.startMs() ?? null;

  // Guard against double-release: both the stream `cancel()` callback and the
  // `abort` listener can fire for the same request (e.g. client drops while
  // the stream body is being read). Only the first caller actually releases.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    unsubscribe?.();
    releaseTee(urlStr, tee);
  };

  let unsubscribe: (() => void) | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (b: Uint8Array, live = false) => {
        if (closed) return;
        // Backpressure on the live path only: a slow client lets desiredSize go
        // increasingly negative. Past the cap we DROP the frame instead of
        // buffering unbounded RAM. The resulting wall-clock gap is rendered by
        // the client as a discontinuity (same as an upstream reconnect gap).
        // The disk-drain burst is exempt — it's bounded by the ring size and
        // must arrive complete so history replays without holes.
        if (live && controller.desiredSize !== null &&
            controller.desiredSize < -LIVE_MAX_QUEUED_CHUNKS) {
          return;
        }
        try { controller.enqueue(b); } catch { closed = true; }
      };

      // Live frames can arrive while we drain disk history — queue them and
      // flush after, deduping anything the disk already covered.
      let draining = fromMs !== null && !!ring;
      const liveQueue: Array<{ wallClock: number; frame: Uint8Array }> = [];
      let lastServedWallClock = 0;

      unsubscribe = tee.subscribeAudio({
        onChunk: (wallClock, bytes) => {
          const frame = encodeFrame(wallClock, bytes);
          if (draining) liveQueue.push({ wallClock, frame });
          else if (wallClock >= lastServedWallClock) safeEnqueue(frame, true);
        },
        onEnd: () => { closed = true; try { controller.close(); } catch { /* already closed */ } },
      });

      if (draining && ring && fromMs !== null) {
        for (const f of ring.readFrom(fromMs)) {
          if (f.wallClock < fromMs) continue; // readFrom returns whole segments
          safeEnqueue(encodeFrame(f.wallClock, f.payload));
          lastServedWallClock = f.wallClock;
        }
        draining = false;
        for (const q of liveQueue) {
          if (q.wallClock > lastServedWallClock) safeEnqueue(q.frame, true);
        }
        liveQueue.length = 0;
      }
    },
    cancel() {
      release();
    },
  });

  req.signal.addEventListener('abort', () => {
    release();
  }, { once: true });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store, no-transform',
      'x-upstream-content-type': info.contentType,
      'x-buffer-start': bufferStart === null ? '' : String(bufferStart),
    },
  });
}

// Drop a tracked station's disk ring immediately (user untracked it, or it
// fell out of the 5-station cap). Audio only — playlist history is untouched.
export async function DELETE(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get('sid');
  if (!sid) return new Response('missing sid', { status: 400 });
  if (sid === '*') { deleteAllRings(); return new Response(null, { status: 204 }); }
  deleteRing(sid);
  return new Response(null, { status: 204 });
}
