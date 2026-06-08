# Saved Songs Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recolor the Saved Songs UI to the Spun brand gradient, let users save tracks from the playlist history, and record/show/filter saved songs by when they played.

**Architecture:** Introduce brand design tokens + two helper CSS classes in `globals.css` (first adopter of `docs/DESIGN_SYSTEM.md`). Put all date logic in a new pure, unit-tested module `app/lib/savedDates.ts`. Add an optional `playedAt` timestamp to `SavedSong` (populated from the track's air time) and an `at` timestamp to `HistoryEntry`. Wire a save affordance into each playlist-history row, and add date filter pills + grouped date headers to the saved-songs dialog.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind CSS v4 / Vitest (node env, tests in `tests/**/*.test.ts`, imports via relative path or `@/` alias).

**Conventions:**
- Tests are TypeScript-only and test pure logic. Component/UI behavior is verified manually via the preview workflow (no JSX tests in this repo).
- Each task ends with a commit. Run `npm test` and `npm run lint` before component commits.

---

## File Structure

- **Create** `app/lib/savedDates.ts` — pure date helpers (`DateRange`, `playedTime`, `rangeFilter`, `groupByDate`, `formatPlayed`).
- **Create** `tests/savedDates.test.ts` — unit tests for the above.
- **Modify** `app/globals.css` — add brand tokens + `.bg-brand` / `.text-brand-gradient` helper classes.
- **Modify** `app/lib/savedSongs.ts` — add `playedAt` to `SavedSong` + `BuildInput`, thread through `buildSavedSong`.
- **Modify** `tests/savedSongs.test.ts` — cover `playedAt`.
- **Modify** `app/lib/nowPlayingTypes.ts` — add `at` to `HistoryEntry`.
- **Modify** `app/components/NowPlaying.tsx` — capture track air time, stamp history `at`, pass `playedAt` on save, recolor the Save button.
- **Modify** `app/page.tsx` — pass `stationName` to `PlaylistHistory`.
- **Modify** `app/components/PlaylistHistory.tsx` — add a brand save heart per row.
- **Modify** `app/components/SavedSongsDialog.tsx` — date filter pills + grouped headers + `formatPlayed` labels (Task 6), then recolor to brand (Task 7).

---

## Task 1: Brand design tokens + helper classes

**Files:**
- Modify: `app/globals.css:3-14` (the `:root` block)

- [ ] **Step 1: Add brand tokens to `:root`**

In `app/globals.css`, replace the `:root` block (lines 3–14) with:

```css
:root {
  --color-bg: #fbf7f3;
  --color-bg-2: #ffffff;
  --color-ink: #1a1410;
  --color-ink-2: #4a3f37;
  --color-ink-3: #8a7a6e;
  --color-ink-4: #b8a99a;
  --color-line: #ece2d8;
  --color-accent: #c0392b;
  --color-accent-2: #7a1f15;
  --color-warm: #d2691e;

  /* Brand (design system — see docs/DESIGN_SYSTEM.md) */
  --grad-brand: linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
  --color-brand-indigo: #6366f1;
  --color-brand-purple: #a855f7;
  --color-brand-pink: #ec4899;
  --color-danger: #c0392b;
}
```

- [ ] **Step 2: Add the two brand helper classes**

After the `:root` block (before the `@font-face` rule), add:

```css
/* Brand gradient fill (primary actions, active states). */
.bg-brand { background-image: var(--grad-brand); }

/* Brand gradient text (brand-moment titles). Solid fallback first so the
   text is readable if background-clip is unsupported (see DESIGN_SYSTEM §4). */
.text-brand-gradient {
  color: var(--color-brand-pink);
  background-image: var(--grad-brand);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

- [ ] **Step 3: Verify the dev build compiles**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(design-system): add brand tokens and helper classes"
```

---

## Task 2: `savedDates.ts` pure date helpers (TDD)

**Files:**
- Create: `app/lib/savedDates.ts`
- Test: `tests/savedDates.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/savedDates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { playedTime, rangeFilter, groupByDate, formatPlayed } from '../app/lib/savedDates';
import { buildSavedSong } from '../app/lib/savedSongs';
import type { SavedSong } from '../app/lib/savedSongs';

// Fixed reference point: Mon Jun 8 2026, 12:00 local.
const now = new Date(2026, 5, 8, 12, 0, 0).getTime();
const at = (mo: number, d: number, h: number, m = 0) => new Date(2026, mo, d, h, m).getTime();

function song(id: string, opts: { playedAt?: number; savedAt?: number }): SavedSong {
  return buildSavedSong({
    raw: id, artist: id, title: id, stationName: 'S',
    savedAt: opts.savedAt ?? now,
    ...(opts.playedAt != null ? { playedAt: opts.playedAt } : {}),
  });
}

const today = song('today', { playedAt: at(5, 8, 9, 0) });        // Jun 8 09:00
const yest = song('yest', { playedAt: at(5, 7, 22, 0) });          // Jun 7 22:00
const thisWeek = song('week', { playedAt: at(5, 5, 10, 0) });      // Jun 5 10:00 (3 days ago)
const earlier = song('earlier', { playedAt: at(4, 29, 8, 0) });    // May 29 08:00 (10 days ago)
const legacy = song('legacy', { savedAt: at(5, 8, 7, 0) });        // no playedAt

describe('playedTime', () => {
  it('uses playedAt when present, else savedAt', () => {
    expect(playedTime(today)).toBe(at(5, 8, 9, 0));
    expect(playedTime(legacy)).toBe(at(5, 8, 7, 0));
  });
});

describe('rangeFilter', () => {
  const all = [today, yest, thisWeek, earlier];
  it('all → unchanged', () => {
    expect(rangeFilter(all, 'all', now)).toEqual(all);
  });
  it('today → only songs since local midnight', () => {
    expect(rangeFilter(all, 'today', now).map(s => s.id)).toEqual(['today']);
  });
  it('week → today + previous 6 days', () => {
    expect(rangeFilter(all, 'week', now).map(s => s.id)).toEqual(['today', 'yest', 'week']);
  });
  it('month → last 30 days', () => {
    expect(rangeFilter(all, 'month', now).map(s => s.id)).toEqual(['today', 'yest', 'week', 'earlier']);
  });
});

describe('groupByDate', () => {
  it('buckets by played time, drops empties, preserves order', () => {
    const groups = groupByDate([today, yest, thisWeek, earlier], now);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'This week', 'Earlier']);
    expect(groups[0].songs.map(s => s.id)).toEqual(['today']);
  });
  it('omits a bucket with no songs', () => {
    const groups = groupByDate([today, earlier], now);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Earlier']);
  });
});

describe('formatPlayed', () => {
  it('today/yesterday show time only (header carries the day)', () => {
    expect(formatPlayed(today, now)).toBe('09:00');
    expect(formatPlayed(yest, now)).toBe('22:00');
  });
  it('this-week shows weekday + time', () => {
    expect(formatPlayed(thisWeek, now)).toMatch(/^\w{3} 10:00$/);
  });
  it('earlier shows month/day + time', () => {
    expect(formatPlayed(earlier, now)).toBe('May 29 · 08:00');
  });
  it('legacy (no playedAt) is labeled as saved', () => {
    expect(formatPlayed(legacy, now)).toBe('Saved Jun 8');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/savedDates.test.ts`
Expected: FAIL — `savedDates` module / exports not found.

- [ ] **Step 3: Write the implementation**

Create `app/lib/savedDates.ts`:

```ts
import type { SavedSong } from './savedSongs';

export type DateRange = 'all' | 'today' | 'week' | 'month';
export type DateGroup = { label: string; songs: SavedSong[] };

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The timestamp a saved song is dated by: when it played, falling back to
 *  when it was saved (legacy songs predate play-time tracking). */
export function playedTime(song: SavedSong): number {
  return song.playedAt ?? song.savedAt;
}

/** Local midnight (00:00) of the day containing `ts`. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function monDay(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Keep songs whose played time falls within `range` relative to `now`. */
export function rangeFilter(songs: SavedSong[], range: DateRange, now: number): SavedSong[] {
  if (range === 'all') return songs;
  const today = startOfDay(now);
  const min =
    range === 'today' ? today :
    range === 'week' ? today - 6 * DAY :   // today + previous 6 days = 7 calendar days
    today - 29 * DAY;                       // 30 calendar days
  return songs.filter(s => playedTime(s) >= min);
}

/** Bucket songs into Today / Yesterday / This week / Earlier by played time.
 *  Input order is preserved within each bucket; empty buckets are dropped. */
export function groupByDate(songs: SavedSong[], now: number): DateGroup[] {
  const today = startOfDay(now);
  const yesterday = today - DAY;
  const weekStart = today - 6 * DAY;
  const buckets: Record<string, SavedSong[]> = { Today: [], Yesterday: [], 'This week': [], Earlier: [] };
  for (const s of songs) {
    const t = playedTime(s);
    if (t >= today) buckets.Today.push(s);
    else if (t >= yesterday) buckets.Yesterday.push(s);
    else if (t >= weekStart) buckets['This week'].push(s);
    else buckets.Earlier.push(s);
  }
  return (['Today', 'Yesterday', 'This week', 'Earlier'] as const)
    .filter(label => buckets[label].length > 0)
    .map(label => ({ label, songs: buckets[label] }));
}

/** The row's time label. The list is always grouped (the header states the
 *  day), so today/yesterday rows show only the time; this-week rows add the
 *  weekday; older rows add the date; legacy songs (no playedAt) read
 *  "Saved <date>" so they're never mislabeled as a known play time. */
export function formatPlayed(song: SavedSong, now: number): string {
  const t = playedTime(song);
  if (song.playedAt == null) return `Saved ${monDay(t)}`;
  const today = startOfDay(now);
  const yesterday = today - DAY;
  const weekStart = today - 6 * DAY;
  if (t >= yesterday) return hhmm(t);                                  // Today / Yesterday
  if (t >= weekStart) return `${WEEKDAYS[new Date(t).getDay()]} ${hhmm(t)}`; // This week
  return `${monDay(t)} · ${hhmm(t)}`;                                  // Earlier
}
```

> Note: `formatPlayed` references `song.playedAt`, added to `SavedSong` in Task 3. Run Task 3 before relying on the type, or accept a transient type error until then. (If executing in order, do Task 3 first — see ordering note below.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/savedDates.test.ts`
Expected: PASS (all assertions).

> If `playedAt` is not yet on `SavedSong`, you'll get a type error in the test helper. Complete Task 3 first, then re-run. (Recommended order: Task 3 → Task 2.)

- [ ] **Step 5: Commit**

```bash
git add app/lib/savedDates.ts tests/savedDates.test.ts
git commit -m "feat(saved): pure date filter/group/format helpers"
```

---

## Task 3: `playedAt` on SavedSong (TDD)

> Do this **before** Task 2's final run (Task 2's tests reference `playedAt`).

**Files:**
- Modify: `app/lib/savedSongs.ts:14-30` (`SavedSong`), `:32-44` (`BuildInput`), `:47-66` (`buildSavedSong`)
- Test: `tests/savedSongs.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/savedSongs.test.ts` (inside the `describe('buildSavedSong', …)` block, after the existing `it` cases):

```ts
  it('passes playedAt through when supplied, and omits the field otherwise', () => {
    expect(buildSavedSong({ ...base, playedAt: 5000 }).playedAt).toBe(5000);
    expect('playedAt' in buildSavedSong(base)).toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/savedSongs.test.ts`
Expected: FAIL — `playedAt` not on the returned object / not a valid `BuildInput` field.

- [ ] **Step 3: Add `playedAt` to the type**

In `app/lib/savedSongs.ts`, in `SavedSong`, add after the `savedAt: number;` line:

```ts
  savedAt: number;
  /** When the track aired (its play time). Absent on songs saved before
   *  play-time tracking existed — callers fall back to savedAt. */
  playedAt?: number;
```

- [ ] **Step 4: Add `playedAt` to `BuildInput`**

In `BuildInput`, add after `savedAt: number;`:

```ts
  savedAt: number;
  playedAt?: number;
```

- [ ] **Step 5: Thread it through `buildSavedSong`**

In `buildSavedSong`'s returned object, change the trailing isrc spread line to also carry `playedAt`:

```ts
    stationName: input.stationName,
    savedAt: input.savedAt,
    ...(input.playedAt != null ? { playedAt: input.playedAt } : {}),
    ...(input.isrc && input.isrc.trim() ? { isrc: input.isrc.trim() } : {}),
  };
```

- [ ] **Step 6: Run both affected test files**

Run: `npx vitest run tests/savedSongs.test.ts tests/savedDates.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/lib/savedSongs.ts tests/savedSongs.test.ts
git commit -m "feat(saved): record playedAt (track air time) on saved songs"
```

---

## Task 4: Capture air time in NowPlaying + recolor the Save button

**Files:**
- Modify: `app/lib/nowPlayingTypes.ts:6`
- Modify: `app/components/NowPlaying.tsx` (refs near `:67`, track branch `:151-170`, save handler `:359-372`, `SaveSongButton` `:419-436`)

- [ ] **Step 1: Add `at` to `HistoryEntry`**

In `app/lib/nowPlayingTypes.ts`, replace line 6:

```ts
export type HistoryEntry = { time: string; title: string; at: number };
```

- [ ] **Step 2: Add a ref tracking the current track's air time**

In `app/components/NowPlaying.tsx`, just below the `prevTitleRef` declaration (around line 67), add:

```ts
  // Air time (epoch ms) of the track currently on screen. Used to stamp the
  // playlist-history entry when it rolls off, and as playedAt when saved.
  // null until the first live `track` event (a restored session has no known
  // start time) → callers fall back to Date.now().
  const currentStartRef = useRef<number | null>(null);
```

- [ ] **Step 3: Stamp history `at` and set the air time on track change**

In the SSE `msg.type === 'track'` branch, replace this block:

```ts
          const prev = prevTitleRef.current;
          if (prev === msg.title) return;
          if (prev !== null && !isNonTrack(prev, station.name)) {
            setHistory(h => [{ time: nowHHMM(), title: prev }, ...h].slice(0, 50));
          }
          prevTitleRef.current = msg.title;
          setCurrentRaw(msg.title);
```

with:

```ts
          const prev = prevTitleRef.current;
          if (prev === msg.title) return;
          if (prev !== null && !isNonTrack(prev, station.name)) {
            const prevAt = currentStartRef.current ?? Date.now();
            setHistory(h => [{ time: nowHHMM(), title: prev, at: prevAt }, ...h].slice(0, 50));
          }
          prevTitleRef.current = msg.title;
          currentStartRef.current = Date.now();
          setCurrentRaw(msg.title);
```

- [ ] **Step 4: Pass `playedAt` when saving the now-playing song**

In the `SaveSongButton`'s `onToggle` handler, add `playedAt` to the `save({...})` call:

```ts
              save({
                raw: currentRaw ?? '', artist, title, cover: trackCover ?? undefined,
                shazamUrl: links.shazamUrl || undefined,
                appleMusicUrl: (links.appleMusicUrl || matchedLookup?.appleUrl) || undefined,
                previewUrl: (links.previewUrl || matchedLookup?.previewUrl) || undefined, key: links.key || undefined,
                stationName: station.name,
                playedAt: currentStartRef.current ?? Date.now(),
              });
```

- [ ] **Step 5: Recolor `SaveSongButton` to the brand**

Replace the `className` array in `SaveSongButton` (the saved/unsaved branch) with:

```tsx
      className={[
        'inline-flex items-center gap-1.5 text-[11px] tracking-[0.8px] uppercase font-bold rounded-full px-2.5 py-1 cursor-pointer transition-colors border',
        saved
          ? 'bg-brand text-white border-transparent'
          : 'text-[var(--color-brand-pink)] border-[var(--color-line)] hover:border-[var(--color-brand-pink)]',
      ].join(' ')}
```

- [ ] **Step 6: Verify lint + types**

Run: `npm run lint`
Expected: no errors. (TypeScript will flag any missed `HistoryEntry` construction site — there should be only the one in Step 3.)

- [ ] **Step 7: Commit**

```bash
git add app/lib/nowPlayingTypes.ts app/components/NowPlaying.tsx
git commit -m "feat(now-playing): track air time, stamp history, recolor Save button"
```

---

## Task 5: Save from playlist history

**Files:**
- Modify: `app/page.tsx:203`
- Modify: `app/components/PlaylistHistory.tsx` (whole file)

- [ ] **Step 1: Pass the station name into `PlaylistHistory`**

In `app/page.tsx`, change line 203:

```tsx
                    <PlaylistHistory history={playlistHistory} stationName={currentStation.name} />
```

- [ ] **Step 2: Rewrite `PlaylistHistory` to add a save heart per row**

Replace the entire contents of `app/components/PlaylistHistory.tsx` with:

```tsx
'use client';

import { splitArtistTitle } from '@/app/lib/track';
import { useSavedSongs } from '@/app/lib/savedSongs';
import type { HistoryEntry } from '@/app/lib/nowPlayingTypes';

const savedId = (artist: string, title: string) =>
  `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

// Session playlist log, rendered below the player controls. Carries a solid
// background + soft feather so the pulse rings dissolve smoothly into it.
// Each row can be saved (brand heart) — metadata-only saves whose cover /
// preview / Apple Music link the SavedSongsDialog backfills from iTunes.
export function PlaylistHistory({ history, stationName }: { history: HistoryEntry[]; stationName: string }) {
  const { isSaved, save, remove } = useSavedSongs();
  if (history.length === 0) return null;

  return (
    <div className="relative z-10 bg-[var(--color-bg)]">
      <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">
        ▾ Playlist history
      </div>
      {history.map((h, i) => {
        const { artist, title } = splitArtistTitle(h.title);
        const id = savedId(artist, title);
        const saved = isSaved(id);
        return (
          <div
            key={i}
            className="grid grid-cols-[64px_1fr_auto] gap-4 py-3 border-b border-[var(--color-line)] items-baseline last:border-none"
          >
            <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
            <div className="text-base text-[var(--color-ink-2)]">
              {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
            </div>
            <button
              onClick={() => {
                if (saved) { remove(id); return; }
                save({ raw: h.title, artist, title, stationName, playedAt: h.at ?? Date.now() });
              }}
              aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
              title={saved ? 'Saved — click to remove' : 'Save this song'}
              className={[
                'self-center w-7 h-7 flex items-center justify-center text-base leading-none cursor-pointer transition-transform hover:scale-125',
                saved ? 'text-[var(--color-brand-pink)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-brand-pink)]',
              ].join(' ')}
            >
              {saved ? '♥' : '♡'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

> `h.at ?? Date.now()` guards restored sessions saved before `HistoryEntry.at` existed (the field may be missing at runtime even though the type now requires it).

- [ ] **Step 3: Verify lint + types**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/components/PlaylistHistory.tsx
git commit -m "feat(history): save tracks directly from the playlist history"
```

---

## Task 6: Date filter + grouped headers in SavedSongsDialog

**Files:**
- Modify: `app/components/SavedSongsDialog.tsx` (imports, state, close-reset effect, the `shown`/list-render region `:92-215`)

- [ ] **Step 1: Add the savedDates import and replace the local `hhmm`**

The `useSavedSongs, searchSavedSongs` import already exists (line 4) — do **not** re-add it. Add one new import line beneath it:

```ts
import { rangeFilter, groupByDate, formatPlayed, type DateRange } from '@/app/lib/savedDates';
```

Then delete the local `hhmm` helper (lines 13–16) — `formatPlayed` replaces it.

- [ ] **Step 2: Add `range` state and reset it on close**

Add to the component's state (near `const [query, setQuery] = useState('');`):

```ts
  const [range, setRange] = useState<DateRange>('all');
```

In the "Stop any preview when the dialog closes" effect, add `setRange('all');` alongside the existing resets:

```ts
    setPreviewId(null);
    setExportOpen(false);
    setRange('all');
```

- [ ] **Step 3: Replace the `shown` memo with search → range → group**

Replace:

```ts
  const shown = useMemo(() => searchSavedSongs(saved, query), [saved, query]);
```

with:

```ts
  // Date labels/buckets are relative to "now"; computed once per render.
  const now = Date.now();
  const filtered = rangeFilter(searchSavedSongs(saved, query), range, now);
  const groups = groupByDate(filtered, now);
```

(Remove the now-unused `useMemo` import if nothing else uses it — check the file; `useMemo` is otherwise unused after this change, so drop it from the React import.)

- [ ] **Step 4: Add the filter pills below the search box**

Immediately after the search-box `</div>` (the block with the 🔍 input), insert:

```tsx
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    {([['all', 'All'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setRange(key)}
                        className={[
                          'text-[11px] font-bold rounded-full px-3 py-1 cursor-pointer border transition-colors',
                          range === key
                            ? 'bg-brand text-white border-transparent'
                            : 'text-[var(--color-ink-3)] border-[var(--color-line)] hover:border-[var(--color-brand-pink)]',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
```

- [ ] **Step 5: Replace the flat list with grouped rendering**

Replace the `shown.length === 0 ? (…) : (<ul>…</ul>)` region with grouped output. The block currently reads `{shown.length === 0 ? (<p>No matches.</p>) : (<ul …>{shown.map(s => (…))}</ul>)}`. Replace it with:

```tsx
                  {filtered.length === 0 ? (
                    <p className="text-sm text-[var(--color-ink-3)]">No songs match.</p>
                  ) : (
                    groups.map(group => (
                      <div key={group.label}>
                        <div className="text-[10px] tracking-[1.2px] uppercase font-extrabold text-[var(--color-ink-4)] mt-4 mb-1">
                          {group.label}
                        </div>
                        <ul className="flex flex-col">
                          {group.songs.map(s => (
                            <li key={s.id} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-line)] last:border-none">
                              <StationLogo name={s.artist || s.title} favicon={s.cover} />
                              <div className="flex-1 min-w-0">
                                <div className="text-[15px] leading-tight truncate">
                                  {s.artist ? <><b className="font-bold text-[var(--color-ink)]">{s.artist}</b> <span className="text-[var(--color-ink-2)]">— {s.title}</span></> : <span className="font-semibold">{s.title}</span>}
                                </div>
                                <div className="text-xs text-[var(--color-ink-3)] truncate mt-0.5">♫ {s.stationName} · {formatPlayed(s, now)}</div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {s.previewUrl && (
                                  <button
                                    onClick={() => togglePreview(s.id, s.previewUrl)}
                                    aria-label={previewId === s.id ? 'Pause preview' : 'Play preview'}
                                    className="w-8 h-8 rounded-full border border-[var(--color-line)] flex items-center justify-center text-[12px] text-[var(--color-brand-purple)] hover:border-[var(--color-brand-purple)] cursor-pointer"
                                  >
                                    {previewId === s.id ? '⏸' : '▶'}
                                  </button>
                                )}
                                {s.appleMusicUrl && (
                                  <a href={s.appleMusicUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-brand text-white">Apple Music</a>
                                )}
                                <button onClick={() => remove(s.id)} aria-label={`Remove ${s.title}`} title="Remove from saved" className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-ink-4)] hover:text-[var(--color-danger)] hover:bg-[rgba(192,57,43,0.08)] cursor-pointer transition-colors">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
```

> This carries the Task 7 recolor for the rows (play button purple, Apple Music `bg-brand`, remove uses `--color-danger`) since we're rewriting this markup anyway. Task 7 covers the remaining header/export recolor.

- [ ] **Step 6: Verify lint + types + existing tests**

Run: `npm run lint && npx vitest run`
Expected: lint clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/components/SavedSongsDialog.tsx
git commit -m "feat(saved): date filter pills + grouped headers + played-time labels"
```

---

## Task 7: Recolor SavedSongsDialog header + export to brand

**Files:**
- Modify: `app/components/SavedSongsDialog.tsx:126-156` (header + export controls)

- [ ] **Step 1: Recolor the title to brand gradient text**

Change the `<h2>` (currently `text-[var(--color-warm)]`, label `★ Saved songs`) to:

```tsx
                <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-brand-gradient">♥ Saved songs</h2>
```

- [ ] **Step 2: Recolor the Export button hover**

In the Export `<button>`, change `hover:border-[var(--color-warm)]` to `hover:border-[var(--color-brand-pink)]`:

```tsx
                        className="flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-3 py-1 border border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-brand-pink)] cursor-pointer"
```

- [ ] **Step 3: Update the empty-state hint to the new heart**

The empty-state `<p>` mentions "tap the ♡". Leave the wording but ensure it matches the now-pink save affordance — change `★` references if any remain. (The empty-state text already says ♡; no change needed beyond Step 1's title.)

- [ ] **Step 4: Verify lint**

Run: `npm run lint`
Expected: no errors. Grep to confirm no `--color-warm` remains in this file:

Run: `grep -n "color-warm" app/components/SavedSongsDialog.tsx`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add app/components/SavedSongsDialog.tsx
git commit -m "style(saved): recolor dialog header + export to brand"
```

---

## Task 8: Manual verification + wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite and lint**

Run: `npx vitest run && npm run lint`
Expected: all tests pass, lint clean.

- [ ] **Step 2: Start the dev server and verify in the preview**

Use the preview workflow (preview_start on `npm run dev`, port 3000). Then:
- Pick a station that names songs; let at least two tracks play so the **playlist history** populates.
- Confirm the now-playing **Save** button is the brand gradient when saved, pink outline when not.
- Click the **♥** on a playlist-history row → it fills pink.
- Open **Saved songs** (the dialog): title is gradient text; the history-saved song appears, with cover/preview/Apple Music backfilled after a moment; its row reads `♫ <station> · Played <when>` (Today → time only).
- Click the filter **pills** (All / Today / This week / This month) → the list narrows; the active pill shows the gradient.
- Confirm rows are under **date group headers**, and **Remove** (trash) still hovers red, not pink.

Check `preview_console_logs` for errors; capture a `preview_screenshot` of the recolored dialog as proof.

- [ ] **Step 3: Final confirmation commit (if any stray changes)**

```bash
git status   # expect clean; commit only if something was missed
```

---

## Self-Review notes (for the executor)

- **Ordering:** Task 3 (adds `playedAt` to `SavedSong`) should run before Task 2's final test run, since the `savedDates` tests construct songs with `playedAt`. Both commit independently.
- **Dedupe limitation (known, out of scope):** a Shazam-recognized now-playing save uses the Shazam `key` as id, while a history save of the same song uses `artist|title`. These won't dedupe against each other (history carries only the title text). Acceptable per spec.
- **Legacy data:** saved songs without `playedAt` fall back to `savedAt` for filtering/grouping and read "Saved <date>"; restored history entries without `at` fall back to `Date.now()` at save time.
