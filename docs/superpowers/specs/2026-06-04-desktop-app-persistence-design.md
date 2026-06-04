# Desktop App + Durable Persistence — Design

**Status:** Approved (design). Awaiting spec review → implementation plan.
**Date:** 2026-06-04

## Problem

All app state (saved songs, favorites, recently played, hidden stations, tracked
stations, settings) lives in browser `localStorage`. It's wiped when the user
clears browser data, never leaves the originating browser, and has no integrity
guarantees. We want data that is **small, reliable, fast, and survives a browser
data clear**.

## Decision summary

Ship the app as a **standalone desktop application (macOS + Windows)** built on
**Electron**, with state persisted in an **embedded SQLite database** on the
local filesystem. This solves durability directly (data lives on disk, not in the
browser), with no accounts, no server, and no hosting/ops. Updates ship as new
app versions via **auto-update** from day one.

Explicitly **out of scope** (considered and rejected for now): multi-user
accounts, cross-device sync, and a hosted web backend. The persistence layer is
designed so a hosted/multi-user variant would be an *additive* step later (add
auth + user scoping behind the same data API), not a rewrite.

## Goals

- Durable local persistence that survives browser/data clears.
- Small, fast, reliable embedded DB.
- Self-contained desktop app (incl. the Shazam recognizer) for macOS + Windows.
- Auto-update so new features reach installed apps without manual reinstall.
- Schema can evolve across versions without losing user data.

## Non-goals

- Accounts / auth / multi-tenant.
- Cross-device sync, mobile, or a public hosted deployment.
- Rewriting the existing UI / API routes (they are reused as-is).

## Architecture overview

```
┌─────────────────────────── Electron app ───────────────────────────┐
│  main process (Node)                                                │
│   • starts the existing Next.js server (next start) on a local port │
│   • opens a BrowserWindow → http://127.0.0.1:<port>                 │
│   • spawns the bundled recognizer sidecar (frozen Python + ffmpeg)  │
│   • electron-updater: checks GitHub Releases, applies updates       │
│                                                                     │
│  Next.js server (reused unchanged: UI, SSE, /api/stream, …)         │
│   • NEW: /api/state  ──►  better-sqlite3  ──►  app_state.db (disk)   │
│                              ▲ migration runner on startup          │
└─────────────────────────────────────────────────────────────────────┘
```

The desktop shell is "just" packaging + lifecycle around the current Next.js
app. The only app-logic change is **where persistence goes**: from
`localStorage` to a SQLite-backed `/api/state` data layer that works identically
in `npm run dev` (browser) and in the packaged app.

## Decomposition (two implementation specs)

Cohesive design, two independently buildable/testable phases:

- **Spec 1 — Persistence layer.** Replace `localStorage` with SQLite via
  `/api/state` + a migration runner. Delivers durable persistence immediately —
  validatable in plain `npm run dev`, no Electron needed.
- **Spec 2 — Desktop shell + auto-update + bundled recognizer.** Electron
  packaging, auto-update, signing/notarization, recognizer bundling.

Build Spec 1 first to de-risk: data becomes durable before any Electron work.

---

## Spec 1 — SQLite persistence layer

### Database

- **`better-sqlite3`** — synchronous, embedded, fast, battle-tested. Runs in the
  Next.js server (Node) process, so it works in `next dev`, `next start`, and
  inside Electron.
- **File location:** Electron → `app.getPath('userData')/app_state.db`. Dev →
  a repo-local `data/app_state.db` (gitignored), resolved via an env var
  (`APP_DB_PATH`) with that dev default.

### Schema

Mirrors the existing stores 1:1 (the data is already JSON blobs client-side):

```sql
CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,   -- savedSongs | favorites | recent | hidden | tracking | settings
  value      TEXT NOT NULL,      -- JSON (the exact shape each store holds today)
  updated_at INTEGER NOT NULL    -- epoch ms
);
CREATE TABLE IF NOT EXISTS schema_meta ( version INTEGER NOT NULL );
```

`settings` bundles the small scalar prefs that currently have their own keys:
`region`, `regionLock`, `ipRegion`, `autoplay`, `volume`, `rings`, `showDebug`.

