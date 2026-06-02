# Radio + Now-Playing — Design Spec

**Date:** 2026-06-02
**Status:** Approved (visual + scope), pending written-spec review
**Author:** etai87@gmail.com (with Claude)

## Goal

A simple, single-page web app that lets the user pick an internet radio station, plays it in the browser, and shows what's currently playing — including a running session history of every song that aired since they tuned in.

## Non-goals (MVP)

- Audio fingerprinting / Shazam / paid recognition APIs (deferred until the metadata-only approach proves insufficient).
- Album art enrichment via iTunes / Spotify / MusicBrainz.
- User accounts, cross-device sync, server-side persistence.
- Multi-listener fan-out (each open EventSource opens its own upstream metadata connection).
- Custom-paste stream URL input.
- Stream proxying for stations that fail to play directly in `<audio>`.
- Production deployment. Local-only (`next dev`) for the MVP.

## Recognition approach

**Metadata-first, fingerprinting deferred.**

Most Icecast / SHOUTcast stations broadcast in-band ICY metadata: a `StreamTitle` text snippet interleaved with the audio. Reading it requires no audio processing, no third-party API, no Python service. For stations that strip metadata, the MVP shows "this station doesn't share song info" and the user can pick another. Fingerprinting (ShazamIO, AudD, ACRCloud) is only revisited if and when a station the user cares about lacks metadata.

## Architecture

Single Next.js 16 app, App Router. No separate backend service. Two parallel connections to each station while listening:

- **Audio:** browser plays the stream directly via `<audio src={streamUrl}>`. The browser handles decoding. No proxy.
- **Metadata:** Next.js route handler opens its own HTTP connection to the same stream with `Icy-MetaData: 1`, parses interleaved `StreamTitle` bytes, and pushes updates to the browser over Server-Sent Events (SSE).

```
Browser ──audio (<audio> element)─────────────────► Station
   │
   └── EventSource(/api/now-playing?id=…) ──► Route handler ──metadata──► Station
                                                    │
                                                    └─ ICY parser, emits SSE
```

Trade-off accepted: two connections per active station is wasteful at scale but irrelevant for a single local listener.

## Station discovery

