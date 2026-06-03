import { NextRequest, NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeStation } from '@/app/lib/stations';

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

  let raw: unknown;
  try {
    raw = await fetchRadioBrowser(
      `/json/stations/search?name=${encodeURIComponent(q)}&limit=20&hidebroken=true&order=clickcount&reverse=true`,
    );
  } catch {
    return NextResponse.json([], { status: 502 });
  }
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
