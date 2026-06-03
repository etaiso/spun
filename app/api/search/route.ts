import { NextRequest, NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeStation } from '@/app/lib/stations';
import { dedupeStations } from '@/app/lib/dedupe';

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

type RawStation = Parameters<typeof normalizeStation>[0] & { stationuuid: string; clickcount?: number };

async function searchRadioBrowser(path: string): Promise<RawStation[]> {
  try {
    const data = await fetchRadioBrowser(path);
    return Array.isArray(data) ? (data as RawStation[]) : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q === '') return NextResponse.json([]);
  const region = (req.nextUrl.searchParams.get('region') ?? '').trim().toUpperCase();

  const cacheKey = `${region}::${q}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const name = encodeURIComponent(q);
  // Always fetch the globally-popular matches. When we know the user's region,
  // ALSO fetch region-filtered matches in parallel so regional stations are
  // guaranteed to be in the candidate pool (the client then ranks them up).
  const paths = [
    `/json/stations/search?name=${name}&limit=40&hidebroken=true&order=clickcount&reverse=true`,
  ];
  if (region) {
    paths.unshift(
      `/json/stations/search?name=${name}&countrycode=${encodeURIComponent(region)}&limit=20&hidebroken=true&order=clickcount&reverse=true`,
    );
  }

  const batches = await Promise.all(paths.map(searchRadioBrowser));
  if (batches.every(b => b.length === 0)) {
    // All upstream calls failed (vs. genuinely no results, which is []).
    // Distinguish by trying one more time isn't worth it; return 502 only if
    // we got nothing AND at least one call threw. Simpler: return [] — the
    // client shows "no stations found". Use 502 only when the popular call
    // (last path) is the one that failed hard. Keep it simple: [].
    setCached(cacheKey, []);
    return NextResponse.json([]);
  }

  // Merge + dedupe by stationuuid, then order by clickcount desc so the
  // client can use position as a popularity signal.
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

  const stations = dedupeStations(
    merged.map(normalizeStation).filter(s => s.streamUrl && s.name),
  ).slice(0, 50);

  setCached(cacheKey, stations);
  return NextResponse.json(stations);
}
