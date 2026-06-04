# SQLite Persistence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist all app state in an embedded SQLite DB (durable, survives browser-data clears) while keeping the existing client store API unchanged.

**Architecture:** A SQLite-backed `/api/state` endpoint mirrors `localStorage` **as opaque strings** (the DB `value` column holds exactly the string each store already writes — no re-parsing, so JSON blobs and raw scalars both round-trip). The client keeps `localStorage` as a synchronous cache: stores read it as today, but their *writes* go through a `persistSet()` that also write-throughs to the server (debounced). On boot, `hydrateFromServer()` pulls the DB into `localStorage` (server wins) and imports any local-only keys (first-run migration). `radio:sessions` (the ephemeral now-playing cache) is intentionally **not** synced.

**Tech Stack:** Next.js 16 (App Router, Node runtime route handlers), `better-sqlite3` (synchronous embedded SQLite), Vitest.

**Working directory:** `/path/to/shazam-radio` on branch `claude/desktop-app-persistence` (off `main`). NOTE: this is the main repo checkout (not a git worktree).

**Deviation from spec:** persist **each existing `radio:*` key as its own row** (key = the localStorage key string) rather than a bundled `settings` blob — makes the persist layer fully generic and the per-store change a one-liner. Same durability.

---

## File Structure

- `app/lib/db/sqlite.ts` — DB connection singleton + schema migration runner. Server-only.
- `app/lib/db/state.ts` — `getAllState()` / `setState()` queries (accept an optional `db` for testing). Server-only.
- `app/api/state/route.ts` — `GET` (all rows) + `PUT` (`{key, value}` upsert). Node runtime.
- `app/lib/persist.ts` — client: `persistGet`, `persistSet`, `hydrateFromServer`, `localOnlyKeys`.
- `app/components/PersistenceBootstrap.tsx` — client: calls `hydrateFromServer()` once on mount.
- `app/layout.tsx` — mount `<PersistenceBootstrap/>`.
- Each store (`favorites.ts`, `recent.ts`, `hidden.ts`, `tracking.ts`, `savedSongs.ts`, `region.ts`, `visualizer.ts`, `volume.ts`/`Player.tsx`, `SettingsDialog.tsx`) — swap `localStorage.setItem(KEY, x)` → `persistSet(KEY, x)`.
- Tests: `tests/db.migrations.test.ts`, `tests/db.state.test.ts`, `tests/persist.test.ts`.
- `.gitignore` — add `data/`.

---

### Task 1: Dependencies + gitignore

**Files:** Modify `package.json` (via npm); Modify `.gitignore`

- [ ] **Step 1: Install better-sqlite3**

Run: `npm install better-sqlite3 && npm install -D @types/better-sqlite3`
Expected: both added to `package.json`; `node_modules/better-sqlite3` present.

- [ ] **Step 2: Ignore the dev DB directory** — append to `.gitignore`:
```
# Local SQLite DB (dev)
/data/
```

- [ ] **Step 3: Commit**
```bash
git add package.json package-lock.json .gitignore
git commit -m "build: add better-sqlite3 + ignore local data/ dir"
```

---

### Task 2: Migration runner

**Files:** Create `app/lib/db/sqlite.ts`; Test `tests/db.migrations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/db.migrations.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../app/lib/db/sqlite';

describe('runMigrations', () => {
  it('creates app_state and records version 1', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const meta = db.prepare('SELECT version FROM schema_meta').get() as { version: number };
    expect(meta.version).toBe(1);
    const cols = db.prepare("PRAGMA table_info(app_state)").all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['key', 'value', 'updated_at']));
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db);
    const meta = db.prepare('SELECT version FROM schema_meta').get() as { version: number };
    expect(meta.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/db.migrations.test.ts` → FAIL (runMigrations undefined).

- [ ] **Step 3: Implement `app/lib/db/sqlite.ts`**

```ts
// app/lib/db/sqlite.ts
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export type DB = Database.Database;

const MIGRATIONS: { version: number; up: (db: DB) => void }[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
];

export function runMigrations(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as { version: number } | undefined;
  if (!row) db.prepare('INSERT INTO schema_meta (version) VALUES (0)').run();
  let current = row?.version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      db.transaction(() => {
        m.up(db);
        db.prepare('UPDATE schema_meta SET version = ?').run(m.version);
      })();
      current = m.version;
    }
  }
}

function dbPath(): string {
  return process.env.APP_DB_PATH || path.join(process.cwd(), 'data', 'app_state.db');
}

const g = globalThis as unknown as { __APP_DB__?: DB };

export function getDb(): DB {
  if (g.__APP_DB__) return g.__APP_DB__;
  const p = dbPath();
  if (p !== ':memory:') fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  g.__APP_DB__ = db;
  return db;
}
```

