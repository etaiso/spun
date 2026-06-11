'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import type { PlayState } from './Player';
import { useRegion, userRegion } from '@/app/lib/region';
import { useFavorites } from '@/app/lib/favorites';
import { useRecent } from '@/app/lib/recent';
import { useGenreAffinity } from '@/app/lib/taste';
import { usePlayCounts } from '@/app/lib/playCounts';
import { getContextState, getEnergy } from '@/app/lib/audioBus';
import { getTimeshiftState } from '@/app/lib/timeshift/bus';
import { timeshiftEnabled } from '@/app/lib/timeshiftSetting';
import type { TimeshiftState } from '@/app/lib/timeshift/engine';

type Props = {
  station: Station | null;
  playState: PlayState;
  currentTrack: string | null;
  // When false (e.g. Settings dialog closed), we skip the polling intervals
  // so the panel doesn't cost anything while hidden.
  active: boolean;
};

type Health = { up: boolean; url: string; ms: number } | null;

type TsStats = {
  tees: { url: string; subscribers: number; bytesPerSec: number; contentType: string | null }[];
  rings: { stationId: string; segments: number; bytes: number; startMs: number | null }[];
} | null;

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

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
  const [ts, setTs] = useState<TimeshiftState | null>(null);
  const [tsStats, setTsStats] = useState<TsStats>(null);
  // Sampled clock for the "gap N ago" readout — Date.now() in render is impure.
  const [now, setNow] = useState(0);
  const { region } = useRegion();
  const { favorites } = useFavorites();
  const { recent } = useRecent();
  const { scores, top, bySource } = useGenreAffinity();
  const { counts } = usePlayCounts();

  const topGenres = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const playEntries = Object.entries(counts)
    .sort((a, b) => b[1].count - a[1].count);
  const sourceLabel = (src: Record<string, number>) => {
    const ks = Object.keys(src);
    return ks.length ? `${ks.length} genre${ks.length === 1 ? '' : 's'}` : '—';
  };
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

  // Sample engine state on the panel's fast cadence.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { setTs(getTimeshiftState()); setNow(Date.now()); }, 250);
    return () => clearInterval(id);
  }, [active]);

  // Server stats on the slow cadence.
  useEffect(() => {
    if (!active || !timeshiftEnabled()) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/timeshift-stats', { cache: 'no-store' });
        const d = (await r.json()) as TsStats;
        if (alive) setTsStats(d);
      } catch { if (alive) setTsStats(null); }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
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
            <span className="text-[var(--color-danger)] font-semibold">○ down</span>
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
              <span className="block h-full bg-[var(--color-brand-purple)]" style={{ width: `${Math.round(audio.energy * 100)}%` }} />
            </span>
            {audio.energy.toFixed(2)}
          </span>
        </Row>
        <Row label="Timeshift">
          {!timeshiftEnabled() ? 'off (setting)'
            : ts ? <span className="text-green-600 font-semibold">on · MSE · {ts.contentType || '?'}</span>
            : 'off (gate/fallback)'}
        </Row>
        {ts && (
          <>
            <Row label="Buffer">
              {ts.ramStartMs !== null && ts.liveEdgeMs !== null
                ? `${mmss(ts.liveEdgeMs - ts.ramStartMs)} / 60:00 · ${mb(ts.ramBytes)}`
                : '—'}
            </Row>
            <Row label="Playhead">
              {ts.behindSec < 3 ? 'live' : `−${mmss(ts.behindSec * 1000)} behind`}
              <span className="text-[var(--color-ink-4)]"> · tier {ts.lastSeekTier ?? '—'} · ahead {ts.sourceBufferAhead.toFixed(1)}s</span>
            </Row>
            <Row label="Live band">enter {ts.liveEnterSec.toFixed(1)}s</Row>
            <Row label="Gaps">
              {ts.discontinuities.length === 0 ? 'none'
                : `${ts.discontinuities.length} · last ${mmss(now - ts.discontinuities[ts.discontinuities.length - 1].toMs)} ago`}
            </Row>
          </>
        )}
        {tsStats && tsStats.tees.length > 0 && (
          <Row label="Tees">
            {tsStats.tees.map(t => `${t.subscribers} sub · ${(t.bytesPerSec / 1024).toFixed(0)} KB/s`).join(' | ')}
          </Row>
        )}
        {tsStats && tsStats.rings.length > 0 && (
          <Row label="Disk rings">
            {tsStats.rings.length}/5 · {mb(tsStats.rings.reduce((n, r) => n + r.bytes, 0))} ·{' '}
            {tsStats.rings.map(r => `${r.segments} segs`).join(', ')}
          </Row>
        )}
        <Row label="Favorites">{favorites.length}</Row>
        <Row label="Recent">{recent.length}</Row>
        <div className="mt-1 pt-1 border-t border-[var(--color-line)]" />
        <Row label="Top genres">
          {topGenres.length
            ? topGenres.map(([g, v]) => `${g} ${v.toFixed(2)}`).join(' · ')
            : '—'}
        </Row>
        <Row label="Sent genres">{top.join(',') || '—'}</Row>
        <Row label="By source">
          fav {sourceLabel(bySource.favorites)} · trk {sourceLabel(bySource.tracked)} · rec {sourceLabel(bySource.recent)} · play {sourceLabel(bySource.play)}
        </Row>
        <Row label="Play tally">
          {playEntries.length
            ? `${playEntries.length} stations · top ${playEntries.slice(0, 3).map(([, p]) => p.count).join('/')}`
            : '—'}
        </Row>
      </div>
    </div>
  );
}
