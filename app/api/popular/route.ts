import { NextRequest, NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeStation } from '@/app/lib/stations';
import { dedupeStations } from '@/app/lib/dedupe';
import { buildPopularPaths } from '@/app/lib/popularPaths';

type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000; // 5 minutes — popularity rankings don't change fast
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

type RawStation = Parameters<typeof normalizeStation>[0] & {
  stationuuid: string;
  clickcount?: number;
};

// Up to 3 genres; lowercased, trimmed, deduped. More than 3 just adds upstream
// calls for diminishing personalization.
function parseGenres(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const g = part.trim().toLowerCase();
    if (g) seen.add(g);
  }
  return [...seen].slice(0, 3);
}

async function fetchBatch(path: string): Promise<RawStation[]> {
  try {
    const data = await fetchRadioBrowser(path);
    return Array.isArray(data) ? (data as RawStation[]) : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const region = (req.nextUrl.searchParams.get('region') ?? '').trim().toUpperCase();
  const genres = parseGenres(req.nextUrl.searchParams.get('genres'));

  const cacheKey = `${region}::${genres.join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const paths = buildPopularPaths(region, genres);
  const batches = await Promise.all(paths.map(fetchBatch));
  // All upstream batches empty → treat as upstream failure (there are always
  // popular stations), unlike /api/search which returns [] for "no matches".
  if (batches.every(b => b.length === 0)) {
    return NextResponse.json([], { status: 502 });
  }

  // Merge + dedupe by stationuuid, then sort by clickcount desc so the client
  // can use list position as a popularity proxy when re-ranking.
  const seen = new Set<string>();
  const merged: RawStation[] = [];
  for (const batch of batches) {
    for (const r of batch) {
      if (r?.stationuuid && !seen.has(r.stationuuid)) {
        seen.add(r.stationuuid);
        merged.push(r);
      }
    }
  }
  merged.sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));

  // Return a WIDE pool (~40) — the client re-ranks and trims to what it shows,
  // so it needs room to promote genre matches that aren't top-clickcount.
  const stations = dedupeStations(
    merged.map(normalizeStation).filter(s => s.streamUrl && s.name),
  ).slice(0, 40);

  setCached(cacheKey, stations);
  return NextResponse.json(stations);
}
