'use client';

import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { StationRow } from './StationRow';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

export function FavoritesList({ selectedId, onSelect }: Props) {
  const { favorites, toggle } = useFavorites();

  return (
    <div>
      <div className="text-[11px] tracking-[1.4px] text-[var(--color-warm)] font-extrabold uppercase mb-3.5">
        ★ Favorites
      </div>
      {favorites.length === 0 ? (
        <div className="text-sm text-[var(--color-ink-3)] mb-4 px-1">
          Star a station below to pin it here.
        </div>
      ) : (
        favorites.map(s => (
          <StationRow
            key={s.id}
            station={s}
            isActive={s.id === selectedId}
            isFavorite
            onSelect={() => onSelect(s)}
            onToggleFavorite={() => toggle(s)}
          />
        ))
      )}
    </div>
  );
}
