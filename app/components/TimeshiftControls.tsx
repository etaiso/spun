'use client';

import type { TimeshiftState } from '@/app/lib/timeshift/engine';

export type TimeshiftControlsProps = {
  state: TimeshiftState;
  onSeekBy: (deltaSec: number) => void;
  onGoLive: () => void;
  onSeekTo: (wallClockMs: number) => void;
  ticks: { atMs: number; title: string }[];
};

// Placeholder — Task 14 builds the real controls (variants reviewed live).
export function TimeshiftControls({ state, onSeekBy, onGoLive }: TimeshiftControlsProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-ink-3)]">
      <button onClick={() => onSeekBy(-30)} className="cursor-pointer">−30s</button>
      <button onClick={() => onSeekBy(30)} className="cursor-pointer">+30s</button>
      <button onClick={onGoLive} className="cursor-pointer">
        {state.behindSec < 3 ? 'LIVE' : `−${Math.round(state.behindSec)}s → LIVE`}
      </button>
    </div>
  );
}
