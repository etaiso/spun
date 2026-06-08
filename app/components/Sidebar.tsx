'use client';

import type { Station } from '@/app/lib/stations';
import { NowPlayingCard } from './NowPlayingCard';
import { FavoritesList } from './FavoritesList';
import { Recommended } from './Recommended';

type Props = {
  selected: Station | null;
  onSelect: (s: Station) => void;
  nowPlaying: string | null;
  // Hidden (but kept mounted, so Popular isn't refetched) while Explore is open,
  // giving the browse view the full width.
  hidden?: boolean;
};

// Recently-played lives in the command palette (⌘K) now, not the sidebar.
export function Sidebar({ selected, onSelect, nowPlaying, hidden }: Props) {
  return (
    <aside className={[
      'bg-[var(--color-bg-2)] border-r border-[var(--color-line)] p-7 w-[360px] shrink-0 overflow-y-auto',
      hidden ? 'hidden' : '',
    ].join(' ')}>
      {selected && <NowPlayingCard station={selected} nowPlaying={nowPlaying} />}
      <FavoritesList onSelect={onSelect} />
      <div className="mt-6">
        <Recommended onSelect={onSelect} />
      </div>
    </aside>
  );
}
