// Pure helpers for the Explore feature — radio-browser request paths plus
// normalizers for the country/tag list endpoints. Kept free of fetch and
// next/server so they're unit-testable without network (mirrors lib/popularPaths.ts).

export type ExploreCountry = { code: string; name: string; count: number };
export type ExploreTag = { name: string; count: number };

// ── Station-list path (drill-in) ────────────────────────────────────────────
// Filters by country and/or genre tags — all facets are ANDed (e.g. German
// stations tagged both jazz AND blues). `tagList` is radio-browser's AND-match
// for multiple tags (a single tag behaves like the `tag` param). Orders by
// clickcount so the most-played surface first; the client doesn't re-rank
// Explore results (unlike search/popular).

export function buildStationsPath(
  { country, tags }: { country?: string | null; tags?: string[] },
  limit = 100,
): string {
  const parts: string[] = [];
  if (country && country.trim()) parts.push(`countrycode=${encodeURIComponent(country.trim().toUpperCase())}`);
  const cleanTags = (tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean);
  if (cleanTags.length) parts.push(`tagList=${cleanTags.map(encodeURIComponent).join(',')}`);
  parts.push('order=clickcount', 'reverse=true', `limit=${limit}`, 'hidebroken=true');
  return `/json/stations/search?${parts.join('&')}`;
}

// ── List normalizers ───────────────────────────────────────────────────────

type RawCountry = { name?: unknown; iso_3166_1?: unknown; stationcount?: unknown };
type RawTag = { name?: unknown; stationcount?: unknown };

/**
 * Distinct, sorted ISO country codes present in a station list — used to narrow
 * the country picker to only countries that actually have stations for the
 * selected genre(s). Skips records with a missing/invalid countrycode.
 */
export function countryCodesFromStations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const r of raw as { countrycode?: unknown }[]) {
    const code = (typeof r?.countrycode === 'string' ? r.countrycode : '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) seen.add(code);
  }
  return [...seen].sort();
}

function asInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/**
 * Map radio-browser `/json/countries` to a clean, count-sorted list. Drops
 * entries without a 2-letter ISO code or name, and any with zero stations.
 */
export function normalizeCountries(raw: unknown): ExploreCountry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExploreCountry[] = [];
  for (const r of raw as RawCountry[]) {
    const code = (typeof r?.iso_3166_1 === 'string' ? r.iso_3166_1 : '').trim().toUpperCase();
    const name = (typeof r?.name === 'string' ? r.name : '').trim();
    const count = asInt(r?.stationcount);
    if (!/^[A-Z]{2}$/.test(code) || !name || count <= 0 || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * Map radio-browser `/json/tags` to a clean, count-sorted list. Lowercases +
 * dedupes by name, drops tags below `min` stations, caps the list length.
 * radio-browser has thousands of junk/one-off tags, so the threshold matters.
 */
export function normalizeTags(raw: unknown, { min = 5, cap = 500 }: { min?: number; cap?: number } = {}): ExploreTag[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExploreTag[] = [];
  for (const r of raw as RawTag[]) {
    const name = (typeof r?.name === 'string' ? r.name : '').trim().toLowerCase();
    const count = asInt(r?.stationcount);
    if (!name || count < min || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, cap);
}
