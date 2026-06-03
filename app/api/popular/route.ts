import { NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeStation } from '@/app/lib/stations';

type CacheEntry = { at: number; data: unknown };
let cache: CacheEntry | null = null;
const TTL_MS = 5 * 60_000; // 5 minutes — popularity rankings don't change fast

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.data);
  }

  let raw: unknown;
  try {
    raw = await fetchRadioBrowser(
      '/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true',
    );
  } catch {
    return NextResponse.json([], { status: 502 });
  }
  if (!Array.isArray(raw)) return NextResponse.json([], { status: 502 });

  const stations = raw
    .map(r => normalizeStation(r as Parameters<typeof normalizeStation>[0]))
    .filter(s => s.streamUrl && s.name);
  cache = { at: Date.now(), data: stations };
  return NextResponse.json(stations);
}
