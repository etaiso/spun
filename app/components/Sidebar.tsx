'use client';

import type { Station } from '@/app/lib/stations';
import { NowPlayingCard } from './NowPlayingCard';
import { FavoritesList } from './FavoritesList';
import { RecentlyPlayed } from './RecentlyPlayed';
import { Recommended } from './Recommended';

type Props = {
  selected: Station | null;
  onSelect: (s: Station) => void;
  nowPlaying: string | null;
};

export function Sidebar({ selected, onSelect, nowPlaying }: Props) {
  const selectedId = selected?.id ?? null;
  return (
    <aside className="bg-[var(--color-bg-2)] border-r border-[var(--color-line)] p-7 w-[360px] shrink-0 overflow-y-auto">
      {selected && <NowPlayingCard station={selected} nowPlaying={nowPlaying} />}
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
