import { NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeTags, type ExploreTag } from '@/app/lib/explorePaths';

// No request params, so opt out of static prerendering — this fetches upstream
// and caches the result in-process (the tag list barely changes).
export const dynamic = 'force-dynamic';

const TTL_MS = 6 * 60 * 60_000; // 6h
let cache: { at: number; data: ExploreTag[] } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  try {
    // Pull the most-used tags; normalizeTags drops one-off/junk tags below the
    // station-count floor and dedupes by name.
    const raw = await fetchRadioBrowser('/json/tags?order=stationcount&reverse=true&hidebroken=true&limit=500');
    const data = normalizeTags(raw, { min: 5, cap: 500 });
    if (data.length === 0) return NextResponse.json([], { status: 502 });
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
