import { NextRequest } from 'next/server';
import { parseIcy } from '@/app/lib/icy';

const UA = 'TripPlannerRadioPOC/0.1 (etai87@gmail.com)';

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
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
    // Return a real HTTP error rather than a 200 SSE-with-error event.
    // EventSource treats a 2xx response that ends as "reconnect" — so a
    // typo'd URL would loop. A non-2xx status makes the client's onerror
    // fire without auto-reconnecting through us.
    return new Response(`upstream fetch failed: ${String(e)}`, { status: 502 });
  }

  if (!upstream.ok) {
    upstreamController.abort();
    return new Response(`upstream returned ${upstream.status}`, { status: 502 });
  }

  const metaIntHeader = upstream.headers.get('icy-metaint');
  const metaInt = metaIntHeader ? parseInt(metaIntHeader, 10) : NaN;

  const encoder = new TextEncoder();

  if (!metaInt || !upstream.body) {
    upstreamController.abort();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(sseLine({ type: 'no-metadata' })));
        c.close();
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

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch {}
      }, 15_000);

      try {
        for await (const event of parseIcy(upstream.body!, metaInt)) {
          // An empty StreamTitle means the station has a metadata channel but
          // isn't naming a song right now (some stations, e.g. Galgalatz, send
          // empty titles permanently). Forward it as a distinct 'no-song'
          // signal so the client can stop "listening…" instead of spinning
          // forever — but keep the connection open in case a real title
          // arrives later.
          if (event.title === '') {
            controller.enqueue(encoder.encode(sseLine({ type: 'no-song' })));
            continue;
          }
          controller.enqueue(encoder.encode(sseLine({ type: 'track', title: event.title })));
        }
      } catch (e) {
        try {
          controller.enqueue(encoder.encode(sseLine({ type: 'error', message: String(e) })));
        } catch {}
      } finally {
        clearInterval(keepalive);
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
