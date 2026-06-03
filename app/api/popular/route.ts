import { NextRequest, NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeStation } from '@/app/lib/stations';

type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000; // 5 minutes — popularity rankings don't change fast

type RawStation = Parameters<typeof normalizeStation>[0] & { stationuuid: string };

async function popular(path: string): Promise<RawStation[]> {
  try {
    const data = await fetchRadioBrowser(path);
    return Array.isArray(data) ? (data as RawStation[]) : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const region = (req.nextUrl.searchParams.get('region') ?? '').trim().toUpperCase();
  const cached = cache.get(region);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.data);
  }

  // Most popular globally, plus — when we know the region — the most popular
  // stations IN that region, listed first.
  const paths = ['/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true'];
  if (region) {
    paths.unshift(
      `/json/stations/bycountrycodeexact/${encodeURIComponent(region)}?order=clickcount&reverse=true&limit=8&hidebroken=true`,
    );
  }

  const batches = await Promise.all(paths.map(popular));
  if (batches.every(b => b.length === 0)) {
    return NextResponse.json([], { status: 502 });
  }

  // Region batch (if any) comes first, then global; dedupe by id.
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

  const stations = merged
    .map(normalizeStation)
    .filter(s => s.streamUrl && s.name)
    .slice(0, 15);

  cache.set(region, { at: Date.now(), data: stations });
  return NextResponse.json(stations);
}
