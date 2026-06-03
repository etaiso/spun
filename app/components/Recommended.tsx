'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { useRegion } from '@/app/lib/region';
import { StationRow } from './StationRow';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  selectedId: string | null;
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

export function Recommended({ selectedId, onSelect }: Props) {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [errored, setErrored] = useState(false);
  const { isFavorite, toggle } = useFavorites();
  const { region } = useRegion();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = region ? `/api/popular?region=${encodeURIComponent(region)}` : '/api/popular';
        const res = await fetch(url);
        if (!res.ok) { if (!cancelled) setErrored(true); return; }
        const data = (await res.json()) as unknown;
        if (!cancelled) {
          setStations(Array.isArray(data) ? (data as Station[]) : []);
        }
      } catch {
        if (!cancelled) setErrored(true);
      }
    })();
    return () => { cancelled = true; };
  }, [region]);

  return (
    <CollapsibleSection title="✦ Popular">
      {stations === null && !errored && (
        <>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </>
      )}
      {errored && (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">
          Couldn&apos;t load popular stations.
        </div>
      )}
      {stations?.map(s => (
        <StationRow
          key={s.id}
          station={s}
          isActive={s.id === selectedId}
          isFavorite={isFavorite(s.id)}
          onSelect={() => onSelect(s)}
          onToggleFavorite={() => toggle(s)}
        />
      ))}
    </CollapsibleSection>
  );
}
