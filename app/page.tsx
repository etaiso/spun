'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Station } from './lib/stations';
import { useRecent } from './lib/recent';
import { usePlayCounts } from './lib/playCounts';
import { useFavorites } from './lib/favorites';
import { useHidden } from './lib/hidden';
import { useDetectRegionByIP } from './lib/region';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { NowPlaying } from './components/NowPlaying';
import { PlaylistHistory } from './components/PlaylistHistory';
import { CommandPalette } from './components/CommandPalette';
import { ExploreView } from './components/ExploreView';
import { TrackingPanel } from './components/TrackingPanel';
import { useTracking } from './lib/tracking';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { SettingsDialog } from './components/SettingsDialog';
import { SavedSongsDialog } from './components/SavedSongsDialog';
import type { PlayState } from './components/Player';
import type { HistoryItem, HistoryEntry } from './lib/nowPlayingTypes';
import { isGap } from './lib/nowPlayingTypes';
import { subscribeTimeshiftState, requestSeekToWallClock } from './lib/timeshift/bus';
import type { TimeshiftState } from './lib/timeshift/engine';

export default function Home() {
  const [selected, setSelected] = useState<Station | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [everPlayed, setEverPlayed] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  // Playlist history, lifted out of NowPlaying so it renders below the player
  // controls — the controls stay anchored near the cover as history grows.
  const [playlistHistory, setPlaylistHistory] = useState<HistoryItem[]>([]);
  // Latest timeshift engine state (null when timeshift is off / inactive),
  // published by the Player-owned engine via the bus. Drives the timeline song
  // ticks and the jump-from-buffer affordance in PlaylistHistory.
  const [tsState, setTsState] = useState<TimeshiftState | null>(null);
  useEffect(() => subscribeTimeshiftState(setTsState), []);

  // Song ticks for the scrubber: history entries with a known air-start that
  // falls inside the currently-buffered wall-clock range.
  const ticks = useMemo(() => {
    if (!tsState?.bufferStartMs || !tsState.liveEdgeMs) return [];
    return playlistHistory
      .filter((h): h is HistoryEntry => !isGap(h) && h.startedAt !== undefined)
      .filter(h => h.startedAt! >= tsState.bufferStartMs! && h.startedAt! <= tsState.liveEdgeMs!)
      .map(h => ({ atMs: h.startedAt!, title: h.title }));
  }, [playlistHistory, tsState]);
  const [showHelp, setShowHelp] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  // Top-level view: the now-playing home, or the Explore browse destination.
  const [view, setView] = useState<'home' | 'explore'>('home');
  // Once Explore has been opened we keep it mounted (just hidden) so its filters
  // and loaded results survive leaving for the now-playing view and coming back.
  const [exploredOnce, setExploredOnce] = useState(false);
  const { recent, add: addRecent } = useRecent();
  const { bump: bumpPlay } = usePlayCounts();
  const { favorites } = useFavorites();
  const { isHidden } = useHidden();
  const { tracked } = useTracking();

  // Refine the search region from the user's IP (physical location), unless
  // they've manually chosen one in Settings.
  useDetectRegionByIP();

  // The station on screen: the user's explicit pick, otherwise the most recent
  // non-hidden station so a reload returns to it. `recent` is empty on the server
  // and during hydration (useSyncExternalStore server snapshot) then fills from
  // localStorage on the client, so this restores post-hydration with no
  // mismatch — and deriving it (vs. setState in an effect) avoids a cascading
  // render.
  const currentStation = selected ?? recent.find(s => !isHidden(s.id)) ?? null;

  // Reflect what's playing in the browser tab: "Song — Station", or just the
  // station name, falling back to "Spun" when nothing's selected.
  useEffect(() => {
    document.title = currentStation
      ? currentTrack
        ? `♫ ${currentTrack} — ${currentStation.name}`
        : currentStation.name
      : 'Spun';
  }, [currentStation, currentTrack]);

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
    // Re-selecting the station that's already current would reset its
    // now-playing state (clearing the sidebar marquee until the next SSE
    // update) even though nothing changed — treat it as a no-op.
    if (s.id === currentStation?.id) return;
    setSelected(s);
    setPlayState('idle');
    setEverPlayed(false);
    setCurrentTrack(null);
    // playlistHistory isn't reset here: NowPlaying reports the new station's
    // history on mount (the restored list, or []), which keeps this in sync.
    // Clearing it here would desync when the same station is re-selected.
    addRecent(s);
    bumpPlay(s);
  }, [addRecent, bumpPlay, currentStation]);

  // Page-level shortcuts. ⌘K / Ctrl+K opens the command palette (handled
  // before the modifier bail). ←/→ cycle favorites, ? toggles help, S toggles
  // saved songs, Esc closes. Audio shortcuts (Space/M/↑/↓) live in Player.
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
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSavedOpen(o => !o);
      } else if (e.key === 'Escape') {
        setShowHelp(false);
        setView('home');
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (favorites.length === 0) return;
        e.preventDefault();
        const i = favorites.findIndex(f => f.id === currentStation?.id);
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
  }, [favorites, handleSelect, currentStation, paletteOpen]);

  // Hardware media keys (the ⏮/⏭ buttons on media keyboards) and OS media
  // controls. next/prev cycle favorites — mirroring the in-app ←/→ behavior —
  // via the Media Session API (works in browsers and the Electron desktop app).
  // Only wired while there are favorites, so the OS hides the buttons otherwise.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const cycle = (dir: 1 | -1) => {
      if (favorites.length === 0) return;
      const i = favorites.findIndex(f => f.id === currentStation?.id);
      const len = favorites.length;
      const next =
        dir === 1
          ? favorites[i < 0 ? 0 : (i + 1) % len]
          : favorites[i < 0 ? len - 1 : (i - 1 + len) % len];
      handleSelect(next);
    };
    try {
      const has = favorites.length > 0;
      ms.setActionHandler('previoustrack', has ? () => cycle(-1) : null);
      ms.setActionHandler('nexttrack', has ? () => cycle(1) : null);
    } catch { /* some actions aren't supported everywhere */ }
    return () => {
      try {
        ms.setActionHandler('previoustrack', null);
        ms.setActionHandler('nexttrack', null);
      } catch { /* ignore */ }
    };
  }, [favorites, currentStation, handleSelect]);

  // Populate the OS "Now Playing" panel (and lock screen) with the current
  // station/track, which also keeps the media-key session reliably active.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof MediaMetadata === 'undefined') return;
    if (!currentStation) { navigator.mediaSession.metadata = null; return; }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack ?? currentStation.name,
      artist: currentTrack ? currentStation.name : 'Spun',
      artwork: currentStation.favicon
        ? [{ src: currentStation.favicon, sizes: '512x512' }]
        : [],
    });
  }, [currentStation, currentTrack]);

  return (
    <div className="flex flex-col h-screen">
      <TopBar
        onOpenSearch={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSaved={() => setSavedOpen(true)}
        settingsActive={settingsOpen}
        onToggleExplore={() => {
          if (view === 'explore') setView('home');
          else { setExploredOnce(true); setView('explore'); }
        }}
        exploreActive={view === 'explore'}
        onGoHome={() => setView('home')}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar selected={currentStation} onSelect={handleSelect} nowPlaying={currentTrack} hidden={view === 'explore'} />
        <main className="flex-1 bg-[var(--color-bg)] overflow-y-auto overflow-x-hidden">
          {/* Now-playing stage. It stays mounted while Explore is open — the
              cover, history and tracking panel hide, and the stage wrappers
              collapse — so the Player (and its live audio + now-playing SSE)
              keep running uninterrupted. The Player itself re-renders as a
              fixed bottom dock via `dock`. Wrappers are keyed by station so a
              station change still remounts them; a view change does not. */}
          {currentStation && (
            <div className={view === 'explore' ? '' : 'p-10 min-h-full flex flex-col'}>
              <div className={view === 'explore' ? '' : 'w-full flex-1 flex flex-col lg:flex-row gap-8'}>
                <div className={view === 'explore' ? '' : 'flex-1 min-w-0 flex flex-col justify-center'}>
                  <div className={view === 'explore' ? '' : 'w-full max-w-4xl mx-auto flex flex-col gap-6'}>
                    <div className={view === 'explore' ? 'hidden' : ''}>
                      <NowPlaying key={currentStation.id} station={currentStation} playState={playState} everPlayed={everPlayed} onTrack={setCurrentTrack} onHistory={setPlaylistHistory} />
                    </div>
                    <Player
                      key={currentStation.id}
                      station={currentStation}
                      onPlayStateChange={handlePlayState}
                      dock={view === 'explore'}
                      nowPlaying={currentTrack}
                      onExpand={() => setView('home')}
                      ticks={ticks}
                    />
                    <div className={view === 'explore' ? 'hidden' : ''}>
                      <PlaylistHistory
                        key={currentStation.id}
                        history={playlistHistory}
                        stationName={currentStation.name}
                        jumpRange={tsState && tsState.bufferStartMs !== null && tsState.liveEdgeMs !== null
                          ? { startMs: tsState.bufferStartMs, endMs: tsState.liveEdgeMs } : null}
                        onJumpTo={requestSeekToWallClock}
                      />
                    </div>
                  </div>
                </div>
                {tracked.length > 0 && view !== 'explore' && (
                  <aside className="shrink-0 self-stretch lg:w-[320px] lg:border-l lg:border-[var(--color-line)] lg:pl-8 pt-2">
                    <TrackingPanel
                      onSelect={handleSelect}
                      activeStationId={currentStation?.id ?? null}
                      activeTrack={currentTrack}
                    />
                  </aside>
                )}
              </div>
            </div>
          )}

          {/* Explore destination. Kept mounted (just hidden) once opened so its
              filters + loaded results persist when you pop out to the now-playing
              view and back. Bottom padding clears the fixed player dock when
              something is playing. Selecting a station keeps you in Explore. */}
          {exploredOnce && (
            <div className={view === 'explore' ? (currentStation ? 'pb-24' : '') : 'hidden'}>
              <ExploreView onSelect={handleSelect} />
            </div>
          )}

          {!currentStation && view !== 'explore' && (
            <div className="p-10 min-h-full flex items-center justify-center text-center">
              <div>
                <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-brand-purple)] mb-3">
                  Spun
                </div>
                <div className="text-[32px] font-bold tracking-tight">Pick a station to begin</div>
                <div className="text-base text-[var(--color-ink-3)] mt-3 max-w-md mx-auto">
                  Press <kbd className="px-1.5 py-0.5 rounded border border-[var(--color-line)] bg-white text-[12px] font-semibold">⌘K</kbd> to search, or browse the popular list in the sidebar. Star what you love to pin it to the top.
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onSelect={handleSelect} />
      )}
      <ShortcutsHelp open={showHelp} onOpenChange={setShowHelp} dockVisible={view === 'explore' && !!currentStation} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        station={currentStation}
        playState={playState}
        currentTrack={currentTrack}
      />
      <SavedSongsDialog open={savedOpen} onOpenChange={setSavedOpen} />
    </div>
  );
}
