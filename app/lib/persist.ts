'use client';

// Client persistence: localStorage stays a synchronous cache, but writes are
// mirrored (debounced) to the SQLite-backed /api/state so data survives a
// browser-data clear. On boot, hydrateFromServer() pulls the server state into
// localStorage (server wins) and imports any local-only keys (first-run).

const API = '/api/state';

const pending = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function persistGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/** Write-through: update the local cache immediately, queue a debounced server upsert. */
export function persistSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, value); } catch { /* best-effort cache */ }
  pending.set(key, value);
  if (!flushTimer) flushTimer = setTimeout(flush, 400);
}

async function flush(): Promise<void> {
  flushTimer = null;
  const entries = [...pending.entries()];
  pending.clear();
  for (const [key, value] of entries) {
    try {
      await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
    } catch {
      pending.set(key, value); // offline / down — retry next flush
    }
  }
  if (pending.size && !flushTimer) flushTimer = setTimeout(flush, 1000);
}

/** Pure: radio:* keys present locally but absent on the server (first-run import set). */
export function localOnlyKeys(serverKeys: string[], localKeys: string[]): string[] {
  const onServer = new Set(serverKeys);
  return localKeys.filter(k => k.startsWith('radio:') && !onServer.has(k));
}

/** radio:* caches that live only in localStorage and must never be synced to
 *  the server (ephemeral now-playing cache + durable-but-local tracking history). */
export function isEphemeralKey(key: string): boolean {
  return key === 'radio:sessions' || key === 'radio:trackingHistory';
}

let hydrated = false;

/** Pull the server DB into localStorage (server wins) + import local-only keys. Runs once. */
export async function hydrateFromServer(): Promise<void> {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;

  let server: Record<string, string> = {};
  try {
    const res = await fetch(API);
    if (res.ok) server = await res.json();
    else return;
  } catch {
    return; // offline: keep the existing localStorage cache as-is
  }

  // Server wins: overwrite local cache + notify stores (they listen for 'storage').
  for (const [key, value] of Object.entries(server)) {
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  }

  // First-run import: push local-only data up so it isn't lost (skip ephemeral cache).
  const local: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k) local.push(k);
  }
  for (const key of localOnlyKeys(Object.keys(server), local)) {
    if (isEphemeralKey(key)) continue; // localStorage-only caches, not synced
    const raw = window.localStorage.getItem(key);
    if (raw != null) persistSet(key, raw);
  }
}
