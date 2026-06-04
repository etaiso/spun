'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { isNonTrack } from '@/app/lib/nonTrack';
import { useFavorites } from '@/app/lib/favorites';
import { StationCover } from './StationCover';
import { RadioWaves } from './RadioWaves';
import { loadSession, saveSession } from '@/app/lib/session';
import { splitArtistTitle } from '@/app/lib/track';
import type { TrackSource, HistoryEntry } from '@/app/lib/nowPlayingTypes';
import type { PlayState } from './Player';
import { useSavedSongs } from '@/app/lib/savedSongs';

type MetaState = 'waiting' | 'playing' | 'no-metadata' | 'no-song' | 'recognizing';

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Props = {
  station: Station;
  playState: PlayState;
  // True once audio has actually played for this station (tracked in the
  // parent from the play-state callback). Used to suppress the big
  // "Connecting…" shimmer on later buffer underruns, which flickered.
  everPlayed: boolean;
  // Reports the current real song (or null) up to the page so the sidebar can
  // show a now-playing marquee on the active station's row.
  onTrack?: (title: string | null) => void;
  // Reports the playlist history up to the page, which renders it below the
  // player controls (so the controls stay put as history grows).
  onHistory?: (history: HistoryEntry[]) => void;
};

export function NowPlaying({ station, playState, everPlayed, onTrack, onHistory }: Props) {
  const { isFavorite, toggle: toggleFavorite } = useFavorites();

  // Restore a recent session for this station (current track + history) so a
  // reload picks up where it left off — unless it's gone stale (>5 min), in
  // which case we start fresh. Parent remounts per station id, so this runs
  // once with the right station.
  const [restored] = useState(() => loadSession(station.id));

  const [metaState, setMetaState] = useState<MetaState>(restored?.current ? 'playing' : 'waiting');
  const [currentRaw, setCurrentRaw] = useState<string | null>(restored?.current?.raw ?? null);
  const [currentSource, setCurrentSource] = useState<TrackSource>(restored?.current?.source ?? 'metadata');
  // Cover art for the current track (Shazam, or an iTunes lookup fallback).
  const [currentCover, setCurrentCover] = useState<string | null>(restored?.current?.cover ?? null);
  // Outbound links for the current track (Shazam-recognized only; metadata
  // tracks get search-URL fallbacks at save time). Reset per track.
  const [links, setLinks] = useState<{ shazamUrl: string; appleMusicUrl: string; previewUrl: string; key: string }>(
    { shazamUrl: '', appleMusicUrl: '', previewUrl: '', key: '' },
  );
  const { isSaved, save, remove } = useSavedSongs();
  const [history, setHistory] = useState<HistoryEntry[]>(restored?.history ?? []);
  const [lastUpdate, setLastUpdate] = useState<string | null>(restored?.lastUpdate ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Track previous title via a ref so we can avoid the React anti-pattern of
  // calling setHistory from inside a setCurrentRaw updater (which double-fires
  // in StrictMode). Seed from the restored session so a re-broadcast of the
  // same title doesn't duplicate it into history.
  const prevTitleRef = useRef<string | null>(restored?.current?.raw ?? null);

  // Keep the onTrack callback in a ref so the SSE effect doesn't depend on it.
  const onTrackRef = useRef(onTrack);
  useEffect(() => { onTrackRef.current = onTrack; });

  // Report the playlist history up to the page for rendering below the player.
  const onHistoryRef = useRef(onHistory);
  useEffect(() => { onHistoryRef.current = onHistory; });
  useEffect(() => { onHistoryRef.current?.(history); }, [history]);

  // Persist the session (current track + history) so a reload within 5 minutes
  // can restore it. Re-stamps the freshness on every change.
  useEffect(() => {
    saveSession(station.id, {
      current: currentRaw ? { raw: currentRaw, source: currentSource, cover: currentCover } : null,
      history,
      lastUpdate,
    });
  }, [station.id, currentRaw, currentSource, currentCover, history, lastUpdate]);

  // Look up album art for the current track when we don't already have a cover
  // from Shazam — broadcast metadata only gives a text title, so most songs
  // would otherwise show no artwork. iTunes Search is free, keyless and
  // CORS-enabled. We tag the result with the track it's for and only display it
  // when it still matches, so stale art never flashes on the next song (and
  // setState stays out of the effect body, avoiding cascading renders).
  const [lookedUp, setLookedUp] = useState<{ key: string; url: string; appleUrl: string; previewUrl: string } | null>(null);
  useEffect(() => {
    if (!currentRaw || currentCover || isNonTrack(currentRaw, station.name)) return;
    const { artist, title } = splitArtistTitle(currentRaw);
    const term = [artist, title].filter(Boolean).join(' ').trim();
    if (!term) return;

    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`,
          { signal: ctrl.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { results?: { artworkUrl100?: string; trackViewUrl?: string; previewUrl?: string }[] };
        const r = data.results?.[0];
        // Capture cover (bumped 100→600), the direct Apple Music URL, AND the
        // ~30s preview clip — so a metadata-only track (no Shazam fingerprint)
        // still gets art, a real link, and a playable preview when saved.
        if (!cancelled && r && (r.artworkUrl100 || r.trackViewUrl || r.previewUrl)) {
          setLookedUp({
            key: currentRaw,
            url: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : '',
            appleUrl: r.trackViewUrl ?? '',
            previewUrl: r.previewUrl ?? '',
          });
        }
      } catch {
        // Network/abort — silently keep the station logo.
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [currentRaw, currentCover, station.name]);

  // Effective cover: Shazam's art if present, else the looked-up art (only when
  // it's for the song currently on screen).
  const matchedLookup = lookedUp?.key === currentRaw ? lookedUp : null;
  const trackCover = currentCover ?? (matchedLookup?.url || null);

  // Parent keys this component by station.id, so a station change remounts
  // and all the useState initial values are fresh. No explicit reset needed.
  // refreshKey bumps when the user clicks the manual refresh button, which
  // forces this effect to re-run (closing the old EventSource and opening a
  // fresh one — the server starts a new ICY parse).
  useEffect(() => {
    onTrackRef.current?.(null); // reset the sidebar marquee for the new station
    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: 'track'; title: string; source?: TrackSource; cover?: string; shazamUrl?: string; appleMusicUrl?: string; previewUrl?: string; key?: string }
          | { type: 'no-metadata' }
          | { type: 'no-song' }
          | { type: 'recognizing' }
          | { type: 'error'; message: string };

        if (msg.type === 'no-metadata') {
          setRefreshing(false);
          if (prevTitleRef.current === null) setMetaState('no-metadata');
        } else if (msg.type === 'no-song') {
          // Station has a metadata channel but isn't naming a song, and Shazam
          // couldn't identify it either. Only show the "no song info" state if
          // we haven't already shown a real track.
          setRefreshing(false);
          if (prevTitleRef.current === null) setMetaState('no-song');
        } else if (msg.type === 'recognizing') {
          // Fingerprinting in progress (station gave no title). Don't disturb
          // a song that's already on screen.
          if (prevTitleRef.current === null) setMetaState('recognizing');
        } else if (msg.type === 'track') {
          setMetaState('playing');
          setLastUpdate(nowHHMM());
          setRefreshing(false);
          setCurrentSource(msg.source ?? 'metadata');
          setCurrentCover(msg.cover ?? null);
          setLinks({
            shazamUrl: msg.shazamUrl ?? '', appleMusicUrl: msg.appleMusicUrl ?? '',
            previewUrl: msg.previewUrl ?? '', key: msg.key ?? '',
          });
          const prev = prevTitleRef.current;
          if (prev === msg.title) return;
          if (prev !== null && !isNonTrack(prev, station.name)) {
            setHistory(h => [{ time: nowHHMM(), title: prev }, ...h].slice(0, 50));
          }
          prevTitleRef.current = msg.title;
          setCurrentRaw(msg.title);
          // Report a real song up for the sidebar marquee (skip station IDs).
          onTrackRef.current?.(isNonTrack(msg.title, station.name) ? null : msg.title);
        }
        // error events: ignore. EventSource auto-reconnects; do not disrupt listening.
      } catch {}
    };

    return () => es.close();
  }, [station.id, station.streamUrl, station.name, refreshKey]);

  // Seed the sidebar marquee + tab title from the restored session on mount so
  // they reflect the cached track immediately (the SSE effect above resets to
  // null, then delivers a live title a moment later). Mount-only per station —
  // the component remounts on station change, so `restored` is always current.
  useEffect(() => {
    if (restored?.current && !isNonTrack(restored.current.raw, station.name)) {
      onTrackRef.current?.(restored.current.raw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh() {
    setRefreshing(true);
    setLastUpdate(nowHHMM());
    // Reset the current-track tracking so the re-opened stream re-identifies
    // from scratch and shows feedback (otherwise the server re-fingerprints but
    // the client suppresses the "recognizing" state and ignores an identical
    // result, so the reload looks like a no-op). History is left intact.
    prevTitleRef.current = null;
    setCurrentRaw(null);
    setCurrentCover(null);
    setMetaState('waiting');
    setRefreshKey(k => k + 1);
    setTimeout(() => setRefreshing(false), 1500);
  }

  // ===== Render branches matched to the 6 states in the spec =====

  // ⑥ Audio error (overrides everything else)
  if (playState === 'error') {
    return (
      <div className="flex flex-col gap-6">
        <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-accent)]">
          ⚠ {station.name} unreachable
        </div>
        <div className="flex gap-5 items-end">
          <div className="w-[140px] h-[140px] rounded-2xl bg-[rgba(192,57,43,0.1)] border-2 border-dashed border-[rgba(192,57,43,0.4)] flex items-center justify-center text-4xl text-[var(--color-accent)]">⚠</div>
          <div className="flex-1 pb-1">
            <div className="text-[26px] font-bold tracking-tight">Couldn&apos;t connect</div>
            <div className="text-sm text-[var(--color-ink-3)] mt-2">The station server may be down. Reconnecting…</div>
          </div>
        </div>
      </div>
    );
  }

  // ② Audio still connecting — but only on the FIRST connect. Once audio has
  // ever played, a buffer underrun (pause/resume also fires 'connecting')
  // must not re-show the shimmer splash — that swap caused a visible flicker.
  if (playState === 'connecting' && !everPlayed && currentRaw === null && history.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
          Connecting to {station.name} <span className="dots"><span /><span /><span /></span>
        </div>
        <div className="flex gap-5 items-end">
          <div className="shimmer pulse-soft w-[180px] h-[180px] rounded-2xl" />
          <div className="flex-1 pb-1">
            <div className="shimmer h-9 w-3/5 mb-2.5" />
            <div className="shimmer h-5 w-2/5" />
          </div>
        </div>
        <div className="text-sm text-[var(--color-ink-3)]">Buffering audio…</div>
      </div>
    );
  }

  // Header bits shared across states ③/④/⑤/① (all the NowPlayingFrame branches)
  const headerExtras = (
    <NowPlayingHeaderControls
      lastUpdate={lastUpdate}
      refreshing={refreshing}
      onRefresh={refresh}
      isFavorite={isFavorite(station.id)}
      onToggleFavorite={() => toggleFavorite(station)}
    />
  );

  // ④ Station has no metadata
  if (metaState === 'no-metadata') {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        playing={playState === 'playing'}
        art={<div className="w-[200px] h-[200px] rounded-2xl bg-[var(--color-line)] flex items-center justify-center text-5xl text-[var(--color-ink-4)]">♪</div>}
        title="This station doesn't share song info"
        subtitle="Audio keeps playing — you just won't see track names."
      />
    );
  }

  // Station has a metadata channel but is sending an empty song title — it
  // simply isn't naming tracks right now (Galgalatz does this permanently).
  // Tell the user instead of spinning forever; SSE stays open so a real
  // title still updates live.
  if (metaState === 'no-song') {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        playing={playState === 'playing'}
        art={<StationCover name={station.name} favicon={station.favicon} size={200} />}
        title="No song info right now"
        subtitle="This station isn't sharing track names at the moment."
      />
    );
  }

  // Fingerprinting in progress (broadcast metadata had no title; asking Shazam)
  if (metaState === 'recognizing') {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        playing={playState === 'playing'}
        art={<StationCover name={station.name} favicon={station.favicon} size={200} dim />}
        title={<>Identifying song <span className="dots"><span /><span /><span /></span></>}
        subtitle="Fingerprinting the audio with Shazam…"
        titleClassName="text-[var(--color-ink-3)]"
      />
    );
  }

  // ③ Audio playing, no first track yet
  if (metaState === 'waiting' || currentRaw === null) {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        playing={playState === 'playing'}
        art={<StationCover name={station.name} favicon={station.favicon} size={200} dim />}
        title={<>Listening for song info <span className="dots"><span /><span /><span /></span></>}
        subtitle="Most stations announce the track within ~30 seconds"
        titleClassName="text-[var(--color-ink-3)]"
      />
    );
  }

  // ⑤ Between tracks (station ID)
  if (isNonTrack(currentRaw, station.name)) {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        playing={playState === 'playing'}
        art={<StationCover name={station.name} favicon={station.favicon} size={200} />}
        title={station.name}
        subtitle="Between tracks · DJ, news, or station ID"
      />
    );
  }

  // ① Audio playing, a real track is present
  const { artist, title } = splitArtistTitle(currentRaw);
  return (
    <NowPlayingFrame
      stationName={station.name}
      headerExtras={headerExtras}
      playing={playState === 'playing'}
      art={
        <StationCover
          name={station.name}
          favicon={station.favicon}
          cover={trackCover ?? undefined}
          size={220}
          className="shadow-[0_16px_48px_rgba(192,57,43,0.28)]"
        />
      }
      title={title}
      subtitle={artist}
      badge={
        <div className="flex items-center gap-2 flex-wrap">
          {currentSource === 'shazam' && (
            <span className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.8px] uppercase font-bold text-white bg-[#0088ff] rounded-full px-2.5 py-1 shadow-[0_2px_8px_rgba(0,136,255,0.35)]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.9 7.36c-.3.41-.79.6-1.3.46-1.6-.45-3.06-.2-4.2.62-.36.26-.86.2-1.14-.15a.86.86 0 0 1 .16-1.22c1.55-1.12 3.52-1.47 5.65-.88.52.14.85.69.7 1.2a.85.85 0 0 1-.53.6Zm-.66 3.05c-.25.33-.67.48-1.06.36-1.06-.31-2-.18-2.74.36-.32.23-.77.16-1-.18a.74.74 0 0 1 .15-1.04c1.07-.78 2.45-.98 3.95-.55.42.12.66.57.5.99a.73.73 0 0 1-.04.06Zm-.86 2.86c-.2.27-.55.38-.85.27-.66-.2-1.2-.12-1.6.18-.27.2-.65.13-.84-.15a.62.62 0 0 1 .13-.87c.7-.5 1.6-.62 2.6-.32.34.1.53.46.42.8a.6.6 0 0 1-.06.31Z"/>
              </svg>
              Identified by Shazam
            </span>
          )}
          <SaveSongButton
            saved={isSaved(links.key || `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`)}
            onToggle={() => {
              const id = links.key || `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
              if (isSaved(id)) { remove(id); return; }
              save({
                raw: currentRaw ?? '', artist, title, cover: trackCover ?? undefined,
                shazamUrl: links.shazamUrl || undefined,
                appleMusicUrl: (links.appleMusicUrl || matchedLookup?.appleUrl) || undefined,
                previewUrl: (links.previewUrl || matchedLookup?.previewUrl) || undefined, key: links.key || undefined,
                stationName: station.name,
              });
            }}
          />
        </div>
      }
    />
  );
}

