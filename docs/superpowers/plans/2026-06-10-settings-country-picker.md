# Searchable Settings Country Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the settings country picker's native `<select>` + hardcoded ~47-country list with a searchable combobox backed by the live ~200-country list, without changing any region-lock behavior.

**Architecture:** Extract Explore's existing `Combobox` into a shared component, add a small pure helper that builds the country option list (live countries + always-included current region, sorted), TDD that helper, then rewire `RegionPicker` to use both. UI wiring is verified in the browser preview; the project has no component-test harness and we are not adding one.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Vitest (logic tests only).

---

## File Structure

- **Create** `app/components/Combobox.tsx` — the shared searchable single-select dropdown (moved verbatim from `ExploreView.tsx`).
- **Modify** `app/components/ExploreView.tsx` — import `Combobox` from the new module; delete the local definition.
- **Modify** `app/lib/region.ts` — add the pure `buildCountryOptions` helper.
- **Create** `tests/regionOptions.test.ts` — unit tests for `buildCountryOptions`.
- **Modify** `app/components/RegionPicker.tsx` — rewrite the picker UI + data source.

---

## Task 1: Extract `Combobox` into a shared component

**Files:**
- Create: `app/components/Combobox.tsx`
- Modify: `app/components/ExploreView.tsx` (remove local `Combobox`, add import)

This is a pure move — the component's code does not change, only its location.

- [ ] **Step 1: Create `app/components/Combobox.tsx`**

