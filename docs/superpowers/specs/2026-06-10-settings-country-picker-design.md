# Searchable settings country picker

## Problem

The settings country picker (`app/components/RegionPicker.tsx`) — used by the
"Show only one country" control — has two flaws:

1. **Missing countries.** It lists a hardcoded array of ~47 ISO codes
   (`CODES` in `RegionPicker.tsx`). Every other country is absent.
2. **No search.** It's a native `<select>`, so finding a country means
   scrolling a long alphabetical list with no autocomplete.

The Explore view already solved both problems. `ExploreView.tsx` defines a
`Combobox` — a searchable single-select dropdown with flag rendering, keyboard
navigation (↑/↓/Enter/Esc), and click-away dismissal — fed by `useCountries()`,
the live ~200-country list from radio-browser. The settings picker should reuse
that work rather than maintain a worse, divergent picker.

## Goal

Replace the settings picker's native `<select>` + hardcoded country list with a
searchable combobox backed by the live country list — without changing any
region-lock behavior.

## Design

### 1. Extract `Combobox` into a shared component

Move the `Combobox` function from `app/components/ExploreView.tsx` into a new
`app/components/Combobox.tsx`, exported unchanged (same props:
`trigger`, `value`, `options`, `onSelect`, `searchPlaceholder`, `ariaLabel`,
`keepOpen`). `ExploreView` imports it from the new module instead of defining it
locally. This is a pure move — no behavior change to Explore.

### 2. Rebuild `RegionPicker` to use the shared combobox + live list

- Delete the hardcoded `CODES` array.
- Source countries from `useCountries()` (`app/lib/explore.ts`). Map each
  `{ code, name }` to a combobox option `{ value: code, label:
  \`${flagEmoji(code)} ${name}\` }`, sorted by name.
- Always include the current `region` (detected or user-chosen) as a selectable
  option even when it is not present in the live list, preserving today's
  guarantee that "your region is always selectable." Resolve its display name
  via `Intl.DisplayNames`, falling back to the raw code.
- Replace the native `<select>` (shown when `locked`) with the `Combobox`. The
  trigger shows the current country's flag + name; `searchPlaceholder` is
  "Search countries…".

### 3. Loading / empty edges

While `useCountries()` is loading or has errored with an empty list, fall back
to a single-option list containing just the current `region`, so the picker is
never empty while locked. Region-lock only produces results when a country has
stations, so this degradation is acceptable.

## Out of scope (unchanged)

- The "Show only one country" toggle and its enable-defaults logic.
- The `useRegion` / `useRegionLock` stores and all region-filtering behavior
  (`useRegionFilter`, `useActiveRegion`).
- Explore's own picker behavior.

## Impact

- New file: `app/components/Combobox.tsx`.
- Changed: `app/components/ExploreView.tsx` (import the moved component),
  `app/components/RegionPicker.tsx` (rewrite the picker UI + data source).
- No new dependencies, no API changes.
