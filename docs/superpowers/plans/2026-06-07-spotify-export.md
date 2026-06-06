# Spotify Playlist Export — Implementation Plan

> **For agentic workers:** implement task-by-task. Front-loaded tasks (1–4) are
> pure/renderer logic and **fully unit-testable**. Tasks 5+ touch the Electron
> main process and the **live OAuth round-trip, which requires a real
> `SPOTIFY_CLIENT_ID` + a Spotify Premium login to verify end-to-end**.

**Goal:** Connect a Spotify account once and have saved songs auto-sync into a
private "Spun" playlist — exact ISRC match when available, confident text match
otherwise, unmatched flagged "not found". Backfill all existing saves on connect;
non-destructive on removal. Desktop-only; iTunes path untouched.

**Tech:** Electron main (plain JS) for auth/token/network via IPC; pure TS in the
renderer for matching/sync; React 19 + Tailwind v4 UI; Vitest. See the design spec
`docs/superpowers/specs/2026-06-07-spotify-export-design.md`.

**Decisions locked:** single private "Spun" playlist · auto-sync default on ·
backfill-all on connect (count shown first) · removals are non-destructive ·
no wrong best-guess (flag not_found).

---

## Task 1: Pure matching + confidence (`spotifyMatch.ts`)

**Files:** create `app/lib/integrations/spotifyMatch.ts`, `tests/spotifyMatch.test.ts`

- [ ] **Step 1 — failing tests.** Create `tests/spotifyMatch.test.ts` covering:
  `normalize` strips `(feat. …)` / `- Remastered 2011` / punctuation; `buildSearchQuery`
  emits `isrc:…` when isrc present else `track:"…" artist:"…"`; `scoreCandidate`
  returns `1` on ISRC equality and a high score for same title+artist; `pickBestMatch`
  returns the candidate `≥ THRESHOLD` and `null` below it.

- [ ] **Step 2 — implement.** Types + pure functions:

```ts
import { fuzzyScore } from '../rank';
import type { TrackQuery } from './types';

export type Candidate = {
  id: string; uri: string; url: string;
  name: string; artists: string[]; isrc?: string; durationMs?: number;
};

export const MATCH_THRESHOLD = 0.72;

export function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\(feat\.?[^)]*\)/g, ' ')
    .replace(/\bfeat\.?\b.*$/g, ' ')
    .replace(/-\s*(remaster(ed)?|live|mono|stereo|radio edit)[^-]*$/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchQuery(q: TrackQuery): string {
  if (q.isrc && q.isrc.trim()) return `isrc:${q.isrc.trim()}`;
  const t = q.title.replace(/"/g, ' ').trim();
  const a = q.artist.replace(/"/g, ' ').trim();
  return [t && `track:"${t}"`, a && `artist:"${a}"`].filter(Boolean).join(' ');
}

export function scoreCandidate(q: TrackQuery, c: Candidate): number {
  if (q.isrc && c.isrc && q.isrc.trim().toUpperCase() === c.isrc.trim().toUpperCase()) return 1;
  const title = fuzzyScore(normalize(q.title), normalize(c.name));
  const artist = c.artists.length
    ? Math.max(...c.artists.map(a => fuzzyScore(normalize(q.artist), normalize(a))))
    : 0;
  // fuzzyScore is unbounded-ish; clamp to 0..1 via a simple ratio against the query length.
  const norm = (raw: string, ref: string) => (ref ? Math.min(1, raw / Math.max(1, ref.length)) : 0);
  return 0.6 * norm(title, normalize(q.title)) + 0.4 * norm(artist, normalize(q.artist));
}

export function pickBestMatch(q: TrackQuery, candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null; let bestScore = 0;
  for (const c of candidates) {
    const s = scoreCandidate(q, c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}
```

> Note: confirm `fuzzyScore`'s range when implementing and adjust the clamp so the
> threshold behaves; the tests pin the intended behavior, tune the math to pass them.