Create the file with this exact content (the body is moved verbatim from `ExploreView.tsx`):

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// A searchable single-select dropdown (combobox): filter by typing, navigate
// with ↑/↓, pick with Enter/click, dismiss with Esc/click-away. Replaces a
// native <select> so a 200-country list is searchable — and so flags actually
// render in the list (native <option>s don't use the Twemoji font on Windows).
export function Combobox({ trigger, value, options, onSelect, searchPlaceholder, ariaLabel, keepOpen = false }: {
  trigger: React.ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
  searchPlaceholder: string;
  ariaLabel: string;
  // Stay open after a pick so several options can be added in one go
  // (genre multiselect); the picked option leaves the list. Single-select
  // (country) closes on pick.
  keepOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Focus the search when the menu opens (query/active are reset in `openMenu`,
  // keeping setState out of effects).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  const openMenu = () => { setQuery(''); setActive(0); setOpen(true); };

  // Dismiss on click-away.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(o: { value: string } | undefined) {
    if (!o) return;
    onSelect(o.value);
    if (keepOpen) {
      // Multiselect: keep the menu open and clear the search so the (now
      // shorter) list is ready for the next pick without reopening.
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    } else {
      setOpen(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="relative flex items-center cursor-pointer rounded-full border border-[var(--color-line)] bg-white pl-4 pr-9 h-9 text-sm font-semibold text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] transition-colors max-w-[240px]"
      >
        <span className="truncate">{trigger}</span>
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-ink-3)]">▾</span>
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          className="absolute left-0 top-[calc(100%+6px)] z-40 w-72 rounded-2xl border border-[var(--color-line)] bg-white shadow-[0_16px_48px_rgba(60,30,10,0.18)] overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--color-line)]">
            <span className="text-[var(--color-ink-4)] text-sm" aria-hidden="true">🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent outline-none text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)]"
            />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto py-1.5">
            {filtered.length === 0 ? (
              <div className="px-3 py-5 text-center text-sm text-[var(--color-ink-3)]">No matches</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.value || '__all'}
                  data-idx={i}
                  type="button"
                  onClick={() => choose(o)}
                  onMouseMove={() => setActive(i)}
                  className={[
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                    i === active ? 'bg-[rgba(168,85,247,0.10)]' : '',
                    o.value === value && value !== '' ? 'font-bold text-[var(--color-brand-purple)]' : 'text-[var(--color-ink-2)]',
                  ].join(' ')}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.value === value && value !== '' && <span aria-hidden="true" className="text-[var(--color-brand-purple)]">✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the import to `ExploreView.tsx`**

In `app/components/ExploreView.tsx`, add this import alongside the other component imports (after the `StationRow` import on line 11):

```tsx
import { Combobox } from './Combobox';
```

- [ ] **Step 3: Delete the local `Combobox` definition from `ExploreView.tsx`**

Remove the entire local `Combobox` block — the comment that begins `// A searchable single-select dropdown (combobox): filter by typing...` through the function's closing `}` (originally lines 223–353). Leave the `// ── Results ──` section that follows it intact.

- [ ] **Step 4: Verify lint + typecheck pass**

Run: `npm run lint`
Expected: no errors. (In particular, no "Combobox is not defined" and no unused-import warnings in `ExploreView.tsx`.)

- [ ] **Step 5: Verify the existing test suite still passes**

Run: `npm test`
Expected: all existing tests PASS (this task touches no tested logic; this just confirms nothing broke).

- [ ] **Step 6: Commit**

```bash
git add app/components/Combobox.tsx app/components/ExploreView.tsx
git commit -m "refactor: extract Combobox into a shared component"
```

---

## Task 2: Add the `buildCountryOptions` helper (TDD)

**Files:**
- Test: `tests/regionOptions.test.ts`
- Modify: `app/lib/region.ts`

This pure helper builds the picker's option list from the live country list, always including the current region (even when absent from the list), sorted by display name.

- [ ] **Step 1: Write the failing test**

Create `tests/regionOptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCountryOptions } from '../app/lib/region';

const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'FR', name: 'France' },
  { code: 'IL', name: 'Israel' },
];

describe('buildCountryOptions', () => {
  it('returns one option per country, sorted by display name', () => {
    const opts = buildCountryOptions(COUNTRIES, '');
    expect(opts.map(o => o.value)).toEqual(['FR', 'IL', 'US']);
    // Label is "<flag> <name>" — assert the name is present after the flag.
    expect(opts.find(o => o.value === 'FR')!.label).toContain('France');
  });

  it('includes the current region even when it is absent from the live list', () => {
    const opts = buildCountryOptions(COUNTRIES, 'JP');
    const jp = opts.find(o => o.value === 'JP');
    expect(jp).toBeDefined();
    expect(jp!.label).toContain('Japan');
  });

  it('does not duplicate the region when it is already in the list', () => {
    const opts = buildCountryOptions(COUNTRIES, 'US');
    expect(opts.filter(o => o.value === 'US')).toHaveLength(1);
  });

  it('returns just the region when the live list is empty', () => {
    const opts = buildCountryOptions([], 'IL');
    expect(opts.map(o => o.value)).toEqual(['IL']);
  });

  it('returns an empty list when there are no countries and no region', () => {
    expect(buildCountryOptions([], '')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- regionOptions`
Expected: FAIL — `buildCountryOptions` is not exported from `app/lib/region.ts`.

- [ ] **Step 3: Implement the helper**

In `app/lib/region.ts`, add the import at the top of the file (after the existing `persistSet` import on line 4):

```ts
import { flagEmoji } from './flag';
```

Then append this to the end of `app/lib/region.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- regionOptions`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/regionOptions.test.ts app/lib/region.ts
git commit -m "feat: add buildCountryOptions helper for the country picker"
```

---

## Task 3: Rewire `RegionPicker` to the shared combobox + live list

**Files:**
- Modify: `app/components/RegionPicker.tsx` (full rewrite)

- [ ] **Step 1: Rewrite `app/components/RegionPicker.tsx`**

Replace the entire file contents with:

```tsx
'use client';

import { useMemo } from 'react';
import { useRegion, useRegionLock, userRegion, buildCountryOptions } from '@/app/lib/region';
import { useCountries } from '@/app/lib/explore';
import { flagEmoji } from '@/app/lib/flag';
import { Combobox } from './Combobox';

export function RegionPicker() {
  const { region, setRegion } = useRegion();
  const { locked, setLocked } = useRegionLock();
  // The live ~200-country list (countries that actually have stations), shared
  // with Explore and cached app-wide. The current region is always folded in by
  // buildCountryOptions even if it isn't in the list, so the picker is never
  // empty while locked.
  const { data: countries } = useCountries();

  const options = useMemo(() => buildCountryOptions(countries, region), [countries, region]);

  // The trigger shows the selected country (flag + name). Fall back to the raw
  // code with a flag while the live list is still loading, then to a prompt.
  const trigger = useMemo(() => {
    const current = options.find(o => o.value === region);
    if (current) return current.label;
    return region ? `${flagEmoji(region)} ${region}` : 'Select a country';
  }, [options, region]);

  // "Show only" needs a region; enabling it defaults to the detected home
  // region (or the first option) when none is set yet.
  function toggle() {
    if (locked) { setLocked(false); return; }
    if (!region) setRegion(userRegion() ?? options[0]?.value ?? '');
    setLocked(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Single coupled control: the region only matters while "show only" is
          on. Off = fully global (no hidden prioritization), so the picker is
          hidden too. */}
      <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
        <span className="flex flex-col">
          <span className="text-sm font-medium text-[var(--color-ink)]">Show only one country</span>
          <span className="text-xs text-[var(--color-ink-4)]">
            Limit search and Popular to a single country. Favorites, Recently played and Explore are never limited.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={locked}
          onClick={toggle}
          className={[
            'shrink-0 relative h-5 w-9 rounded-full transition-colors cursor-pointer',
            locked ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
              locked ? 'left-[18px]' : 'left-0.5',
            ].join(' ')}
          />
        </button>
      </label>

      {locked && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] tracking-[1.2px] uppercase font-bold text-[var(--color-ink-3)]">
            Country
          </span>
          <Combobox
            ariaLabel="Country"
            searchPlaceholder="Search countries…"
            trigger={trigger}
            value={region}
            options={options}
            onSelect={(v) => setRegion(v)}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify lint + typecheck pass**

Run: `npm run lint`
Expected: no errors and no unused-import warnings (the old `Intl.DisplayNames` usage and `CODES` array are gone).

- [ ] **Step 3: Verify the full test suite still passes**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 4: Verify in the browser preview**

Start the dev server (preview_start if not already running) and open the app. Then:
1. Open **Settings** (gear/top bar).
2. Toggle **"Show only one country"** on — the Country picker appears.
3. Click the picker → the search field is focused; type a country not in the old 47 (e.g. "Iceland", "Kenya", "Vietnam") and confirm it appears with its flag and is selectable.
4. Pick it → the dropdown closes and the trigger shows the chosen country's flag + name.
5. Reopen the picker → the selected country is marked (✓, bold) and scrolled into view.
6. Confirm ↑/↓ navigation, Enter to select, and Esc/click-away to dismiss all work.

Capture a screenshot of the open picker (with a search query showing a previously-missing country) as proof.

- [ ] **Step 5: Commit**

```bash
git add app/components/RegionPicker.tsx
git commit -m "feat: searchable country picker with the full country list in settings"
```

---

## Self-Review Notes

- **Spec coverage:** Missing countries → live `useCountries()` list (Task 3) + always-include-region (Task 2). Autocomplete search → shared `Combobox` (Tasks 1 & 3). Loading/empty edge → `buildCountryOptions` returns the region-only list, and the trigger falls back to `flag + code` (Tasks 2 & 3). Region-lock behavior untouched → `toggle()` logic and the `useRegion`/`useRegionLock` stores are unchanged.
- **Type consistency:** `Combobox` option shape `{ value, label }` matches `CountryOption` and `buildCountryOptions`'s return type across all tasks. `useCountries()` yields `ExploreCountry` (`{ code, name, count }`), structurally compatible with `buildCountryOptions`'s `{ code, name }[]` parameter.
- **No DOM tests:** intentional — no component-test harness exists; UI is verified via the browser preview in Task 3, Step 4.
