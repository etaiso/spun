# Radio + Now-Playing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-page Next.js 16 app that lets the user search internet radio stations, mark favorites, play one in the browser, and see the currently-playing track + a session history — all driven by in-band ICY metadata. Local-only POC.

**Architecture:** App Router. Browser plays the stream via `<audio>`; a route handler opens its own connection to read interleaved `StreamTitle` bytes and pushes track changes to the client over Server-Sent Events. Favorites live in `localStorage`. No fingerprinting (deferred). Visual direction: warm-editorial.

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), Tailwind v4, Vitest (added in Task 1).

**Spec:** [docs/superpowers/specs/2026-06-02-radio-shazam-design.md](docs/superpowers/specs/2026-06-02-radio-shazam-design.md)

---

> ⚠️ **Next.js 16 note (from AGENTS.md):** This is NOT the Next.js you know. Before writing route handlers (Tasks 9, 10) or making other framework choices, skim the relevant pages under `node_modules/next/dist/docs/`. The streaming-response and route-handler APIs may differ from older guides.

---

## File map

**Created:**
- `vitest.config.ts` — test runner config
- `app/lib/stations.ts` — `Station` type + `normalizeStation()`
- `app/lib/colors.ts` — deterministic gradient picker by name
- `app/lib/nonTrack.ts` — "between tracks" detection
- `app/lib/icy.ts` — pure ICY metadata parser (async generator)
- `app/lib/favorites.ts` — `useFavorites()` hook over `localStorage`
- `app/api/search/route.ts` — radio-browser search proxy + 60s cache
- `app/api/now-playing/route.ts` — SSE endpoint, drives the ICY parser
- `app/components/StationLogo.tsx` — favicon with letter-chip fallback
- `app/components/StationRow.tsx` — one row, used by Favorites + Search
- `app/components/FavoritesList.tsx` — favorites section in sidebar
- `app/components/StationSearch.tsx` — debounced search input + results
- `app/components/Sidebar.tsx` — composes Favorites + Search
- `app/components/Player.tsx` — `<audio>` + play/pause/volume, reports `playState`
- `app/components/NowPlaying.tsx` — EventSource consumer + all 6 visual states
- `tests/icy.test.ts`, `tests/nonTrack.test.ts`, `tests/colors.test.ts`, `tests/stations.test.ts`

**Modified:**
- `package.json` — add `vitest` + `test` script
- `app/globals.css` — replace boilerplate with warm palette tokens
- `app/layout.tsx` — drop Geist fonts + dark-mode classes
- `app/page.tsx` — replace boilerplate with the app shell

---

## Task 1: Set up Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest @vitest/ui
```

- [ ] **Step 2: Add test script to `package.json`**

In `package.json` under `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create a smoke test at `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

```bash
npm test
```
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "test: add vitest"
```

---

## Task 2: Strip boilerplate, apply warm palette

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/globals.css` entirely**

```css
@import "tailwindcss";

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
}

@theme inline {
  --color-bg: var(--color-bg);
  --color-bg-2: var(--color-bg-2);
  --color-ink: var(--color-ink);
  --color-ink-2: var(--color-ink-2);
  --color-ink-3: var(--color-ink-3);
  --color-ink-4: var(--color-ink-4);
  --color-line: var(--color-line);
  --color-accent: var(--color-accent);
  --color-accent-2: var(--color-accent-2);
  --color-warm: var(--color-warm);
}

html, body { background: var(--color-bg); color: var(--color-ink); }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