- [ ] **Step 3 — green.** `npx vitest run tests/spotifyMatch.test.ts`
- [ ] **Step 4 — commit:** `feat(spotify): pure track matching + confidence scoring`

---

## Task 2: Typed bridge to Electron main (`spotifyBridge.ts`)

**Files:** create `app/lib/integrations/spotifyBridge.ts`

- [ ] **Step 1 — implement** a thin, typed wrapper over `window.spun.spotify` with an
  `isAvailable()` guard so the renderer/web build never crashes:

```ts
import type { Candidate } from './spotifyMatch';

export type SpotifyStatus = { connected: boolean; displayName?: string; playlistUrl?: string };

type Bridge = {
  getStatus(): Promise<SpotifyStatus>;
  connect(): Promise<{ ok: boolean; displayName?: string }>;
  disconnect(): Promise<void>;
  search(query: string): Promise<Candidate[]>;
  ensurePlaylist(): Promise<{ id: string; url: string }>;
  playlistTrackIds(): Promise<string[]>;
  addTracks(uris: string[]): Promise<void>;
};

function raw(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { spun?: { spotify?: Bridge } }).spun?.spotify ?? null;
}

export function isAvailable(): boolean { return raw() !== null; }

export const spotify: Bridge = {
  async getStatus() { return raw()?.getStatus() ?? { connected: false }; },
  async connect() { return raw()?.connect() ?? { ok: false }; },
  async disconnect() { await raw()?.disconnect(); },
  async search(q) { return raw()?.search(q) ?? []; },
  async ensurePlaylist() { const r = await raw()?.ensurePlaylist(); if (!r) throw new Error('Spotify unavailable'); return r; },
  async playlistTrackIds() { return raw()?.playlistTrackIds() ?? []; },
  async addTracks(uris) { await raw()?.addTracks(uris); },
};
```

- [ ] **Step 2 — verify:** `npx tsc --noEmit`
- [ ] **Step 3 — commit:** `feat(spotify): typed renderer↔main bridge with web no-op guard`

---

## Task 3: Sync orchestrator (`spotifySync.ts`) + tests

**Files:** create `app/lib/integrations/spotifySync.ts`, `tests/spotifySync.test.ts`

- [ ] **Step 1 — failing tests** against an injected fake bridge: `pendingSongs`
  selects only songs lacking `spotifyTrackId` and not `skipped` (and excludes
  `not_found` unless `includeNotFound`); `syncSongs` patches matched songs to
  `synced` + collects uris, patches unmatched to `not_found`, and calls
  `addTracks` only with uris **not** already in `playlistTrackIds()`.

- [ ] **Step 2 — implement** with dependency-injected bridge + a `patch` callback so
  it's pure-ish and testable (the React layer passes the real bridge + store `update`):

```ts
import { buildSearchQuery, pickBestMatch, type Candidate } from './spotifyMatch';
import type { SavedSong } from '../savedSongs';

export type SyncBridge = {
  search(q: string): Promise<Candidate[]>;
  ensurePlaylist(): Promise<{ id: string; url: string }>;
  playlistTrackIds(): Promise<string[]>;
  addTracks(uris: string[]): Promise<void>;
};

export function pendingSongs(list: SavedSong[], includeNotFound = false): SavedSong[] {
  return list.filter(s =>
    !s.spotifyTrackId &&
    s.syncState !== 'skipped' &&
    (includeNotFound || s.syncState !== 'not_found'));
}

export type Patch = (id: string, patch: Partial<SavedSong>) => void;

/** Resolve + append a set of songs. Returns counts. Throws only on connect/network death. */
export async function syncSongs(songs: SavedSong[], bridge: SyncBridge, patch: Patch) {
  let synced = 0, notFound = 0;
  const newlyMatched: { uri: string }[] = [];
  for (const s of songs) {
    const candidates = await bridge.search(buildSearchQuery(s));
    const match = pickBestMatch(s, candidates);
    if (match) {
      patch(s.id, { spotifyTrackId: match.id, spotifyUrl: match.url, syncState: 'synced' });
      newlyMatched.push({ uri: match.uri }); synced++;
    } else {
      patch(s.id, { syncState: 'not_found' }); notFound++;
    }
  }
  if (newlyMatched.length) {
    await bridge.ensurePlaylist();
    const existing = new Set(await bridge.playlistTrackIds());
    const uris = newlyMatched.map(m => m.uri).filter(u => !existing.has(u.split(':').pop()!));
    for (let i = 0; i < uris.length; i += 100) await bridge.addTracks(uris.slice(i, i + 100));
  }
  return { synced, notFound };
}
```