Source: [radio-browser.info](https://api.radio-browser.info/) — federated, free, no auth required.

- **Mirror selection:** at server startup (or on first request), resolve `all.api.radio-browser.info` DNS, pick one IP, cache for the process lifetime. No retry-with-different-mirror in MVP — if requests start failing the user can restart the dev server.
- **Search:** debounced (~250ms) `GET /api/search?q=…` route handler proxies to `https://<mirror>/json/stations/search?name=<q>&limit=20&hidebroken=true&order=clickcount&reverse=true`. Server normalizes the response to only the fields the UI needs: `{ id (stationuuid), name, streamUrl (url_resolved), favicon, country, bitrate, codec }`.
- **Favorites:** stored in browser `localStorage` under key `radio:favorites` as a JSON array of the same normalized station shape (not just IDs — so a favorite still works if the station later disappears from radio-browser).

## UI

### Layout

Two-column page. Left: sidebar with Favorites (pinned to top) + Search. Right: now-playing detail with album-art placeholder, large title/artist, controls, and session history.

```
┌─────────────────────────────────────────────────────┐
│  ★ FAVORITES                                        │
│  [K] KEXP   Seattle · 128 kbps          ★           │
│  [F] FIP    Paris · 192 kbps            ★           │
│                                                     │
│  BROWSE                                             │
│  🔍 [ jazz ]                       NOW PLAYING ON   │
│  [J] Jazz FM   London · 128 kbps      JAZZ FM       │
│  [N] NTS 1     London · 128 kbps                    │
│  [B] BBC R6    UK · 320 kbps      ┌──────┐          │
│                                   │ART   │  So What │
│                                   │      │  Miles…  │
│                                   └──────┘          │
│                                   ▶  🔊 ━━━━━○──    │
│                                                     │
│                                   ▾ SESSION HISTORY │
│                                   14:28  Coltrane — │
│                                   14:22  Monk — …   │
└─────────────────────────────────────────────────────┘
```

### Visual direction

Warm editorial — locked in via mockup review. Reference vibes: Apple Music + curated-magazine editorial.

- **Palette:** off-white (`#fbf7f3`) background, white cards, ink-near-black (`#1a1410`) text, warm orange (`#d2691e`) accent for labels/active states, deep red (`#c0392b`) for errors.
- **Type:** -apple-system sans, large bold display sizes (42px song title, 22px artist), 11px uppercase tracked labels in warm orange.
- **Geometry:** rounded shapes (10–20px radii), pronounced shadows on cards and the play button, generous spacing.
- **Letter-chip station logo fallback** when `favicon` is missing or 404s: the first letter of the station name on a colored gradient chip. Deterministic gradient per name (so a station always gets the same chip).

### Components

All under `app/`. Component count kept small and each component owns its concern:

| File | Type | Responsibility |
|---|---|---|
| `app/page.tsx` | Client (made client because it holds `selectedStation` state) | Layout shell. Holds `selectedStation: Station \| null`. Renders sidebar + main panel. |
| `app/components/Sidebar.tsx` | Client | Composes `FavoritesList` + `StationSearch`. |
| `app/components/FavoritesList.tsx` | Client | Reads `useFavorites()`, renders rows. Click → set selected. |
| `app/components/StationSearch.tsx` | Client | Debounced search input. Fetches `/api/search?q=…`. Renders result rows with favicon + favorite star. |
| `app/components/StationRow.tsx` | Client (shared) | One row UI. Props: station, isActive, isFavorite, onSelect, onToggleFavorite. |
| `app/components/Player.tsx` | Client | Owns `<audio ref={audioRef} src={station.streamUrl} autoPlay />`. Play/pause/volume internal state. Reports `playState` ('idle' \| 'connecting' \| 'playing' \| 'error') up via callback so the right panel can show the connecting state. |
| `app/components/NowPlaying.tsx` | Client | Receives selected station + the player's `playState`. Opens EventSource to `/api/now-playing?url=…` keyed by station id. Owns `currentTrack`, `history`, `metaState` ('waiting' \| 'playing' \| 'no-metadata'). Renders the art placeholder, title, history. Combines its own `metaState` with the incoming `playState` to decide which of states ②–⑥ to show. |
| `app/components/StationLogo.tsx` | Client | Renders favicon with letter-chip fallback. Centralizes the broken-favicon handling. |
| `app/lib/stations.ts` | Module | `Station` TypeScript type + station normalization helper. |
| `app/lib/icy.ts` | Module | Pure async generator: takes `ReadableStream<Uint8Array>` + `metaInt`, yields `{ title: string }` on every StreamTitle change. No I/O, no framework deps. |
| `app/lib/favorites.ts` | Module | `useFavorites()` hook + localStorage read/write helpers. |
| `app/lib/colors.ts` | Module | Deterministic chip gradient picker by station name. |
| `app/api/search/route.ts` | Route handler | Proxies + normalizes radio-browser search. |
| `app/api/now-playing/route.ts` | Route handler | SSE endpoint. Opens upstream with `Icy-MetaData: 1`, feeds to `icy.ts`, streams `data: {...}\n\n` events. |

### State flow

- `selectedStation` lives in `page.tsx`. Player + NowPlaying receive it as a prop.
- NowPlaying is **keyed by `station.id`** so changing stations unmounts + remounts it, naturally resetting `currentTrack` and `history`.
- Player's audio element is keyed by `station.streamUrl` for the same reason — change station, reload audio.
- Favorites state lives in `localStorage` via `useFavorites()`. Any component that toggles a favorite triggers a re-render of all consumers via a tiny store (React `useSyncExternalStore` or a 5-line custom event bus — implementation detail for the plan).

## Loading & feedback states

Same visual language throughout: warm-orange spinner / dots, shimmer skeletons for unknown text, red accent reserved for errors.

| # | State | Trigger | UI |
|---|---|---|---|
| ① | Searching stations | User typing in search, debounce settled, request in flight | Small spinner inside search input. Shimmer skeleton rows below (same dimensions as real rows) so layout doesn't shift when results arrive. |
| ② | Connecting to station | User just clicked a station; audio not yet playing | Shimmer placeholder for album art. Skeleton bars for title/artist. Play button greyed with inline spinner. "Buffering audio…" caption. Station tag shows "Connecting to <name>" with bouncing-dots animation. |
| ③ | Audio playing, no song info yet | Audio is playing, EventSource open, first metadata event not yet received | Album art at 50% opacity. Title area shows "Listening for song info…" with bouncing dots. Subtitle: "Most stations announce the track within ~30 seconds." Play button is active (audio works). |
| ④ | Station has no metadata | Server confirmed no `icy-metaint` header on the stream response | Definitive placeholder — music-note glyph in a flat gray frame. Title: "This station doesn't share song info." Subtitle: "Audio keeps playing — you just won't see track names." No spinner. |
| ⑤ | Between tracks | StreamTitle equals the station name, is empty/whitespace, or matches a non-song pattern (e.g. station ID jingles) | Microphone glyph in a dark gradient frame. Title: station name. Subtitle: "Between tracks · DJ, news, or station ID." Detection rule for MVP: treat StreamTitle as "non-track" if any of: (a) trimmed value is empty, (b) it equals the station name case-insensitively, or (c) it has no `-` separator AND is shorter than 4 characters. |
| ⑥ | Audio connection error | The `<audio>` element fires `error` or fails to start playback within a reasonable timeout | Red station tag "⚠ <name> unreachable". Dashed-border art frame with ⚠ glyph. Title: "Couldn't connect." Subtitle: "The station server may be down. Reconnecting…" Buttons: [Retry now] [Pick another station]. Browser auto-retries playback; user can force retry. |

**Metadata-only failures are silent.** If the SSE/metadata connection drops while audio is still playing, the EventSource auto-reconnects in the background and we *do not* show the error UI — the user is still listening to music. We continue to show state ③ ("Listening for song info…") until either a new title arrives or the audio itself fails. State ⑥ is specifically for audio failures, which the user actually notices.

State ⑤ ("between tracks") is best-effort heuristic. We accept false positives/negatives here — the alternative is to show every station-ID string as a "song," which is worse UX.

## ICY metadata protocol (implementation reference)

When the request includes header `Icy-MetaData: 1`, the response includes header `icy-metaint: N` (often 8192 or 16000). Response body alternates indefinitely:

```
[N bytes of audio]
[1 byte length L]
[L * 16 bytes of metadata, null-padded]
... repeats forever ...
```

Metadata payload is ASCII like `StreamTitle='Artist - Title';StreamUrl='...';`. `L=0` means "no change since last block."

`app/lib/icy.ts` consumes a `ReadableStream<Uint8Array>` and `metaInt`, accumulates bytes across read boundaries, and yields `{ title: string }` each time the parsed `StreamTitle` differs from the previous one. Audio bytes are discarded — we never decode audio on the server.

## Route-handler behavior

### `GET /api/search?q=<query>`

- Validates `q` is non-empty (else returns `[]`).
- Fetches the cached radio-browser mirror.
- Normalizes response to `{ id, name, streamUrl, favicon, country, bitrate, codec }[]`.
- Caches results in-memory for 60 seconds per query string (tiny LRU map, ~50 entries) to avoid hammering the mirror on rapid backspace/retype.

### `GET /api/now-playing?url=<encoded streamUrl>`

- Receives the stream URL as a query parameter (the client already has it from the `/api/search` response or from a saved favorite). Avoids an extra radio-browser round-trip on every station change.
- Validates that the URL parses and uses `http:` or `https:`. (Local POC, no SSRF guard beyond that — fine because this is a local dev server.)
- Opens `fetch(streamUrl, { headers: { 'Icy-MetaData': '1' }, signal })` where `signal` is wired to `request.signal` so client disconnect kills the upstream.
- If response has no `icy-metaint` header → emit one SSE event `{type: 'no-metadata'}` and close.
- Otherwise feeds `response.body` into the ICY parser, emits one SSE event per StreamTitle change as `data: {"type":"track","title":"..."}\n\n`.
- Emits a `: keepalive\n\n` SSE comment every 15 s so intermediate proxies don't time out.
- On upstream error or parse failure: emit `{type: 'error', message}` and close. EventSource auto-reconnects.

## Testing plan

**Unit tests** (`app/lib/icy.ts`):
- Title parsed from a single well-formed block.
- Title change across two blocks emits two yields.
- `L=0` block emits nothing.
- Partial chunk arrival across read boundaries (split mid-metadata) still parses correctly.
- UTF-8 title with non-ASCII characters.
- Malformed metadata (no `StreamTitle=` field) emits nothing, doesn't throw.

**Manual smoke test:**
1. `npm run dev`
2. Search "KEXP" → favorite → click.
3. Verify audio plays within ~5 s (state ② resolves to playing).
4. Verify title appears within ~30 s (state ③ resolves to a track).
5. Wait for a track change — verify the new title replaces the current and the previous goes to history with a timestamp.
6. Pick a station that doesn't broadcast metadata (we'll find one during dev) → verify state ④ shows.
7. Stop the network briefly → verify state ⑥ shows and recovers after network restore.

