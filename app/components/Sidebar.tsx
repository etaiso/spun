'use client';

import type { Station } from '@/app/lib/stations';
import { FavoritesList } from './FavoritesList';
import { RecentlyPlayed } from './RecentlyPlayed';
import { Recommended } from './Recommended';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

export function Sidebar({ selectedId, onSelect }: Props) {
  return (
    <aside className="bg-[var(--color-bg-2)] border-r border-[var(--color-line)] p-7 w-[360px] shrink-0 overflow-y-auto">
      <FavoritesList selectedId={selectedId} onSelect={onSelect} />
      <div className="mt-6">
        <RecentlyPlayed selectedId={selectedId} onSelect={onSelect} />
      </div>
      <div className="mt-6">
        <Recommended selectedId={selectedId} onSelect={onSelect} />
      </div>
    </aside>
  );
}
