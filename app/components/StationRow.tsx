'use client';

import type { Station } from '@/app/lib/stations';
import { StationLogo } from './StationLogo';

type Props = {
  station: Station;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  // When this row is the active station and a song is detected, the current
  // track title — shown as a marquee in place of the country/bitrate line.
  nowPlaying?: string | null;
};

export function StationRow({ station, isActive, isFavorite, onSelect, onToggleFavorite, nowPlaying }: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={[
        'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors mb-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-warm)]',
        isActive
          ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-[var(--color-line)]'
          : 'hover:bg-[rgba(210,105,30,0.05)]',
      ].join(' ')}
    >
      <StationLogo name={station.name} favicon={station.favicon} />
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
            {[station.country, station.bitrate > 0 ? `${station.bitrate} kbps` : null].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        className={[
          'shrink-0 w-8 h-8 flex items-center justify-center text-xl leading-none',
          'cursor-pointer transition-transform hover:scale-125',
          isFavorite ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-warm)]',
        ].join(' ')}
      >
        {isFavorite ? '★' : '☆'}
      </button>
    </div>
  );
}
