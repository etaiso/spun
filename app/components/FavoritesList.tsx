'use client';

import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { StationRow } from './StationRow';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
  nowPlaying: string | null;
};

export function FavoritesList({ selectedId, onSelect, nowPlaying }: Props) {
  const { favorites, toggle } = useFavorites();

  return (
    <CollapsibleSection title="★ Favorites" count={favorites.length}>
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
            nowPlaying={s.id === selectedId ? nowPlaying : null}
          />
        ))
      )}
    </CollapsibleSection>
  );
}
