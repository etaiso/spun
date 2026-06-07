'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useTracking } from '@/app/lib/tracking';
import { isNonTrack } from '@/app/lib/nonTrack';
import { loadSession, saveSession } from '@/app/lib/session';
import type { TrackSource } from '@/app/lib/nowPlayingTypes';
import { StationLogo } from './StationLogo';

type Props = {
  onSelect: (s: Station) => void;
  // The currently-playing station. It stays in the list (highlighted as
  // "Playing") instead of disappearing, but doesn't open its own SSE — the
  // NowPlaying panel already recognises it, so this avoids double-recognition.
  activeStationId: string | null;
  // Live now-playing title for the active station (from NowPlaying), shown on
  // its highlighted row.
  activeTrack: string | null;
};

// A monitor panel (lives in the main area beside the player) listing every
// station being tracked in the background. Hidden entirely when nothing is
// tracked.
export function TrackingPanel({ onSelect, activeStationId, activeTrack }: Props) {
  const { tracked, untrack } = useTracking();
  if (tracked.length === 0) return null;

  return (
    <div>
      <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)] mb-3 flex items-center gap-2">
        <span>📡 Tracking</span>
        <span className="text-[var(--color-ink-4)] font-bold">{tracked.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {tracked.map(s => {
          const active = s.id === activeStationId;
          return (
            <TrackedStationRow
              // Re-key on active so flipping it remounts the row, re-seeding
              // status from the (NowPlaying-refreshed) session cache with no
              // stale flash, and opening/closing the SSE accordingly.
              key={`${s.id}:${active}`}
              station={s}
              active={active}
              activeTrack={active ? activeTrack : null}
              onSelect={() => onSelect(s)}
              onUntrack={() => untrack(s.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'recognizing' }
  | { kind: 'track'; title: string }
  | { kind: 'idle' }; // no song info

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// One tracked station. When it's NOT the active station it opens its own
// /api/now-playing SSE (the server fingerprints / reads ICY metadata in the
// background, no audio playback needed). The active station opens no SSE and
// shows the live title passed down from NowPlaying.
function TrackedStationRow({
  station,
  active,
  activeTrack,
  onSelect,
  onUntrack,
}: {
  station: Station;
  active: boolean;
  activeTrack: string | null;
  onSelect: () => void;
  onUntrack: () => void;
}) {
  // Seed from the session cache so a station shows its last-known song
  // immediately instead of flashing "Connecting…" while it (re)recognises —
  // symmetric with how NowPlaying restores. The SSE below keeps it current.
  const [status, setStatus] = useState<Status>(() => {
    const s = loadSession(station.id);
    return s?.current && !isNonTrack(s.current.raw, station.name)
      ? { kind: 'track', title: s.current.raw }
      : { kind: 'connecting' };
  });

  useEffect(() => {
    // The active station is recognised by NowPlaying; don't open a second SSE.
    if (active) return;

    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: 'track'; title: string; source?: TrackSource; cover?: string }
          | { type: 'no-metadata' }
          | { type: 'no-song' }
          | { type: 'recognizing' }
          | { type: 'error' };
        if (msg.type === 'track') {
          if (isNonTrack(msg.title, station.name)) {
            setStatus({ kind: 'idle' });
          } else {
            setStatus({ kind: 'track', title: msg.title });
            // Seed the session cache so selecting this station shows the song
            // immediately (NowPlaying restores from the same store on mount).
            const prev = loadSession(station.id);
            saveSession(station.id, {
              current: { raw: msg.title, source: msg.source ?? 'metadata', cover: msg.cover ?? null },
              history: prev?.history ?? [],
              lastUpdate: nowHHMM(),
            });
          }
        } else if (msg.type === 'recognizing') {
          setStatus(prev => (prev.kind === 'track' ? prev : { kind: 'recognizing' }));
        } else if (msg.type === 'no-song' || msg.type === 'no-metadata') {
          setStatus(prev => (prev.kind === 'track' ? prev : { kind: 'idle' }));
        }
      } catch { /* ignore malformed frames */ }
    };
    return () => es.close();
  }, [active, station.streamUrl, station.name, station.id]);

  const subtitle = active
    ? (activeTrack || 'Playing now')
    : status.kind === 'track' ? status.title
    : status.kind === 'recognizing' ? 'Identifying…'
    : status.kind === 'connecting' ? 'Connecting…'
    : 'No song info';
  const showGreen = active || status.kind === 'track';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={[
        'group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-warm)]',
        active
          ? 'bg-[rgba(210,105,30,0.12)] ring-1 ring-[var(--color-warm)]'
          : 'hover:bg-[rgba(210,105,30,0.12)]',
      ].join(' ')}
    >
      <StationLogo name={station.name} favicon={station.favicon} />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold tracking-tight truncate flex items-center gap-2">
          <span className="truncate">{station.name}</span>
          {active && (
            <span className="shrink-0 text-[9px] uppercase tracking-[1px] font-bold text-[var(--color-warm)]">● Playing</span>
          )}
        </div>
        <div className="text-xs text-[var(--color-ink-3)] truncate flex items-center gap-1.5">
          <span
            className={[
              'inline-block w-1.5 h-1.5 rounded-full shrink-0',
              showGreen ? 'bg-green-500' : 'bg-[var(--color-warm)] animate-pulse',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className="truncate">{subtitle}</span>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onUntrack(); }}
        aria-label={`Stop tracking ${station.name}`}
        title="Stop tracking"
        className="shrink-0 w-7 h-7 flex items-center justify-center text-base leading-none rounded-full text-[var(--color-ink-4)] hover:text-[var(--color-accent)] hover:bg-[rgba(192,57,43,0.08)] cursor-pointer transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
