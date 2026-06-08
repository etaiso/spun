# Saved Songs rework — brand recolor, save-from-history, date filter

**Date:** 2026-06-08
**Status:** Approved design

## Summary

Rework the saving-songs UI/UX in Spun:

1. **Recolor** the Saved Songs surfaces to the Spun brand gradient
   (indigo→purple→pink), establishing a reusable design system as the source of
   truth (`docs/DESIGN_SYSTEM.md`).
2. **Save from playlist history** — let the user save any track listed in the
   session playlist history, not just the currently-playing one.
3. **"Played" time + date filter** — record when each saved track aired and let
   the user filter the saved list by date (with grouped date headers).

This is the **first adopter** of the new design system. Other components keep
the legacy terracotta accents and migrate later.

## Decisions (from brainstorming)

- **Palette:** full Spun brand gradient `linear-gradient(135deg, #6366F1,
  #A855F7, #EC4899)`, used sparingly (brand moments + primary actions). Solid
  **pink `#EC4899`** is the primary interactive accent; **purple `#A855F7`** is
  secondary. Red `#c0392b` stays reserved for danger.
- **Rollout:** define the design system + tokens now and convert Saved Songs +
  its save affordances; migrate the rest of the app feature-by-feature later.
- **Saved time = when the track *played*** (aired), not when the user tapped
  save — clearly labeled in the UI as "Played …" so the meaning is unambiguous.
- **Date filter UI:** filter pills (All / Today / This week / This month) **and**
  grouped date headers (Today / Yesterday / This week / Earlier), combined with
  the existing search.

## Architecture

### New: `docs/DESIGN_SYSTEM.md`
Brand foundations, color tokens, usage rules, typography, component patterns,
accessibility. Already written; see that file. Implementation must conform to it.

### New: `app/lib/savedDates.ts` (pure, unit-tested)
All date logic lives here, out of the component, so it's testable in isolation.

- `type DateRange = 'all' | 'today' | 'week' | 'month'`
- `playedTime(song: SavedSong): number` — `song.playedAt ?? song.savedAt`
  (the single accessor used for both filtering and grouping; legacy songs fall
  back to `savedAt`).
- `rangeFilter(songs: SavedSong[], range: DateRange, now: number): SavedSong[]`
  — keep songs whose `playedTime` falls in the range. Ranges are calendar-based
  (today = since local midnight; week = last 7 days; month = last 30 days).
- `groupByDate(songs: SavedSong[], now: number): { label: string; songs: SavedSong[] }[]`
  — bucket into Today / Yesterday / This week / Earlier, preserving input order
  within each bucket, dropping empty buckets.
- `formatPlayed(song: SavedSong, now: number): string` — the row's time string.
  Because the list is **always grouped** (the group header states the day), the
  row must not repeat it:
  - Played song within this week → `"{HH:MM}"` (header carries Today/Yesterday/This week).
  - Played song older than this week (the "Earlier" bucket) → `"{Mon D} · {HH:MM}"`.
  - Legacy song (no `playedAt`) → `"Saved {Mon D}"`, so it's never mislabeled as
    a known play time.
  The row renders this as `♫ {stationName} · {formatPlayed(...)}`.

`now` is injected (not read from `Date.now()` inside) so the helpers are
deterministic and testable.

### Data model changes

**`app/lib/savedSongs.ts`** — `SavedSong` gains `playedAt?: number`.
- `BuildInput` gains optional `playedAt`. `buildSavedSong` copies it through when
  present. Additive and backward compatible — persisted songs without the field
  just read as legacy.
- `useSavedSongs().save(...)` already stamps `savedAt = Date.now()`; callers now
  also pass `playedAt`.

**`app/lib/nowPlayingTypes.ts`** — `HistoryEntry` gains `at: number`:
```ts
export type HistoryEntry = { time: string; title: string; at: number };
```
`time` (the `HH:MM` display string) stays. `at` is the airing timestamp used as
`playedAt` when saving from history. Restored sessions predating this field lack
`at`; treat a missing `at` as "unknown" and fall back to `Date.now()` at save.

## Data flow

### Now-playing save
`NowPlaying` captures a numeric `playedAtRef` when a `track` SSE event arrives
(the moment the current track started for this listener). The Save handler passes
`playedAt: playedAtRef.current` alongside the existing fields. Recolor
`SaveSongButton` to the brand save affordance.

### History entries
When a track rolls off "now playing" into history, the entry is built with
`at: Date.now()` (the existing push site at `NowPlaying.tsx:164`).

### Save from history
- `page.tsx` passes the active `stationName` to `PlaylistHistory`.
- `PlaylistHistory` uses `useSavedSongs()` and renders a `♡`/`♥` per row.
  On toggle it builds a save from the row: `splitArtistTitle(h.title)` →
  `save({ raw: h.title, artist, title, stationName, playedAt: h.at ?? Date.now() })`.
  No cover/preview/Apple Music link is available from history, so the save starts
  metadata-only (search-URL fallbacks via `buildSavedSong`).
- The **existing** iTunes backfill sweep in `SavedSongsDialog` (runs on open)
  fills in cover / preview / Apple Music link for these songs — the same path
  now-playing metadata saves already rely on.
- Id is `key || \`${artist}|${title}\`` (normalized), so saving the same song
  from now-playing and from history dedupes to one entry.

### Date filter + grouping (in `SavedSongsDialog`)
1. `searchSavedSongs(saved, query)` (existing) →
2. `rangeFilter(..., range, now)` →
3. `groupByDate(..., now)` → render groups with headers.
Filter pills set `range`; the active pill uses `--grad-brand`. Each row's meta
line uses `formatPlayed`.

## Recolor specifics (per the design system)

- `SavedSongsDialog`: gradient title text (with solid fallback), gradient active
  filter pill, gradient Apple Music link, pink hearts, purple play button /
  hovers, brand "Saved" affordance. Remove button keeps `--color-danger`.
- `NowPlaying.SaveSongButton`: off = white + line border + pink `♡`; saved =
  `--grad-brand` fill + white `♥`.
- `PlaylistHistory` save heart: pink, mirroring the now-playing affordance.
- Favorites ★, "Now playing on X" labels, and the rest of the app stay
  terracotta (migrate later) — an accepted temporary mix.

## Persistence

- `savedSongs` persists via `persistSet` (localStorage + SQLite in Electron).
  Adding `playedAt` is additive — old data loads unchanged.
- Session cache (`app/lib/session.ts`) persists `history`; the added
  `HistoryEntry.at` is additive and tolerated-missing on restore.

## Testing

Test-first (Vitest), focused on the pure logic:

- `savedDates.test.ts`: `rangeFilter` boundaries (midnight today, 7-day, 30-day;
  `all`), `groupByDate` bucketing + empty-bucket drop + order preservation,
  `formatPlayed` for played vs legacy songs, and `playedTime` fallback. Inject a
  fixed `now`.
- `savedSongs.test.ts` (extend if present, else add): `buildSavedSong` carries
  `playedAt` through and omits it when absent; dedupe by id still holds.

UI wiring (SSE timestamp capture, history heart, pill state) is verified
manually in the running app via the preview workflow.

## Out of scope

- Migrating the rest of the app to the brand system (later, feature-by-feature).
- Changing export formats, the recognizer, or persistence backends.
- A custom date-range picker (the presets + grouping cover the need).