- [ ] **Step 4: Run test → PASS** — `npx vitest run tests/db.migrations.test.ts`
- [ ] **Step 5: Commit**
```bash
git add app/lib/db/sqlite.ts tests/db.migrations.test.ts
git commit -m "feat(db): sqlite connection + schema migration runner"
```

---

### Task 3: State queries

**Files:** Create `app/lib/db/state.ts`; Test `tests/db.state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/db.state.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../app/lib/db/sqlite';
import { getAllState, setState } from '../app/lib/db/state';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

describe('state queries', () => {
  it('round-trips opaque string values', () => {
    const db = freshDb();
    setState('radio:favorites', '[{"id":"a"}]', db);
    setState('radio:region', 'IL', db);
    const all = getAllState(db);
    expect(all['radio:favorites']).toBe('[{"id":"a"}]');
    expect(all['radio:region']).toBe('IL');
  });

  it('upserts (last write wins)', () => {
    const db = freshDb();
    setState('radio:volume', '0.5', db);
    setState('radio:volume', '0.8', db);
    expect(getAllState(db)['radio:volume']).toBe('0.8');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`getAllState`/`setState` undefined).
- [ ] **Step 3: Implement `app/lib/db/state.ts`**

```ts
// app/lib/db/state.ts
import { getDb, type DB } from './sqlite';

/** All persisted key→value rows as opaque strings (verbatim localStorage values). */
export function getAllState(db: DB = getDb()): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_state').all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/** Upsert one key with the raw string value the client wrote. */
export function setState(key: string, value: string, db: DB = getDb()): void {
  db.prepare(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/db.state.test.ts`
- [ ] **Step 5: Commit**
```bash
git add app/lib/db/state.ts tests/db.state.test.ts
git commit -m "feat(db): getAllState/setState opaque-string queries"
```

---

### Task 4: `/api/state` route

**Files:** Create `app/api/state/route.ts`; extend `tests/db.state.test.ts`

- [ ] **Step 1: Append to tests/db.state.test.ts**

```ts
import { GET, PUT } from '../app/api/state/route';

describe('/api/state handlers', () => {
  it('PUT upserts and GET returns it', async () => {
    process.env.APP_DB_PATH = ':memory:';
    const put = await PUT(new Request('http://x/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'radio:hidden', value: '[{"id":"z"}]' }),
    }) as any);
    expect(put.status).toBe(204);
    const res = await GET();
    const body = await res.json();
    expect(body['radio:hidden']).toBe('[{"id":"z"}]');
  });

  it('PUT rejects a missing key', async () => {
    const res = await PUT(new Request('http://x/api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x' }),
    }) as any);
    expect(res.status).toBe(400);
  });
});
```

Place this `describe` LAST in the file so the `:memory:` singleton is what the earlier tests already initialised is irrelevant — set `APP_DB_PATH=':memory:'` before the first `getDb()` call in these handler tests.

- [ ] **Step 2: Run → FAIL** (cannot import from route).
- [ ] **Step 3: Implement `app/api/state/route.ts`**

```ts
// app/api/state/route.ts
import { NextRequest } from 'next/server';
import { getAllState, setState } from '@/app/lib/db/state';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(getAllState());
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { key?: unknown; value?: unknown } | null;
  if (!body || typeof body.key !== 'string' || typeof body.value !== 'string') {
    return new Response('expected { key: string, value: string }', { status: 400 });
  }
  setState(body.key, body.value);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/db.state.test.ts`
- [ ] **Step 5: Commit**
```bash
git add app/api/state/route.ts tests/db.state.test.ts
git commit -m "feat(api): /api/state GET all + PUT upsert"
```

---

### Task 5: Client persist layer

**Files:** Create `app/lib/persist.ts`; Test `tests/persist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/persist.test.ts
import { describe, it, expect } from 'vitest';
import { localOnlyKeys } from '../app/lib/persist';

