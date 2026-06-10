'use client';

import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LIVE_ENTER_SEC, type TimeshiftState } from '@/app/lib/timeshift/engine';
import { fmtBehind, fmtWallClock } from '@/app/lib/timeshift/format';

export type TimeshiftControlsProps = {
  state: TimeshiftState;
  onSeekBy: (deltaSec: number) => void;
  onGoLive: () => void;
  onSeekTo: (wallClockMs: number) => void;
  ticks: { atMs: number; title: string }[];
};

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
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  const { bufferStartMs, liveEdgeMs, playheadMs, atLiveEdge } = state;
  const span = (liveEdgeMs ?? 0) - (bufferStartMs ?? 0);
  const frac = useCallback((ms: number) =>
    span > 0 ? Math.min(1, Math.max(0, (ms - (bufferStartMs ?? 0)) / span)) : 1,
    [bufferStartMs, span]);
  // The playhead trails the advancing live edge by decode latency, which would
  // leave a permanent unfilled tail — at LIVE the bar is simply full.
  const fillFrac = atLiveEdge ? 1 : frac(playheadMs ?? liveEdgeMs ?? 0);

  const pointOnBar = (e: ReactPointerEvent): { x: number; ms: number } | null => {
    const el = barRef.current;
    if (!el || bufferStartMs === null || liveEdgeMs === null) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    return { x, ms: bufferStartMs + (x / r.width) * span };
  };

  const seekFromPointer = (e: ReactPointerEvent) => {
    const p = pointOnBar(e);
    if (p) onSeekTo(p.ms);
  };

  const onMove = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return; // hover tooltip is a mouse affordance
    setHover(pointOnBar(e));
  };

  // Clamp the tooltip inside the bar once its rendered width is known.
  useLayoutEffect(() => {
    const tip = tipRef.current, bar = barRef.current;
    if (!tip || !bar || hover === null) return;
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(hover.x, half), Math.max(half, bar.clientWidth - half));
    tip.style.left = `${x}px`;
  }, [hover]);

  // Show as soon as there's any buffer (even seconds) so the scrubber is present
  // from first load while it fills — frac() clamps to the live edge until then.
  if (bufferStartMs === null || liveEdgeMs === null) return null;
  const hoverBehindSec = hover ? Math.max(0, (liveEdgeMs - hover.ms) / 1000) : 0;
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Rewind position"
      aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(fillFrac * 100)}
      onPointerDown={seekFromPointer}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      className="relative w-full cursor-pointer group/tl"
      style={{ height: height + 8, paddingTop: 4, paddingBottom: 4 }}
    >
      {/* base track: the whole seekable buffer, always reads filled */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-brand-purple)]/20" style={{ height }}>
        {/* strong fill up to the playhead (100% at LIVE) */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-[var(--color-brand-purple)]/55"
          style={{ width: `${fillFrac * 100}%` }}
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
        {/* hover position line */}
        {hover && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-px h-[200%] bg-[var(--color-ink)]/50 pointer-events-none"
            style={{ left: hover.x }}
          />
        )}
        {/* playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--color-ink)] shadow opacity-0 group-hover/tl:opacity-100 transition-opacity"
          style={{ left: `calc(${fillFrac * 100}% - 5px)` }}
        />
      </div>
      {/* hover tooltip: broadcast wall-clock · behind-live */}
      {hover && (
        <div
          ref={tipRef}
          className="absolute bottom-full mb-1.5 -translate-x-1/2 px-2 py-1 rounded-md bg-[var(--color-ink)] text-[var(--color-bg)] text-[10px] font-semibold tabular-nums whitespace-nowrap pointer-events-none shadow-lg z-10"
          style={{ left: hover.x }}
        >
          {hoverBehindSec < LIVE_ENTER_SEC
            ? 'Live'
            : `${fmtWallClock(hover.ms)} · ${fmtBehind(hoverBehindSec)}`}
        </div>
      )}
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
