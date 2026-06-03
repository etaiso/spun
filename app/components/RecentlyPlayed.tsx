'use client';

import type { Station } from '@/app/lib/stations';
import { useRecent } from '@/app/lib/recent';
import { useFavorites } from '@/app/lib/favorites';
import { StationRow } from './StationRow';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

export function RecentlyPlayed({ selectedId, onSelect }: Props) {
  const { recent } = useRecent();
  const { isFavorite, toggle } = useFavorites();

  if (recent.length === 0) return null;

  return (
    <div>
      <div className="text-[11px] tracking-[1.4px] text-[var(--color-warm)] font-extrabold uppercase mb-3.5">
        ↻ Recently played
      </div>
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
    </div>
  );
}
