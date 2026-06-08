# Explore — Browse Stations by Country & Genre — Implementation Plan

**Status:** Shipped in v0.3.0 (PR #43). This documents the design as built.

**Goal:** A dedicated "Explore" destination to browse the radio-browser
catalogue by country and genre (combinable, ANDed), with a docked mini-player so
playback continues while browsing, and a reframed "show only one country"
control.

**Architecture:** New cached API routes wrap radio-browser's country/tag/station
search and reuse the existing `normalizeStation` + `dedupeStations` pipeline.
Pure path/normalize helpers live in `app/lib/*` (unit-tested in node). A client
data layer (`app/lib/explore.ts`) exposes fetch-once list hooks + station
fetchers. `ExploreView` renders the landing + faceted results; `page.tsx` adds a
`view: 'home' | 'explore'` state and keeps both the now-playing stage and Explore
mounted so audio + filter state persist.

**Tech Stack:** Next.js 16 (App Router, `nodejs` route handlers), React 19,
TypeScript, Vitest (node env, `tests/`), Tailwind v4. Region store is the
existing write-through `persistSet`/`useSyncExternalStore` pattern.

## Conventions
- Single test file: `npx vitest run tests/<name>.test.ts`; all: `npm test`;
  lint: `npm run lint`; types: `npx tsc --noEmit`.
- Only **pure functions** are unit-tested (node env). Components/hooks are
  verified via build + the browser preview workflow.
- Per AGENTS.md, this Next.js has breaking changes — route params/searchParams
  are async; check `node_modules/next/dist/docs` before adding routes.

## File structure

**Create — data layer**
- `app/lib/explorePaths.ts` — pure: `buildStationsPath({country, tags[]})`
  (countrycode + `tagList` AND), `normalizeCountries`, `normalizeTags`,
  `countryCodesFromStations`. Tested in `tests/explorePaths.test.ts`.
- `app/api/countries/route.ts` — `/json/countries` → `[{code,name,count}]`, 6h cache.
- `app/api/tags/route.ts` — top `/json/tags` → `[{name,count}]`, 6h cache.
- `app/api/stations/route.ts` — `?country=&tag=` (repeatable `tag`) → normalized
  + deduped stations, 5min cache.
- `app/api/country-codes/route.ts` — `?tag=…` → distinct country codes across all
  matching stations (narrows the country picker), 5min cache.

**Create — client + UI**
- `app/lib/explore.ts` — `useCountries()`/`useTags()` (module-cache +
  useSyncExternalStore), `fetchStations({country,tags})`,
  `fetchCountryCodesForTags`, curated `GENRES` (matched to exact radio-browser
  tag spellings).
- `app/lib/flag.ts` — extracted `flagEmoji` (was duplicated in TopBar/RegionPicker).
- `app/lib/dom.ts` — `showTitleIfTruncated` (tooltip only when a name is clipped).
- `app/components/ExploreView.tsx` — landing (genre chips + country grid) +
  results (searchable `Combobox` country picker, multiselect genre combobox →
  chips, Reset, results grid). `ShowOnlyToggle` by the title sets/clears
  "show only this country".

**Modify**
- `app/page.tsx` — `view` + `exploredOnce` state; render `ExploreView`
  (kept mounted/hidden); keep the now-playing stage mounted with the `Player`
  keyed by station; clickable logo → home; hide sidebar in Explore; lift the
  shortcuts button above the dock.
- `app/components/Player.tsx` — `dock` mode (fixed bottom bar); `<audio>`
  rendered once outside the dock/full branch so layout toggles never remount it.
- `app/components/TopBar.tsx` — Explore button, `onGoHome`, full country name in
  the pill.
- `app/lib/region.ts` — `useActiveRegion()` (= region only when "show only" on).
- `app/components/{CommandPalette,Recommended}.tsx` — use `useActiveRegion`;
  stop region-filtering Favorites/Recently-played.
- `app/components/RegionPicker.tsx` — single coupled "Show only one country"
  control (picker revealed only when on).
- `app/components/Sidebar.tsx`, `ShortcutsHelp.tsx`, `StationRow.tsx` — hide
  prop, dock-aware position, truncation tooltip.

## Verification
- `npm test` (path/normalize units) + `npm run lint` + `npx tsc --noEmit`.
- Browser: Explore opens; genre chips (real counts) + country grid (home pinned);
  combine country + multiple genres ("jazz + blues in Germany"); country picker
  narrows to genres' countries; searchable pickers; play a station → returns home
  + audio continues (same `<audio>`); dock controls work; "show only" toggle +
  global-when-off; filters persist across home↔Explore.
