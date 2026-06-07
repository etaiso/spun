# Personalized Genre-Aware "Popular" Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar "Popular" section personalized to the genres the user listens to and fuller/livelier for small markets (e.g. Israel), with a dev-only debug readout.

**Architecture:** Map radio-browser's `tags` onto stations; derive a weighted genre-affinity profile from favorites/tracked/recents plus a new persisted play tally; have `/api/popular` fetch a wider candidate pool (per-genre regional + trending + anchor lists); re-rank that pool live on the client by `genre affinity + popularity + region`. Pure logic lives in `app/lib/*` (unit-tested in node), React hooks/UI wire it up (verified by build + preview).

**Tech Stack:** Next.js 16 (App Router, `nodejs` runtime route), React 19, TypeScript, Vitest (`environment: 'node'`, tests in `tests/`), Tailwind v4. Persistence via the existing write-through `persistSet`/`persistGet` (localStorage cache mirrored to SQLite `/api/state`).

---

## Conventions (read before starting)

- Run a single test file: `npx vitest run tests/<name>.test.ts`
- Run all tests: `npm test` · Lint: `npm run lint` · Build: `npm run build`
- Test env is **node** (no `window`/`jsdom`). Only **pure functions** are unit-tested. React hooks + components are verified via `npm run build` and the preview workflow, NOT vitest.
- Tests live in `tests/**/*.test.ts` and import app code via the `@/` or `../app/...` alias (both work; existing tests use `../app/...`).
- Stores follow the `app/lib/favorites.ts` pattern: a module-level cached `snapshot`, `subscribe`/`read`/`write`, `useSyncExternalStore`, and `persistSet(KEY, JSON.stringify(next))`. Persisted keys are `radio:*`.

## File Structure

**Create:**
- `app/lib/playCounts.ts` — persisted per-station play tally. Pure `bumpPlay`/`parsePlayCounts` + `usePlayCounts()` hook. Responsibility: record how often each station is played, with its genre tags.
- `app/lib/taste.ts` — pure `computeAffinity()` + `useGenreAffinity()` hook. Responsibility: blend signals into a normalized genre-affinity profile.
- `app/lib/popularPaths.ts` — pure `buildPopularPaths(region, genres)`. Responsibility: build the radio-browser request paths for the Popular pool.
- `app/lib/popularRank.ts` — pure `genreAffinity()` + `scorePopular()`. Responsibility: order a candidate pool by the combined score.
- `tests/playCounts.test.ts`, `tests/taste.test.ts`, `tests/popularPaths.test.ts`, `tests/popularRank.test.ts`, `tests/dedupe.test.ts`

**Modify:**
- `app/lib/stations.ts` — parse `tags` into `Station.tags?: string[]`.
- `app/lib/dedupe.ts` — union tags when collapsing duplicates.
- `tests/stations.test.ts` — cover tag parsing.
- `app/api/popular/route.ts` — accept `genres`, use `buildPopularPaths`, clickcount-sort, return ~40.
- `app/components/Recommended.tsx` — send `genres`, re-rank the pool live.
- `app/page.tsx` — bump the play tally in `handleSelect`.
- `app/components/DebugPanel.tsx` — dev-only "Taste" block.

---

## Task 1: Parse genre tags onto stations

**Files:**
- Modify: `app/lib/stations.ts`
- Test: `tests/stations.test.ts`

- [ ] **Step 1: Add failing tests for tag parsing**

Append to `tests/stations.test.ts` (inside the file, after the existing `describe('normalizeStation', …)` closes — i.e. as new top-level `describe` blocks):

```ts
describe('normalizeStation tags', () => {
  const raw = {
    stationuuid: 'x', name: 'X', url_resolved: 'http://x', url: '',
    favicon: '', country: '', countrycode: '', bitrate: 0, codec: '',
  };

  it('parses comma-separated tags into a lowercased, trimmed array', () => {
    expect(normalizeStation({ ...raw, tags: 'Pop, Rock ,news' }).tags).toEqual(['pop', 'rock', 'news']);
  });

  it('omits the tags field entirely when there are none', () => {
    expect('tags' in normalizeStation(raw)).toBe(false);
    expect('tags' in normalizeStation({ ...raw, tags: '' })).toBe(false);
    expect('tags' in normalizeStation({ ...raw, tags: ' , , ' })).toBe(false);
  });

  it('dedupes and caps tags at 8', () => {
    const tags = 'a,a,b,c,d,e,f,g,h,i,j';
    expect(normalizeStation({ ...raw, tags }).tags).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run tests/stations.test.ts`
Expected: FAIL — the existing tests pass, the new `tags` tests fail (`tags` is `undefined`).

- [ ] **Step 3: Implement tag parsing in `app/lib/stations.ts`**

Add `tags?: string[]` to the `Station` type (after `aliases?`):

