'use client';

// Tiny event bus decoupling the timeshift engine (owned by Player) from the
// rest of the UI: PlaylistHistory requests jump-to-song seeks; the page and
// DebugPanel read the latest engine state.
import type { TimeshiftState } from './engine';

type SeekListener = (wallClockMs: number) => void;
const seekListeners = new Set<SeekListener>();

export function requestSeekToWallClock(ms: number): void {
  for (const cb of seekListeners) cb(ms);
}
export function subscribeSeekRequests(cb: SeekListener): () => void {
  seekListeners.add(cb);
  return () => seekListeners.delete(cb);
}

let lastState: TimeshiftState | null = null;
type StateListener = (s: TimeshiftState | null) => void;
const stateListeners = new Set<StateListener>();

export function publishTimeshiftState(s: TimeshiftState | null): void {
  lastState = s;
  for (const cb of stateListeners) cb(s);
}
export function getTimeshiftState(): TimeshiftState | null { return lastState; }
export function subscribeTimeshiftState(cb: StateListener): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}
