# Saved Songs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A curated, persistent playlist of recognized songs — each linking to Shazam and Apple Music with a ~30s preview — saved from the now-playing card and viewable any time in a searchable modal.

**Architecture:** The Python recognizer already receives Shazam's full payload; we pass the track's Shazam URL, Apple Music deep link, preview clip, and id through the existing `/api/now-playing` SSE into `NowPlaying`. A ♥ button there saves the current song to a localStorage-backed store (`savedSongs`), with search-URL fallbacks for metadata-only tracks. A new top-bar button opens a Settings-style modal that lists, searches (reusing `fuzzyScore`), previews, links, and removes saved songs. A tiny `playbackBus` lets a preview pause the live radio so the two never overlap.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Vitest · Python FastAPI + ShazamIO (recognizer sidecar).

---

## File Structure

- Create `app/lib/savedSongs.ts` — types, pure helpers (`buildSavedSong`, `addSong`, `removeSong`, `searchSavedSongs`), and the `useSavedSongs` hook (localStorage store).
- Create `app/lib/playbackBus.ts` — pub/sub so a preview can pause the radio.
- Create `app/components/SavedSongsDialog.tsx` — the modal (list, search, preview, links, remove).
- Modify `recognizer/main.py` — extract & return `shazamUrl`, `appleMusicUrl`, `previewUrl`, `key`.
- Modify `app/api/now-playing/route.ts` — carry the new fields on the `track` SSE event.
- Modify `app/components/NowPlaying.tsx` — hold the current song's link fields; add the ♥ save button (real-track state only).
- Modify `app/components/Player.tsx` — pause when `playbackBus` signals.
- Modify `app/components/TopBar.tsx` — add the "Saved songs" button (a new prop + icon).
- Modify `app/page.tsx` — dialog open/close state; render `SavedSongsDialog`.
- Create `tests/savedSongs.test.ts`, `tests/playbackBus.test.ts` — unit tests for the pure logic.
- Modify `README.md` — mention the feature.

---

## Task 1: Recognizer returns Shazam / Apple Music / preview links

**Files:**
- Modify: `recognizer/main.py`

- [ ] **Step 1: Add two pure extractor helpers + use them in `recognize`**

In `recognizer/main.py`, add near the top (after the imports, before `app = FastAPI(...)`):

```python
import json
import re


def extract_apple_music_url(hub: dict | None) -> str:
    """First https://music.apple.com/... link found in the hub deep links, or ''."""
    blob = json.dumps(hub or {})
    m = re.search(r"music\.apple\.com[^\"#\\]*", blob)
    return ("https://" + m.group(0)) if m else ""


def extract_preview_url(hub: dict | None) -> str:
    """The ~30s AAC preview clip (.m4a) from the hub actions, or ''."""
    for a in (hub or {}).get("actions") or []:
        uri = a.get("uri") or ""
        if ".m4a" in uri:
            return uri
    return ""
```

Then replace the `return {"match": True, ...}` block at the end of `recognize` with:

```python
    images = track.get("images") or {}
    cover = (
        images.get("coverarthq")
        or images.get("coverart")
        or (track.get("share") or {}).get("image")
        or ""
    )
    hub = track.get("hub") or {}
    shazam_url = (track.get("share") or {}).get("href") or track.get("url") or ""

    return {
        "match": True,
        "artist": artist,
        "title": title,
        "raw": raw,
        "cover": cover,
        "shazamUrl": shazam_url,
        "appleMusicUrl": extract_apple_music_url(hub),
        "previewUrl": extract_preview_url(hub),
        "key": str(track.get("key") or ""),
    }
```

(Leave the existing `cover` computation in place if already present — this block supersedes it; ensure only one `cover = ...` / `return` remains.)

- [ ] **Step 2: Test the pure extractors (offline, deterministic)**

Run:

