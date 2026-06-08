import { NextRequest, NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { buildStationsPath, countryCodesFromStations } from '@/app/lib/explorePaths';

// Which countries have at least one station for the given genre tag(s)? Used to
// narrow the Explore country picker so it doesn't list countries with zero
// matches for the current genre filter. We fetch ALL matching stations (the
// broadest single genre is ~5k / ~1.4s, well within the upstream timeout; tag
// intersections are far smaller) and collect their distinct country codes.

type CacheEntry = { at: number; data: string[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 50;

function getCached(key: string): string[] | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { cache.delete(key); return null; }
  return e.data;
}

function setCached(key: string, data: string[]) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

export async function GET(req: NextRequest) {
  const tags = [...new Set(
    req.nextUrl.searchParams.getAll('tag').map(t => t.trim().toLowerCase()).filter(Boolean),
  )].sort();
  if (tags.length === 0) return NextResponse.json([]);

  const cacheKey = tags.join(',');
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const raw = await fetchRadioBrowser(buildStationsPath({ tags }, 100000));
    const codes = countryCodesFromStations(raw);
    setCached(cacheKey, codes);
    return NextResponse.json(codes);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
