'use client';

import type { Station } from '@/app/lib/stations';
import { NowPlayingCard } from './NowPlayingCard';
import { FavoritesList } from './FavoritesList';
import { Recommended } from './Recommended';

type Props = {
  selected: Station | null;
  onSelect: (s: Station) => void;
  nowPlaying: string | null;
};

// Recently-played lives in the command palette (⌘K) now, not the sidebar.
export function Sidebar({ selected, onSelect, nowPlaying }: Props) {
  return (
    <aside className="bg-[var(--color-bg-2)] border-r border-[var(--color-line)] p-7 w-[360px] shrink-0 overflow-y-auto">
      {selected && <NowPlayingCard station={selected} nowPlaying={nowPlaying} />}
      <FavoritesList onSelect={onSelect} />
      <div className="mt-6">
        <Recommended onSelect={onSelect} />
      </div>
    </aside>
  );
}
