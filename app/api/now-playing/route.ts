import { NextRequest } from 'next/server';
import { parseIcy } from '@/app/lib/icy';

const UA = 'TripPlannerRadioPOC/0.1 (etai87@gmail.com)';

// Python ShazamIO sidecar (recognizer/). When a station's broadcast metadata
// doesn't name the current song, we ask it to fingerprint a few seconds of
// the stream. If it's not running, fingerprinting silently no-ops and we fall
// back to the no-song / no-metadata states.
const RECOGNIZER_URL = process.env.RECOGNIZER_URL || 'http://127.0.0.1:8755';
// How often to re-fingerprint while metadata still isn't naming a song
// (catches song changes on metadata-less stations).
const FINGERPRINT_INTERVAL_MS = 60_000;
// Give broadcast metadata a moment to provide a title before we fingerprint.
const FINGERPRINT_INITIAL_DELAY_MS = 3_500;

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function fingerprint(streamUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${RECOGNIZER_URL}/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: streamUrl, seconds: 6 }),
      // capture (~6s) + recognition + headroom
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { match?: boolean; raw?: string };
    return data?.match && data?.raw ? data.raw : null;
  } catch {
    // Sidecar down / timeout — graceful no-op.
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return new Response('missing url', { status: 400 });

  let streamUrl: URL;
  try {
    streamUrl = new URL(raw);
  } catch {
    return new Response('invalid url', { status: 400 });
  }
  if (streamUrl.protocol !== 'http:' && streamUrl.protocol !== 'https:') {
    return new Response('unsupported protocol', { status: 400 });
  }

  const upstreamController = new AbortController();
  req.signal.addEventListener('abort', () => upstreamController.abort(), { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(streamUrl, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': UA },
      signal: upstreamController.signal,
    });
  } catch (e) {
    return new Response(`upstream fetch failed: ${String(e)}`, { status: 502 });
  }
  if (!upstream.ok) {
    upstreamController.abort();
    return new Response(`upstream returned ${upstream.status}`, { status: 502 });
  }

  const metaIntHeader = upstream.headers.get('icy-metaint');
  const metaInt = metaIntHeader ? parseInt(metaIntHeader, 10) : NaN;
  const hasMeta = Boolean(metaInt) && Boolean(upstream.body);

  const encoder = new TextEncoder();
  const streamUrlStr = streamUrl.toString();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastTitle: string | null = null; // last title we sent (any source)
      let haveMetaTitle = false; // metadata gave a real (non-empty) title
      let fpInFlight = false;

      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseLine(obj))); } catch {}
      };

      const keepalive = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch {}
      }, 15_000);

      // Fingerprint fallback. No-ops once metadata has named a song, or if
      // another attempt is already running.
      async function tryFingerprint() {
        if (closed || haveMetaTitle || fpInFlight) return;
        fpInFlight = true;
        send({ type: 'recognizing' });
        const title = await fingerprint(streamUrlStr);
        fpInFlight = false;
        if (closed || haveMetaTitle) return;
        if (title) {
          if (title !== lastTitle) {
            lastTitle = title;
            send({ type: 'track', title, source: 'shazam' });
          }
        } else {
          // Couldn't identify — report the honest "no song" state. Distinguish
          // a station with a metadata channel (no-song) from one without it
          // (no-metadata).
          send({ type: hasMeta ? 'no-song' : 'no-metadata' });
        }
      }

      const fpInitial = setTimeout(tryFingerprint, hasMeta ? FINGERPRINT_INITIAL_DELAY_MS : 0);
      const fpInterval = setInterval(tryFingerprint, FINGERPRINT_INTERVAL_MS);

      try {
        if (hasMeta) {
          for await (const event of parseIcy(upstream.body!, metaInt)) {
            if (event.title === '') {
              // Station isn't naming the song — let the fingerprint fallback
              // try (fire-and-forget; it debounces via fpInFlight).
              tryFingerprint();
              continue;
            }
            // Real broadcast title always wins over fingerprinting.
            haveMetaTitle = true;
            if (event.title !== lastTitle) {
              lastTitle = event.title;
              send({ type: 'track', title: event.title, source: 'metadata' });
            }
          }
        } else {
          // No metadata channel at all. We don't need the audio body here —
          // the recognizer pulls its own copy. Keep the SSE open so the
          // initial + periodic fingerprints can push results.
          upstreamController.abort();
          await new Promise<void>((resolve) => {
            req.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      } catch (e) {
        send({ type: 'error', message: String(e) });
      } finally {
        closed = true;
        clearInterval(keepalive);
        clearInterval(fpInterval);
        clearTimeout(fpInitial);
        try { controller.close(); } catch {}
        upstreamController.abort();
      }
    },
    cancel() {
      upstreamController.abort();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