describe('localOnlyKeys', () => {
  it('returns radio:* keys present locally but not on the server', () => {
    const server = ['radio:favorites'];
    const local = ['radio:favorites', 'radio:savedSongs', 'theme', 'radio:volume'];
    expect(localOnlyKeys(server, local)).toEqual(['radio:savedSongs', 'radio:volume']);
  });

  it('ignores non radio:* keys', () => {
    expect(localOnlyKeys([], ['foo', 'bar'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`localOnlyKeys` undefined).
- [ ] **Step 3: Implement `app/lib/persist.ts`**

```ts
// app/lib/persist.ts
'use client';

const API = '/api/state';

const pending = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function persistGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

/** Write-through: update the local cache immediately, queue a debounced server upsert. */
export function persistSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, value); } catch { /* best-effort cache */ }
  pending.set(key, value);
  if (!flushTimer) flushTimer = setTimeout(flush, 400);
}

async function flush(): Promise<void> {
  flushTimer = null;
  const entries = [...pending.entries()];
  pending.clear();
  for (const [key, value] of entries) {
    try {
      await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
    } catch {
      pending.set(key, value);
    }
  }
  if (pending.size && !flushTimer) flushTimer = setTimeout(flush, 1000);
}

/** Pure: radio:* keys present locally but absent on the server (first-run import set). */
export function localOnlyKeys(serverKeys: string[], localKeys: string[]): string[] {
  const onServer = new Set(serverKeys);
  return localKeys.filter(k => k.startsWith('radio:') && !onServer.has(k));
}

let hydrated = false;

/** Pull the server DB into localStorage (server wins) + import local-only keys. Runs once. */
export async function hydrateFromServer(): Promise<void> {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;

  let server: Record<string, string> = {};
  try {
    const res = await fetch(API);
    if (res.ok) server = await res.json();
    else return;
  } catch {
    return;
  }

  for (const [key, value] of Object.entries(server)) {
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  }

  const local: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k) local.push(k);
  }
  for (const key of localOnlyKeys(Object.keys(server), local)) {
    if (key === 'radio:sessions') continue;
    const raw = window.localStorage.getItem(key);
    if (raw != null) persistSet(key, raw);
  }
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run tests/persist.test.ts`
- [ ] **Step 5: Commit**
```bash
git add app/lib/persist.ts tests/persist.test.ts
git commit -m "feat(persist): client localStorage<->server mirror + first-run import"
```

---

### Task 6: Bootstrap hydration on app load

**Files:** Create `app/components/PersistenceBootstrap.tsx`; Modify `app/layout.tsx`

- [ ] **Step 1: Create the component**

```tsx
// app/components/PersistenceBootstrap.tsx
'use client';

import { useEffect } from 'react';
import { hydrateFromServer } from '@/app/lib/persist';

export function PersistenceBootstrap() {
  useEffect(() => { void hydrateFromServer(); }, []);
  return null;
}
```

- [ ] **Step 2: Mount in `app/layout.tsx`** — add the import and render `<PersistenceBootstrap />` as the first child inside `<body>` (keep all existing body attributes/children):
```tsx
import { PersistenceBootstrap } from './components/PersistenceBootstrap';
// ...
<body className={/* existing */}>
  <PersistenceBootstrap />
  {children}
</body>
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit && npx eslint app/components/PersistenceBootstrap.tsx app/layout.tsx`
- [ ] **Step 4: Commit**
```bash
git add app/components/PersistenceBootstrap.tsx app/layout.tsx
git commit -m "feat(persist): hydrate from server on app load"
```

---

### Task 7: Route the `favorites` store through persist

**Files:** Modify `app/lib/favorites.ts`

- [ ] **Step 1:** Add `import { persistSet } from './persist';`. Replace `write()` body:
```ts
function write(next: Station[]) {
  snapshot = next;
  persistSet(KEY, JSON.stringify(next));
  emit();
}
```
- [ ] **Step 2: Verify** — `npx tsc --noEmit && npx eslint app/lib/favorites.ts`
- [ ] **Step 3: Commit** — `git commit -am "refactor(favorites): persist via /api/state"`

---

### Task 8: Route `recent`, `hidden`, `tracking` through persist

**Files:** Modify `app/lib/recent.ts`, `app/lib/hidden.ts`, `app/lib/tracking.ts`

- [ ] **Step 1:** In each file add `import { persistSet } from './persist';` and change the persisting line inside `write()` from
```ts
try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ... */ }
```
to
```ts
persistSet(KEY, JSON.stringify(next));
```
Keep `snapshot = next;` and `emit();`.
- [ ] **Step 2: Verify** — `npx tsc --noEmit && npx eslint app/lib/recent.ts app/lib/hidden.ts app/lib/tracking.ts`
- [ ] **Step 3: Commit** — `git commit -am "refactor(recent,hidden,tracking): persist via /api/state"`

---

### Task 9: Route the `savedSongs` store through persist

**Files:** Modify `app/lib/savedSongs.ts`

- [ ] **Step 1:** Add `import { persistSet } from './persist';`. Replace `write()` body:
```ts
function write(next: SavedSong[]) {
  snapshot = next;
  persistSet(KEY, JSON.stringify(next));
  for (const cb of listeners) cb();
}
```
- [ ] **Step 2: Verify** — `npx tsc --noEmit && npx vitest run tests/savedSongs.test.ts && npx eslint app/lib/savedSongs.ts`
- [ ] **Step 3: Commit** — `git commit -am "refactor(saved-songs): persist via /api/state"`

---

### Task 10: Route the `region` store through persist

**Files:** Modify `app/lib/region.ts`

- [ ] **Step 1:** Add `import { persistSet } from './persist';`. For each write of `radio:region` and `radio:regionLock`, replace `window.localStorage.setItem(<KEY>, <value>)` with `persistSet(<KEY>, <value>)`. **Leave `radio:ipRegion` on raw `localStorage.setItem`** (it's re-detected from IP each load, not user data). Region values are raw strings — persist mirrors them verbatim, reads unchanged.
- [ ] **Step 2: Verify** — `npx tsc --noEmit && npx eslint app/lib/region.ts`
- [ ] **Step 3: Commit** — `git commit -am "refactor(region): persist region + regionLock via /api/state"`

---

### Task 11: Route `visualizer`, player volume/autoplay, debug toggle through persist

**Files:** Modify `app/lib/visualizer.ts`, `app/components/Player.tsx`, `app/components/SettingsDialog.tsx`

- [ ] **Step 1: visualizer** — add `import { persistSet } from './persist';`; in `write()` replace `window.localStorage.setItem(KEY, next ? '1' : '0')` with `persistSet(KEY, next ? '1' : '0')`.
- [ ] **Step 2: Player** — add `import { persistSet } from '@/app/lib/persist';`; replace `window.localStorage.setItem(VOLUME_KEY, String(volume))` with `persistSet(VOLUME_KEY, String(volume))` and `window.localStorage.setItem(AUTOPLAY_KEY, String(autoplay))` with `persistSet(AUTOPLAY_KEY, String(autoplay))`.
- [ ] **Step 3: SettingsDialog** — add `import { persistSet } from '@/app/lib/persist';`; in `toggleDebug` replace `window.localStorage.setItem(DEBUG_KEY, next ? '1' : '0')` with `persistSet(DEBUG_KEY, next ? '1' : '0')`.
- [ ] **Step 4: Verify** — `npx tsc --noEmit && npx eslint app/lib/visualizer.ts app/components/Player.tsx app/components/SettingsDialog.tsx`
- [ ] **Step 5: Commit** — `git commit -am "refactor(settings,player): persist rings/volume/autoplay/debug via /api/state"`

---

### Task 12: Full verification

- [ ] **Step 1:** `npx vitest run && npx tsc --noEmit && npx eslint app` → all pass (existing 39 + new db/persist tests; lint clean except pre-existing `<img>` warnings).
- [ ] **Step 2: Manual durability** — `npm run dev`; save a song / favorite / change volume; confirm `data/app_state.db` has rows (`sqlite3 data/app_state.db 'select key, substr(value,1,40) from app_state;'`); then clear site data / localStorage in devtools and reload → data **returns** (re-hydrated from SQLite).
- [ ] **Step 3: First-run import** — in a browser that already had `radio:*` localStorage data (no DB), load once → those keys become rows; `radio:sessions` does NOT.

---

## Notes for Spec 2 (separate plan)

Spec 2 (Electron shell, `electron-builder`, `electron-updater` + GitHub Releases, macOS signing/notarization, bundled PyInstaller recognizer + ffmpeg) gets its own plan. Handoff: Electron main sets `APP_DB_PATH` to `app.getPath('userData')/app_state.db` and rebuilds `better-sqlite3` for Electron's ABI via `electron-rebuild`.
