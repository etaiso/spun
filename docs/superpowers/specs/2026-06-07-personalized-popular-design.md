# Personalized, Genre-Aware "Popular" Section — Design

**Date:** 2026-06-07
**Status:** Approved for planning

## Problem

The sidebar "✦ Popular" section is sparse for Israeli (and other small-market)
regions, and feels static. Today it is driven entirely by radio-browser's
all-time, community-wide `clickcount`:

- For a region like `IL` it fetches the top 8 IL stations + top 10 global
  stations (`order=clickcount`), merges, dedupes, caps at 15, caches 5 min.
- If "Region-only mode" is on, the 10 global stations are filtered out,
  leaving ≤8 IL stations; after dedupe and removing already-favorited
  stations, often only 2–3 remain.
- The ranking is not personalized (ignores what the user listens to) and not
  live (a slowly-moving all-time counter).

The app currently maps **no genre/tag data** on stations and keeps only thin
listening signals (last-5 recents, favorites, saved songs).

## Goals

1. **Personalize** the Popular list by the genres the user actually listens to.
2. **Fresher / livelier** ordering that responds to recent behavior without
   hammering radio-browser.
3. **Fill the sparse regional list** — including for brand-new users with no
   taste data yet.

## Non-Goals (YAGNI)

- No server-side / cloud tracking — everything stays local.
- No real-time concurrent-listener counts.
- No genre-browsing navigation UI.
- No onboarding genre picker (cold start is fully automatic — user decision).
- No section rename.

## Design

### 1. Genre data on stations (foundation)

radio-browser returns a `tags` field (e.g. `"pop,rock,israeli,news"`) that the
app currently discards.

- Extend `normalizeStation` in `app/lib/stations.ts` to parse `tags` into
  `tags: string[]` — lowercased, trimmed, empty-filtered, capped at ~8 — and
  add `tags?: string[]` to the `Station` type (optional, backward-compatible).
- Update `dedupeStations` in `app/lib/dedupe.ts` to **union** tags when
  collapsing duplicate stations, so a merged station retains all genre labels.

### 2. Play tally store (new — `app/lib/playCounts.ts`)

A store under key `radio:playCounts`, keyed by station id:

```ts
type PlayCount = { count: number; tags: string[]; lastAt: number };
```

- **Persistence:** uses the existing write-through layer (`persistSet` /
  `persistGet` in `app/lib/persist.ts`), exactly like `recent.ts` /
  `favorites.ts`. That means localStorage is a synchronous cache **and** every
  write is mirrored (debounced) to the SQLite-backed `/api/state`, and is
  rehydrated from the server on boot. It is **persisted in the DB, not
  localStorage-only.** No schema/migration work — `/api/state` is a generic
  key/value store.
- Incremented in `handleSelect` in `app/page.tsx` (the same spot recents are
  updated), capturing the station's `tags` at play time.
- This is the signal that sharpens the taste profile over time.

> The derived **taste profile** (§3) is computed at runtime from these signals
> and is **not** persisted separately — nothing extra to store or migrate.

### 3. Taste profile — weighted blend (new — `app/lib/taste.ts`)

A `useGenreAffinity()` hook that aggregates genre signals into a
`Map<genre, score>`:

| Source            | Weight   |
| ----------------- | -------- |
| Favorites         | ×4       |
| Tracked stations  | ×2       |
| Play tally        | ×`count` |
| Last-5 recents    | ×1       |

- Each contributing station adds its `tags` to the matching genre buckets,
  multiplied by the source weight.
- Result normalized to 0–1.
- Exposes: the full affinity map (for scoring) and `topGenres` (top 3 by score)
  for the fetch param.
- **Empty profile → empty `topGenres`** (the cold-start path).

### 4. Hybrid fetch (`app/api/popular/route.ts`)

The endpoint gains an optional `&genres=pop,rock,news` param (client sends its
top 3). It fetches the following in parallel and merges them:

- **Per-genre regional** (personalization fill), one call per top genre:
  `/json/stations/search?tag={g}&countrycode={region}&order=clickcount&reverse=true&limit=5&hidebroken=true`
  → "top pop / rock / news stations in Israel". Only fires when `genres` present.
- **Trending regional** (cold-start fill + liveliness, always):
  `/json/stations/search?countrycode={region}&order=clicktrend&reverse=true&limit=10&hidebroken=true`
  → rising click velocity, not all-time total.
- **Anchor lists** (neutral baseline, always): the existing regional-top
  (limit raised 8 → ~20) + global-top-10 by `clickcount`.

Merge → dedupe by id → `normalizeStation` → `dedupeStations`. Return a
**larger candidate pool (~30–40)** instead of a pre-truncated 15, so the client
has room to re-rank.

- Cache key becomes `region + sorted(genres)`; 5-min TTL retained for
  radio-browser etiquette.
- If all batches are empty → return `[]` with 502 (unchanged behavior).

