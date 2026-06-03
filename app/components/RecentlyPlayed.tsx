'use client';

import type { Station } from '@/app/lib/stations';
import { useRecent } from '@/app/lib/recent';
import { useFavorites } from '@/app/lib/favorites';
import { StationRow } from './StationRow';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

export function RecentlyPlayed({ selectedId, onSelect }: Props) {
  const { recent } = useRecent();
  const { isFavorite, toggle } = useFavorites();

  // The currently-playing station lives in the Now Playing card above, so
  // drop it here to avoid showing it twice.
  const items = recent.filter(s => s.id !== selectedId);
  if (items.length === 0) return null;

  return (
    <CollapsibleSection title="↻ Recently played" count={items.length}>
      {items.map(s => (
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
