'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { persistSet } from './persist';

// "Rewind live radio" — default ON. Off reverts to the plain <audio> +
// /api/stream path: no tees, no disk rings, no rewind controls.
export const TIMESHIFT_KEY = 'radio:timeshift';

export function timeshiftEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(TIMESHIFT_KEY) !== 'false'; } catch { return true; }
}

const listeners = new Set<() => void>();
function emit() { for (const cb of listeners) cb(); }
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTimeshiftEnabled() {
  const enabled = useSyncExternalStore(subscribe, timeshiftEnabled, () => true);
  const toggle = useCallback(() => {
    persistSet(TIMESHIFT_KEY, timeshiftEnabled() ? 'false' : 'true');
    emit();
  }, []);
  return { enabled, toggle };
}
