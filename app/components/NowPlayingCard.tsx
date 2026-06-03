'use client';

import type { Station } from '@/app/lib/stations';
import { StationLogo } from './StationLogo';

type Props = {
  station: Station;
  nowPlaying: string | null;
};

// The single place the currently-playing station + song marquee appears in
// the sidebar. Pinned above the lists so it isn't duplicated across
// Favorites / Recently played / Popular.
export function NowPlayingCard({ station, nowPlaying }: Props) {
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
      </div>
    </div>
  );
}