> Implementation note: confirm the `/json/stations/search` endpoint accepts
> `tag` + `countrycode` + `order` together and that `order=clicktrend` is
> supported, against the radio-browser docs, before finalizing the calls.

### 5. Live client-side re-rank (`app/components/Recommended.tsx`)

The client scores each candidate against the **live** affinity profile and
shows the top 15:

```
score = W_GENRE · affinity(station.tags)
      + W_POP   · popularityRank
      + W_REGION · (station.countrycode === region ? 1 : 0)
```

- `affinity(tags)` = mean of the profile scores for the station's tags
  (unmatched tags contribute 0); 0 when the profile is empty.
- Reuse the weighting spirit of `app/lib/rank.ts`.
- Because re-ranking runs on the client against the live profile, **order
  updates instantly** when the user favorites/plays a station — no refetch.
  This delivers the "fresher / live" feel cheaply.
- Existing filters unchanged: hidden-stations filter, region-only mode,
  drop-already-favorited. Empty/error/skeleton states unchanged.

## Cold start (new user, no signals)

- `topGenres` empty → no `genres` param → no per-genre fetch.
- `W_GENRE` term is 0 for all candidates → ranking falls back to
  **popularity + region**, i.e. today's behavior — no regression.
- Emptiness is fixed independently of personalization by the **fatter regional
  anchor (≈20)** and the **trending regional fetch**, giving a fuller, livelier
  baseline for everyone.
- After the first play, the play tally + recents update live and personalization
  shapes the order on the very next render.

### 6. Debug / observability (dev-only)

Surface the otherwise-invisible taste signals for debugging, reusing the
**existing** double-gated debug surface — no new flag, no user-facing UI, no
`console.*` logging (the app deliberately avoids console logging and routes
diagnostics through `DebugPanel`).

- Gating is already in place in `app/components/SettingsDialog.tsx`: the panel
  renders only when `isDev` (`NODE_ENV === 'development'` **or** Electron) **and**
  the `radio:showDebug` toggle is on. Invisible in production web builds.
- Add a **"Taste" block** to `app/components/DebugPanel.tsx` showing:
  - **Top genres** — affinity map sorted desc with normalized scores
    (e.g. `pop 0.82 · rock 0.61 · news 0.34`).
  - **`genres` param** currently sent to `/api/popular` (top 3).
  - **Play tally** — total tracked stations + top few by count with their tags.
  - **Per-source breakdown** — favorites / tracked / play-count / recents
    contribution, so it's visible *why* a genre ranks high.
- The panel reads `useGenreAffinity()` and the play-count store directly; it does
  **not** need the candidate pool or the re-rank output (the visible Popular list
  order is that output). No coupling into `StationRow` / the user-facing list.

## Data Flow

```
play/favorite/track  ──►  localStorage (playCounts, favorites, tracking, recent)
                                   │
                                   ▼
                     useGenreAffinity()  ──►  topGenres ─┐
                                   │                      │
                                   │            GET /api/popular?region&genres
                                   │                      │
                                   │                      ▼
                                   │        radio-browser: per-genre + trending
                                   │                      + anchor lists (cached)
                                   │                      │
                                   ▼                      ▼
                          affinity map ─────►  client re-rank ──► top 15 shown
                          (live, re-runs on every render)
```

## Affected / New Files

| File                              | Change                                            |
| --------------------------------- | ------------------------------------------------- |
| `app/lib/stations.ts`             | map `tags`, add `tags?: string[]` to `Station`    |
| `app/lib/dedupe.ts`               | union tags on collapse                            |
| `app/lib/playCounts.ts`           | **new** — play tally store + hook                 |
| `app/lib/taste.ts`                | **new** — `useGenreAffinity()` weighted blend     |
| `app/api/popular/route.ts`        | `genres` param, per-genre + trending fetch, pool  |
| `app/components/Recommended.tsx`  | send `genres`, client re-rank by combined score   |
| `app/page.tsx`                    | increment play tally in `handleSelect`            |
| `app/components/DebugPanel.tsx`   | dev-only "Taste" block (profile, genres, tally)   |

## Testing Strategy

- **`taste.ts`**: unit tests for the weighted blend — favorites outweigh
  recents; play count scales; empty inputs → empty profile; normalization
  bounds 0–1; top-N selection.
- **`playCounts.ts`**: increment/persist/restore; tags captured; dedupe by id.
- **`stations.ts` / `dedupe.ts`**: tag parsing (casing, empties, cap); tag union
  on duplicate collapse.
- **`popular/route.ts`**: builds correct paths with/without `genres`; merge +
  dedupe + pool cap; cache keyed by region+genres; all-empty → 502.
- **`Recommended.tsx`**: combined-score ordering; empty profile falls back to
  popularity+region (cold-start parity); re-rank updates when favorites change;
  existing filters still applied.
