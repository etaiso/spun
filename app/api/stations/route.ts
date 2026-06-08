import { NextRequest, NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeStation } from '@/app/lib/stations';
import { dedupeStations } from '@/app/lib/dedupe';
import { buildCountryStationsPath, buildTagStationsPath } from '@/app/lib/explorePaths';

// Stations for an Explore drill-in: `?country=XX` or `?tag=Y` (country wins if
// both are present). Results come back ordered by clickcount; unlike search,
// the client doesn't re-rank them.

type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000;
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

type RawStation = Parameters<typeof normalizeStation>[0] & { stationuuid: string };

export async function GET(req: NextRequest) {
  const country = (req.nextUrl.searchParams.get('country') ?? '').trim().toUpperCase();
  const tag = (req.nextUrl.searchParams.get('tag') ?? '').trim().toLowerCase();
  if (!country && !tag) return NextResponse.json([]);

  const path = country ? buildCountryStationsPath(country) : buildTagStationsPath(tag);
  const cacheKey = country ? `c:${country}` : `t:${tag}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const raw = await fetchRadioBrowser(path);
    const list = Array.isArray(raw) ? (raw as RawStation[]) : [];

    // Dedupe by stationuuid (upstream order = clickcount desc), then collapse
    // crowd-sourced near-duplicates via the shared pipeline used by search/popular.
    const seen = new Set<string>();
    const merged: RawStation[] = [];
    for (const r of list) {
      if (r?.stationuuid && !seen.has(r.stationuuid)) {
        seen.add(r.stationuuid);
        merged.push(r);
      }
    }
    const stations = dedupeStations(
      merged.map(normalizeStation).filter(s => s.streamUrl && s.name),
    ).slice(0, 100);

    setCached(cacheKey, stations);
    return NextResponse.json(stations);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
