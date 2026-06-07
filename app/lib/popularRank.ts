import type { Station } from './stations';

// Re-ranks the Popular candidate pool. The pool arrives in popularity order
// (the route sorts by radio-browser clickcount desc), so the index is a
// popularity proxy — same convention as lib/rank.ts. Unlike search ranking,
// NOTHING is dropped: every candidate is just reordered.
//
// A perfect genre match (affinity 1) outweighs the popularity and region terms
// combined, so taste dominates; with an empty profile the genre term is 0 and
// ordering falls back to popularity + region (the cold-start path).

const W_GENRE = 10;
const W_POPULARITY = 5;
const W_REGION = 4;

export type PopularRankContext = {
  region: string | null;
  affinity: Record<string, number>; // genre → 0..1, from lib/taste.ts
};

/** Mean of the affinity scores for a station's tags (unmatched tags = 0). */
export function genreAffinity(
  tags: string[] | undefined,
  affinity: Record<string, number>,
): number {
  if (!tags || tags.length === 0) return 0;
  let sum = 0;
  for (const t of tags) sum += affinity[t] ?? 0;
  return sum / tags.length;
}

export function scorePopular(stations: Station[], ctx: PopularRankContext): Station[] {
  const n = stations.length;
  return stations
    .map((s, i) => {
      const genre = genreAffinity(s.tags, ctx.affinity);
      const popularity = n > 1 ? (n - i) / n : 1;
      const region = ctx.region && s.countrycode === ctx.region ? 1 : 0;
      const score = genre * W_GENRE + popularity * W_POPULARITY + region * W_REGION;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
}
