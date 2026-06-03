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

  if (recent.length === 0) return null;

  return (
    <CollapsibleSection title="↻ Recently played" count={recent.length} defaultCollapsed>
      {recent.map(s => (
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
