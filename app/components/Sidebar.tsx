'use client';

import type { Station } from '@/app/lib/stations';
import { FavoritesList } from './FavoritesList';
import { StationSearch } from './StationSearch';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

export function Sidebar({ selectedId, onSelect }: Props) {
  return (
    <aside className="bg-[var(--color-bg-2)] border-r border-[var(--color-line)] p-7 w-[360px] shrink-0 h-screen overflow-y-auto">
      <FavoritesList selectedId={selectedId} onSelect={onSelect} />
      <div className="mt-6">
        <StationSearch selectedId={selectedId} onSelect={onSelect} />
      </div>
    </aside>
  );
}
