# Explore — Browse Stations by Country & Genre — Design

**Date:** 2026-06-09
**Status:** Shipped (v0.3.0)

## Problem

spun could only **search by name** (⌘K command palette) and **browse Popular /
Favorites** in the sidebar. The region control merely *filtered/ranked* existing
lists — there was no way to **browse the catalogue** by country or genre.
radio-browser exposes exactly this via `/json/countries` and `/json/tags` (both
with station counts), plus `stations/search?countrycode=` / `tagList=`.

A new browse surface also collided with the existing **"region-only mode"**,
which filtered *every* list — directly contradicting the idea of browsing other
countries.

## Goals

1. A first-class way to **discover** stations by **country** and by **genre**,
   and to **combine** them (e.g. "jazz + blues in Germany").
2. Fit spun's existing UX (cream/gradient design system, command palette,
   sidebar) without disrupting the now-playing experience.
3. Resolve the region-only-mode conflict so browsing and "show only my country"
   coexist without confusion.

## Design

### Surface — a dedicated "Explore" view (Approach C)
Three approaches were prototyped in a throwaway preview and compared with the
user: (A) Countries/Tags scopes inside the ⌘K palette, (B) a Library⇄Explore
mode atop the sidebar, (C) a dedicated full-stage destination from a new top-bar
button. **C** was chosen — most room for a flagship discovery feature, most
visual, and it keeps playback context.

- **Landing:** curated genre chips (with live station counts) + a flag country
  grid (the user's home country pinned first).
- **Drill-in:** a station-results grid, reusing the existing `StationRow`.
- The sidebar is hidden while Explore is open (full width for browsing).

### Faceted, combinable filters
Country and genre are **independent, ANDed** facets:
- One country + any number of genre tags, all intersected. radio-browser ANDs
  `countrycode` + `tagList` (a single tag behaves like the old `tag` param).
- The results view has a filter bar: a **country** picker and a **genre** picker,
  built on a custom **searchable combobox** (the ~200-country list isn't usable
  as a native `<select>`, and native `<option>`s don't render flag emoji on
  Windows). Genre is **multiselect** — picked genres become removable chips and
  the menu stays open to add more. A **Reset** clears everything.
- When genres are selected, the **country picker is narrowed** to only countries
  that actually have a matching station (a server endpoint aggregates the
  distinct country codes across all stations matching the tags).

### Playback continuity
Opening Explore must not stop the audio. The now-playing stage stays mounted
(hidden) and the `Player` is keyed by station (not view), so the same `<audio>`
element survives the switch. While Explore is open the Player renders as a
**docked mini-player** (fixed bottom bar: play/pause, station, live track,
volume). Explore is itself kept mounted once opened, so filters + loaded results
persist across trips to the now-playing view.

### "Show only" (region-only mode), reframed & coupled
- The lock is reframed from "filter everything" to **discovery-only**: it limits
  **search + Popular** to one country; **Favorites, Recently-played and Explore
  are never limited** (filtering explicit picks caused a "played it → it vanished"
  surprise).
- Region prioritization is **tied to the toggle**: the chosen country only shapes
  search/Popular while "show only" is on; off = fully global (no hidden boost).
- Explore is **exempt** from the lock (browsing is explicit intent); a
  **"Show only [country]"** toggle by the country result title sets/switches/
  clears it from any state.
- Terminology is plain **"Show only [country]"** (not "lock"/"region-only"), and
  user-facing copy says **country** to match Explore.

## Non-goals
- No new persistence model — reuses the existing radio-browser fetch + station
  normalization/dedupe pipeline and the write-through region store.
- No re-ranking of Explore results (unlike search/Popular) — they're returned by
  clickcount.
