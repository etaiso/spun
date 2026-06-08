'use client';

import { splitArtistTitle } from '@/app/lib/track';
import { useSavedSongs } from '@/app/lib/savedSongs';
import type { HistoryEntry } from '@/app/lib/nowPlayingTypes';

const savedId = (artist: string, title: string) =>
  `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

// Session playlist log, rendered below the player controls. Carries a solid
// background + soft feather so the pulse rings dissolve smoothly into it.
// Each row can be saved (brand heart) — metadata-only saves whose cover /
// preview / Apple Music link the SavedSongsDialog backfills from iTunes.
export function PlaylistHistory({ history, stationName }: { history: HistoryEntry[]; stationName: string }) {
  const { isSaved, save, remove } = useSavedSongs();
  if (history.length === 0) return null;

  return (
    <div className="relative z-10 bg-[var(--color-bg)]">
      <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">
        ▾ Playlist history
      </div>
      {history.map((h, i) => {
        const { artist, title } = splitArtistTitle(h.title);
        const id = savedId(artist, title);
        const saved = isSaved(id);
        return (
          <div
            key={i}
            className="grid grid-cols-[64px_1fr_auto] gap-4 py-3 border-b border-[var(--color-line)] items-center last:border-none"
          >
            <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
            <div className="text-base text-[var(--color-ink-2)]">
              {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
            </div>
            <button
              onClick={() => {
                if (saved) { remove(id); return; }
                save({ raw: h.title, artist, title, stationName, playedAt: h.at ?? Date.now() });
              }}
              aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
              title={saved ? 'Saved — click to remove' : 'Save this song'}
              className={[
                'w-7 h-7 flex items-center justify-center text-base leading-none cursor-pointer transition-transform hover:scale-125',
                saved ? 'text-[var(--color-brand-pink)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-brand-pink)]',
              ].join(' ')}
            >
              <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