function NowPlayingHeaderControls({
  lastUpdate, refreshing, onRefresh, isFavorite, onToggleFavorite,
}: {
  lastUpdate: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="flex items-center gap-3 text-[var(--color-ink-3)]">
      <button
        onClick={onToggleFavorite}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        className={[
          'w-7 h-7 flex items-center justify-center text-xl leading-none cursor-pointer transition-transform hover:scale-125',
          isFavorite ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-warm)]',
        ].join(' ')}
      >
        {isFavorite ? '★' : '☆'}
      </button>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Check for song update"
        title="Check for song update"
        className="w-7 h-7 rounded-full border border-[var(--color-line)] flex items-center justify-center text-[13px] text-[var(--color-ink-3)] hover:text-[var(--color-ink)] hover:border-[var(--color-warm)] hover:bg-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {refreshing ? <span className="spin-warm" /> : <span aria-hidden="true">↻</span>}
      </button>
      {lastUpdate && (
        <span className="text-[11px] tracking-[0.6px] uppercase font-semibold text-[var(--color-ink-3)] tabular-nums">
          Updated {lastUpdate}
        </span>
      )}
    </div>
  );
}

function SaveSongButton({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={saved ? 'Remove from saved songs' : 'Save song'}
      title={saved ? 'Saved — click to remove' : 'Save this song'}
      className={[
        'inline-flex items-center gap-1.5 text-[11px] tracking-[0.8px] uppercase font-bold rounded-full px-2.5 py-1 cursor-pointer transition-colors border',
        saved
          ? 'bg-[var(--color-warm)] text-white border-[var(--color-warm)]'
          : 'text-[var(--color-warm)] border-[var(--color-line)] hover:border-[var(--color-warm)]',
      ].join(' ')}
    >
      <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}

function NowPlayingFrame({
  stationName, headerExtras, art, title, subtitle, badge, titleClassName = '', playing = false,
}: {
  stationName: string;
  headerExtras?: React.ReactNode;
  art: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  titleClassName?: string;
  playing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
        <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
          Now playing on {stationName}
        </div>
        {headerExtras}
      </div>
      <div className="flex gap-8 items-end flex-wrap">
        {/* Cover with the broadcast-wave rings radiating from behind it. */}
        <div className="relative shrink-0">
          <RadioWaves playing={playing} />
          <div className="relative z-10">{art}</div>
        </div>
        {/* basis-80 + flex-wrap: the text block keeps its own line beside the
            art when there's room, and drops below it (full width) when the
            panel is too narrow — no horizontal overflow from the big title. */}
        <div className="relative z-10 flex-1 basis-80 min-w-0 pb-2">
          {badge && <div className="mb-2.5">{badge}</div>}
          <div className={`text-[clamp(28px,5vw,42px)] font-extrabold tracking-[-1.2px] leading-[1.05] break-words ${titleClassName}`}>{title}</div>
          {subtitle && <div className="text-[clamp(16px,2.5vw,22px)] text-[var(--color-ink-2)] font-medium mt-1.5 break-words">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}
