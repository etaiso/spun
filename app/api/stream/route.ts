import { NextRequest } from 'next/server';

const UA = 'Spun/0.1';

// Audio proxy. Re-streams a station from our own origin so the browser's Web
// Audio API can analyse the waveform (cross-origin streams are otherwise
// off-limits to AnalyserNode). We deliberately do NOT request Icy-MetaData
// here — we want clean audio for playback/analysis; song titles come from the
// separate /api/now-playing route.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return new Response('missing url', { status: 400 });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new Response('invalid url', { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new Response('unsupported protocol', { status: 400 });
  }

  const controller = new AbortController();
  req.signal.addEventListener('abort', () => controller.abort(), { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
  } catch (e) {
    return new Response(`upstream fetch failed: ${String(e)}`, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    controller.abort();
    return new Response(`upstream returned ${upstream.status}`, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-transform',
    },
  });
}
