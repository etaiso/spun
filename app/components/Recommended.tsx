'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { useRegion, useRegionFilter } from '@/app/lib/region';
import { useHiddenFilter } from '@/app/lib/hidden';
import { useGenreAffinity } from '@/app/lib/taste';
import { scorePopular } from '@/app/lib/popularRank';
import { StationRow } from './StationRow';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  onSelect: (s: Station) => void;
};

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
      <div className="shimmer w-10 h-10 rounded-[10px]" />
      <div className="flex-1">
        <div className="shimmer h-3.5 w-3/5 mb-1.5" />
        <div className="shimmer h-2.5 w-2/5" />
      </div>
    </div>
  );
}

export function Recommended({ onSelect }: Props) {
  // The raw candidate pool from the API (≈40), pre-ranking.
  const [pool, setPool] = useState<Station[] | null>(null);
  const [errored, setErrored] = useState(false);
  const { isFavorite, toggle } = useFavorites();
  const { region } = useRegion();
  const filterByRegion = useRegionFilter();
  const filterHidden = useHiddenFilter();
  const { scores, top } = useGenreAffinity();

  // Refetch when the region or our top genres change. A string key keeps the
  // dependency stable (arrays change identity every render).
  const genresKey = top.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (region) params.set('region', region);
        if (genresKey) params.set('genres', genresKey);
        const qs = params.toString();
        const res = await fetch(qs ? `/api/popular?${qs}` : '/api/popular');
        if (!res.ok) { if (!cancelled) setErrored(true); return; }
        const data = (await res.json()) as unknown;
        if (!cancelled) setPool(Array.isArray(data) ? (data as Station[]) : []);
      } catch {
        if (!cancelled) setErrored(true);
      }
    })();
    return () => { cancelled = true; };
  }, [region, genresKey]);

  // Filter, then re-rank live by genre affinity + popularity + region, then drop
  // favorites (they have their own section). Re-runs every render, so the order
  // updates instantly as you star/play a station — no refetch.
  const filtered = filterHidden(filterByRegion(pool ?? []));
  const ranked = scorePopular(filtered, { region: region || null, affinity: scores });
  const shown = ranked.filter(s => !isFavorite(s.id));

  return (
    <CollapsibleSection title="✦ Popular">
      {pool === null && !errored && (
        <>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </>
      )}
      {errored && (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">
          Couldn&apos;t load popular stations.
        </div>
      )}
      {pool !== null && !errored && shown.length === 0 && (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">
          No popular stations in this region.
        </div>
      )}
      {shown.slice(0, 15).map(s => (
        <StationRow
          key={s.id}
          station={s}
          isActive={false}
          isFavorite={isFavorite(s.id)}
          onSelect={() => onSelect(s)}
          onToggleFavorite={() => toggle(s)}
        />
      ))}
    </CollapsibleSection>
  );
}
