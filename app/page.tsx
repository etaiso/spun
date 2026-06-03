'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { Station } from './lib/stations';
import { useRecent } from './lib/recent';
import { useFavorites } from './lib/favorites';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { NowPlaying } from './components/NowPlaying';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import type { PlayState } from './components/Player';

export default function Home() {
  const [selected, setSelected] = useState<Station | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [everPlayed, setEverPlayed] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const { add: addRecent } = useRecent();
  const { favorites } = useFavorites();

  // Track play-state from Player. Also remember whether audio has ever played
  // for the current station — NowPlaying uses that to avoid re-showing the
  // "Connecting…" shimmer on pause/resume buffer underruns. Set from an event
  // callback (not an effect), so no cascading-render lint issue.
  const handlePlayState = useCallback((s: PlayState) => {
    setPlayState(s);
    if (s === 'playing') setEverPlayed(true);
  }, []);

  // Wrap selection so every station pick also lands in "Recently played",
  // and reset transient state so the new station doesn't inherit the previous
  // one's (e.g. 'connecting' would render a stale splash).
  const handleSelect = useCallback((s: Station) => {
    setSelected(s);
    setPlayState('idle');
    setEverPlayed(false);
    addRecent(s);
  }, [addRecent]);

  // Page-level shortcuts: ←/→ cycle favorites, ? toggles help, Esc closes.
  // (Audio shortcuts — Space/M/↑/↓ — live in Player, which owns the audio.)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(s => !s);
      } else if (e.key === 'Escape') {
        setShowHelp(false);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (favorites.length === 0) return;
        e.preventDefault();
        const i = favorites.findIndex(f => f.id === selected?.id);
        const len = favorites.length;
        const next =
          e.key === 'ArrowRight'
            ? favorites[i < 0 ? 0 : (i + 1) % len]
            : favorites[i < 0 ? len - 1 : (i - 1 + len) % len];
        handleSelect(next);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [favorites, handleSelect, selected]);

  return (
    <div className="flex min-h-screen">
      <Sidebar selectedId={selected?.id ?? null} onSelect={handleSelect} />
      <main className="flex-1 p-10 bg-[var(--color-bg)] overflow-y-auto">
        {/* Cap the content width so the 42px title and artwork don't sprawl
            edge-to-edge on large screens. */}
        <div className="max-w-4xl w-full flex flex-col gap-6 min-h-full">
          {selected ? (
            // Single key on the Fragment so both children remount together when
            // the station changes. Short `<>` can't carry a key, and putting the
            // same key on both children produces React's duplicate-key error.
            <Fragment key={selected.id}>
              <NowPlaying station={selected} playState={playState} everPlayed={everPlayed} />
              <Player station={selected} onPlayStateChange={handlePlayState} />
            </Fragment>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)] mb-3">
                  Radio
                </div>
                <div className="text-[32px] font-bold tracking-tight">Pick a station to begin</div>
                <div className="text-base text-[var(--color-ink-3)] mt-3 max-w-md mx-auto">
                  Browse the sidebar — start with the popular list, or search for something specific. Star what you love to pin it to the top.
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      <ShortcutsHelp open={showHelp} onOpenChange={setShowHelp} />
    </div>
  );
}