- [ ] **Step 3 — green:** `npx vitest run tests/spotifySync.test.ts`
- [ ] **Step 4 — commit:** `feat(spotify): sync orchestrator (resolve, dedupe, append) + tests`

---

## Task 4: Auto-sync preference (`spotifyPrefs.ts`)

**Files:** create `app/lib/spotifyPrefs.ts`

- [ ] **Step 1 — implement** a `useSpotifyAutoSync()` hook mirroring `useAutoUpdate`
  (`radio:spotifyAutoSync`, default `'1'`, via `persistGet`/`persistSet` +
  `useSyncExternalStore`).
- [ ] **Step 2 — commit:** `feat(spotify): auto-sync preference store`

---

## Task 5: Electron main — auth, token, API (`electron/spotify.js`)

**Files:** create `electron/spotify.js`; edit `electron/main.js`, `electron/preload.js`

> **Verification boundary:** this task's logic can only be smoke-tested with a real
> `SPOTIFY_CLIENT_ID` and a Premium login in the packaged/dev Electron app.

- [ ] **Step 1 — `electron/spotify.js`:**
  - `generatePkce()` — `code_verifier` (43–128 chars) + S256 `code_challenge` (Node `crypto`).
  - `connect()` — start `http.createServer` on `127.0.0.1:8888`; `shell.openExternal`
    the authorize URL (`client_id`, `response_type=code`, redirect
    `http://127.0.0.1:8888/callback`, scopes
    `playlist-modify-private playlist-read-private`, `code_challenge`, `state`);
    on `/callback` validate `state`, exchange `code` + `code_verifier` at
    `/api/token`, store tokens, fetch `/v1/me`, respond with a "you can close this
    tab" page, resolve `{ ok, displayName }`.
  - `tokenStore` — `safeStorage.encryptString(JSON)` → `userData/spotify-token.bin`;
    load/refresh (`grant_type=refresh_token`) when `expiresAt` near; `disconnect()`
    unlinks the file + clears the cached playlist.
  - `api(path, init)` — fetch with `Authorization: Bearer`, auto-refresh on 401,
    honor `429 Retry-After`.
  - `search`, `ensurePlaylist` (GET `/v1/me/playlists` find "Spun" else POST
    `/v1/users/{id}/playlists` `{ name:'Spun', public:false }`; cache id),
    `playlistTrackIds` (paged GET), `addTracks(uris)` (POST `/v1/playlists/{id}/tracks`).
  - `getStatus()` — `{ connected: hasToken, displayName, playlistUrl }` from cache.

- [ ] **Step 2 — `electron/main.js`:** read `SPOTIFY_CLIENT_ID` from env; register
  `ipcMain.handle('spun:spotify:<method>', …)` for each bridge method, delegating to
  `electron/spotify.js`. Skip registration (so the renderer guard hides the feature)
  when no client id is configured.

- [ ] **Step 3 — `electron/preload.js`:** extend `window.spun` with a `spotify`
  object exposing `getStatus/connect/disconnect/search/ensurePlaylist/playlistTrackIds/addTracks`
  via `ipcRenderer.invoke`.

- [ ] **Step 4 — verify:** `npx tsc --noEmit` (renderer types) + app boots
  (`npm run electron:dev`) without errors when no client id is set (feature hidden).
- [ ] **Step 5 — commit:** `feat(spotify): Electron main OAuth (PKCE), token store, Web API + IPC`

---

## Task 6: Settings → Integrations section

