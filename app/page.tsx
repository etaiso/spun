'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { Station } from './lib/stations';
import { useRecent } from './lib/recent';
import { useFavorites } from './lib/favorites';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { NowPlaying } from './components/NowPlaying';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { RegionPicker } from './components/RegionPicker';
import type { PlayState } from './components/Player';

export default function Home() {
  const [selected, setSelected] = useState<Station | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [everPlayed, setEverPlayed] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
    setCurrentTrack(null);
    addRecent(s);
  }, [addRecent]);

  // Page-level shortcuts. ⌘K / Ctrl+K opens the command palette (handled
  // before the modifier bail). ←/→ cycle favorites, ? toggles help, Esc
  // closes. Audio shortcuts (Space/M/↑/↓) live in Player.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(o => !o);
        return;
      }
      // Palette owns the keyboard while open.
      if (paletteOpen) return;

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
  }, [favorites, handleSelect, selected, paletteOpen]);

  return (
    <div className="flex flex-col h-screen">
      <TopBar onOpenSearch={() => setPaletteOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar selected={selected} onSelect={handleSelect} nowPlaying={currentTrack} />
        <main className="flex-1 p-10 bg-[var(--color-bg)] overflow-y-auto overflow-x-hidden">
          {/* Centered, width-capped stage so the title + artwork sit in the
              middle of the panel instead of sprawling top-left. */}
          <div className="max-w-4xl w-full mx-auto flex flex-col gap-6 min-h-full justify-center">
            {selected ? (
              // Single key on the Fragment so both children remount together
              // when the station changes. Short `<>` can't carry a key, and
              // the same key on both children is a React duplicate-key error.
              <Fragment key={selected.id}>
                <NowPlaying station={selected} playState={playState} everPlayed={everPlayed} onTrack={setCurrentTrack} />
                <Player station={selected} onPlayStateChange={handlePlayState} />
              </Fragment>
            ) : (
              <div className="flex items-center justify-center text-center">
                <div>
                  <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)] mb-3">
                    Radio
                  </div>
                  <div className="text-[32px] font-bold tracking-tight">Pick a station to begin</div>
                  <div className="text-base text-[var(--color-ink-3)] mt-3 max-w-md mx-auto">
                    Press <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-line)] bg-white text-[12px] font-semibold">⌘K</kbd> to search, or browse the popular list in the sidebar. Star what you love to pin it to the top.
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
      <RegionPicker />
      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onSelect={handleSelect} />
      )}
      <ShortcutsHelp open={showHelp} onOpenChange={setShowHelp} />
    </div>
  );
}
