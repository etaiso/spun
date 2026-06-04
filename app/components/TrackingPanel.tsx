'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useTracking } from '@/app/lib/tracking';
import { isNonTrack } from '@/app/lib/nonTrack';
import { StationLogo } from './StationLogo';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  onSelect: (s: Station) => void;
  // The currently-playing station. It's shown in "Now Playing", so we hide it
  // from this panel while it plays — but keep it tracked, so it reappears (and
  // resumes background recognition) once you switch to another station.
  activeStationId: string | null;
};

// Sidebar section listing the stations being tracked in the background. Hidden
// when nothing (other than the currently-playing station) is being tracked.
export function TrackingPanel({ onSelect, activeStationId }: Props) {
  const { tracked, untrack } = useTracking();
  const shown = tracked.filter(s => s.id !== activeStationId);
  if (shown.length === 0) return null;

  return (
    <div className="mb-6">
      <CollapsibleSection title="📡 Tracking" count={shown.length}>
        {shown.map(s => (
          <TrackedStationRow
            key={s.id}
            station={s}
            onSelect={() => onSelect(s)}
            onUntrack={() => untrack(s.id)}
          />
        ))}
      </CollapsibleSection>
    </div>
  );
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'recognizing' }
  | { kind: 'track'; title: string }
  | { kind: 'idle' }; // no song info

// One tracked station. Opens its own /api/now-playing SSE for the lifetime of
// the row — the server fingerprints / reads ICY metadata in the background, no
// audio playback needed. Closing the EventSource on unmount (i.e. when the
// station is untracked) aborts the upstream connection server-side, so a
// removed station consumes nothing.
function TrackedStationRow({
  station,
  onSelect,
  onUntrack,
}: {
  station: Station;
  onSelect: () => void;
  onUntrack: () => void;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });

  useEffect(() => {
    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: 'track'; title: string }
          | { type: 'no-metadata' }
          | { type: 'no-song' }
          | { type: 'recognizing' }
          | { type: 'error' };
        if (msg.type === 'track') {
          setStatus(isNonTrack(msg.title, station.name) ? { kind: 'idle' } : { kind: 'track', title: msg.title });
        } else if (msg.type === 'recognizing') {
          setStatus(prev => (prev.kind === 'track' ? prev : { kind: 'recognizing' }));
        } else if (msg.type === 'no-song' || msg.type === 'no-metadata') {
          setStatus(prev => (prev.kind === 'track' ? prev : { kind: 'idle' }));
        }
      } catch { /* ignore malformed frames */ }
    };
    // EventSource auto-reconnects on error; nothing to do. Cleanup closes it,
    // which aborts the server-side stream (no lingering background work) — this
    // fires when the station is untracked OR becomes the currently-playing one
    // (filtered out of this panel), so it never double-recognizes.
    return () => es.close();
  }, [station.streamUrl, station.name]);

  const subtitle =
    status.kind === 'track' ? status.title
    : status.kind === 'recognizing' ? 'Identifying…'
    : status.kind === 'connecting' ? 'Connecting…'
    : 'No song info';
  const hasTrack = status.kind === 'track';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors mb-1 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-warm)] hover:bg-[rgba(210,105,30,0.12)]"
    >
      <StationLogo name={station.name} favicon={station.favicon} />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold tracking-tight truncate">{station.name}</div>
        <div className="text-xs text-[var(--color-ink-3)] truncate flex items-center gap-1.5">
          <span
            className={[
              'inline-block w-1.5 h-1.5 rounded-full shrink-0',
              hasTrack ? 'bg-green-500' : 'bg-[var(--color-warm)] animate-pulse',
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
