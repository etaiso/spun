// Builds the radio-browser request paths for the Popular candidate pool.
// Kept pure (no fetch) so it can be unit-tested without network or next/server.
//
// Order matters only as a fallback when scores tie; the client re-ranks the
// merged pool by genre affinity + popularity + region (see lib/popularRank.ts).
//
//   per-genre regional (personalization) → trending regional (live/cold-start
//   fill) → regional anchor (fat clickcount baseline) → global anchor.

export function buildPopularPaths(region: string, genres: string[]): string[] {
  const r = region.trim().toUpperCase();
  const paths: string[] = [];

  if (r && genres.length) {
    for (const g of genres) {
      paths.push(
        `/json/stations/search?tag=${encodeURIComponent(g)}&countrycode=${encodeURIComponent(r)}&order=clickcount&reverse=true&limit=5&hidebroken=true`,
      );
    }
  }

  if (r) {
    paths.push(
      `/json/stations/search?countrycode=${encodeURIComponent(r)}&order=clicktrend&reverse=true&limit=10&hidebroken=true`,
    );
    paths.push(
      `/json/stations/bycountrycodeexact/${encodeURIComponent(r)}?order=clickcount&reverse=true&limit=20&hidebroken=true`,
    );
  }

  paths.push('/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true');
  return paths;
}
