# Spotify Playlist Export — Design

Optionally mirror saved songs into a **private "Spun" playlist** on the user's
Spotify account, automatically. This builds on the portable CSV/M3U8 export
already shipped: that works for everyone with no account; this adds *live,
automatic* sync for users who connect Spotify. **Desktop (Electron) only.**

## Goals

- Connect a Spotify account once; saved songs then appear in a private **"Spun"**
  playlist.
- **Auto-append** newly saved songs; **backfill the entire existing library** on
  first connect (with a count shown first).
- **Accurate matching** — exact via ISRC when available, else a confident text
  match. **Never insert a wrong track**: below the confidence threshold a song is
  flagged **"not found"** with a one-tap "search on Spotify".
- Keep credentials safe: **PKCE** (no client secret embedded); refresh token
  encrypted with Electron `safeStorage`.
- **No regression** for users who don't connect; the **iTunes** metadata path
  (cover art, previews, links) is untouched.

## Non-goals

- Replacing iTunes for covers/previews/links — Spotify can't (token-gated; it
  removed `preview_url` in Nov 2024). Decided earlier.
- **Removing** tracks from Spotify when a song is removed in spun — **non-destructive**
  by decision (spun never deletes from the user's playlist).
- Multiple playlists, reordering, or curation beyond append.
- Public distribution with a shared client_id. Spotify's Feb-2026 rules gate the
  Web API behind **owner Premium** and cap Development Mode at **5 users**, with no
  realistic path to Extended Quota for a hobby app. This is a **personal /
  power-user** feature.
- Apple Music / YouTube Music — future, via the same `PlaylistProvider` seam.

## Prerequisites / constraints

- App **owner must have Spotify Premium** (Feb-2026 Web API requirement).
- A Spotify app **`client_id`** (PKCE, **no secret**). Redirect URI
  `http://127.0.0.1:8888/callback`. Supplied via env (`SPOTIFY_CLIENT_ID`); the
  feature stays hidden until one is configured.
- **Electron only.** On the web/dev build `window.spun.spotify` is absent → the
  whole feature is hidden and every call is a graceful no-op (mirrors
  `autoUpdate`).
- Spotify endpoints used: `GET /v1/me`, `GET /v1/search`,
  `POST /v1/users/{id}/playlists`, `GET /v1/me/playlists`,
  `POST /v1/playlists/{id}/tracks` *(a.k.a. `/items` post-rename — we send
  `uris`)*, with `accounts.spotify.com/authorize` + `/api/token` for OAuth.

## Architecture

All Spotify **auth, token, and network** logic lives in the Electron **main
process** (`electron/spotify.js`), exposed to the renderer via IPC
(`window.spun.spotify.*`). Rationale:

- The refresh token must be encrypted with **`safeStorage`** — a main-process API.
- The Next.js server runs as a **separate spawned Node process** and cannot use
  `safeStorage`.
- Main can **open the system browser** (`shell.openExternal`) and run the
  **loopback redirect listener**.

**No new Next.js route handlers.** The renderer calls main exactly like the
existing auto-update feature. The **decision logic** (query building, candidate
scoring/confidence, sync planning) is pure TS under `app/lib/integrations/`,
runs in the renderer, and is unit-tested.

### Token storage

Main encrypts `{ refreshToken, accessToken, expiresAt }` with
`safeStorage.encryptString` and writes it to `spotify-token.bin` in
`app.getPath('userData')`. Main also caches the resolved `playlistId`/`playlistUrl`
there. `disconnect()` deletes the file.

### IPC surface — `window.spun.spotify`

| Method | Returns | Notes |
|---|---|---|
| `getStatus()` | `{ connected, displayName?, playlistUrl? }` | cheap; no network unless refreshing |
| `connect()` | `{ ok, displayName }` | opens browser, awaits loopback, exchanges code, stores token, fetches `/me` |
| `disconnect()` | `void` | delete token + playlist cache |
| `search(query)` | `Candidate[]` | `{ id, uri, url, name, artists, isrc?, durationMs }`; main refreshes token as needed |
| `ensurePlaylist()` | `{ id, url }` | find-or-create **private** "Spun"; cache id |
| `playlistTrackIds()` | `string[]` | existing track ids in the playlist (dedupe backfill) |
| `addTracks(uris)` | `void` | POST in batches of 100 |

`search`/`addTracks`/etc. throw on hard failure (offline, revoked); the renderer
orchestrator catches and leaves items pending.

### Renderer orchestration — `app/lib/integrations/spotifySync.ts`

- Computes the **pending set**: saved songs with no `spotifyTrackId` and
  `syncState` not `skipped`. (`not_found` is retried only on **manual** "Sync now",
  not on every auto-save.)
- For each pending song: `bridge.search(buildSearchQuery(song))` →
  `pickBestMatch(song, candidates)` → matched ⇒ patch
  `{ spotifyTrackId, spotifyUrl, syncState:'synced' }` and collect its `uri`;
  no match ⇒ patch `{ syncState:'not_found' }`.
- `ensurePlaylist()` once; `addTracks(uris)` for songs **newly matched this run**,
  minus any already in `playlistTrackIds()` (covers a pre-existing playlist).
- Processed sequentially with light throttling; respects `429 Retry-After` (main).
- **Triggers:** (a) auto-save when connected + auto-sync on (debounced single/batch);
  (b) on **connect** → backfill all (count shown first); (c) **"Sync now"** (incl.
  retrying `not_found`); (d) app start → reconcile pending.

### Matching & confidence — `app/lib/integrations/spotifyMatch.ts` (pure)

- `normalize(s)` — lowercase, strip `(feat. …)`, `- Remastered…`, punctuation,
  collapse whitespace.
- `buildSearchQuery(song)` — ISRC present ⇒ `isrc:{isrc}`; else
  `track:"{title}" artist:"{artist}"`.
- `scoreCandidate(song, c)` — ISRC equal ⇒ `1.0`; else normalized title+artist
  similarity (reuse `fuzzyScore`), small bonus for close `durationMs`.
- `pickBestMatch(song, candidates)` — highest score; accept if `≥ THRESHOLD`
  (≈ `0.72`) ⇒ match, else `null` ⇒ not found.

### Data model

Reuses the optional `SavedSong` fields added in the export phase: `isrc`,
`spotifyTrackId`, `spotifyUrl`, `syncState`. New persisted pref
`radio:spotifyAutoSync` (`'1'`/`'0'`, default `'1'`) via the usual `persist` store.
Playlist id/url are owned/cached by main and read via `getStatus()`.

**Optional ISRC capture (recommended):** extend the recognizer to return
`track.isrc` and thread it through the SSE → save, so Shazam-identified songs get
**exact** Spotify matches. Independent task; matching degrades gracefully to text
search without it.

## UI

### Settings → new "Integrations" section (`SettingsDialog`)

- **Disconnected:** `Connect Spotify` button + one-liner + "Requires Spotify
  Premium" note.
- **Connected:** account name · **"Spun playlist ↗"** link · counts
  *(N synced · M not found · K pending)* · **Auto-sync** toggle · **Sync now** ·
  **Disconnect**.
- **Web build:** section hidden (no `window.spun.spotify`).

### SavedSongsDialog

- Per-row status: **synced** ⇒ small "Spotify ↗" link (`spotifyUrl`);
  **not found** ⇒ "Not on Spotify · search" (opens Spotify search); **pending** ⇒
  subtle dot. Existing CSV/M3U8 export stays.
- Footer summary: *"Spotify: N synced · M not found"* + a Connect nudge when
  disconnected.

## Edge cases

- **Not connected / web build** → all no-ops; UI hidden.
- **Token expired** → main refreshes; refresh fails (revoked / Premium lapsed) →
  status `connected:false`, UI offers reconnect.
- **Offline** → ops throw; items stay pending; retried on next save / Sync now /
  launch.
- **Rate limit (429)** → main honors `Retry-After`.
- **No confident match** → `not_found`; auto-save doesn't retry, manual Sync now does.
- **Dedup** → never add a `uri` whose track id is already in the playlist
  (`playlistTrackIds()` checked once per run) or already on the song.
- **Remove in spun** → no Spotify change (non-destructive).
- **Backfill volume** → show count before; adds batched 100/req; searches throttled.
- **Playlist deleted on Spotify** → cached id 404s → `ensurePlaylist()` recreates.

## Files

**Electron / IPC**
- `electron/spotify.js` *(new)* — PKCE, loopback listener, `safeStorage` token
  store, refresh, and the Spotify API calls.
- `electron/main.js` *(edit)* — register `spun:spotify:*` handlers; init.
- `electron/preload.js` *(edit)* — expose `window.spun.spotify`.

**Renderer logic**
- `app/lib/integrations/spotifyMatch.ts` *(new, pure)* — normalize / query / score / pick.
- `app/lib/integrations/spotifySync.ts` *(new)* — pending计算, run, patch store, triggers.
- `app/lib/integrations/spotifyBridge.ts` *(new)* — typed `window.spun.spotify` wrapper + `isAvailable()` guard (no-op on web).
- `app/lib/spotifyPrefs.ts` *(new)* — `useSpotifyAutoSync()` (persist).

**UI**
- `app/components/SettingsDialog.tsx` *(edit)* — Integrations section.
- `app/components/SavedSongsDialog.tsx` *(edit)* — per-row badges + footer.
- `app/components/NowPlaying.tsx` *(edit)* — fire auto-sync on save (or via the store).

**Recognizer (optional ISRC)**
- `recognizer/main.py`, `app/api/now-playing/route.ts`, `app/components/NowPlaying.tsx`
  *(edit)* — return/thread `isrc`.

**Config / docs**
- `.env.example` / `README.md` *(edit)* — `SPOTIFY_CLIENT_ID`, Premium + 5-user caveat, redirect URI.

## Testing

- **Unit (vitest):** `spotifyMatch` (normalize / query / score / pick), `spotifySync`
  (pending computation, state transitions, dedup) against a **mocked bridge**.
- **Manual (needs `client_id` + Premium):** connect flow, backfill count,
  new-save auto-append, not-found surfacing, disconnect/reconnect, offline retry.
  *(This is the part I cannot verify without your credentials.)*