```ts
  aliases?: string[];
  // Genre/format tags from radio-browser (e.g. ["pop","rock","news"]),
  // lowercased + deduped. Used to personalize the Popular section. Optional —
  // absent on legacy stored stations and on records radio-browser tagged with
  // nothing. See lib/taste.ts.
  tags?: string[];
};
```

Add `tags?: string;` to the `RawStation` type (after `codec: number;`… i.e. after `codec: string;`):

```ts
  codec: string;
  tags?: string; // comma-separated from radio-browser, e.g. "pop,rock,news"
};
```

Add a `parseTags` helper above `normalizeStation`:

```ts
// radio-browser returns tags as a single comma-separated string. Normalize to a
// clean, lowercased, deduped array, capped so a station spamming 30 tags can't
// dominate the genre profile.
export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const t = part.trim().toLowerCase();
    if (t) seen.add(t);
  }
  return [...seen].slice(0, 8);
}
```

In `normalizeStation`, compute tags and include the field only when non-empty (so stations with no tags keep the exact shape the existing test asserts):

```ts
export function normalizeStation(raw: RawStation): Station {
  const tags = parseTags(raw.tags);
  return {
    id: raw.stationuuid,
    name: (raw.name ?? '').trim(),
    streamUrl: raw.url_resolved || raw.url,
    favicon: raw.favicon,
    country: raw.country,
    countrycode: (raw.countrycode ?? '').toUpperCase(),
    bitrate: raw.bitrate,
    codec: raw.codec,
    ...(tags.length ? { tags } : {}),
  };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run tests/stations.test.ts`
Expected: PASS (all old + new tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/stations.ts tests/stations.test.ts
git commit -m "feat: parse radio-browser genre tags onto Station"
```

---

## Task 2: Union tags when deduping stations

**Files:**
- Modify: `app/lib/dedupe.ts`
- Test: `tests/dedupe.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/dedupe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dedupeStations } from '../app/lib/dedupe';
import type { Station } from '../app/lib/stations';

function station(over: Partial<Station> & { id: string; name: string }): Station {
  return {
    streamUrl: `http://stream/${over.id}`,
    favicon: '', country: '', countrycode: 'IL', bitrate: 128, codec: 'MP3',
    ...over,
  };
}

