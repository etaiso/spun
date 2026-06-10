'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LIVE_ENTER_SEC, type TimeshiftState } from '@/app/lib/timeshift/engine';
import { IDLE, displayMs, scrubCancel, scrubMove, scrubRelease, scrubSettle, scrubStart, type ScrubState } from '@/app/lib/timeshift/scrub';
import { fmtBehind, fmtWallClock } from '@/app/lib/timeshift/format';

export type TimeshiftControlsProps = {
  state: TimeshiftState;
  onGoLive: () => void;
  onSeekTo: (wallClockMs: number) => void;
  ticks: { atMs: number; title: string }[];
};

// Layout (YouTube-live style): a full-width scrubber with, below it, a LIVE
// toggle pinned left and the behind-live readout pinned right. Seeking is done
// on the timeline itself (click/drag, or J/L on the keyboard) — there are no
// step buttons. The LIVE toggle's content never changes (state is expressed by
// color only) and each end of the row is independent, so nothing shifts when
// the offset appears, grows to hours, or vanishes.
export function TimeshiftControls(props: TimeshiftControlsProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <Timeline state={props.state} onSeekTo={props.onSeekTo} ticks={props.ticks} height={4} />
      <div className="flex items-center">
        <LiveButton state={props.state} onGoLive={props.onGoLive} />
        <div className="flex-1" />
        <BehindReadout state={props.state} />
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
  // Scrub state lives in BOTH a ref and useState: pointer events stream
  // faster than renders, and pointerup must commit the exact position of the
  // last pointermove — a useState read from the event closure can be one
  // move stale. The ref is authoritative; the state mirror drives rendering.
  const [scrub, setScrubState] = useState<ScrubState>(IDLE);
  const scrubRef = useRef<ScrubState>(scrub);
  const setScrub = useCallback((next: ScrubState) => {
    if (next === scrubRef.current) return; // scrubSettle returns same ref on no-op
    scrubRef.current = next;
    setScrubState(next);
  }, []);

  const { bufferStartMs, liveEdgeMs, playheadMs, atLiveEdge } = state;
  const span = (liveEdgeMs ?? 0) - (bufferStartMs ?? 0);
  const frac = useCallback((ms: number) =>
    span > 0 ? Math.min(1, Math.max(0, (ms - (bufferStartMs ?? 0)) / span)) : 1,
    [bufferStartMs, span]);

  // Release the post-seek display hold once the engine playhead catches up.
  useEffect(() => {
    setScrub(scrubSettle(scrubRef.current, playheadMs, Date.now()));
  }, [playheadMs, setScrub]);

  const dispMs = displayMs(scrub);
  // The playhead trails the advancing live edge by decode latency, which would
  // leave a permanent unfilled tail — at LIVE the bar is simply full.
  const fillFrac = dispMs !== null
    ? frac(dispMs)
    : atLiveEdge ? 1 : frac(playheadMs ?? liveEdgeMs ?? 0);

  const pointOnBar = (e: ReactPointerEvent): { x: number; ms: number } | null => {
    const el = barRef.current;
    if (!el || bufferStartMs === null || liveEdgeMs === null) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;
    const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
    return { x, ms: bufferStartMs + (x / r.width) * span };
  };

  const onDown = (e: ReactPointerEvent) => {
    const p = pointOnBar(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(scrubStart(p.ms));
    setHover(p); // tooltip follows the drag for every pointer type
  };

  const onMove = (e: ReactPointerEvent) => {
    const p = pointOnBar(e);
    if (!p) return;
    if (scrubRef.current.phase === 'dragging') {
      setScrub(scrubMove(scrubRef.current, p.ms));
      setHover(p);
    } else if (e.pointerType === 'mouse') {
      setHover(p); // hover preview is a mouse affordance
    }
  };

  const onUp = (e: ReactPointerEvent) => {
    const { next, commitMs } = scrubRelease(scrubRef.current, Date.now());
    setScrub(next);
    if (commitMs !== null) onSeekTo(commitMs);
    if (e.pointerType !== 'mouse') setHover(null);
  };

  const onCancel = () => {
    setScrub(scrubCancel());
    setHover(null);
  };

  const onLeave = () => {
    // Pointer capture still delivers boundary events — keep the tooltip alive
    // mid-drag when the pointer strays off the bar.
    if (scrubRef.current.phase !== 'dragging') setHover(null);
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
  const dispBehindSec = Math.max(0, (liveEdgeMs - (dispMs ?? playheadMs ?? liveEdgeMs)) / 1000);
  const shownLive = dispMs === null ? atLiveEdge : dispBehindSec < LIVE_ENTER_SEC;
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Rewind position"
      aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(fillFrac * 100)}
      aria-valuetext={shownLive ? 'Live' : `${fmtBehind(dispBehindSec)} behind live`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onPointerLeave={onLeave}
      className="relative w-full cursor-pointer group/tl"
      style={{ height: height + 8, paddingTop: 4, paddingBottom: 4 }}
    >
      {/* base track: the whole seekable buffer, always reads filled */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-brand-purple)]/20" style={{ height }}>
        {/* strong fill up to the displayed position (100% at LIVE) */}
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

function LiveButton({ state, onGoLive }: { state: TimeshiftState; onGoLive: () => void }) {
  const atEdge = state.atLiveEdge;
  // Fixed content in every state — at/behind live is expressed by color only,
  // so the button never changes size. The `border-transparent` keeps the
  // at-edge box identical to the behind box.
  return (
    <button
      onClick={onGoLive}
      disabled={atEdge}
      aria-label={atEdge ? 'Live' : `Behind live by ${fmtBehind(state.behindSec)} — back to live`}
      title={atEdge ? 'Live' : 'Back to live (Shift+L)'}
      className={[
        'h-9 px-3 inline-flex items-center gap-1.5 rounded-full border text-[11px] tracking-[1px] uppercase font-bold transition-colors',
        atEdge
          ? 'border-transparent bg-[var(--color-brand-purple)]/10 text-[var(--color-brand-purple)] cursor-default'
          : 'border-[var(--color-line)] text-[var(--color-ink-3)] hover:border-[var(--color-brand-purple)] hover:text-[var(--color-brand-purple)] cursor-pointer',
      ].join(' ')}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${atEdge ? 'pulse-soft' : ''}`} />
      Live
    </button>
  );
}

// The behind-live offset, at the far end of the row so its appearance, growth
// (to hours) or disappearance can never move the LIVE toggle. Fades rather
// than unmounts; hidden from the a11y tree since the LIVE button announces it.
function BehindReadout({ state }: { state: TimeshiftState }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'text-[13px] font-semibold tabular-nums text-[var(--color-ink-3)] whitespace-nowrap pointer-events-none transition-opacity duration-300',
        state.atLiveEdge ? 'opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      {fmtBehind(state.behindSec)}
    </span>
  );
}
