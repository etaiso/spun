'use client';

import { splitArtistTitle } from '@/app/lib/track';
import type { HistoryEntry } from '@/app/lib/nowPlayingTypes';

// Session playlist log, rendered below the player controls. Carries a solid
// background + soft feather so the pulse rings dissolve smoothly into it.
export function PlaylistHistory({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) return null;

  return (
    <div className="relative z-10 bg-[var(--color-bg)]">
      <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">
        ▾ Playlist history
      </div>
      {history.map((h, i) => {
        const { artist, title } = splitArtistTitle(h.title);
        return (
          <div
            key={i}
            className="grid grid-cols-[64px_1fr] gap-4 py-3 border-b border-[var(--color-line)] items-baseline last:border-none"
          >
            <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
            <div className="text-base text-[var(--color-ink-2)]">
              {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
            </div>
          </div>
        );
      })}
    </div>
  );
}
