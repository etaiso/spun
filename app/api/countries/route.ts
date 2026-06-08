import { NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeCountries, type ExploreCountry } from '@/app/lib/explorePaths';

// No request params, so opt out of static prerendering — this fetches upstream
// and caches the result in-process (the country list barely changes).
export const dynamic = 'force-dynamic';

const TTL_MS = 6 * 60 * 60_000; // 6h
let cache: { at: number; data: ExploreCountry[] } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL_MS) return NextResponse.json(cache.data);
  try {
    const data = normalizeCountries(await fetchRadioBrowser('/json/countries'));
    // Empty means the upstream call failed or returned junk — don't cache it.
    if (data.length === 0) return NextResponse.json([], { status: 502 });
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