```bash
cd recognizer && .venv/bin/python -c '
from main import extract_apple_music_url, extract_preview_url
HUB = {
  "actions": [
    {"name":"apple","type":"applemusicplay","id":"1877678417"},
    {"name":"apple","type":"uri","uri":"https://audio-ssl.itunes.apple.com/x/mzaf_x.plus.aac.ep.m4a"}
  ],
  "options":[{"actions":[{"name":"hub:applemusic:deeplink","type":"intent",
    "uri":"intent://music.apple.com/gb/album/x/1877678416?i=1877678417&app=music#Intent;scheme=http;end"}]}]
}
assert extract_apple_music_url(HUB) == "https://music.apple.com/gb/album/x/1877678416?i=1877678417&app=music", extract_apple_music_url(HUB)
assert extract_preview_url(HUB).endswith(".m4a")
assert extract_apple_music_url({}) == ""
assert extract_preview_url({}) == ""
print("OK")
'
```

Expected: prints `OK` (no AssertionError).

- [ ] **Step 3: Commit**

```bash
git add recognizer/main.py
git commit -m "feat(recognizer): return shazamUrl, appleMusicUrl, previewUrl, key"
```

---

## Task 2: Thread the new fields through the SSE `track` event

**Files:**
- Modify: `app/api/now-playing/route.ts`

- [ ] **Step 1: Extend the `Recognized` type and `fingerprint` parsing**

Find:

```ts
type Recognized = { raw: string; cover: string | null };
```

Replace with:

```ts
type Recognized = {
  raw: string;
  cover: string | null;
  shazamUrl: string;
  appleMusicUrl: string;
  previewUrl: string;
  key: string;
};
```

In `fingerprint`, find:

```ts
    const data = (await res.json()) as { match?: boolean; raw?: string; cover?: string };
    return data?.match && data?.raw ? { raw: data.raw, cover: data.cover || null } : null;
```

Replace with:

```ts
    const data = (await res.json()) as {
      match?: boolean; raw?: string; cover?: string;
      shazamUrl?: string; appleMusicUrl?: string; previewUrl?: string; key?: string;
    };
    return data?.match && data?.raw
      ? {
          raw: data.raw,
          cover: data.cover || null,
          shazamUrl: data.shazamUrl || '',
          appleMusicUrl: data.appleMusicUrl || '',
          previewUrl: data.previewUrl || '',
          key: data.key || '',
        }
      : null;
```

- [ ] **Step 2: Include the fields on the `track` SSE event**

Find (inside `tryFingerprint`):

```ts
            send({ type: 'track', title: match.raw, source: 'shazam', cover: match.cover ?? undefined });
```

Replace with:

```ts
            send({
              type: 'track', title: match.raw, source: 'shazam',
              cover: match.cover ?? undefined,
              shazamUrl: match.shazamUrl || undefined,
              appleMusicUrl: match.appleMusicUrl || undefined,
              previewUrl: match.previewUrl || undefined,
              key: match.key || undefined,
            });
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (warnings about npm config are fine).

- [ ] **Step 4: Commit**

```bash
git add app/api/now-playing/route.ts
git commit -m "feat(now-playing): carry Shazam/Apple/preview links on track events"
```

---

## Task 3: `playbackBus` — pause the radio when a preview plays

**Files:**
- Create: `app/lib/playbackBus.ts`
- Test: `tests/playbackBus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/playbackBus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pauseRadio, subscribePauseRadio } from '../app/lib/playbackBus';