**Files:** edit `app/components/SettingsDialog.tsx`

- [ ] **Step 1** — add an Integrations section gated by `isAvailable()`. Disconnected:
  `Connect Spotify` (calls `spotify.connect()`, then refresh status) + "Requires
  Spotify Premium". Connected: account name, "Spun playlist ↗", live counts from the
  saved-songs store (synced/not-found/pending), Auto-sync toggle (`useSpotifyAutoSync`),
  **Sync now** (runs `syncSongs(pendingSongs(saved, true), …)`), **Disconnect**.
- [ ] **Step 2 — verify:** `npx tsc --noEmit && npm run lint`
- [ ] **Step 3 — commit:** `feat(spotify): Settings integration UI (connect/status/sync)`

---

## Task 7: SavedSongsDialog badges + auto-sync on save

**Files:** edit `app/components/SavedSongsDialog.tsx`; edit `app/components/NowPlaying.tsx` (or the store)

- [ ] **Step 1** — per-row status in the dialog: `synced` ⇒ "Spotify ↗"
  (`spotifyUrl`); `not_found` ⇒ "Not on Spotify · search"; footer summary +
  Connect nudge when `!isAvailable()`/disconnected.
- [ ] **Step 2** — fire auto-sync after a save when connected + auto-sync on
  (debounced; resolve just the new song via `syncSongs([song], …)`). Keep it in a
  small effect/hook so it also reconciles `pendingSongs(saved)` on app start.
- [ ] **Step 3 — verify:** `npx tsc --noEmit && npm run lint && npx vitest run`
- [ ] **Step 4 — commit:** `feat(spotify): per-song sync badges + auto-append on save`

---

## Task 8 (optional, recommended): Capture ISRC for exact matches

**Files:** edit `recognizer/main.py`, `app/api/now-playing/route.ts`, `app/components/NowPlaying.tsx`

- [ ] Return `track.isrc` from the recognizer; thread `isrc` on the SSE `track` event;
  pass it into `save({ … , isrc })`. `buildSavedSong` already passes `isrc` through.
- [ ] **Verify** the recognizer extractor offline (python `-c`) like the saved-songs plan; `npx tsc --noEmit`.
- [ ] **Commit:** `feat(spotify): capture ISRC from recognizer for exact matching`

---

## Task 9: Config + docs

**Files:** create/edit `.env.example`; edit `README.md`

- [ ] Document `SPOTIFY_CLIENT_ID`, the `http://127.0.0.1:8888/callback` redirect, and
  the **Premium + 5-user Development-Mode** caveat. README feature bullet.
- [ ] **Commit:** `docs(spotify): client_id setup + Premium/dev-mode caveats`

---

## Task 10: Verification

- [ ] **Unit:** `npx tsc --noEmit && npm run lint && npx vitest run` — all green
  (new `spotifyMatch` + `spotifySync` suites included).
- [ ] **Manual (needs `SPOTIFY_CLIENT_ID` + Premium login):** connect → browser auth →
  "Spun" playlist created private; backfill count shown then existing songs appear;
  save a new song → auto-appends; an obscure track → "not found" + search link;
  Disconnect → reconnect resumes; kill network mid-sync → items stay pending, retried.

---

## Self-review notes

- **Verification split:** Tasks 1–4 fully unit-tested; Task 5 (OAuth/main) and the
  connect/backfill flows need the owner's `client_id` + Premium — called out at the top.
- **Type consistency:** `Candidate` defined in Task 1, reused by bridge (2) + sync (3);
  `SpotifyStatus` in Task 2 consumed by Settings (6); `SavedSong.{spotifyTrackId,
  spotifyUrl,syncState,isrc}` already exist from the export phase.
- **No new Next.js route handler** — all Spotify I/O is Electron main + IPC, mirroring
  `autoUpdate`; renderer guards on `isAvailable()` so the web/dev build is unaffected.
- **Non-destructive:** no code path deletes from the Spotify playlist; removal in spun
  only mutates local state.
