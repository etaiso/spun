import { NextRequest, NextResponse } from 'next/server';
import { normalizeStation } from '@/app/lib/stations';

const UA = 'TripPlannerRadioPOC/0.1 (etai87@gmail.com)'; // radio-browser requires a User-Agent

let mirrorPromise: Promise<string> | null = null;
async function getMirror(): Promise<string> {
  if (!mirrorPromise) {
    mirrorPromise = (async () => {
      const res = await fetch('https://all.api.radio-browser.info/json/servers', {
        headers: { 'User-Agent': UA },
      });
      const servers = (await res.json()) as Array<{ name: string }>;
      if (!servers.length) throw new Error('no radio-browser mirrors available');
      // pick the first one; spec accepts this for MVP
      return `https://${servers[0].name}`;
    })();
    mirrorPromise.catch(() => { mirrorPromise = null; }); // allow retry on next request
  }
  return mirrorPromise;
}

type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 50;

function getCached(key: string): unknown | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { cache.delete(key); return null; }
  return e.data;
}
function setCached(key: string, data: unknown) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q === '') return NextResponse.json([]);

  const cached = getCached(q);
  if (cached) return NextResponse.json(cached);

  const mirror = await getMirror();
  const url = `${mirror}/json/stations/search?name=${encodeURIComponent(q)}&limit=20&hidebroken=true&order=clickcount&reverse=true`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return NextResponse.json([], { status: 502 });

  const raw = (await res.json()) as Parameters<typeof normalizeStation>[0][];
  const stations = raw.map(normalizeStation).filter(s => s.streamUrl && s.name);
  setCached(q, stations);
  return NextResponse.json(stations);
}
