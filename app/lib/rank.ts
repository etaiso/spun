import type { Station } from './stations';

/**
 * How well `query` matches `name`, 0 (no match) … 1 (exact). Tiered:
 * exact > whole-string prefix > word prefix > substring (earlier = better) >
 * subsequence (fuzzy, e.g. "jzz" loosely matches "jazz"). Case-insensitive.
 */
export function fuzzyScore(query: string, name: string): number {
  const q = query.toLowerCase().trim();
  const n = name.toLowerCase().trim();
  if (!q) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.92;
  if (n.split(/\s+/).some(w => w.startsWith(q))) return 0.85;

  const idx = n.indexOf(q);
  if (idx >= 0) return 0.7 - Math.min(idx, 40) / 200; // 0.7 … 0.5, earlier wins

  // Subsequence: every query char appears in order. Score by compactness so a
  // tight match ("blu" in "blues") beats a scattered one.
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let ni = 0; ni < n.length && qi < q.length; ni++) {
    if (n[ni] === q[qi]) {
      if (first < 0) first = ni;
      last = ni;
      qi++;
    }
  }
  if (qi < q.length) return 0; // not all chars present
  const span = last - first + 1;
  return 0.45 * (q.length / span);
}

export type RankContext = {
  query: string;
  region: string | null;
  recentIds: ReadonlySet<string>;
  favoriteIds: ReadonlySet<string>;
};

// Weights. Fuzzy relevance dominates; among comparable matches the boosts
// reorder. Recently-played is the strongest boost (per product intent),
// then region, then favorite, with popularity as a final tie-breaker.
const W_FUZZY = 100;
const W_RECENT = 18;
const W_REGION = 12;
const W_FAVORITE = 8;
const W_POPULARITY = 5;

/**
 * Rank a candidate pool. `stations` is assumed to arrive in popularity order
 * (radio-browser clickcount desc), so the index doubles as a popularity proxy.
 * Stations that don't match the query at all are dropped.
 */
export function rankStations(stations: Station[], ctx: RankContext): Station[] {
  const n = stations.length;
  return stations
    .map((s, i) => {
      const fuzzy = fuzzyScore(ctx.query, s.name);
      const popularity = n > 1 ? (n - i) / n : 1;
      const region = ctx.region && s.countrycode === ctx.region ? 1 : 0;
      const recent = ctx.recentIds.has(s.id) ? 1 : 0;
      const favorite = ctx.favoriteIds.has(s.id) ? 1 : 0;
      const score =
        fuzzy * W_FUZZY +
        recent * W_RECENT +
        region * W_REGION +
        favorite * W_FAVORITE +
        popularity * W_POPULARITY;
      return { s, fuzzy, score };
    })
    .filter(x => x.fuzzy > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
}