@keyframes pulse-soft { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes bounce-dot { 0%,60%,100% { transform: translateY(0); opacity: 0.3; } 30% { transform: translateY(-4px); opacity: 1; } }

.shimmer {
  background: linear-gradient(90deg, var(--color-line) 0%, #f5ede5 50%, var(--color-line) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.6s ease-in-out infinite;
  border-radius: 6px;
}
.pulse-soft { animation: pulse-soft 1.8s ease-in-out infinite; }
.spin-warm {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid var(--color-line); border-top-color: var(--color-warm);
  border-radius: 50%; animation: spin 0.8s linear infinite;
}
.dots span {
  display: inline-block; width: 5px; height: 5px; border-radius: 50%;
  background: var(--color-warm); margin: 0 1px; animation: bounce-dot 1.2s ease-in-out infinite;
}
.dots span:nth-child(2) { animation-delay: 0.15s; }
.dots span:nth-child(3) { animation-delay: 0.3s; }
```

- [ ] **Step 2: Replace `app/layout.tsx` entirely**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radio",
  description: "Live internet radio with now-playing info",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Replace `app/page.tsx` with a minimal placeholder shell**

```tsx
export default function Home() {
  return (
    <main className="min-h-screen p-10">
      <h1 className="text-2xl font-bold">Radio — building…</h1>
    </main>
  );
}
```

- [ ] **Step 4: Verify the dev server starts**

```bash
npm run dev
```
Expected: starts on http://localhost:3000 with "Radio — building…" on a warm off-white background. Stop with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx app/page.tsx
git commit -m "chore: strip boilerplate, apply warm palette tokens"
```

---

## Task 3: Station type + normalizer (TDD)

**Files:**
- Create: `app/lib/stations.ts`
- Create: `tests/stations.test.ts`

- [ ] **Step 1: Write the failing test at `tests/stations.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { normalizeStation } from '../app/lib/stations';

describe('normalizeStation', () => {
  it('maps radio-browser fields to our Station shape', () => {
    const raw = {
      stationuuid: 'abc-123',
      name: '  KEXP  ',
      url_resolved: 'https://kexp.example/stream',
      url: 'http://kexp.example/playlist.pls',
      favicon: 'https://kexp.example/logo.png',
      country: 'United States',
      bitrate: 128,
      codec: 'MP3',
    };
    expect(normalizeStation(raw)).toEqual({
      id: 'abc-123',
      name: 'KEXP',
      streamUrl: 'https://kexp.example/stream',
      favicon: 'https://kexp.example/logo.png',
      country: 'United States',
      bitrate: 128,
      codec: 'MP3',
    });
  });

  it('falls back to url when url_resolved is empty', () => {
    const raw = {
      stationuuid: 'x',
      name: 'X',
      url_resolved: '',
      url: 'http://fallback/stream',
      favicon: '',
      country: '',
      bitrate: 0,
      codec: '',
    };
    expect(normalizeStation(raw).streamUrl).toBe('http://fallback/stream');
  });
});
```

- [ ] **Step 2: Run it**

```bash
npm test
```
Expected: FAIL — `Cannot find module '../app/lib/stations'`.

- [ ] **Step 3: Create `app/lib/stations.ts`**

```ts
export type Station = {
  id: string;
  name: string;
  streamUrl: string;
  favicon: string;
  country: string;
  bitrate: number;
  codec: string;
};

type RawStation = {
  stationuuid: string;
  name: string;
  url_resolved: string;
  url: string;
  favicon: string;
  country: string;
  bitrate: number;
  codec: string;
};

export function normalizeStation(raw: RawStation): Station {
  return {
    id: raw.stationuuid,
    name: raw.name.trim(),
    streamUrl: raw.url_resolved || raw.url,
    favicon: raw.favicon,
    country: raw.country,
    bitrate: raw.bitrate,
    codec: raw.codec,
  };
}
```

- [ ] **Step 4: Run tests again**

```bash
npm test
```
Expected: 3 passed (smoke + 2 stations).

- [ ] **Step 5: Commit**

```bash
git add app/lib/stations.ts tests/stations.test.ts
git commit -m "feat(lib): Station type + radio-browser normalizer"
```

---

## Task 4: Deterministic color chip (TDD)

**Files:**
- Create: `app/lib/colors.ts`
- Create: `tests/colors.test.ts`

- [ ] **Step 1: Write failing tests at `tests/colors.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { gradientForName } from '../app/lib/colors';

describe('gradientForName', () => {
  it('returns the same gradient for the same name', () => {
    expect(gradientForName('KEXP')).toBe(gradientForName('KEXP'));
  });

  it('returns CSS linear-gradient strings', () => {
    const g = gradientForName('KEXP');
    expect(g).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  });

  it('handles empty string without crashing', () => {
    expect(typeof gradientForName('')).toBe('string');
  });
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/lib/colors.ts`**

```ts
const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#c0392b', '#7a1f15'],
  ['#2c5aa0', '#1a3866'],
  ['#d35400', '#8e3500'],
  ['#d2691e', '#8b3a0f'],
  ['#6b3410', '#3d1d09'],
  ['#1e6650', '#0e3a2c'],
  ['#7a3a8c', '#48214f'],
  ['#a85a2c', '#5f3217'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function gradientForName(name: string): string {
  const [a, b] = PALETTE[hash(name) % PALETTE.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
```

- [ ] **Step 4: Run tests**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/colors.ts tests/colors.test.ts
git commit -m "feat(lib): deterministic station-chip gradient"
```

---

## Task 5: Non-track detector (TDD)

**Files:**
- Create: `app/lib/nonTrack.ts`
- Create: `tests/nonTrack.test.ts`

- [ ] **Step 1: Write failing tests at `tests/nonTrack.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isNonTrack } from '../app/lib/nonTrack';

describe('isNonTrack', () => {
  it('flags empty title', () => {
    expect(isNonTrack('', 'Jazz FM')).toBe(true);
    expect(isNonTrack('   ', 'Jazz FM')).toBe(true);
  });

  it('flags title equal to station name (case-insensitive)', () => {
    expect(isNonTrack('Jazz FM', 'Jazz FM')).toBe(true);
    expect(isNonTrack('JAZZ FM', 'jazz fm')).toBe(true);
  });

  it('flags short title without a dash separator', () => {
    expect(isNonTrack('ID', 'Jazz FM')).toBe(true);
    expect(isNonTrack('AD', 'Jazz FM')).toBe(true);
  });

  it('does NOT flag normal track titles', () => {
    expect(isNonTrack('Miles Davis - So What', 'Jazz FM')).toBe(false);
    expect(isNonTrack('Coltrane — Naima', 'Jazz FM')).toBe(false);
  });

  it('does NOT flag a longer title even without a dash', () => {
    expect(isNonTrack('Loose Ends Loose Ends', 'Jazz FM')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — module not found.

- [ ] **Step 3: Create `app/lib/nonTrack.ts`**

```ts
export function isNonTrack(title: string, stationName: string): boolean {
  const t = title.trim();
  if (t === '') return true;
  if (t.toLowerCase() === stationName.trim().toLowerCase()) return true;
  if (!t.includes('-') && !t.includes('—') && t.length < 4) return true;
  return false;
}
```

- [ ] **Step 4: Run tests**

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/nonTrack.ts tests/nonTrack.test.ts
git commit -m "feat(lib): between-tracks/station-id detection"
```

---

## Task 6: ICY parser — happy path (TDD)

**Files:**
- Create: `app/lib/icy.ts`
- Create: `tests/icy.test.ts`

**Background:** ICY response body alternates `[metaInt audio bytes][1 byte L][L*16 metadata bytes]`. Metadata is ASCII like `StreamTitle='Artist - Title';StreamUrl='...';\0\0\0\0` (null-padded to a 16-byte multiple). `L=0` means "no change since last block." See [the spec](../specs/2026-06-02-radio-shazam-design.md#icy-metadata-protocol-implementation-reference).

- [ ] **Step 1: Write a test helper inline + the first three tests at `tests/icy.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { parseIcy } from '../app/lib/icy';

// Helpers to build ICY-format buffers for tests.
function buildMetadataBlock(payload: string): Uint8Array {
  const bytes = new TextEncoder().encode(payload);
  // round up to multiple of 16
  const padded = Math.ceil(bytes.length / 16) * 16;
  const out = new Uint8Array(1 + padded);
  out[0] = padded / 16;
  out.set(bytes, 1);
  // remaining bytes are 0 (null-padded), which is what we want
  return out;
}

function buildEmptyMetaMarker(): Uint8Array {
  return new Uint8Array([0]); // L=0 → no metadata
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('parseIcy — happy path', () => {
  it('yields a title from a single well-formed block', async () => {
    const metaInt = 4;
    const audio = new Uint8Array(metaInt); // 4 bytes of "audio"
    const meta = buildMetadataBlock("StreamTitle='Miles Davis - So What';");
    const stream = streamFromChunks([audio, meta]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Miles Davis - So What' }]);
  });

  it('emits twice when the title changes between blocks', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='A - one';"),
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='B - two';"),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'A - one' }, { title: 'B - two' }]);
  });

  it('dedupes consecutive identical titles', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='Same - song';"),
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='Same - song';"),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Same - song' }]);
  });

  it('reassembles data split across multiple chunks mid-metadata', async () => {
    const metaInt = 4;
    const audio = new Uint8Array(metaInt);
    const meta = buildMetadataBlock("StreamTitle='Split - test';");
    // split the metadata block in half
    const half = Math.floor(meta.length / 2);
    const stream = streamFromChunks([audio, meta.slice(0, half), meta.slice(half)]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Split - test' }]);
  });
});
```

- [ ] **Step 2: Run it**

Expected: FAIL — `parseIcy` not defined.

- [ ] **Step 3: Implement `app/lib/icy.ts`**

```ts
export type IcyEvent = { title: string };

const decoder = new TextDecoder('utf-8', { fatal: false });

function extractTitle(payload: Uint8Array): string | null {
  // Strip trailing null padding before decoding.
  let end = payload.length;
  while (end > 0 && payload[end - 1] === 0) end--;
  const text = decoder.decode(payload.subarray(0, end));
  const match = text.match(/StreamTitle='((?:[^']|\\')*)'/);
  return match ? match[1] : null;
}

export async function* parseIcy(
  stream: ReadableStream<Uint8Array>,
  metaInt: number,
): AsyncGenerator<IcyEvent> {
  const reader = stream.getReader();
  const buf: number[] = [];
  let mode: 'audio' | 'len' | 'meta' = 'audio';
  let need = metaInt;
  let metaLen = 0;
  let lastTitle: string | null = null;

  function take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = buf[i];
    buf.splice(0, n);
    return out;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    for (let i = 0; i < value.length; i++) buf.push(value[i]);

    while (true) {
      if (mode === 'audio') {
        if (buf.length < need) break;
        buf.splice(0, need);
        mode = 'len';
        need = 1;
      } else if (mode === 'len') {
        if (buf.length < 1) break;
        const lenByte = take(1)[0];
        metaLen = lenByte * 16;
        if (metaLen === 0) {
          mode = 'audio';
          need = metaInt;
        } else {
          mode = 'meta';
          need = metaLen;
        }
      } else {
        // mode === 'meta'
        if (buf.length < need) break;
        const payload = take(need);
        const title = extractTitle(payload);
        if (title !== null && title !== lastTitle) {
          lastTitle = title;
          yield { title };
        }
        mode = 'audio';
        need = metaInt;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: all happy-path icy tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/icy.ts tests/icy.test.ts
git commit -m "feat(lib): ICY metadata parser (happy path)"
```

---

## Task 7: ICY parser — edge cases (TDD)

**Files:**
- Modify: `tests/icy.test.ts`

- [ ] **Step 1: Append new tests to `tests/icy.test.ts`**

Add these three `describe` blocks after the existing one (same helpers `buildMetadataBlock`, `streamFromChunks`, `collect` are already in the file):

```ts
describe('parseIcy — edge cases', () => {
  it('emits nothing for an L=0 (no-change) marker', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      new Uint8Array([0]),         // L=0 → no metadata payload
      new Uint8Array(metaInt),
      new Uint8Array([0]),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([]);
  });

  it('parses a UTF-8 title with non-ASCII characters', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='Beyoncé - Déjà Vu';"),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Beyoncé - Déjà Vu' }]);
  });

  it('emits nothing and does not throw on malformed metadata', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock('garbage with no StreamTitle field'),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: all icy tests pass (no implementation change needed — the existing parser already handles these).

- [ ] **Step 3: Commit**

```bash
git add tests/icy.test.ts
git commit -m "test(lib): icy parser edge cases (L=0, utf-8, malformed)"
```

---

## Task 8: Favorites store hook

**Files:**
- Create: `app/lib/favorites.ts`

No unit tests for this — it's a localStorage-backed React hook. Manual verification happens during component wiring.

- [ ] **Step 1: Create `app/lib/favorites.ts`**

```ts
'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Station } from './stations';

const KEY = 'radio:favorites';

function read(): Station[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Station[]) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function emit() { for (const cb of listeners) cb(); }

function write(next: Station[]) {
  window.localStorage.setItem(KEY, JSON.stringify(next));
  emit();
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, read, () => []);

  const isFavorite = useCallback(
    (id: string) => favorites.some(s => s.id === id),
    [favorites],
  );

  const toggle = useCallback((station: Station) => {
    const current = read();
    const next = current.some(s => s.id === station.id)
      ? current.filter(s => s.id !== station.id)
      : [...current, station];
    write(next);
  }, []);

  return { favorites, isFavorite, toggle };
}
```

- [ ] **Step 2: Commit**

```bash
git add app/lib/favorites.ts
git commit -m "feat(lib): useFavorites hook over localStorage"
```

---

## Task 9: Search route handler

**Files:**
- Create: `app/api/search/route.ts`

> Skim `node_modules/next/dist/docs/` for the App Router route-handler conventions before writing this if you're unsure of the current 16.x signature.

- [ ] **Step 1: Create `app/api/search/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { normalizeStation } from '@/app/lib/stations';

const UA = 'TripPlannerRadioPOC/0.1 (etai87@gmail.com)'; // radio-browser requires a User-Agent

let mirrorPromise: Promise<string> | null = null;
async function getMirror(): Promise<string> {
  if (!mirrorPromise) {
    mirrorPromise = (async () => {
      const res = await fetch('https://all.api.radio-browser.info/json/servers', {
        headers: { 'User-Agent': UA },
      });
      const servers = (await res.json()) as Array<{ name: string }>;
      if (!servers.length) throw new Error('no radio-browser mirrors available');
      // pick the first one; spec accepts this for MVP
      return `https://${servers[0].name}`;
    })();
    mirrorPromise.catch(() => { mirrorPromise = null; }); // allow retry on next request
  }
  return mirrorPromise;
}

type CacheEntry = { at: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;
const MAX_ENTRIES = 50;

function getCached(key: string): unknown | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) { cache.delete(key); return null; }
  return e.data;
}
function setCached(key: string, data: unknown) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q === '') return NextResponse.json([]);

  const cached = getCached(q);
  if (cached) return NextResponse.json(cached);

  const mirror = await getMirror();
  const url = `${mirror}/json/stations/search?name=${encodeURIComponent(q)}&limit=20&hidebroken=true&order=clickcount&reverse=true`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return NextResponse.json([], { status: 502 });

  const raw = (await res.json()) as Parameters<typeof normalizeStation>[0][];
  const stations = raw.map(normalizeStation).filter(s => s.streamUrl);
  setCached(q, stations);
  return NextResponse.json(stations);
}
```

- [ ] **Step 2: Smoke test it manually**

```bash
npm run dev
```
In a separate terminal:

```bash
curl -s 'http://localhost:3000/api/search?q=kexp' | head -c 500
```
Expected: JSON array of station objects, KEXP near the top, fields `id`/`name`/`streamUrl`/`favicon`/`country`/`bitrate`/`codec`. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/search/route.ts
git commit -m "feat(api): /api/search proxies radio-browser with 60s cache"
```

---

## Task 10: Now-playing SSE route handler

**Files:**
- Create: `app/api/now-playing/route.ts`

> Re-skim Next 16 docs for streaming responses if needed: `node_modules/next/dist/docs/`. The pattern below uses a `ReadableStream` body on a plain `Response` — standard but verify nothing is deprecated.

- [ ] **Step 1: Create `app/api/now-playing/route.ts`**

```ts
import { NextRequest } from 'next/server';
import { parseIcy } from '@/app/lib/icy';

const UA = 'TripPlannerRadioPOC/0.1 (etai87@gmail.com)';

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return new Response('missing url', { status: 400 });

  let streamUrl: URL;
  try {
    streamUrl = new URL(raw);
  } catch {
    return new Response('invalid url', { status: 400 });
  }
  if (streamUrl.protocol !== 'http:' && streamUrl.protocol !== 'https:') {
    return new Response('unsupported protocol', { status: 400 });
  }

  const upstreamController = new AbortController();
  req.signal.addEventListener('abort', () => upstreamController.abort());

  let upstream: Response;
  try {
    upstream = await fetch(streamUrl, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': UA },
      signal: upstreamController.signal,
    });
  } catch (e) {
    return new Response(sseLine({ type: 'error', message: String(e) }), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const metaIntHeader = upstream.headers.get('icy-metaint');
  const metaInt = metaIntHeader ? parseInt(metaIntHeader, 10) : NaN;

  const encoder = new TextEncoder();

  if (!metaInt || !upstream.body) {
    upstreamController.abort();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(sseLine({ type: 'no-metadata' })));
        c.close();
      },
    });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const keepalive = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch {}
      }, 15_000);

      try {
        for await (const event of parseIcy(upstream.body!, metaInt)) {
          controller.enqueue(encoder.encode(sseLine({ type: 'track', title: event.title })));
        }
      } catch (e) {
        try {
          controller.enqueue(encoder.encode(sseLine({ type: 'error', message: String(e) })));
        } catch {}
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch {}
        upstreamController.abort();
      }
    },
    cancel() {
      upstreamController.abort();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: Smoke test it manually**

```bash
npm run dev
```
In a separate terminal, get a known-good streaming URL via the search route, then point curl at SSE:

```bash
STREAM=$(curl -s 'http://localhost:3000/api/search?q=kexp' | node -e 'process.stdin.on("data",d=>{const a=JSON.parse(d);console.log(a[0].streamUrl)})')
echo "Stream: $STREAM"
curl -s -N "http://localhost:3000/api/now-playing?url=$(node -e "console.log(encodeURIComponent('$STREAM'))")" | head -c 400
```
Expected: within ~30 s you should see at least one `data: {"type":"track","title":"…"}` line. Ctrl-C to stop, then stop dev server.

- [ ] **Step 3: Commit**

```bash
git add app/api/now-playing/route.ts
git commit -m "feat(api): /api/now-playing SSE driven by ICY parser"
```

---

## Task 11: StationLogo component

**Files:**
- Create: `app/components/StationLogo.tsx`

- [ ] **Step 1: Create `app/components/StationLogo.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { gradientForName } from '@/app/lib/colors';

type Props = { name: string; favicon: string; size?: number };

export function StationLogo({ name, favicon, size = 40 }: Props) {
  const [failed, setFailed] = useState(false);
  const letter = (name.trim()[0] ?? '?').toUpperCase();

  if (!favicon || failed) {
    return (
      <div
        className="flex items-center justify-center rounded-[10px] text-white font-extrabold shadow-[0_3px_8px_rgba(0,0,0,0.15)] shrink-0"
        style={{ width: size, height: size, background: gradientForName(name), fontSize: size * 0.42 }}
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      src={favicon}
      alt=""
      onError={() => setFailed(true)}
      width={size}
      height={size}
      className="rounded-[10px] object-cover shrink-0 bg-[var(--color-line)]"
      style={{ width: size, height: size }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/StationLogo.tsx
git commit -m "feat(ui): StationLogo with letter-chip fallback"
```

---

## Task 12: StationRow component

**Files:**
- Create: `app/components/StationRow.tsx`

- [ ] **Step 1: Create `app/components/StationRow.tsx`**

```tsx
'use client';

import type { Station } from '@/app/lib/stations';
import { StationLogo } from './StationLogo';

type Props = {
  station: Station;
  isActive: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
};

export function StationRow({ station, isActive, isFavorite, onSelect, onToggleFavorite }: Props) {
  return (
    <div
      onClick={onSelect}
      className={[
        'flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors mb-1',
        isActive
          ? 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-[var(--color-line)]'
          : 'hover:bg-[rgba(210,105,30,0.05)]',
      ].join(' ')}
    >
      <StationLogo name={station.name} favicon={station.favicon} />
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold tracking-tight truncate">{station.name}</div>
        <div className="text-xs text-[var(--color-ink-3)] truncate">
          {[station.country, station.bitrate && `${station.bitrate} kbps`].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
        className={`text-lg leading-none ${isFavorite ? 'text-[var(--color-warm)]' : 'text-[var(--color-ink-4)] hover:text-[var(--color-warm)]'}`}
      >
        {isFavorite ? '★' : '☆'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/StationRow.tsx
git commit -m "feat(ui): StationRow with favorite toggle"
```

---

## Task 13: FavoritesList component

**Files:**
- Create: `app/components/FavoritesList.tsx`

- [ ] **Step 1: Create `app/components/FavoritesList.tsx`**

```tsx
'use client';

import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { StationRow } from './StationRow';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

export function FavoritesList({ selectedId, onSelect }: Props) {
  const { favorites, toggle } = useFavorites();

  return (
    <div>
      <div className="text-[11px] tracking-[1.4px] text-[var(--color-warm)] font-extrabold uppercase mb-3.5">
        ★ Favorites
      </div>
      {favorites.length === 0 ? (
        <div className="text-sm text-[var(--color-ink-3)] mb-4 px-1">
          Star a station below to pin it here.
        </div>
      ) : (
        favorites.map(s => (
          <StationRow
            key={s.id}
            station={s}
            isActive={s.id === selectedId}
            isFavorite
            onSelect={() => onSelect(s)}
            onToggleFavorite={() => toggle(s)}
          />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/FavoritesList.tsx
git commit -m "feat(ui): FavoritesList with empty-state hint"
```

---

## Task 14: StationSearch component

**Files:**
- Create: `app/components/StationSearch.tsx`

- [ ] **Step 1: Create `app/components/StationSearch.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { useFavorites } from '@/app/lib/favorites';
import { StationRow } from './StationRow';

type Props = {
  selectedId: string | null;
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

export function StationSearch({ selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const { isFavorite, toggle } = useFavorites();

  useEffect(() => {
    const q = query.trim();
    if (q === '') { setResults([]); setLoading(false); return; }

    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as Station[];
        setResults(data);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [query]);

  return (
    <div>
      <div className="text-[11px] tracking-[1.4px] text-[var(--color-warm)] font-extrabold uppercase mb-3.5">
        Browse
      </div>
      <div className="bg-white border-[1.5px] border-[var(--color-line)] rounded-full px-4 py-2.5 mb-4 flex items-center gap-2.5 shadow-[0_2px_6px_rgba(0,0,0,0.03)] focus-within:border-[var(--color-warm)]">
        <span>🔍</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search stations…"
          className="flex-1 outline-none bg-transparent text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)]"
        />
        {loading && <span className="spin-warm" />}
      </div>
      {loading && results.length === 0 && (
        <>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </>
      )}
      {!loading && query.trim() !== '' && results.length === 0 && (
        <div className="text-sm text-[var(--color-ink-3)] px-1 py-2">No stations found.</div>
      )}
      {results.map(s => (
        <StationRow
          key={s.id}
          station={s}
          isActive={s.id === selectedId}
          isFavorite={isFavorite(s.id)}
          onSelect={() => onSelect(s)}
          onToggleFavorite={() => toggle(s)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/StationSearch.tsx
git commit -m "feat(ui): debounced StationSearch with shimmer skeletons"
```

---

## Task 15: Sidebar wrapper

**Files:**
- Create: `app/components/Sidebar.tsx`

- [ ] **Step 1: Create `app/components/Sidebar.tsx`**

```tsx
'use client';

import type { Station } from '@/app/lib/stations';
import { FavoritesList } from './FavoritesList';
import { StationSearch } from './StationSearch';

type Props = {
  selectedId: string | null;
  onSelect: (s: Station) => void;
};

export function Sidebar({ selectedId, onSelect }: Props) {
  return (
    <aside className="bg-[var(--color-bg-2)] border-r border-[var(--color-line)] p-7 w-[360px] shrink-0 h-screen overflow-y-auto">
      <FavoritesList selectedId={selectedId} onSelect={onSelect} />
      <div className="mt-6">
        <StationSearch selectedId={selectedId} onSelect={onSelect} />
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/Sidebar.tsx
git commit -m "feat(ui): Sidebar composing favorites + search"
```

---

## Task 16: Player component

**Files:**
- Create: `app/components/Player.tsx`

- [ ] **Step 1: Create `app/components/Player.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';

export type PlayState = 'idle' | 'connecting' | 'playing' | 'error';

type Props = {
  station: Station;
  onPlayStateChange: (s: PlayState) => void;
};

export function Player({ station, onPlayStateChange }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(0.65);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume;
  }, [volume]);

  useEffect(() => {
    setPaused(false);
    onPlayStateChange('connecting');
  }, [station.id, onPlayStateChange]);

  function onPlay() { onPlayStateChange('playing'); }
  function onWaiting() { onPlayStateChange('connecting'); }
  function onError() { onPlayStateChange('error'); }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPaused(false); } else { a.pause(); setPaused(true); }
  }

  function retry() {
    const a = audioRef.current;
    if (!a) return;
    a.load();
    a.play().catch(() => {});
  }

  return (
    <div className="flex items-center gap-5 pt-2">
      <audio
        ref={audioRef}
        key={station.streamUrl}
        src={station.streamUrl}
        autoPlay
        onPlay={onPlay}
        onWaiting={onWaiting}
        onError={onError}
        onPlaying={onPlay}
      />
      <button
        onClick={togglePlay}
        className="w-14 h-14 rounded-full bg-[var(--color-ink)] text-white text-xl flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.2)]"
        aria-label={paused ? 'Play' : 'Pause'}
      >
        {paused ? '▶' : '⏸'}
      </button>
      <div className="flex items-center gap-3 flex-1 max-w-[280px] text-[var(--color-ink-3)]">
        <span className="text-base">🔊</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="flex-1 accent-[var(--color-warm)]"
          aria-label="Volume"
        />
      </div>
      <button onClick={retry} className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)] underline">
        Retry
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/Player.tsx
git commit -m "feat(ui): Player with play/pause/volume and play-state reporting"
```

---

## Task 17: NowPlaying component (all 6 states)

**Files:**
- Create: `app/components/NowPlaying.tsx`

- [ ] **Step 1: Create `app/components/NowPlaying.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { gradientForName } from '@/app/lib/colors';
import { isNonTrack } from '@/app/lib/nonTrack';
import type { PlayState } from './Player';

type MetaState = 'waiting' | 'playing' | 'no-metadata';

type HistoryEntry = { time: string; title: string };

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function splitArtistTitle(raw: string): { artist: string; title: string } {
  const sep = raw.includes(' — ') ? ' — ' : raw.includes(' - ') ? ' - ' : null;
  if (!sep) return { artist: '', title: raw };
  const [artist, ...rest] = raw.split(sep);
  return { artist: artist.trim(), title: rest.join(sep).trim() };
}

type Props = {
  station: Station;
  playState: PlayState;
};

export function NowPlaying({ station, playState }: Props) {
  const [metaState, setMetaState] = useState<MetaState>('waiting');
  const [currentRaw, setCurrentRaw] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setMetaState('waiting');
    setCurrentRaw(null);
    setHistory([]);

    const es = new EventSource(`/api/now-playing?url=${encodeURIComponent(station.streamUrl)}`);

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: 'track'; title: string }
          | { type: 'no-metadata' }
          | { type: 'error'; message: string };

        if (msg.type === 'no-metadata') {
          setMetaState('no-metadata');
        } else if (msg.type === 'track') {
          setMetaState('playing');
          setCurrentRaw(prev => {
            if (prev === msg.title) return prev; // dedupe across reconnects
            if (prev && !isNonTrack(prev, station.name)) {
              setHistory(h => [{ time: nowHHMM(), title: prev }, ...h].slice(0, 50));
            }
            return msg.title;
          });
        }
        // error events: ignore, EventSource will reconnect; do not disrupt listening
      } catch {}
    };

    return () => es.close();
  }, [station.id, station.streamUrl, station.name]);

  // ===== Render branches matched to the 6 states in the spec =====

  // ⑥ Audio error (overrides everything else)
  if (playState === 'error') {
    return (
      <div className="flex flex-col gap-6">
        <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-accent)]">
          ⚠ {station.name} unreachable
        </div>
        <div className="flex gap-5 items-end">
          <div className="w-[140px] h-[140px] rounded-2xl bg-[rgba(192,57,43,0.1)] border-2 border-dashed border-[rgba(192,57,43,0.4)] flex items-center justify-center text-4xl text-[var(--color-accent)]">⚠</div>
          <div className="flex-1 pb-1">
            <div className="text-[26px] font-bold tracking-tight">Couldn't connect</div>
            <div className="text-sm text-[var(--color-ink-3)] mt-2">The station server may be down. Reconnecting…</div>
          </div>
        </div>
      </div>
    );
  }

  // ② Audio still connecting
  if (playState === 'connecting') {
    return (
      <div className="flex flex-col gap-5">
        <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
          Connecting to {station.name} <span className="dots"><span /><span /><span /></span>
        </div>
        <div className="flex gap-5 items-end">
          <div className="shimmer pulse-soft w-[180px] h-[180px] rounded-2xl" />
          <div className="flex-1 pb-1">
            <div className="shimmer h-9 w-3/5 mb-2.5" />
            <div className="shimmer h-5 w-2/5" />
          </div>
        </div>
        <div className="text-sm text-[var(--color-ink-3)]">Buffering audio…</div>
      </div>
    );
  }

  // ④ Station has no metadata
  if (metaState === 'no-metadata') {
    return (
      <NowPlayingFrame
        stationName={station.name}
        art={<div className="w-[200px] h-[200px] rounded-2xl bg-[var(--color-line)] flex items-center justify-center text-5xl text-[var(--color-ink-4)]">♪</div>}
        title="This station doesn't share song info"
        subtitle="Audio keeps playing — you just won't see track names."
        history={history}
      />
    );
  }

  // ③ Audio playing, no first track yet
  if (metaState === 'waiting' || currentRaw === null) {
    return (
      <NowPlayingFrame
        stationName={station.name}
        art={<div className="w-[200px] h-[200px] rounded-2xl opacity-50" style={{ background: gradientForName(station.name) }} />}
        title={<>Listening for song info <span className="dots"><span /><span /><span /></span></>}
        subtitle="Most stations announce the track within ~30 seconds"
        titleClassName="text-[var(--color-ink-3)]"
        history={history}
      />
    );
  }

  // ⑤ Between tracks (station ID)
  if (isNonTrack(currentRaw, station.name)) {
    return (
      <NowPlayingFrame
        stationName={station.name}
        art={<div className="w-[200px] h-[200px] rounded-2xl bg-gradient-to-br from-[#8a7a6e] to-[#4a3f37] flex items-center justify-center text-4xl">🎙️</div>}
        title={station.name}
        subtitle="Between tracks · DJ, news, or station ID"
        history={history}
      />
    );
  }

  // ① Audio playing, a real track is present
  const { artist, title } = splitArtistTitle(currentRaw);
  return (
    <NowPlayingFrame
      stationName={station.name}
      art={<div className="w-[220px] h-[220px] rounded-2xl shadow-[0_16px_48px_rgba(192,57,43,0.28)]" style={{ background: gradientForName(station.name) }} />}
      title={title}
      subtitle={artist}
      history={history}
    />
  );
}

function NowPlayingFrame({
  stationName, art, title, subtitle, history, titleClassName = '',
}: {
  stationName: string;
  art: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  history: HistoryEntry[];
  titleClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
        Now playing on {stationName}
      </div>
      <div className="flex gap-8 items-end">
        {art}
        <div className="flex-1 pb-2">
          <div className={`text-[42px] font-extrabold tracking-[-1.2px] leading-[1.05] ${titleClassName}`}>{title}</div>
          {subtitle && <div className="text-[22px] text-[var(--color-ink-2)] font-medium mt-1.5">{subtitle}</div>}
        </div>
      </div>
      {history.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">▾ Session history</div>
          {history.map((h, i) => {
            const { artist, title } = splitArtistTitle(h.title);
            return (
              <div key={i} className="grid grid-cols-[64px_1fr] gap-4 py-3 border-b border-[var(--color-line)] items-baseline last:border-none">
                <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
                <div className="text-base text-[var(--color-ink-2)]">
                  {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/NowPlaying.tsx
git commit -m "feat(ui): NowPlaying with all 6 visual states"
```

---

## Task 18: Wire up page.tsx + full smoke test

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/page.tsx` entirely**

```tsx
'use client';

import { useState } from 'react';
import type { Station } from './lib/stations';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { NowPlaying } from './components/NowPlaying';
import type { PlayState } from './components/Player';

export default function Home() {
  const [selected, setSelected] = useState<Station | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');

  return (
    <div className="flex min-h-screen">
      <Sidebar selectedId={selected?.id ?? null} onSelect={setSelected} />
      <main className="flex-1 p-10 flex flex-col gap-6 bg-[var(--color-bg)] overflow-y-auto">
        {selected ? (
          <>
            <NowPlaying key={selected.id} station={selected} playState={playState} />
            <Player key={selected.id} station={selected} onPlayStateChange={setPlayState} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <div className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)] mb-3">
                Radio
              </div>
              <div className="text-[32px] font-bold tracking-tight">Search for a station to begin</div>
              <div className="text-base text-[var(--color-ink-3)] mt-3 max-w-md mx-auto">
                Find a station in the sidebar. Star the ones you love — they'll be pinned at the top next time.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Run the full manual smoke test**

```bash
npm run dev
```
Then in a browser at http://localhost:3000:

1. Empty state shows on first load.
2. Type `kexp` in the search box — within ~500 ms see shimmer rows, then real station results.
3. Click the star on KEXP — it appears under Favorites at the top.
4. Click the KEXP row — main panel shows state ② (Connecting to KEXP, shimmer art).
5. Within ~5 s audio is audible and the panel transitions to state ③ ("Listening for song info…", dimmed art).
6. Within ~30 s a real track title appears (state ①).
7. Wait for a track change — the previous title appears in Session History with a timestamp.
8. Click play/pause and adjust volume — both work.
9. Search a station you suspect has no metadata (try `BBC World Service` or similar) — state ④ shows.
10. Refresh the page — KEXP is still in Favorites.

If all 10 pass, the MVP works. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(ui): wire main page — Sidebar + Player + NowPlaying"
```

---

## Task 19: Final cleanup

**Files:**
- Review only

- [ ] **Step 1: Run all unit tests and typecheck**

```bash
npm test
npx tsc --noEmit
npm run lint
```
Expected: all green.

- [ ] **Step 2: Verify nothing stale remains in the working tree**

```bash
git status
```
Expected: clean.

- [ ] **Step 3: Confirm spec / plan / code agree**

Re-read the spec section ["Loading & feedback states"](../specs/2026-06-02-radio-shazam-design.md#loading--feedback-states). For each of the 6 states, confirm the wired-up app actually shows that state in the matching scenario from the manual smoke test in Task 18.

If anything is off, file a small follow-up task; don't try to fix it inside this plan's final cleanup.

---

## Self-review notes (already applied)

- **Coverage:** every component in the spec's component table has a task (3,4,5,6/7,8,9,10,11,12,13,14,15,16,17). Every loading state (①–⑥) is rendered in Task 17. Spec sections "Architecture," "Station discovery," "UI," "Loading & feedback states," "ICY metadata protocol," and "Route-handler behavior" all map to one or more tasks.
- **Placeholder scan:** no TBDs, all code shown inline.
- **Type consistency:** `Station` shape defined in Task 3 is used unchanged in Tasks 8, 11–17. `PlayState` defined in Task 16 is imported in Tasks 17, 18. SSE message shape (`{type:'track'|'no-metadata'|'error', ...}`) matches between Task 10 (server) and Task 17 (client).
- **Open questions from spec — resolved here:**
  - Tailwind tokens: defined as CSS custom properties + Tailwind v4 `@theme inline` (Task 2). No JS theme config needed.
  - Debounce: inline `useEffect` + `setTimeout`, no new dep (Task 14).
  - Favorites store: `useSyncExternalStore` over localStorage (Task 8).
  - Empty-favorites state: helpful empty state with "Star a station…" hint (Task 13).
