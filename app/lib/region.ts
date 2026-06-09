'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { persistSet } from './persist';
import { flagEmoji } from './flag';

/**
 * Best-guess ISO 3166 alpha-2 region for the current user, derived from their
 * browser locale(s) — e.g. "he-IL" → "IL". Used to rank stations from the
 * user's country higher in search. Returns null if no region can be inferred.
 */
export function userRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const locales = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const locale of locales) {
    if (!locale) continue;
    try {
      const region = new Intl.Locale(locale).region;
      if (region) return region.toUpperCase();
    } catch {
      // Fall back to parsing the subtag after "-" (e.g. "en-US" → "US").
      const part = locale.split('-')[1];
      if (part && part.length === 2) return part.toUpperCase();
    }
  }
  return null;
}

// ── Region preference store ──────────────────────────────────────────────
// The effective search region: a user override persisted in localStorage,
// falling back to the browser-detected region. Empty string = "Global".
const KEY = 'radio:region';
let cache: string | null = null;
const listeners = new Set<() => void>();

function read(): string {
  if (cache !== null) return cache;
  let v = '';
  if (typeof window !== 'undefined') {
    try { v = window.localStorage.getItem(KEY) ?? ''; } catch { /* ignore */ }
  }
  // No stored choice yet → seed from the detected locale region.
  if (!v) v = userRegion() ?? '';
  cache = v;
  return cache;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

export function useRegion(): { region: string; setRegion: (r: string) => void } {
  const region = useSyncExternalStore(subscribe, read, () => '');
  const setRegion = useCallback((r: string) => {
    cache = r;
    persistSet(KEY, r);
    for (const cb of listeners) cb();
  }, []);
  return { region, setRegion };
}

// ── IP-based region detection ──────────────────────────────────────────────
// The locale heuristic above keys off the *language* order, which often says
// "US" for an English UI even when the user is elsewhere. An IP lookup reflects
// physical location. It runs client-side on purpose: that geolocates the user's
// own public IP. (A server call would geolocate the server's IP — wrong in dev
// or in production depending on where it runs.)

// Has the user explicitly picked a region via the picker? That's the only thing
// written to localStorage, and it always wins over auto-detection.
function hasExplicitChoice(): boolean {
  if (typeof window === 'undefined') return false;
  try { return !!window.localStorage.getItem(KEY); } catch { return false; }
}

const IP_SESSION_KEY = 'radio:ipRegion';

/** Resolve the user's country (ISO 3166 alpha-2) from their IP, or null. */
export async function detectRegionByIP(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch('https://get.geojs.io/v1/ip/country.json', { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { country?: string };
    const code = (data?.country ?? '').toString().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

// Apply an auto-detected region: update the effective region in memory and
// notify subscribers, but DON'T persist — only explicit picker choices are
// stored. Never overrides a manual choice.
function applyAutoRegion(code: string): void {
  if (!code || hasExplicitChoice()) return;
  if (cache === code) return;
  cache = code;
  for (const cb of listeners) cb();
}

/**
 * One-shot IP region detection. Call once near the app root. No-op when the
 * user has already chosen a region. Caches the result in sessionStorage so we
 * don't re-hit the geo service on every reload within a session.
 */
export function useDetectRegionByIP(): void {
  useEffect(() => {
    if (hasExplicitChoice()) return;

    let cached: string | null = null;
    try { cached = window.sessionStorage.getItem(IP_SESSION_KEY); } catch { /* ignore */ }
    if (cached) { applyAutoRegion(cached); return; }

    const ctrl = new AbortController();
    detectRegionByIP(ctrl.signal).then(code => {
      if (!code) return;
      try { window.sessionStorage.setItem(IP_SESSION_KEY, code); } catch { /* ignore */ }
      applyAutoRegion(code);
    });
    return () => ctrl.abort();
  }, []);
}

// ── Region lock ──────────────────────────────────────────────────────────
// When enabled, every station list in the app (search, favorites, popular,
// recently played) is filtered down to the active region. A no-op when the
// region is "Global" (empty) — there's nothing to lock to.
const LOCK_KEY = 'radio:regionLock';
let lockCache: boolean | null = null;
const lockListeners = new Set<() => void>();

function readLock(): boolean {
  if (lockCache !== null) return lockCache;
  let v = false;
  if (typeof window !== 'undefined') {
    try { v = window.localStorage.getItem(LOCK_KEY) === '1'; } catch { /* ignore */ }
  }
  lockCache = v;
  return lockCache;
}

function subscribeLock(cb: () => void): () => void {
  lockListeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === LOCK_KEY) { lockCache = null; cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { lockListeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

export function useRegionLock(): { locked: boolean; setLocked: (v: boolean) => void } {
  const locked = useSyncExternalStore(subscribeLock, readLock, () => false);
  const setLocked = useCallback((v: boolean) => {
    lockCache = v;
    persistSet(LOCK_KEY, v ? '1' : '0');
    for (const cb of lockListeners) cb();
  }, []);
  return { locked, setLocked };
}

/**
 * Returns a filter that, when the region lock is active AND a region is set,
 * keeps only stations from that region. Otherwise it's the identity filter.
 * Use across every station list so the lock applies app-wide.
 */
export function useRegionFilter(): <T extends { countrycode: string }>(stations: T[]) => T[] {
  const region = useSyncExternalStore(subscribe, read, () => '');
  const locked = useSyncExternalStore(subscribeLock, readLock, () => false);
  return useCallback(
    <T extends { countrycode: string }>(stations: T[]) => {
      if (!locked || !region) return stations;
      return stations.filter(s => s.countrycode === region);
    },
    [locked, region],
  );
}

/**
 * The region that actually shapes discovery (search + Popular): the chosen
 * region only while "show only" is on, else empty (fully global). This keeps
 * region effects tied to the visible toggle — there's no hidden prioritization
 * when it's off. (The stored home region still drives Explore's "your country
 * first" pinning and the picker default; that's `useRegion`.)
 */
export function useActiveRegion(): string {
  const region = useSyncExternalStore(subscribe, read, () => '');
  const locked = useSyncExternalStore(subscribeLock, readLock, () => false);
  return locked ? region : '';
}

// ── Country picker options ─────────────────────────────────────────────────
export type CountryOption = { value: string; label: string };

/**
 * Build the settings picker's country options from the live country list,
 * always including `region` (even if it's not in the list) so the user's own
 * country is always selectable. Each label is "<flag> <name>"; sorted by name.
 */
export function buildCountryOptions(
  countries: { code: string; name: string }[],
  region: string,
): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { names = null; }

  const byCode = new Map<string, string>();
  for (const c of countries) {
    if (c.code) byCode.set(c.code, c.name);
  }
  if (region && !byCode.has(region)) {
    byCode.set(region, names?.of(region) ?? region);
  }

  return Array.from(byCode, ([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ code, name }) => ({ value: code, label: `${flagEmoji(code)} ${name}` }));
}
