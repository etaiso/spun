'use client';

import { useMemo } from 'react';
import type { Station } from './stations';
import { useFavorites } from './favorites';
import { useTracking } from './tracking';
import { useRecent } from './recent';
import { usePlayCounts } from './playCounts';
import type { PlayCounts } from './playCounts';

// The user's genre taste, blended from several signals. Favorites express the
// strongest intent, then tracked stations, then a play tally (weighted by how
// often each station was played), then the last-5 recents. Tags that appear
// across signals accumulate. Scores are normalized 0..1 against the top genre.

const W_FAVORITE = 4;
const W_TRACKED = 2;
const W_RECENT = 1;

type Tagged = { tags?: string[] };

export type Affinity = {
  /** genre → normalized score in 0..1 (blended across all sources) */
  scores: Record<string, number>;
  /** top genres by score, highest first */
  top: string[];
  /** raw (pre-normalization) weighted contributions, for debugging */
  bySource: {
    favorites: Record<string, number>;
    tracked: Record<string, number>;
    recent: Record<string, number>;
    play: Record<string, number>;
  };
};

function tally(items: Tagged[], weight: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    for (const tag of item.tags ?? []) out[tag] = (out[tag] ?? 0) + weight;
  }
  return out;
}

export function computeAffinity(
  input: {
    favorites: Tagged[];
    tracked: Tagged[];
    recent: Tagged[];
    playCounts: PlayCounts;
  },
  topN = 3,
): Affinity {
  const bySource = {
    favorites: tally(input.favorites, W_FAVORITE),
    tracked: tally(input.tracked, W_TRACKED),
    recent: tally(input.recent, W_RECENT),
    play: Object.values(input.playCounts).reduce<Record<string, number>>((acc, pc) => {
      for (const tag of pc.tags) acc[tag] = (acc[tag] ?? 0) + pc.count;
      return acc;
    }, {}),
  };

  const raw: Record<string, number> = {};
  for (const src of Object.values(bySource)) {
    for (const [tag, v] of Object.entries(src)) raw[tag] = (raw[tag] ?? 0) + v;
  }

  const max = Math.max(0, ...Object.values(raw));
  const scores: Record<string, number> = {};
  if (max > 0) {
    for (const [tag, v] of Object.entries(raw)) scores[tag] = v / max;
  }
  const top = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => tag);

  return { scores, top, bySource };
}

/** Live genre-affinity profile derived from the user's persisted signals. */
export function useGenreAffinity(topN = 3): Affinity {
  const { favorites } = useFavorites();
  const { tracked } = useTracking();
  const { recent } = useRecent();
  const { counts } = usePlayCounts();
  return useMemo(
    () => computeAffinity(
      { favorites: favorites as Station[], tracked, recent, playCounts: counts },
      topN,
    ),
    [favorites, tracked, recent, counts, topN],
  );
}