describe('dedupeStations tag union', () => {
  it('merges tags from a collapsed duplicate into the survivor', () => {
    const out = dedupeStations([
      station({ id: '1', name: 'גלגלצ - Glglz', tags: ['pop', 'rock'] }),
      station({ id: '2', name: 'Glglz', tags: ['rock', 'israeli'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1'); // first occurrence wins
    expect([...(out[0].tags ?? [])].sort()).toEqual(['israeli', 'pop', 'rock']);
  });

  it('gives the survivor tags when it had none but a duplicate did', () => {
    const out = dedupeStations([
      station({ id: '1', name: 'Glglz' }),
      station({ id: '2', name: 'גלגלצ - Glglz', tags: ['pop'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].tags).toEqual(['pop']);
  });

  it('leaves a lone station untouched', () => {
    const out = dedupeStations([station({ id: '1', name: 'Solo', tags: ['jazz'] })]);
    expect(out[0].tags).toEqual(['jazz']);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/dedupe.test.ts`
Expected: FAIL — the survivor keeps only its own tags (union not implemented).

- [ ] **Step 3: Implement the tag union in `app/lib/dedupe.ts`**

Add a `mergeTags` helper next to `addAlias` (inside `dedupeStations`):

```ts
  const mergeTags = (owner: Station, tags: string[] | undefined) => {
    if (!tags || tags.length === 0) return;
    const set = new Set(owner.tags ?? []);
    for (const t of tags) set.add(t);
    owner.tags = [...set];
  };
```

In the `if (owner) { … }` block, call it right after the alias merge:

```ts
    if (owner) {
      addAlias(owner, s.name);
      for (const a of s.aliases ?? []) addAlias(owner, a);
      mergeTags(owner, s.tags);
      // Point both keys at the owner so future dupes matching either collapse too.
      if (u && !urlOwner.has(u)) urlOwner.set(u, owner);
      if (nk && !nameOwner.has(nk)) nameOwner.set(nk, owner);
      continue;
    }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/dedupe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/dedupe.ts tests/dedupe.test.ts
git commit -m "feat: union genre tags when collapsing duplicate stations"
```

---

## Task 3: Persisted play-tally store

**Files:**
- Create: `app/lib/playCounts.ts`
- Test: `tests/playCounts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/playCounts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bumpPlay, parsePlayCounts } from '../app/lib/playCounts';
import type { PlayCounts } from '../app/lib/playCounts';

describe('bumpPlay', () => {
  it('records a first play with count 1, tags, and timestamp', () => {
    const next = bumpPlay({}, { id: 'a', tags: ['pop'] }, 1000);
    expect(next).toEqual({ a: { count: 1, tags: ['pop'], lastAt: 1000 } });
  });

  it('increments count and refreshes tags + lastAt on a repeat play', () => {
    const first = bumpPlay({}, { id: 'a', tags: ['pop'] }, 1000);
    const second = bumpPlay(first, { id: 'a', tags: ['pop', 'rock'] }, 2000);
    expect(second.a).toEqual({ count: 2, tags: ['pop', 'rock'], lastAt: 2000 });
  });

  it('keeps prior tags when a later play has none', () => {
    const first = bumpPlay({}, { id: 'a', tags: ['pop'] }, 1000);
    const second = bumpPlay(first, { id: 'a' }, 2000);
    expect(second.a.tags).toEqual(['pop']);
  });

  it('does not mutate the input map', () => {
    const input: PlayCounts = {};
    bumpPlay(input, { id: 'a', tags: [] }, 1000);
    expect(input).toEqual({});
  });
});

describe('parsePlayCounts', () => {
  it('parses a valid object', () => {
    const raw = JSON.stringify({ a: { count: 2, tags: ['pop'], lastAt: 5 } });
    expect(parsePlayCounts(raw)).toEqual({ a: { count: 2, tags: ['pop'], lastAt: 5 } });
  });

  it('returns {} for null, arrays, and invalid JSON', () => {
    expect(parsePlayCounts(null)).toEqual({});
    expect(parsePlayCounts('[]')).toEqual({});
    expect(parsePlayCounts('not json')).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/playCounts.test.ts`
Expected: FAIL — module `app/lib/playCounts` does not exist.

- [ ] **Step 3: Implement `app/lib/playCounts.ts`**

```ts
'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { persistSet } from './persist';

// Per-station play tally — how many times the user has started each station,
// plus its genre tags at play time. Feeds the genre-affinity profile in
// lib/taste.ts. Persisted like favorites/recent: a localStorage cache mirrored
// (debounced) to the SQLite-backed /api/state, rehydrated on boot.

export type PlayCount = { count: number; tags: string[]; lastAt: number };
export type PlayCounts = Record<string, PlayCount>;

const KEY = 'radio:playCounts';
const EMPTY: PlayCounts = {};

/** Pure: record one play of `station`, returning a NEW map (input untouched). */
export function bumpPlay(
  counts: PlayCounts,
  station: { id: string; tags?: string[] },
  now: number,
): PlayCounts {
  const prev = counts[station.id];
  return {
    ...counts,
    [station.id]: {
      count: (prev?.count ?? 0) + 1,
      tags: station.tags ?? prev?.tags ?? [],
      lastAt: now,
    },
  };
}

/** Pure: tolerant parse of the stored value into a PlayCounts map. */
export function parsePlayCounts(raw: string | null): PlayCounts {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as PlayCounts)
      : {};
  } catch {
    return {};
  }
}

function loadFromStorage(): PlayCounts {
  if (typeof window === 'undefined') return EMPTY;
  return parsePlayCounts(window.localStorage.getItem(KEY));
}

let snapshot: PlayCounts | null = null;
function read(): PlayCounts {
  if (snapshot === null) snapshot = loadFromStorage();
  return snapshot;
}

const listeners = new Set<() => void>();
function emit() { for (const cb of listeners) cb(); }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { snapshot = loadFromStorage(); cb(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function write(next: PlayCounts) {
  snapshot = next;
  persistSet(KEY, JSON.stringify(next));
  emit();
}

export function usePlayCounts() {
  const counts = useSyncExternalStore(subscribe, read, () => EMPTY);
  const bump = useCallback((station: { id: string; tags?: string[] }) => {
    write(bumpPlay(read(), station, Date.now()));
  }, []);
  return { counts, bump };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/playCounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/playCounts.ts tests/playCounts.test.ts
git commit -m "feat: add persisted per-station play tally store"
```

---

## Task 4: Genre-affinity (taste) profile

**Files:**
- Create: `app/lib/taste.ts`
- Test: `tests/taste.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/taste.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeAffinity } from '../app/lib/taste';

const empty = { favorites: [], tracked: [], recent: [], playCounts: {} };

describe('computeAffinity', () => {
  it('returns empty scores and no top genres with no signals', () => {
    const a = computeAffinity(empty);
    expect(a.scores).toEqual({});
    expect(a.top).toEqual([]);
  });

  it('normalizes the strongest genre to 1', () => {
    const a = computeAffinity({ ...empty, favorites: [{ tags: ['pop'] }] });
    expect(a.scores.pop).toBe(1);
    expect(a.top).toEqual(['pop']);
  });

  it('weights favorites (x4) above recents (x1)', () => {
    const a = computeAffinity({
      ...empty,
      favorites: [{ tags: ['pop'] }],
      recent: [{ tags: ['rock'] }],
    });
    // pop raw=4, rock raw=1 → normalized pop=1, rock=0.25
    expect(a.scores.pop).toBe(1);
    expect(a.scores.rock).toBeCloseTo(0.25, 5);
    expect(a.top[0]).toBe('pop');
  });

  it('weights tracked (x2) between favorites and recents', () => {
    const a = computeAffinity({
      ...empty,
      favorites: [{ tags: ['a'] }],
      tracked: [{ tags: ['b'] }],
      recent: [{ tags: ['c'] }],
    });
    expect(a.bySource.favorites.a).toBe(4);
    expect(a.bySource.tracked.b).toBe(2);
    expect(a.bySource.recent.c).toBe(1);
  });

  it('uses play count as the play-weight multiplier', () => {
    const a = computeAffinity({
      ...empty,
      playCounts: { s1: { count: 5, tags: ['jazz'], lastAt: 0 } },
    });
    expect(a.bySource.play.jazz).toBe(5);
    expect(a.scores.jazz).toBe(1);
  });

  it('returns at most topN genres, highest first', () => {
    const a = computeAffinity({
      ...empty,
      favorites: [{ tags: ['a'] }, { tags: ['a'] }, { tags: ['b'] }, { tags: ['c'] }, { tags: ['d'] }],
    }, 2);
    expect(a.top).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/taste.test.ts`
Expected: FAIL — module `app/lib/taste` does not exist.

- [ ] **Step 3: Implement `app/lib/taste.ts`**

```ts
'use client';

import { useMemo } from 'react';
import type { Station } from './stations';
import { useFavorites } from './favorites';
import { useTracking } from './tracking';
import { useRecent } from './recent';
import { usePlayCounts } from './playCounts';
import type { PlayCounts } from './playCounts';

// The user's genre taste, blended from several signals. Favorites express the
// strongest intent, then tracked stations, then a play tally (weighted by how
// often each station was played), then the last-5 recents. Tags that appear
// across signals accumulate. Scores are normalized 0..1 against the top genre.

const W_FAVORITE = 4;
const W_TRACKED = 2;
const W_RECENT = 1;

type Tagged = { tags?: string[] };

export type Affinity = {
  /** genre → normalized score in 0..1 (blended across all sources) */
  scores: Record<string, number>;
  /** top genres by score, highest first */
  top: string[];
  /** raw (pre-normalization) weighted contributions, for debugging */
  bySource: {
    favorites: Record<string, number>;
    tracked: Record<string, number>;
    recent: Record<string, number>;
    play: Record<string, number>;
  };
};

function tally(items: Tagged[], weight: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    for (const tag of item.tags ?? []) out[tag] = (out[tag] ?? 0) + weight;
  }
  return out;
}

export function computeAffinity(
  input: {
    favorites: Tagged[];
    tracked: Tagged[];
    recent: Tagged[];
    playCounts: PlayCounts;
  },
  topN = 3,
): Affinity {
  const bySource = {
    favorites: tally(input.favorites, W_FAVORITE),
    tracked: tally(input.tracked, W_TRACKED),
    recent: tally(input.recent, W_RECENT),
    play: Object.values(input.playCounts).reduce<Record<string, number>>((acc, pc) => {
      for (const tag of pc.tags) acc[tag] = (acc[tag] ?? 0) + pc.count;
      return acc;
    }, {}),
  };

  const raw: Record<string, number> = {};
  for (const src of Object.values(bySource)) {
    for (const [tag, v] of Object.entries(src)) raw[tag] = (raw[tag] ?? 0) + v;
  }

  const max = Math.max(0, ...Object.values(raw));
  const scores: Record<string, number> = {};
  if (max > 0) {
    for (const [tag, v] of Object.entries(raw)) scores[tag] = v / max;
  }
  const top = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => tag);

  return { scores, top, bySource };
}

/** Live genre-affinity profile derived from the user's persisted signals. */
export function useGenreAffinity(topN = 3): Affinity {
  const { favorites } = useFavorites();
  const { tracked } = useTracking();
  const { recent } = useRecent();
  const { counts } = usePlayCounts();
  return useMemo(
    () => computeAffinity(
      { favorites: favorites as Station[], tracked, recent, playCounts: counts },
      topN,
    ),
    [favorites, tracked, recent, counts, topN],
  );
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/taste.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/taste.ts tests/taste.test.ts
git commit -m "feat: derive weighted genre-affinity profile from listening signals"
```

---

## Task 5: Popular request-path builder

**Files:**
- Create: `app/lib/popularPaths.ts`
- Test: `tests/popularPaths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/popularPaths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPopularPaths } from '../app/lib/popularPaths';

describe('buildPopularPaths', () => {
  it('global only when no region and no genres', () => {
    const paths = buildPopularPaths('', []);
    expect(paths).toEqual([
      '/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true',
    ]);
  });

  it('adds trending + fat regional anchor when a region is known', () => {
    const paths = buildPopularPaths('IL', []);
    expect(paths).toEqual([
      '/json/stations/search?countrycode=IL&order=clicktrend&reverse=true&limit=10&hidebroken=true',
      '/json/stations/bycountrycodeexact/IL?order=clickcount&reverse=true&limit=20&hidebroken=true',
      '/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true',
    ]);
  });

  it('prepends a per-genre regional search per genre when region + genres known', () => {
    const paths = buildPopularPaths('il', ['pop', 'rock']);
    expect(paths.slice(0, 2)).toEqual([
      '/json/stations/search?tag=pop&countrycode=IL&order=clickcount&reverse=true&limit=5&hidebroken=true',
      '/json/stations/search?tag=rock&countrycode=IL&order=clickcount&reverse=true&limit=5&hidebroken=true',
    ]);
    expect(paths).toHaveLength(5); // 2 genre + trending + regional anchor + global
  });

  it('ignores genres when no region is set (per-genre needs a country)', () => {
    expect(buildPopularPaths('', ['pop'])).toEqual([
      '/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true',
    ]);
  });

  it('url-encodes genre tags with spaces', () => {
    const paths = buildPopularPaths('US', ['hip hop']);
    expect(paths[0]).toContain('tag=hip%20hop');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/popularPaths.test.ts`
Expected: FAIL — module `app/lib/popularPaths` does not exist.

- [ ] **Step 3: Implement `app/lib/popularPaths.ts`**

```ts
// Builds the radio-browser request paths for the Popular candidate pool.
// Kept pure (no fetch) so it can be unit-tested without network or next/server.
//
// Order matters only as a fallback when scores tie; the client re-ranks the
// merged pool by genre affinity + popularity + region (see lib/popularRank.ts).
//
//   per-genre regional (personalization) → trending regional (live/cold-start
//   fill) → regional anchor (fat clickcount baseline) → global anchor.

export function buildPopularPaths(region: string, genres: string[]): string[] {
  const r = region.trim().toUpperCase();
  const paths: string[] = [];

  if (r && genres.length) {
    for (const g of genres) {
      paths.push(
        `/json/stations/search?tag=${encodeURIComponent(g)}&countrycode=${encodeURIComponent(r)}&order=clickcount&reverse=true&limit=5&hidebroken=true`,
      );
    }
  }

  if (r) {
    paths.push(
      `/json/stations/search?countrycode=${encodeURIComponent(r)}&order=clicktrend&reverse=true&limit=10&hidebroken=true`,
    );
    paths.push(
      `/json/stations/bycountrycodeexact/${encodeURIComponent(r)}?order=clickcount&reverse=true&limit=20&hidebroken=true`,
    );
  }

  paths.push('/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true');
  return paths;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/popularPaths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/popularPaths.ts tests/popularPaths.test.ts
git commit -m "feat: build genre-aware radio-browser paths for Popular pool"
```

---

## Task 6: Combined-score ranking for the Popular pool

**Files:**
- Create: `app/lib/popularRank.ts`
- Test: `tests/popularRank.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/popularRank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { genreAffinity, scorePopular } from '../app/lib/popularRank';
import type { Station } from '../app/lib/stations';

function station(over: Partial<Station> & { id: string }): Station {
  return {
    name: over.id, streamUrl: `http://x/${over.id}`, favicon: '',
    country: '', countrycode: 'IL', bitrate: 128, codec: 'MP3', ...over,
  };
}

describe('genreAffinity', () => {
  it('is the mean of the station tags scores; unmatched tags count as 0', () => {
    expect(genreAffinity(['pop', 'rock'], { pop: 1, rock: 0 })).toBeCloseTo(0.5, 5);
    expect(genreAffinity(['pop'], { pop: 0.8 })).toBeCloseTo(0.8, 5);
  });

  it('is 0 for a station with no tags or an empty profile', () => {
    expect(genreAffinity(undefined, { pop: 1 })).toBe(0);
    expect(genreAffinity(['pop'], {})).toBe(0);
  });
});

describe('scorePopular', () => {
  it('with an empty profile, orders by popularity (input order) then region', () => {
    const pool = [
      station({ id: 'global-top', countrycode: 'US' }),
      station({ id: 'il-second', countrycode: 'IL' }),
    ];
    const out = scorePopular(pool, { region: 'IL', affinity: {} });
    // il-second gets the region boost (4) which outweighs the 1-slot popularity
    // gap, so it ranks first; verifies regional-first cold-start behavior.
    expect(out.map(s => s.id)).toEqual(['il-second', 'global-top']);
  });

  it('promotes a strong genre match above a more popular non-match', () => {
    const pool = [
      station({ id: 'popular-talk', tags: ['talk'] }),
      station({ id: 'my-genre', tags: ['pop'] }),
    ];
    const out = scorePopular(pool, { region: 'IL', affinity: { pop: 1 } });
    expect(out[0].id).toBe('my-genre');
  });

  it('does not drop any stations (unlike search ranking)', () => {
    const pool = [station({ id: 'a' }), station({ id: 'b' }), station({ id: 'c' })];
    expect(scorePopular(pool, { region: null, affinity: {} })).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/popularRank.test.ts`
Expected: FAIL — module `app/lib/popularRank` does not exist.

- [ ] **Step 3: Implement `app/lib/popularRank.ts`**

```ts
import type { Station } from './stations';

// Re-ranks the Popular candidate pool. The pool arrives in popularity order
// (the route sorts by radio-browser clickcount desc), so the index is a
// popularity proxy — same convention as lib/rank.ts. Unlike search ranking,
// NOTHING is dropped: every candidate is just reordered.
//
// A perfect genre match (affinity 1) outweighs the popularity and region terms
// combined, so taste dominates; with an empty profile the genre term is 0 and
// ordering falls back to popularity + region (the cold-start path).

const W_GENRE = 10;
const W_POPULARITY = 5;
const W_REGION = 4;

export type PopularRankContext = {
  region: string | null;
  affinity: Record<string, number>; // genre → 0..1, from lib/taste.ts
};

/** Mean of the affinity scores for a station's tags (unmatched tags = 0). */
export function genreAffinity(
  tags: string[] | undefined,
  affinity: Record<string, number>,
): number {
  if (!tags || tags.length === 0) return 0;
  let sum = 0;
  for (const t of tags) sum += affinity[t] ?? 0;
  return sum / tags.length;
}

export function scorePopular(stations: Station[], ctx: PopularRankContext): Station[] {
  const n = stations.length;
  return stations
    .map((s, i) => {
      const genre = genreAffinity(s.tags, ctx.affinity);
      const popularity = n > 1 ? (n - i) / n : 1;
      const region = ctx.region && s.countrycode === ctx.region ? 1 : 0;
      const score = genre * W_GENRE + popularity * W_POPULARITY + region * W_REGION;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.s);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/popularRank.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/popularRank.ts tests/popularRank.test.ts
git commit -m "feat: combined-score ranking for the Popular pool"
```

---

## Task 7: Wire the Popular API route to genres + a wider pool

**Files:**
- Modify: `app/api/popular/route.ts`

No unit test (the handler calls `fetchRadioBrowser` over the network; the path logic is covered by Task 5). Verified by `npm run build` and the preview workflow in Task 11.

- [ ] **Step 1: Replace `app/api/popular/route.ts` with the genre-aware version**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchRadioBrowser } from '@/app/lib/radioBrowser';
import { normalizeStation } from '@/app/lib/stations';
import { dedupeStations } from '@/app/lib/dedupe';
import { buildPopularPaths } from '@/app/lib/popularPaths';

type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000; // 5 minutes — popularity rankings don't change fast

type RawStation = Parameters<typeof normalizeStation>[0] & {
  stationuuid: string;
  clickcount?: number;
};

// Up to 3 genres; lowercased, trimmed, deduped. More than 3 just adds upstream
// calls for diminishing personalization.
function parseGenres(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const g = part.trim().toLowerCase();
    if (g) seen.add(g);
  }
  return [...seen].slice(0, 3);
}

async function fetchBatch(path: string): Promise<RawStation[]> {
  try {
    const data = await fetchRadioBrowser(path);
    return Array.isArray(data) ? (data as RawStation[]) : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const region = (req.nextUrl.searchParams.get('region') ?? '').trim().toUpperCase();
  const genres = parseGenres(req.nextUrl.searchParams.get('genres'));

  const cacheKey = `${region}::${genres.join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const paths = buildPopularPaths(region, genres);
  const batches = await Promise.all(paths.map(fetchBatch));
  if (batches.every(b => b.length === 0)) {
    return NextResponse.json([], { status: 502 });
  }

  // Merge + dedupe by stationuuid, then sort by clickcount desc so the client
  // can use list position as a popularity proxy when re-ranking.
  const seen = new Set<string>();
  const merged: RawStation[] = [];
  for (const batch of batches) {
    for (const r of batch) {
      if (r?.stationuuid && !seen.has(r.stationuuid)) {
        seen.add(r.stationuuid);
        merged.push(r);
      }
    }
  }
  merged.sort((a, b) => (b.clickcount ?? 0) - (a.clickcount ?? 0));

  // Return a WIDE pool (~40) — the client re-ranks and trims to what it shows,
  // so it needs room to promote genre matches that aren't top-clickcount.
  const stations = dedupeStations(
    merged.map(normalizeStation).filter(s => s.streamUrl && s.name),
  ).slice(0, 40);

  cache.set(cacheKey, { at: Date.now(), data: stations });
  return NextResponse.json(stations);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no errors for `app/api/popular/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/api/popular/route.ts
git commit -m "feat: genre-aware Popular endpoint with a wider clickcount-sorted pool"
```

---

## Task 8: Re-rank the Popular list live on the client

**Files:**
- Modify: `app/components/Recommended.tsx`

No unit test (React component; node test env has no DOM). Verified in Task 11.

- [ ] **Step 1: Replace `app/components/Recommended.tsx` with the personalized version**

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { useRegion, useRegionFilter } from '@/app/lib/region';
import { useHiddenFilter } from '@/app/lib/hidden';
import { useGenreAffinity } from '@/app/lib/taste';
import { scorePopular } from '@/app/lib/popularRank';
import { StationRow } from './StationRow';
import { CollapsibleSection } from './CollapsibleSection';

type Props = {
  onSelect: (s: Station) => void;
};

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 mb-1">
      <div className="shimmer w-10 h-10 rounded-[10px]" />
      <div className="flex-1">
        <div className="shimmer h-3.5 w-3/5 mb-1.5" />
        <div className="shimmer h-2.5 w-2/5" />
      </div>
    </div>
  );
}

export function Recommended({ onSelect }: Props) {
  // The raw candidate pool from the API (≈40), pre-ranking.
  const [pool, setPool] = useState<Station[] | null>(null);
  const [errored, setErrored] = useState(false);
  const { isFavorite, toggle } = useFavorites();
  const { region } = useRegion();
  const filterByRegion = useRegionFilter();
  const filterHidden = useHiddenFilter();
  const { scores, top } = useGenreAffinity();

  // Refetch when the region or our top genres change. A string key keeps the
  // dependency stable (arrays change identity every render).
  const genresKey = top.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (region) params.set('region', region);
        if (genresKey) params.set('genres', genresKey);
        const qs = params.toString();
        const res = await fetch(qs ? `/api/popular?${qs}` : '/api/popular');
        if (!res.ok) { if (!cancelled) setErrored(true); return; }
        const data = (await res.json()) as unknown;
        if (!cancelled) setPool(Array.isArray(data) ? (data as Station[]) : []);
      } catch {
        if (!cancelled) setErrored(true);
      }
    })();
    return () => { cancelled = true; };
  }, [region, genresKey]);

  // Filter, then re-rank live by genre affinity + popularity + region, then drop
  // favorites (they have their own section). Re-runs every render, so the order
  // updates instantly as you star/play a station — no refetch.
  const filtered = filterHidden(filterByRegion(pool ?? []));
  const ranked = scorePopular(filtered, { region: region || null, affinity: scores });
  const shown = ranked.filter(s => !isFavorite(s.id));

  return (
    <CollapsibleSection title="✦ Popular">
      {pool === null && !errored && (
        <>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </>
      )}
      {errored && (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">
          Couldn&apos;t load popular stations.
        </div>
      )}
      {pool !== null && !errored && shown.length === 0 && (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">
          No popular stations in this region.
        </div>
      )}
      {shown.slice(0, 15).map(s => (
        <StationRow
          key={s.id}
          station={s}
          isActive={false}
          isFavorite={isFavorite(s.id)}
          onSelect={() => onSelect(s)}
          onToggleFavorite={() => toggle(s)}
        />
      ))}
    </CollapsibleSection>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run lint`
Expected: no errors for `app/components/Recommended.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/components/Recommended.tsx
git commit -m "feat: personalize Popular list via live client-side genre re-rank"
```

---

## Task 9: Record plays in the page selection handler

**Files:**
- Modify: `app/page.tsx`

No unit test. Verified in Task 11.

- [ ] **Step 1: Import the play-counts hook**

In `app/page.tsx`, add the import next to the existing `useRecent` import (line ~5):

```tsx
import { usePlayCounts } from './lib/playCounts';
```

- [ ] **Step 2: Use the hook next to `useRecent`**

After the existing `const { recent, add: addRecent } = useRecent();` (line ~35), add:

```tsx
  const { bump: bumpPlay } = usePlayCounts();
```

- [ ] **Step 3: Bump the tally in `handleSelect`**

In `handleSelect`, after `addRecent(s);` (line ~86), add the bump, and add `bumpPlay` to the dependency array:

```tsx
    addRecent(s);
    bumpPlay(s);
  }, [addRecent, bumpPlay, currentStation]);
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: no errors for `app/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: record station plays into the genre play tally"
```

---

## Task 10: Dev-only "Taste" block in the debug panel

**Files:**
- Modify: `app/components/DebugPanel.tsx`

No unit test. The panel only renders when `isDev` (NODE_ENV=development or Electron) AND the `radio:showDebug` toggle is on — gating already exists in `SettingsDialog.tsx`. Verified in Task 11.

- [ ] **Step 1: Add imports**

In `app/components/DebugPanel.tsx`, after the existing `useRecent` import (line ~8), add:

```tsx
import { useGenreAffinity } from '@/app/lib/taste';
import { usePlayCounts } from '@/app/lib/playCounts';
```

- [ ] **Step 2: Read the taste data in the component**

Inside `DebugPanel(...)`, after `const { recent } = useRecent();` (line ~36), add:

```tsx
  const { scores, top, bySource } = useGenreAffinity();
  const { counts } = usePlayCounts();

  const topGenres = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const playEntries = Object.entries(counts)
    .sort((a, b) => b[1].count - a[1].count);
  const sourceLabel = (src: Record<string, number>) => {
    const ks = Object.keys(src);
    return ks.length ? `${ks.length} genre${ks.length === 1 ? '' : 's'}` : '—';
  };
```

- [ ] **Step 3: Render the Taste rows**

In the returned JSX, add these rows after the existing `<Row label="Recent">{recent.length}</Row>` (line ~101), before the closing `</div>`s:

```tsx
        <div className="mt-1 pt-1 border-t border-[var(--color-line)]" />
        <Row label="Top genres">
          {topGenres.length
            ? topGenres.map(([g, v]) => `${g} ${v.toFixed(2)}`).join(' · ')
            : '—'}
        </Row>
        <Row label="Sent genres">{top.join(',') || '—'}</Row>
        <Row label="By source">
          fav {sourceLabel(bySource.favorites)} · trk {sourceLabel(bySource.tracked)} · rec {sourceLabel(bySource.recent)} · play {sourceLabel(bySource.play)}
        </Row>
        <Row label="Play tally">
          {playEntries.length
            ? `${playEntries.length} stations · top ${playEntries.slice(0, 3).map(([, p]) => p.count).join('/')}`
            : '—'}
        </Row>
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: no errors for `app/components/DebugPanel.tsx`.

- [ ] **Step 5: Commit**

```bash
git add app/components/DebugPanel.tsx
git commit -m "feat: dev-only Taste readout in the debug panel"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the 5 new/extended suites (stations, dedupe, playCounts, taste, popularPaths, popularRank).

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: lint clean; production build succeeds.

- [ ] **Step 3: Manual preview check (use the preview_* workflow)**

1. `preview_start` (or reuse a running server).
2. Set region to Israel via the region picker (or confirm auto-detected IL).
3. `preview_snapshot` the sidebar — confirm the ✦ Popular section is **populated** (more than 2–3 rows), even before favoriting anything (trending + fat regional anchor at work).
4. `preview_console_logs` / `preview_network` — confirm `GET /api/popular?region=IL...` returns a 200 with a list (no 502).
5. Favorite/play a couple of stations of one genre, then `preview_snapshot` again — confirm the Popular order shifts toward that genre (live re-rank, no reload).
6. Open Settings; if running in dev/Electron, enable the Debug toggle and `preview_snapshot` the Debug panel — confirm the Taste block shows top genres, sent genres, by-source counts, and play tally.
7. `preview_screenshot` the populated Popular section as proof.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verification fixups for personalized Popular"
```

---

## Self-Review (completed during planning)

- **Spec coverage:**
  - Genre data on stations → Task 1 (`tags` parse) + Task 2 (union on dedupe). ✓
  - Weighted taste profile (fav ×4, tracked ×2, play ×count, recent ×1) → Task 4. ✓
  - Persisted play tally via DB write-through → Task 3 (uses `persistSet`). ✓
  - Hybrid fetch (per-genre regional + trending + fat anchor + global) → Task 5 (`buildPopularPaths`) + Task 7 (route, clickcount sort, ~40 pool). ✓
  - Live client re-rank (genre + popularity + region) → Task 6 (`scorePopular`) + Task 8 (Recommended). ✓
  - Cold start (empty profile → popularity+region, fuller via trending/fat anchor) → covered by Task 5/6/7 (genre term 0; regional paths fire regardless of genres) and asserted in `tests/popularRank.test.ts`. ✓
  - Dev-only debug readout (existing gating, no console logging) → Task 10. ✓
  - Persistence answer (DB, not localStorage-only) → Task 3 uses the same `persistSet` path as favorites. ✓
- **Placeholder scan:** none — every code step has complete code; every command has expected output.
- **Type consistency:** `Station.tags?: string[]` (Task 1) consumed by `dedupe` (Task 2), `taste`/`computeAffinity` (Task 4), `popularRank`/`genreAffinity`/`scorePopular` (Task 6), and `Recommended` (Task 8). `PlayCounts`/`bumpPlay`/`parsePlayCounts` (Task 3) consumed by `taste` and `DebugPanel`. `buildPopularPaths(region, genres)` (Task 5) consumed by the route (Task 7). `Affinity.{scores,top,bySource}` (Task 4) consumed by `Recommended` (`scores`,`top`) and `DebugPanel` (`scores`,`top`,`bySource`). Hook names: `usePlayCounts().bump`, `useGenreAffinity()` — used consistently across Tasks 8/9/10. ✓