describe('playbackBus', () => {
  it('notifies subscribers when pauseRadio is called', () => {
    let calls = 0;
    const unsub = subscribePauseRadio(() => { calls++; });
    pauseRadio();
    pauseRadio();
    expect(calls).toBe(2);
    unsub();
    pauseRadio();
    expect(calls).toBe(2); // no longer notified after unsubscribe
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/playbackBus.test.ts`
Expected: FAIL (cannot find module `../app/lib/playbackBus`).

- [ ] **Step 3: Implement `playbackBus.ts`**

Create `app/lib/playbackBus.ts`:

```ts
'use client';

// One-way signal: "something else is about to play audio, radio should pause".
// The Player subscribes and pauses its <audio>; the Saved-Songs preview calls
// pauseRadio() before playing so the two never overlap.
type Listener = () => void;
const listeners = new Set<Listener>();

export function pauseRadio(): void {
  for (const cb of listeners) cb();
}

export function subscribePauseRadio(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/playbackBus.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/lib/playbackBus.ts tests/playbackBus.test.ts
git commit -m "feat: playbackBus pub/sub to pause radio on external play"
```

---

## Task 4: `savedSongs` pure helpers + types

**Files:**
- Create: `app/lib/savedSongs.ts` (helpers + types only in this task; the hook is Task 5)
- Test: `tests/savedSongs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/savedSongs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSavedSong, addSong, removeSong, searchSavedSongs } from '../app/lib/savedSongs';
import type { SavedSong } from '../app/lib/savedSongs';

const base = {
  raw: 'Tracy Chapman - Fast Car',
  artist: 'Tracy Chapman',
  title: 'Fast Car',
  cover: 'http://cover/1',
  stationName: 'Radio Paradise',
  savedAt: 1000,
};

describe('buildSavedSong', () => {
  it('uses the Shazam key as id and keeps direct links when present', () => {
    const s = buildSavedSong({ ...base, key: '12345', shazamUrl: 'https://shz/x', appleMusicUrl: 'https://am/x', previewUrl: 'https://p/x.m4a' });
    expect(s.id).toBe('12345');
    expect(s.shazamUrl).toBe('https://shz/x');
    expect(s.appleMusicUrl).toBe('https://am/x');
    expect(s.previewUrl).toBe('https://p/x.m4a');
  });

  it('falls back to a normalized artist|title id and search URLs when links are missing', () => {
    const s = buildSavedSong({ ...base, key: '', shazamUrl: '', appleMusicUrl: '', previewUrl: '' });
    expect(s.id).toBe('tracy chapman|fast car');
    expect(s.shazamUrl).toBe('https://www.shazam.com/search/' + encodeURIComponent('Tracy Chapman Fast Car'));
    expect(s.appleMusicUrl).toBe('https://music.apple.com/search?term=' + encodeURIComponent('Tracy Chapman Fast Car'));
    expect(s.previewUrl).toBe('');
  });
});

describe('addSong / removeSong', () => {
  it('prepends, de-dupes by id, and removes by id', () => {
    const a = buildSavedSong({ ...base, key: 'A' });
    const b = buildSavedSong({ ...base, key: 'B', raw: 'Toto - Africa', artist: 'Toto', title: 'Africa', savedAt: 2000 });
    let list: SavedSong[] = [];
    list = addSong(list, a);
    list = addSong(list, b);
    expect(list.map(s => s.id)).toEqual(['B', 'A']); // newest first
    list = addSong(list, a); // dup → no change
    expect(list.length).toBe(2);
    list = removeSong(list, 'A');
    expect(list.map(s => s.id)).toEqual(['B']);
  });
});

describe('searchSavedSongs', () => {
  const a = buildSavedSong({ ...base, key: 'A' }); // Tracy Chapman - Fast Car
  const b = buildSavedSong({ ...base, key: 'B', raw: 'Toto - Africa', artist: 'Toto', title: 'Africa' });
  const list = [b, a];

  it('returns the full list (unchanged order) for an empty query', () => {
    expect(searchSavedSongs(list, '   ')).toEqual(list);
  });

  it('filters to fuzzy matches', () => {
    const r = searchSavedSongs(list, 'africa');
    expect(r.map(s => s.id)).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/savedSongs.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement the helpers**

Create `app/lib/savedSongs.ts`:

```ts
'use client';

import { fuzzyScore } from './rank';

export type SavedSong = {
  id: string;            // Shazam key, else normalized `${artist}|${title}`
  title: string;
  artist: string;
  raw: string;
  cover: string;
  shazamUrl: string;
  appleMusicUrl: string;
  previewUrl: string;
  stationName: string;
  savedAt: number;
};

export type BuildInput = {
  raw: string;
  artist: string;
  title: string;
  cover?: string;
  shazamUrl?: string;
  appleMusicUrl?: string;
  previewUrl?: string;
  key?: string;
  stationName: string;
  savedAt: number;
};

/** Build a SavedSong, filling search-URL fallbacks for metadata-only tracks. */
export function buildSavedSong(input: BuildInput): SavedSong {
  const term = ([input.artist, input.title].filter(Boolean).join(' ').trim()) || input.raw;
  const norm = (s: string) => s.trim().toLowerCase();
  const id = input.key && input.key.trim()
    ? input.key.trim()
    : `${norm(input.artist)}|${norm(input.title)}`;
  return {
    id,
    title: input.title,
    artist: input.artist,
    raw: input.raw,
    cover: input.cover || '',
    shazamUrl: input.shazamUrl || `https://www.shazam.com/search/${encodeURIComponent(term)}`,
    appleMusicUrl: input.appleMusicUrl || `https://music.apple.com/search?term=${encodeURIComponent(term)}`,
    previewUrl: input.previewUrl || '',
    stationName: input.stationName,
    savedAt: input.savedAt,
  };
}

/** Prepend a song, de-duping by id (existing entry wins; no reorder churn). */
export function addSong(list: SavedSong[], song: SavedSong): SavedSong[] {
  if (list.some(s => s.id === song.id)) return list;
  return [song, ...list];
}

export function removeSong(list: SavedSong[], id: string): SavedSong[] {
  return list.filter(s => s.id !== id);
}

/** Fuzzy filter by "Artist - Title". Empty query → original list unchanged. */
export function searchSavedSongs(list: SavedSong[], query: string): SavedSong[] {
  const q = query.trim();
  if (!q) return list;
  return list
    .map(s => ({ s, score: fuzzyScore(q, s.raw) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.savedAt - a.s.savedAt)
    .map(x => x.s);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/savedSongs.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add app/lib/savedSongs.ts tests/savedSongs.test.ts
git commit -m "feat: savedSongs pure helpers (build/add/remove/search) + tests"
```

---

## Task 5: `useSavedSongs` localStorage store

**Files:**
- Modify: `app/lib/savedSongs.ts` (append the hook)

- [ ] **Step 1: Append the hook (mirrors the favorites store pattern)**

Add to the end of `app/lib/savedSongs.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'radio:savedSongs';
const EMPTY: SavedSong[] = [];

function load(): SavedSong[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedSong[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let snapshot: SavedSong[] | null = null;
function read(): SavedSong[] {
  if (snapshot === null) snapshot = load();
  return snapshot;
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { snapshot = load(); cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function write(next: SavedSong[]) {
  snapshot = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  for (const cb of listeners) cb();
}

export function useSavedSongs() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);
  const isSaved = useCallback((id: string) => saved.some(s => s.id === id), [saved]);
  // Stamp savedAt at call time; build + de-dupe via the pure helpers.
  const save = useCallback((input: Omit<BuildInput, 'savedAt'>) => {
    write(addSong(read(), buildSavedSong({ ...input, savedAt: Date.now() })));
  }, []);
  const remove = useCallback((id: string) => { write(removeSong(read(), id)); }, []);
  return { saved, isSaved, save, remove };
}
```

> Note: `import` placed mid-file is fine — bundlers hoist it. If your linter objects, move the `import { useCallback, useSyncExternalStore } from 'react';` line up beside the `fuzzyScore` import.

- [ ] **Step 2: Verify compile + existing tests still pass**

Run: `npx tsc --noEmit && npx vitest run tests/savedSongs.test.ts`
Expected: tsc clean; tests still PASS (the hook isn't tested here, the pure helpers remain green).

- [ ] **Step 3: Commit**

```bash
git add app/lib/savedSongs.ts
git commit -m "feat: useSavedSongs localStorage store"
```

---

## Task 6: NowPlaying — keep link fields + add the ♥ save button

**Files:**
- Modify: `app/components/NowPlaying.tsx`

- [ ] **Step 1: Import the store and add link state**

At the top of `app/components/NowPlaying.tsx`, add to the imports:

```ts
import { useSavedSongs } from '@/app/lib/savedSongs';
```

Just after the existing `const [currentCover, setCurrentCover] = useState<...>(...)` line, add:

```ts
  // Outbound links for the current track (Shazam-recognized only; metadata
  // tracks get search-URL fallbacks at save time). Reset per track.
  const [links, setLinks] = useState<{ shazamUrl: string; appleMusicUrl: string; previewUrl: string; key: string }>(
    { shazamUrl: '', appleMusicUrl: '', previewUrl: '', key: '' },
  );
  const { isSaved, save, remove } = useSavedSongs();
```

- [ ] **Step 2: Widen the SSE `track` message type and capture the links**

Find the SSE message union member:

```ts
          | { type: 'track'; title: string; source?: TrackSource; cover?: string }
```

Replace with:

```ts
          | { type: 'track'; title: string; source?: TrackSource; cover?: string; shazamUrl?: string; appleMusicUrl?: string; previewUrl?: string; key?: string }
```

Inside the `else if (msg.type === 'track') {` block, just after `setCurrentCover(msg.cover ?? null);`, add:

```ts
          setLinks({
            shazamUrl: msg.shazamUrl ?? '', appleMusicUrl: msg.appleMusicUrl ?? '',
            previewUrl: msg.previewUrl ?? '', key: msg.key ?? '',
          });
```

- [ ] **Step 3: Add the save toggle in the real-track (①) branch**

In the final `return (` of the component (the ① real-track branch, the one that destructures `const { artist, title } = splitArtistTitle(currentRaw);`), add a `badge` sibling. Replace the existing `badge={ ... }` prop with this (keeps the Shazam badge, adds a Save toggle beside it):

```tsx
      badge={
        <div className="flex items-center gap-2 flex-wrap">
          {currentSource === 'shazam' && (
            <span className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.8px] uppercase font-bold text-white bg-[#0088ff] rounded-full px-2.5 py-1 shadow-[0_2px_8px_rgba(0,136,255,0.35)]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.9 7.36c-.3.41-.79.6-1.3.46-1.6-.45-3.06-.2-4.2.62-.36.26-.86.2-1.14-.15a.86.86 0 0 1 .16-1.22c1.55-1.12 3.52-1.47 5.65-.88.52.14.85.69.7 1.2a.85.85 0 0 1-.53.6Zm-.66 3.05c-.25.33-.67.48-1.06.36-1.06-.31-2-.18-2.74.36-.32.23-.77.16-1-.18a.74.74 0 0 1 .15-1.04c1.07-.78 2.45-.98 3.95-.55.42.12.66.57.5.99a.73.73 0 0 1-.04.06Zm-.86 2.86c-.2.27-.55.38-.85.27-.66-.2-1.2-.12-1.6.18-.27.2-.65.13-.84-.15a.62.62 0 0 1 .13-.87c.7-.5 1.6-.62 2.6-.32.34.1.53.46.42.8a.6.6 0 0 1-.06.31Z"/>
              </svg>
              Identified by Shazam
            </span>
          )}
          <SaveSongButton
            saved={isSaved(links.key || `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`)}
            onToggle={() => {
              const id = links.key || `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
              if (isSaved(id)) { remove(id); return; }
              save({
                raw: currentRaw, artist, title, cover: trackCover ?? undefined,
                shazamUrl: links.shazamUrl || undefined, appleMusicUrl: links.appleMusicUrl || undefined,
                previewUrl: links.previewUrl || undefined, key: links.key || undefined,
                stationName: station.name,
              });
            }}
          />
        </div>
      }
```

Then add this small component at the bottom of the file (after `NowPlayingFrame`):

```tsx
function SaveSongButton({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={saved ? 'Remove from saved songs' : 'Save song'}
      title={saved ? 'Saved — click to remove' : 'Save this song'}
      className={[
        'inline-flex items-center gap-1.5 text-[11px] tracking-[0.8px] uppercase font-bold rounded-full px-2.5 py-1 cursor-pointer transition-colors border',
        saved
          ? 'bg-[var(--color-warm)] text-white border-[var(--color-warm)]'
          : 'text-[var(--color-warm)] border-[var(--color-line)] hover:border-[var(--color-warm)]',
      ].join(' ')}
    >
      <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
      {saved ? 'Saved' : 'Save'}
    </button>
  );
}
```

> The id expression is duplicated intentionally for the `saved` prop and the toggle; both compute `links.key || normalized artist|title`, matching `buildSavedSong`'s id rule so the heart reflects the true saved state.

- [ ] **Step 4: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/NowPlaying.tsx
git commit -m "feat(now-playing): save-song heart toggle with Shazam/Apple/preview data"
```

---

## Task 7: Player pauses when a preview plays

**Files:**
- Modify: `app/components/Player.tsx`

- [ ] **Step 1: Subscribe to the playback bus**

Add to the imports in `app/components/Player.tsx`:

```ts
import { subscribePauseRadio } from '@/app/lib/playbackBus';
```

Add this effect alongside the other mount effects (e.g., right after the autoplay effect):

```ts
  // Pause the live stream when something else (a saved-song preview) starts.
  useEffect(() => {
    return subscribePauseRadio(() => {
      const a = audioRef.current;
      if (a && !a.paused) { a.pause(); setPaused(true); }
    });
  }, []);
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/Player.tsx
git commit -m "feat(player): pause radio when a preview plays (playbackBus)"
```

---

## Task 8: SavedSongsDialog (modal, search, preview, links, remove)

**Files:**
- Create: `app/components/SavedSongsDialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `app/components/SavedSongsDialog.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSavedSongs, searchSavedSongs } from '@/app/lib/savedSongs';
import { pauseRadio } from '@/app/lib/playbackBus';
import { StationLogo } from './StationLogo';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function SavedSongsDialog({ open, onOpenChange }: Props) {
  const { saved, remove } = useSavedSongs();
  const [query, setQuery] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Stop any preview when the dialog closes.
  useEffect(() => {
    if (!open) { audioRef.current?.pause(); setPreviewId(null); }
  }, [open]);

  const shown = useMemo(() => searchSavedSongs(saved, query), [saved, query]);

  if (!open) return null;

  const togglePreview = (id: string, url: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (previewId === id) { a.pause(); setPreviewId(null); return; }
    pauseRadio();           // never overlap the live stream
    a.src = url;
    a.play().catch(() => {});
    setPreviewId(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => onOpenChange(false)}>
      <audio ref={audioRef} onEnded={() => setPreviewId(null)} className="hidden" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Saved songs"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="overflow-y-auto p-7">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">★ Saved songs</h2>
            <button onClick={() => onOpenChange(false)} aria-label="Close" className="text-lg leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)] cursor-pointer">✕</button>
          </div>

          {saved.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-3)]">
              No saved songs yet — tap the ♡ on a recognized song to save it here.
            </p>
          ) : (
            <>
              {saved.length >= 5 && (
                <div className="flex items-center gap-2 border border-[var(--color-line)] rounded-full px-3.5 py-2 mb-4 bg-[var(--color-bg)]">
                  <span aria-hidden="true" className="text-[var(--color-ink-4)]">🔍</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search saved songs…"
                    className="flex-1 bg-transparent outline-none text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-4)]"
                  />
                </div>
              )}

              {shown.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-3)]">No matches.</p>
              ) : (
                <ul className="flex flex-col">
                  {shown.map(s => (
                    <li key={s.id} className="flex items-center gap-3 py-2.5 border-b border-[var(--color-line)] last:border-none">
                      <StationLogo name={s.artist || s.title} favicon={s.cover} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] leading-tight truncate">
                          {s.artist ? <><b className="font-bold text-[var(--color-ink)]">{s.artist}</b> <span className="text-[var(--color-ink-2)]">— {s.title}</span></> : <span className="font-semibold">{s.title}</span>}
                        </div>
                        <div className="text-xs text-[var(--color-ink-3)] truncate mt-0.5">♫ {s.stationName} · {hhmm(s.savedAt)}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {s.previewUrl && (
                          <button
                            onClick={() => togglePreview(s.id, s.previewUrl)}
                            aria-label={previewId === s.id ? 'Pause preview' : 'Play preview'}
                            className="w-8 h-8 rounded-full border border-[var(--color-line)] flex items-center justify-center text-[12px] text-[var(--color-ink-2)] hover:border-[var(--color-warm)] cursor-pointer"
                          >
                            {previewId === s.id ? '⏸' : '▶'}
                          </button>
                        )}
                        <a href={s.shazamUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[#0088ff] text-white">Shazam</a>
                        {s.appleMusicUrl && (
                          <a href={s.appleMusicUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold rounded-full px-2.5 py-1 bg-[var(--color-ink)] text-white">Apple Music</a>
                        )}
                        <button onClick={() => remove(s.id)} aria-label={`Remove ${s.title}`} title="Remove" className="w-7 h-7 flex items-center justify-center text-base rounded-full text-[var(--color-ink-4)] hover:text-[var(--color-accent)] cursor-pointer">✕</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/SavedSongsDialog.tsx
git commit -m "feat: SavedSongsDialog (list, search, preview, links, remove)"
```

---

## Task 9: Top-bar button + page wiring

**Files:**
- Modify: `app/components/TopBar.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add an `onOpenSaved` prop + button to TopBar**

In `app/components/TopBar.tsx`, extend `Props`:

```ts
type Props = {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenSaved: () => void;
  settingsActive: boolean;
};
```

Destructure it: `export function TopBar({ onOpenSearch, onOpenSettings, onOpenSaved, settingsActive }: Props) {`

Immediately **before** the settings `<button … aria-label={showRegion ? … : 'Settings'} …>` add a saved-songs button:

```tsx
      <button
        onClick={onOpenSaved}
        aria-label="Saved songs"
        title="Saved songs"
        className="w-10 h-10 rounded-full border border-[var(--color-line)] bg-white text-[var(--color-ink-3)] hover:text-[var(--color-ink)] hover:border-[var(--color-warm)] transition-colors cursor-pointer flex items-center justify-center shrink-0"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </button>
```

- [ ] **Step 2: Wire the dialog into the page**

In `app/page.tsx`, add the import:

```ts
import { SavedSongsDialog } from './components/SavedSongsDialog';
```

Add state beside `const [settingsOpen, setSettingsOpen] = useState(false);`:

```ts
  const [savedOpen, setSavedOpen] = useState(false);
```

Pass the prop to `<TopBar … />`:

```tsx
      <TopBar
        onOpenSearch={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSaved={() => setSavedOpen(true)}
        settingsActive={settingsOpen}
      />
```

Render the dialog next to `<SettingsDialog … />`:

```tsx
      <SavedSongsDialog open={savedOpen} onOpenChange={setSavedOpen} />
```

- [ ] **Step 3: Verify compile + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc clean; lint 0 errors (the two pre-existing `<img>` warnings are fine).

- [ ] **Step 4: Commit**

```bash
git add app/components/TopBar.tsx app/page.tsx
git commit -m "feat: top-bar Saved Songs button opens the dialog"
```

---

## Task 10: Manual verification + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full check suite**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: tsc clean; lint 0 errors; all tests pass (including the new `savedSongs` + `playbackBus` suites).

- [ ] **Step 2: Manual smoke test (recognizer running)**

Start the recognizer (`./recognizer/run.sh`) and the app (`npm run dev`), then:
1. Play a music station until a song is identified (Shazam badge).
2. Click **♡ Save** on the now-playing card → it flips to **♥ Saved**.
3. Open the top-bar **Saved songs** button → the song appears with cover, "♫ {station} · {time}", a **▶ preview**, **Shazam** + **Apple Music** links.
4. Click **▶** → preview plays and the **radio pauses**; click again → preview stops.
5. Open Shazam/Apple links in a new tab → correct track/search pages.
6. Type in the search box (with ≥5 saved) → list filters; clear → full list.
7. Click **✕** on a row → it's removed. Reload the page → saved songs persist.
8. Save a song on a **metadata-only** station (e.g. one broadcasting ICY titles, recognizer can't add links) → entry has Shazam/Apple **search** links and **no** preview button.

- [ ] **Step 3: Update the README features list**

In `README.md`, add a bullet under `## Features`:

```markdown
- 💾 **Saved songs** — save any recognized track to a personal, persisted
  playlist (top-bar button). Each entry links to Shazam and Apple Music, plays a
  ~30s preview (pausing the radio), and is fuzzy-searchable.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: note the Saved Songs feature in the README"
```

---

## Self-Review notes

- **Spec coverage:** data model (Task 4) · store (Task 5) · recognizer fields (Task 1) · SSE plumbing (Task 2) · save action + fallbacks (Tasks 4/6) · modal + search (Task 8) · top-bar entry (Task 9) · preview↔radio (Tasks 3/7/8) · edge cases (dedup Task 4, cross-tab Task 5, metadata fallback Task 4, preview hidden Task 8). All covered.
- **Type consistency:** `SavedSong`/`BuildInput` defined in Task 4 and used unchanged in Tasks 5/6/8; SSE `track` fields (`shazamUrl`/`appleMusicUrl`/`previewUrl`/`key`) defined in Task 2 and consumed in Task 6; `pauseRadio`/`subscribePauseRadio` from Task 3 used in Tasks 7/8.
- **id rule** is identical in `buildSavedSong` (Task 4) and the NowPlaying heart-state check (Task 6): `key || normalized "artist|title"`.
