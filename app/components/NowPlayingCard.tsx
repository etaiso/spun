'use client';

import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { useTracking } from '@/app/lib/tracking';
import { StationLogo } from './StationLogo';

type Props = {
  station: Station;
  nowPlaying: string | null;
};

// The single place the currently-playing station + song marquee appears in
// the sidebar. Pinned above the lists so it isn't duplicated across
// Favorites / Recently played / Popular.
export function NowPlayingCard({ station, nowPlaying }: Props) {
  const { isFavorite, toggle } = useFavorites();
  const { isTracked, track, untrack } = useTracking();
  const fav = isFavorite(station.id);
  const tracked = isTracked(station.id);

  return (
    <div className="mb-6 rounded-2xl border border-[rgba(210,105,30,0.35)] bg-white p-3 shadow-[0_2px_10px_rgba(120,60,30,0.08)]">
      <div className="flex items-center gap-1.5 mb-2.5 text-[10px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warm)] pulse-soft" />
        Now playing
      </div>
      <div className="flex items-center gap-3">
        <StationLogo name={station.name} favicon={station.favicon} size={44} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold tracking-tight truncate">{station.name}</div>
          {nowPlaying ? (
            <div className="marquee text-xs text-[var(--color-warm)] font-semibold">
              <span className="marquee-inner">
                ♪ {nowPlaying}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;♪ {nowPlaying}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
              </span>
            </div>
          ) : (
            <div className="text-xs text-[var(--color-ink-3)] truncate">
              {station.country || 'Live'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => (tracked ? untrack(station.id) : track(station))}
            aria-label={tracked ? 'Stop tracking' : 'Track in background'}
            title={tracked ? 'Stop tracking' : 'Track in background'}
            className={[
              'w-8 h-8 flex items-center justify-center',
              'cursor-pointer transition-transform hover:scale-125',
              tracked ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-warm)]',
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            onClick={() => toggle(station)}
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            title={fav ? 'Remove from favorites' : 'Add to favorites'}
            className={[
              'w-8 h-8 flex items-center justify-center text-xl leading-none',
              'cursor-pointer transition-transform hover:scale-125',
              fav ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-warm)]',
            ].join(' ')}
          >
            {fav ? '★' : '☆'}
          </button>
        </div>
      </div>
    </div>
  );
}