Rationale for key→JSONB-style blobs (vs normalized per-entity tables): tiny,
fast, zero schema churn, trivial to map from the existing client stores, and
search/ranking already runs client-side. Normalized tables are YAGNI.

> **Implementation note:** the plan persists each existing `radio:*` key as its
> own row (key = the localStorage key string) rather than literally bundling a
> `settings` blob — it makes the persist layer fully generic. Same durability.

### Migration runner

On startup the server reads `schema_meta.version` and applies an ordered list of
migration steps (`migrations[]`, each `{ version, up(db) }`) until current. This
is the mechanism that lets future feature updates change the schema without
losing or corrupting existing local data. v1 seeds version 1 (the table above).

### Data API (`/api/state`)

- `GET /api/state` → `{ [key]: value }` for all known keys.
- `PUT /api/state` with body `{ key, value }` → upsert `(key, value, now)`.

A thin typed wrapper module is the only thing the stores call — the "service"
around the DB. Server-side DB access lives in `app/lib/db/` (connection,
migrations, queries) and is imported only by the API route handlers (never by
client components).

### Client store refactor

Each persisted store keeps its `useSyncExternalStore` shape but swaps its write
from `localStorage.setItem` to a `persistSet()` that mirrors to both the local
cache and the server. `localStorage` remains a synchronous read cache; the
server (SQLite) is the durable source of truth, hydrated on load.

### One-time migration of existing local data

On first run, if the DB has no row for a key but the browser has the legacy
`radio:*` `localStorage` value, import it into SQLite so current users' saved
songs/favorites aren't lost.

### Spec 1 testing

- Unit (Vitest): migration runner; the DB query layer against an in-memory
  SQLite; the `localStorage`→SQLite import decision (pure function).
- Integration: write via `PUT /api/state`, confirm `GET /api/state` returns it.

---

## Spec 2 — Desktop shell + auto-update + bundled recognizer

### Electron shell

- Electron main process starts the existing Next.js production server
  (`next start`) on an ephemeral local port and opens a `BrowserWindow` to it,
  reusing **all** current code. No static export / API rewrite.
- `better-sqlite3` rebuilt for Electron's Node ABI via `electron-rebuild`.
- DB path set to `app.getPath('userData')/app_state.db`.

### Bundled recognizer (self-contained)

- The Python recognizer is frozen with **PyInstaller** (per-platform), **ffmpeg**
  bundled alongside.
- Electron main spawns it as a **sidecar** child process on launch (and tears it
  down on quit), exposed on a local port; the web app reaches it via the existing
  `RECOGNIZER_URL` env var. No separate user install.
- Packaged as `extraResources` in `electron-builder`.

### Packaging, signing, auto-update

- **`electron-builder`** produces `.dmg` (macOS) and `.exe` (Windows/NSIS) +
  update metadata (`latest-mac.yml` / `latest.yml`).
- **Auto-update from day one** via **`electron-updater`** pointed at a
  **GitHub Releases** feed.
- **macOS:** Developer ID signing + notarization (required for clean Gatekeeper
  install + auto-update). **Windows:** code signing optional.

### Release flow

Code → bump `version` in `package.json` → `electron-builder` build + publish to
GitHub Releases → installed apps auto-update on next launch → migration runner
runs on first launch of the new version so data is preserved.

### Spec 2 testing

- Manual: install on macOS + Windows; change data; quit; relaunch → data
  persists. Recognizer works out of the box.
- Manual: publish `v+1`; confirm an installed `v` auto-updates; confirm a schema
  migration runs cleanly and preserves existing data.

---

## Risks & mitigations

- **`better-sqlite3` native rebuild for Electron** — pin `electron-rebuild`.
- **macOS notarization friction** — requires an Apple Developer ID ($99/yr).
- **Recognizer bundling** — per-platform PyInstaller + ffmpeg licensing; largest
  installer size.
- **Async hydration flash** — reuse the existing "empty snapshot then fill"
  pattern to avoid hydration mismatches.
- **Single source of truth** — `localStorage` stays a cache; the one-time import
  is the only place both are read.

## Future (explicitly deferred)

Hosted/multi-user is an additive path: the same `/api/state` contract gains an
authenticated user scope (e.g. Supabase/Postgres + RLS) and the DB swaps from a
local file to a server DB. No client rewrite required. Not built now.