**No e2e/browser automation tests in MVP** — manual is faster and the surface area is one page.

## Risks (re-listed from the design discussion)

1. **Stations without ICY metadata.** Mitigation: state ④ tells user clearly; future Shazam fallback is the escape hatch.
2. **Browser CORS / playlist formats (.pls, .m3u).** Mitigation: add a thin proxy route only if a station the user wants fails. Not in MVP.
3. **radio-browser mirror outages.** Mitigation: none in MVP — user restarts dev server. Add retry-with-different-mirror later if it bites.
4. **Misbehaving favicon URLs (404, mixed content, slow).** Mitigation: letter-chip fallback covers all failure modes.
5. **"Between tracks" detection is heuristic.** Accepted false-positive rate; logic is centralized and easy to refine.

## Open questions for implementation plan

- Tailwind v4 token setup for the warm palette — define as CSS custom properties or as Tailwind theme extension? (Project already has `@tailwindcss/postcss`.)
- Exact debounce library or just a 10-line hook? (Lean toward 10-line hook — no new dep.)
- For favorites store: `useSyncExternalStore` over localStorage, or a tiny EventTarget-based bus? (Both fine; pick during plan.)
- Whether to seed `localStorage` with 2–3 starter favorites on first load, or start empty with a "Search for a station to begin" empty state. (Default: empty with helpful empty state, since the search-first UX is the whole point.)
