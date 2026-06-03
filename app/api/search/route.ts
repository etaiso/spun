import { NextRequest, NextResponse } from 'next/server';
import { normalizeStation } from '@/app/lib/stations';

const UA = 'TripPlannerRadioPOC/0.1 (etai87@gmail.com)'; // radio-browser requires a User-Agent

const UPSTREAM_TIMEOUT_MS = 5_000;

let mirrorPromise: Promise<string> | null = null;
async function getMirror(): Promise<string> {
  if (!mirrorPromise) {
    mirrorPromise = (async () => {
      const res = await fetch('https://all.api.radio-browser.info/json/servers', {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const servers = (await res.json()) as unknown;
      if (!Array.isArray(servers) || servers.length === 0) {
        throw new Error('no radio-browser mirrors available');
      }
      // pick the first one; spec accepts this for MVP
      return `https://${(servers[0] as { name: string }).name}`;
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

  let mirror: string;
  try {
    mirror = await getMirror();
  } catch {
    return NextResponse.json([], { status: 502 });
  }

  const url = `${mirror}/json/stations/search?name=${encodeURIComponent(q)}&limit=20&hidebroken=true&order=clickcount&reverse=true`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json([], { status: 502 });
  }
  if (!res.ok) return NextResponse.json([], { status: 502 });

  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return NextResponse.json([], { status: 502 });

  // Drop rows missing a stream URL OR a name. normalizeStation's null-name
  // guard turns malformed upstream rows into empty-name rows we don't want
  // to surface in the UI.
  const stations = raw
    .map(r => normalizeStation(r as Parameters<typeof normalizeStation>[0]))
    .filter(s => s.streamUrl && s.name);
  setCached(q, stations);
  return NextResponse.json(stations);
}
