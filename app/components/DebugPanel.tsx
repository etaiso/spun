'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import type { PlayState } from './Player';
import { useRegion, userRegion } from '@/app/lib/region';
import { useFavorites } from '@/app/lib/favorites';
import { useRecent } from '@/app/lib/recent';
import { getContextState, getEnergy } from '@/app/lib/audioBus';

type Props = {
  station: Station | null;
  playState: PlayState;
  currentTrack: string | null;
  // When false (e.g. Settings dialog closed), we skip the polling intervals
  // so the panel doesn't cost anything while hidden.
  active: boolean;
};

type Health = { up: boolean; url: string; ms: number } | null;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 shrink-0 text-[var(--color-ink-4)]">{label}</span>
      <span className="flex-1 min-w-0 break-words text-[var(--color-ink)]">{children}</span>
    </div>
  );
}

export function DebugPanel({ station, playState, currentTrack, active }: Props) {
  const [health, setHealth] = useState<Health>(null);
  const [audio, setAudio] = useState({ state: 'none', energy: 0 });
  const { region } = useRegion();
  const { favorites } = useFavorites();
  const { recent } = useRecent();
  const [detected] = useState(() => userRegion() ?? '—');

  // Poll the recognizer health while the panel is visible.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch('/api/recognizer-health', { cache: 'no-store' });
        const d = (await r.json()) as Health;
        if (alive) setHealth(d);
      } catch {
        if (alive) setHealth({ up: false, url: '?', ms: 0 });
      }
    };
    ping();
    const id = setInterval(ping, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [active]);

  // Sample audio state/energy while visible.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setAudio({ state: getContextState(), energy: getEnergy() });
    }, 250);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="rounded-xl bg-[var(--color-bg)] border border-[var(--color-line)] p-3 text-[12px] font-mono leading-relaxed">
      <div className="flex flex-col gap-1">
        <Row label="Recognizer">
          {health == null ? (
            <span className="text-[var(--color-ink-4)]">checking…</span>
          ) : health.up ? (
            <span className="text-green-600 font-semibold">● up</span>
          ) : (
            <span className="text-[var(--color-accent)] font-semibold">○ down</span>
          )}
          {health && <span className="text-[var(--color-ink-4)]"> ({health.ms}ms)</span>}
        </Row>
        <Row label="Region">
          {region || 'global'} <span className="text-[var(--color-ink-4)]">· detected {detected}</span>
        </Row>
        <Row label="Play state">{playState}</Row>
        <Row label="Station">
          {station ? `${station.name} [${station.countrycode || '—'}]` : '—'}
        </Row>
        {station && (
          <Row label="Stream">{station.codec || '?'} · {station.bitrate || '?'}kbps</Row>
        )}
        <Row label="Now playing">{currentTrack ?? '—'}</Row>
        <Row label="Audio ctx">{audio.state}</Row>
        <Row label="Energy">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-1.5 w-24 rounded-full bg-[var(--color-line)] overflow-hidden align-middle">
              <span className="block h-full bg-[var(--color-warm)]" style={{ width: `${Math.round(audio.energy * 100)}%` }} />
            </span>
            {audio.energy.toFixed(2)}
          </span>
        </Row>
        <Row label="Favorites">{favorites.length}</Row>
        <Row label="Recent">{recent.length}</Row>
      </div>
    </div>
  );
}
