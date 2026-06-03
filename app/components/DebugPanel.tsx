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

export function DebugPanel({ station, playState, currentTrack }: Props) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<Health>(null);
  const [audio, setAudio] = useState({ state: 'none', energy: 0 });
  const { region } = useRegion();
  const { favorites } = useFavorites();
  const { recent } = useRecent();
  const [detected] = useState(() => userRegion() ?? '—');

  // Poll the recognizer health (only while the panel is open).
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  // Sample audio state/energy while open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setAudio({ state: getContextState(), energy: getEnergy() });
    }, 250);
    return () => clearInterval(id);
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Debug panel (dev only)"
        className="fixed bottom-16 left-4 z-50 w-9 h-9 rounded-full bg-[var(--color-ink)] text-white text-base flex items-center justify-center shadow-lg cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
      >
        🐞
      </button>
    );
  }

  return (
    <div className="fixed bottom-16 left-4 z-50 w-[300px] rounded-xl bg-white/95 backdrop-blur border border-[var(--color-line)] shadow-[0_12px_40px_rgba(0,0,0,0.25)] p-3 text-[12px] font-mono leading-relaxed">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold tracking-wide text-[var(--color-warm)]">🐞 DEBUG</span>
        <button onClick={() => setOpen(false)} aria-label="Close" className="cursor-pointer text-[var(--color-ink-3)] hover:text-[var(--color-ink)]">✕</button>
      </div>
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
