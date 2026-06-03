'use client';

import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { useRegionFilter } from '@/app/lib/region';
import { useHiddenFilter } from '@/app/lib/hidden';
import { StationRow } from './StationRow';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  onSelect: (s: Station) => void;
};

export function FavoritesList({ onSelect }: Props) {
  const { favorites, toggle } = useFavorites();
  const filterByRegion = useRegionFilter();
  const filterHidden = useHiddenFilter();
  const shown = filterHidden(filterByRegion(favorites));

  return (
    <CollapsibleSection title="★ Favorites" count={shown.length}>
      {favorites.length === 0 ? (
        <div className="text-sm text-[var(--color-ink-3)] mb-4 px-1">
          Star a station below to pin it here.
        </div>
      ) : shown.length === 0 ? (
        <div className="text-sm text-[var(--color-ink-3)] mb-4 px-1">
          No favorites match the current filters.
        </div>
      ) : (
        shown.map(s => (
          <StationRow
            key={s.id}
            station={s}
            isActive={false}
            isFavorite
            onSelect={() => onSelect(s)}
            onToggleFavorite={() => toggle(s)}
          />
        ))
      )}
    </CollapsibleSection>
  );
}
