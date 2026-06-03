'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { isNonTrack } from '@/app/lib/nonTrack';
import { useFavorites } from '@/app/lib/favorites';
import { StationCover } from './StationCover';
import type { PlayState } from './Player';

type MetaState = 'waiting' | 'playing' | 'no-metadata' | 'no-song' | 'recognizing';
type TrackSource = 'metadata' | 'shazam';

type HistoryEntry = { time: string; title: string };

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function splitArtistTitle(raw: string): { artist: string; title: string } {
  // Try separators in order of confidence: em-dash and en-dash are
  // unambiguous; ASCII hyphen is only used if the left side has no hyphen
  // (avoids miscategorizing titles like "Song - Live Version").
  for (const sep of [' — ', ' – '] as const) {
    if (raw.includes(sep)) {
      const [artist, ...rest] = raw.split(sep);
      return { artist: artist.trim(), title: rest.join(sep).trim() };
    }
  }
  const hyphenIdx = raw.indexOf(' - ');
  if (hyphenIdx > 0 && !raw.slice(0, hyphenIdx).includes('-')) {
    const artist = raw.slice(0, hyphenIdx);
    const title = raw.slice(hyphenIdx + 3);
    return { artist: artist.trim(), title: title.trim() };
  }
  return { artist: '', title: raw };
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
};

export function NowPlaying({ station, playState, everPlayed, onTrack }: Props) {
  const { isFavorite, toggle: toggleFavorite } = useFavorites();
  const [metaState, setMetaState] = useState<MetaState>('waiting');
  const [currentRaw, setCurrentRaw] = useState<string | null>(null);
  const [currentSource, setCurrentSource] = useState<TrackSource>('metadata');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Track previous title via a ref so we can avoid the React anti-pattern of
  // calling setHistory from inside a setCurrentRaw updater (which double-fires
  // in StrictMode).
  const prevTitleRef = useRef<string | null>(null);

  // Keep the onTrack callback in a ref so the SSE effect doesn't depend on it.
  const onTrackRef = useRef(onTrack);
  useEffect(() => { onTrackRef.current = onTrack; });

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
          | { type: 'track'; title: string; source?: TrackSource }
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

  function refresh() {
    setRefreshing(true);
    // Optimistic timestamp: ICY only re-broadcasts StreamTitle when the song
    // changes, so a refresh may not deliver a new event for minutes. Stamp
    // "I checked now" immediately, then clear the spinner after a short
    // window. If fresh metadata does arrive, both update naturally.
    setLastUpdate(nowHHMM());
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
        art={<div className="w-[200px] h-[200px] rounded-2xl bg-[var(--color-line)] flex items-center justify-center text-5xl text-[var(--color-ink-4)]">♪</div>}
        title="This station doesn't share song info"
        subtitle="Audio keeps playing — you just won't see track names."
        history={history}
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
        art={<StationCover name={station.name} favicon={station.favicon} size={200} />}
        title="No song info right now"
        subtitle="This station isn't sharing track names at the moment."
        history={history}
      />
    );
  }

  // Fingerprinting in progress (broadcast metadata had no title; asking Shazam)
  if (metaState === 'recognizing') {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        art={<StationCover name={station.name} favicon={station.favicon} size={200} dim />}
        title={<>Identifying song <span className="dots"><span /><span /><span /></span></>}
        subtitle="Fingerprinting the audio with Shazam…"
        titleClassName="text-[var(--color-ink-3)]"
        history={history}
      />
    );
  }

  // ③ Audio playing, no first track yet
  if (metaState === 'waiting' || currentRaw === null) {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        art={<StationCover name={station.name} favicon={station.favicon} size={200} dim />}
        title={<>Listening for song info <span className="dots"><span /><span /><span /></span></>}
        subtitle="Most stations announce the track within ~30 seconds"
        titleClassName="text-[var(--color-ink-3)]"
        history={history}
      />
    );
  }

  // ⑤ Between tracks (station ID)
  if (isNonTrack(currentRaw, station.name)) {
    return (
      <NowPlayingFrame
        stationName={station.name}
        headerExtras={headerExtras}
        art={<StationCover name={station.name} favicon={station.favicon} size={200} />}
        title={station.name}
        subtitle="Between tracks · DJ, news, or station ID"
        history={history}
      />
    );
  }

  // ① Audio playing, a real track is present
  const { artist, title } = splitArtistTitle(currentRaw);
  return (
    <NowPlayingFrame
      stationName={station.name}
      headerExtras={headerExtras}
      art={
        <StationCover
          name={station.name}
          favicon={station.favicon}
          size={220}
          className="shadow-[0_16px_48px_rgba(192,57,43,0.28)]"
        />
      }
      title={title}
      subtitle={artist}
      badge={
        currentSource === 'shazam' ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.8px] uppercase font-bold text-[var(--color-warm)] bg-[rgba(210,105,30,0.1)] rounded-full px-2.5 py-1">
            ✦ Identified by Shazam
          </span>
        ) : undefined
      }
      history={history}
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

function NowPlayingFrame({
  stationName, headerExtras, art, title, subtitle, badge, history, titleClassName = '',
}: {
  stationName: string;
  headerExtras?: React.ReactNode;
  art: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  history: HistoryEntry[];
  titleClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
          Now playing on {stationName}
        </div>
        {headerExtras}
      </div>
      <div className="flex gap-8 items-end flex-wrap">
        {art}
        {/* basis-80 + flex-wrap: the text block keeps its own line beside the
            art when there's room, and drops below it (full width) when the
            panel is too narrow — no horizontal overflow from the big title. */}
        <div className="flex-1 basis-80 min-w-0 pb-2">
          {badge && <div className="mb-2.5">{badge}</div>}
          <div className={`text-[clamp(28px,5vw,42px)] font-extrabold tracking-[-1.2px] leading-[1.05] break-words ${titleClassName}`}>{title}</div>
          {subtitle && <div className="text-[clamp(16px,2.5vw,22px)] text-[var(--color-ink-2)] font-medium mt-1.5 break-words">{subtitle}</div>}
        </div>
      </div>
      {history.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">▾ Session history</div>
          {history.map((h, i) => {
            const { artist, title } = splitArtistTitle(h.title);
            return (
              <div key={i} className="grid grid-cols-[64px_1fr] gap-4 py-3 border-b border-[var(--color-line)] items-baseline last:border-none">
                <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
                <div className="text-base text-[var(--color-ink-2)]">
                  {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
