'use client';

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { TimeshiftState } from '@/app/lib/timeshift/engine';

export type TimeshiftControlsProps = {
  state: TimeshiftState;
  onSeekBy: (deltaSec: number) => void;
  onGoLive: () => void;
  onSeekTo: (wallClockMs: number) => void;
  ticks: { atMs: number; title: string }[];
};

function fmtBehind(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `−${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Layout: a full-width scrubber on its own row above a centered
// [−30] [LIVE] [+30] cluster. The scrubber tints the played-behind portion,
// marks song boundaries (ticks) and real audio gaps (discontinuities), and
// seeks on click/drag.
const STEP_SEC = 30;

export function TimeshiftControls(props: TimeshiftControlsProps) {
  const { bufferStartMs, liveEdgeMs, playheadMs, atLiveEdge } = props.state;
  const head = playheadMs ?? liveEdgeMs;
  // −30 needs a full step of rewindable history behind the playhead; on first
  // load (or once rewound to the start) there isn't, so disable it rather than
  // letting it clamp to a no-op. +30 is meaningless at the live edge.
  const canRewind = head !== null && bufferStartMs !== null && head - bufferStartMs >= STEP_SEC * 1000;
  const canForward = !atLiveEdge;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <Timeline state={props.state} onSeekTo={props.onSeekTo} ticks={props.ticks} height={4} />
      <div className="flex items-center justify-center gap-3">
        <StepButton delta={-30} onSeekBy={props.onSeekBy} disabled={!canRewind} />
        <LivePill state={props.state} onGoLive={props.onGoLive} />
        <StepButton delta={30} onSeekBy={props.onSeekBy} disabled={!canForward} />
      </div>
    </div>
  );
}

function Timeline({ state, onSeekTo, ticks, height }: {
  state: TimeshiftState; onSeekTo: (ms: number) => void;
  ticks: TimeshiftControlsProps['ticks']; height: number;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const { bufferStartMs, liveEdgeMs, playheadMs } = state;
  const span = (liveEdgeMs ?? 0) - (bufferStartMs ?? 0);
  const frac = useCallback((ms: number) =>
    span > 0 ? Math.min(1, Math.max(0, (ms - (bufferStartMs ?? 0)) / span)) : 1,
    [bufferStartMs, span]);

  const seekFromPointer = (e: ReactPointerEvent) => {
    const el = barRef.current;
    if (!el || bufferStartMs === null || liveEdgeMs === null) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSeekTo(bufferStartMs + f * span);
  };

  // Show as soon as there's any buffer (even seconds) so the scrubber is present
  // from first load while it fills — frac() clamps to the live edge until then.
  if (bufferStartMs === null || liveEdgeMs === null) return null;
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Rewind position"
      aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(frac(playheadMs ?? liveEdgeMs) * 100)}
      onPointerDown={seekFromPointer}
      className="relative w-full cursor-pointer group/tl"
      style={{ height: height + 8, paddingTop: 4, paddingBottom: 4 }}
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-line)]" style={{ height }}>
        {/* buffered region = whole bar; played-behind portion tinted */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-[var(--color-brand-purple)]/40"
          style={{ width: `${frac(playheadMs ?? liveEdgeMs) * 100}%` }}
        />
        {/* discontinuity breaks */}
        {state.discontinuities.map(g => (
          <div key={g.fromMs}
            className="absolute top-0 h-full bg-[var(--color-bg)]"
            style={{ left: `${frac(g.fromMs) * 100}%`, width: `${Math.max(0.5, (frac(g.toMs) - frac(g.fromMs)) * 100)}%` }} />
        ))}
        {/* song ticks */}
        {ticks.filter(t => t.atMs >= bufferStartMs && t.atMs <= liveEdgeMs).map(t => (
          <button
            key={t.atMs}
            title={t.title}
            aria-label={`Jump to ${t.title}`}
            onPointerDown={(e) => { e.stopPropagation(); onSeekTo(t.atMs - 3000); }}
            className="absolute top-1/2 -translate-y-1/2 w-[3px] h-[150%] rounded bg-[var(--color-brand-pink)]/70 hover:bg-[var(--color-brand-pink)] cursor-pointer"
            style={{ left: `${frac(t.atMs) * 100}%` }}
          />
        ))}
        {/* playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--color-ink)] shadow opacity-0 group-hover/tl:opacity-100 transition-opacity"
          style={{ left: `calc(${frac(playheadMs ?? liveEdgeMs) * 100}% - 5px)` }}
        />
      </div>
    </div>
  );
}

function StepButton({ delta, onSeekBy, disabled }: { delta: number; onSeekBy: (d: number) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onSeekBy(delta)}
      disabled={disabled}
      aria-label={delta < 0 ? 'Back 30 seconds' : 'Forward 30 seconds'}
      title={delta < 0 ? 'Back 30s (J)' : 'Forward 30s (L)'}
      className={[
        'w-9 h-9 rounded-full border border-[var(--color-line)] text-[11px] font-bold transition-colors',
        disabled
          ? 'text-[var(--color-ink-4)] opacity-40 cursor-default'
          : 'text-[var(--color-ink-3)] hover:border-[var(--color-brand-pink)] hover:text-[var(--color-ink)] cursor-pointer',
      ].join(' ')}
    >
      {delta < 0 ? '−30' : '+30'}
    </button>
  );
}

function LivePill({ state, onGoLive }: { state: TimeshiftState; onGoLive: () => void }) {
  const atEdge = state.atLiveEdge;
  return (
    <button
      onClick={onGoLive}
      disabled={atEdge}
      aria-label={atEdge ? 'Live' : `Behind live by ${fmtBehind(state.behindSec)} — back to live`}
      title={atEdge ? 'Live' : 'Back to live (Shift+L)'}
      className={[
        'px-3 py-1.5 rounded-full text-[11px] tracking-[1px] uppercase font-bold transition-colors',
        atEdge
          ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] cursor-default'
          : 'border border-[var(--color-line)] text-[var(--color-ink-3)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] cursor-pointer',
      ].join(' ')}
    >
      {atEdge ? '● Live' : `${fmtBehind(state.behindSec)} · Live`}
    </button>
  );
}
