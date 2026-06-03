'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { gradientForName } from '@/app/lib/colors';
import { isNonTrack } from '@/app/lib/nonTrack';
import type { PlayState } from './Player';

type MetaState = 'waiting' | 'playing' | 'no-metadata';

type HistoryEntry = { time: string; title: string };

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function splitArtistTitle(raw: string): { artist: string; title: string } {
  const sep = raw.includes(' — ') ? ' — ' : raw.includes(' - ') ? ' - ' : null;
  if (!sep) return { artist: '', title: raw };
  const [artist, ...rest] = raw.split(sep);
  return { artist: artist.trim(), title: rest.join(sep).trim() };
}

type Props = {
  station: Station;
  playState: PlayState;
};

export function NowPlaying({ station, playState }: Props) {
  const [metaState, setMetaState] = useState<MetaState>('waiting');
  const [currentRaw, setCurrentRaw] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Track previous title via a ref so we can avoid the React anti-pattern of
  // calling setHistory from inside a setCurrentRaw updater (which double-fires
  // in StrictMode).
  const prevTitleRef = useRef<string | null>(null);

  useEffect(() => {
    setMetaState('waiting');
    setCurrentRaw(null);
    setHistory([]);
    prevTitleRef.current = null;

    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: 'track'; title: string }
          | { type: 'no-metadata' }
          | { type: 'error'; message: string };

        if (msg.type === 'no-metadata') {
          setMetaState('no-metadata');
        } else if (msg.type === 'track') {
          setMetaState('playing');
          const prev = prevTitleRef.current;
          if (prev === msg.title) return;
          if (prev !== null && !isNonTrack(prev, station.name)) {
            setHistory(h => [{ time: nowHHMM(), title: prev }, ...h].slice(0, 50));
          }
          prevTitleRef.current = msg.title;
          setCurrentRaw(msg.title);
        }
        // error events: ignore. EventSource auto-reconnects; do not disrupt listening.
      } catch {}
    };

    return () => es.close();
  }, [station.id, station.streamUrl, station.name]);

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

  // ② Audio still connecting
  if (playState === 'connecting') {
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

  // ④ Station has no metadata
  if (metaState === 'no-metadata') {
    return (
      <NowPlayingFrame
        stationName={station.name}
        art={<div className="w-[200px] h-[200px] rounded-2xl bg-[var(--color-line)] flex items-center justify-center text-5xl text-[var(--color-ink-4)]">♪</div>}
        title="This station doesn't share song info"
        subtitle="Audio keeps playing — you just won't see track names."
        history={history}
      />
    );
  }

  // ③ Audio playing, no first track yet
  if (metaState === 'waiting' || currentRaw === null) {
    return (
      <NowPlayingFrame
        stationName={station.name}
        art={<div className="w-[200px] h-[200px] rounded-2xl opacity-50" style={{ background: gradientForName(station.name) }} />}
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
        art={<div className="w-[200px] h-[200px] rounded-2xl bg-gradient-to-br from-[#8a7a6e] to-[#4a3f37] flex items-center justify-center text-4xl">🎙️</div>}
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
      art={<div className="w-[220px] h-[220px] rounded-2xl shadow-[0_16px_48px_rgba(192,57,43,0.28)]" style={{ background: gradientForName(station.name) }} />}
      title={title}
      subtitle={artist}
      history={history}
    />
  );
}

function NowPlayingFrame({
  stationName, art, title, subtitle, history, titleClassName = '',
}: {
  stationName: string;
  art: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  history: HistoryEntry[];
  titleClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
        Now playing on {stationName}
      </div>
      <div className="flex gap-8 items-end">
        {art}
        <div className="flex-1 pb-2">
          <div className={`text-[42px] font-extrabold tracking-[-1.2px] leading-[1.05] ${titleClassName}`}>{title}</div>
          {subtitle && <div className="text-[22px] text-[var(--color-ink-2)] font-medium mt-1.5">{subtitle}</div>}
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
