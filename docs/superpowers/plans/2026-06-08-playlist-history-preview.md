# Playlist-History Song Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user play a ~30s preview of any song in the playlist history, pausing the live radio while it plays and auto-resuming it afterward.

**Architecture:** A symmetric `resumeRadio()` signal is added to the existing `playbackBus`; the `Player` tracks whether a preview was what paused it and resumes only then. A shared `usePreviewPlayer` hook encapsulates the audio/pause/volume dance (adopted by both the Saved-Songs dialog and the history list). `PlaylistHistory` becomes stateful: each song row resolves its clip on demand from iTunes (cached in-session) and plays it through the hook.

**Tech Stack:** Next.js 16 / React 19 / TypeScript (strict) · Web Audio `<audio>` · iTunes Search · Vitest.

---

## Background for the implementer (read once)

Spun shows a "playlist history" list under the player (`app/components/PlaylistHistory.tsx`), rendering `HistoryItem[]` — song entries `{ time, title, at? }` and "no tracking" gap markers `{ gap, fromAt, toAt }`. History rows carry only a title (no preview URL), unlike Saved Songs which store a `previewUrl`.

The existing preview mechanism (in `app/components/SavedSongsDialog.tsx`): a single hidden `<audio>`, a `previewId` state, and a `togglePreview(id, url)` that calls `pauseRadio()` (from `app/lib/playbackBus.ts`), sets `audio.volume = readStoredVolume()`, and plays. `app/components/Player.tsx` subscribes via `subscribePauseRadio` and pauses its `<audio>` when signalled. The radio does **not** currently auto-resume after a preview.

`app/lib/itunes.ts` exposes `lookupITunesSong(term, signal?) → { cover, appleUrl, previewUrl } | null` (keyless, CORS-enabled). `app/lib/track.ts` exposes `splitArtistTitle(raw) → { artist, title }`. The spinner class `spin-warm` exists in `app/globals.css` (used as `<span className="spin-warm" />`).

This plan: add resume to the bus, share the playback logic via a hook, and add per-row preview to the history list with on-demand iTunes resolution.

Conventions: pure logic is exported and unit-tested in `tests/<module>.test.ts` (Vitest, node env, `npm test`). DOM/audio components have no unit tests (verified in the preview), mirroring `SavedSongsDialog`. Typecheck `npx tsc --noEmit`; lint `npm run lint`. Commit after each task; every commit compiles.

---

## Task 1: `resumeRadio` signal on the playback bus

**Files:**
- Modify: `app/lib/playbackBus.ts`
- Test: `tests/playbackBus.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `tests/playbackBus.test.ts` (add `resumeRadio, subscribeResumeRadio` to the EXISTING `../app/lib/playbackBus` import line — do not add a second import statement):

```ts
describe('playbackBus — resume', () => {
  it('notifies resume subscribers and stops after unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeResumeRadio(() => { calls++; });
    resumeRadio();
    resumeRadio();
    expect(calls).toBe(2);
    unsub();
    resumeRadio();
    expect(calls).toBe(2);
  });

  it('keeps pause and resume channels independent', () => {
    let pause = 0, resume = 0;
    const u1 = subscribePauseRadio(() => { pause++; });
    const u2 = subscribeResumeRadio(() => { resume++; });
    pauseRadio();
    expect([pause, resume]).toEqual([1, 0]);
    resumeRadio();
    expect([pause, resume]).toEqual([1, 1]);
    u1(); u2();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- playbackBus`
Expected: FAIL — `resumeRadio` / `subscribeResumeRadio` not exported.

- [ ] **Step 3: Implement the resume channel**

Replace the entire contents of `app/lib/playbackBus.ts` with:

```ts
'use client';

// One-way signals coordinating the single audio output. "pause": something else
// is about to play (a preview) — the radio should pause. "resume": that preview
// ended — the radio may resume (the Player decides, only if a preview paused it).
// The Player subscribes to both; previews call pauseRadio() before playing and
// (optionally) resumeRadio() when they stop.
type Listener = () => void;

const pauseListeners = new Set<Listener>();
const resumeListeners = new Set<Listener>();

export function pauseRadio(): void {
  for (const cb of pauseListeners) cb();
}

export function subscribePauseRadio(cb: Listener): () => void {
  pauseListeners.add(cb);
  return () => { pauseListeners.delete(cb); };
}

export function resumeRadio(): void {
  for (const cb of resumeListeners) cb();
}

export function subscribeResumeRadio(cb: Listener): () => void {
  resumeListeners.add(cb);
  return () => { resumeListeners.delete(cb); };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- playbackBus`
Expected: PASS (3 cases total — 1 existing + 2 new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (existing `pauseRadio`/`subscribePauseRadio` signatures unchanged).

- [ ] **Step 6: Commit**

```bash
git add app/lib/playbackBus.ts tests/playbackBus.test.ts
git commit -m "feat: add resumeRadio signal to playbackBus"
```

---

## Task 2: `historyRowKey` stable key helper

A content-based key so a row's identity survives the history list prepending (used for both React keys and the active-preview id).

**Files:**
- Modify: `app/lib/nowPlayingTypes.ts`
- Test: `tests/nowPlayingTypes.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `tests/nowPlayingTypes.test.ts` (add `historyRowKey` to the EXISTING `../app/lib/nowPlayingTypes` import line):

```ts
describe('historyRowKey', () => {
  it('keys a song by its epoch `at` and title when present', () => {
    expect(historyRowKey({ time: '10:00', title: 'A - B', at: 1234 })).toBe('1234::A - B');
  });
  it('falls back to `time` when a song has no `at`', () => {
    expect(historyRowKey({ time: '10:00', title: 'A - B' })).toBe('10:00::A - B');
  });
  it('keys a gap by its bounds', () => {
    expect(historyRowKey({ gap: true, fromAt: 5, toAt: 9 })).toBe('gap::5::9');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- nowPlayingTypes`
Expected: FAIL — `historyRowKey` not exported.

- [ ] **Step 3: Implement the helper**

In `app/lib/nowPlayingTypes.ts`, add at the end of the file:

```ts
/** A stable, content-based key for a history row — survives the list growing
 *  (new entries prepend), unlike an array index. Used as the React key and the
 *  active-preview id in PlaylistHistory. */
export function historyRowKey(item: HistoryItem): string {
  return isGap(item)
    ? `gap::${item.fromAt}::${item.toAt}`
    : `${item.at ?? item.time}::${item.title}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- nowPlayingTypes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/nowPlayingTypes.ts tests/nowPlayingTypes.test.ts
git commit -m "feat: add historyRowKey helper"
```

---

## Task 3: `usePreviewPlayer` shared hook

Encapsulates the preview-audio dance (single `<audio>`, `previewId`, pause/optional-resume, volume). No unit test — DOM/audio, verified in the preview later (mirrors the untested `SavedSongsDialog` logic it replaces).

**Files:**
- Create: `app/lib/usePreviewPlayer.ts`

- [ ] **Step 1: Implement the hook**

Create `app/lib/usePreviewPlayer.ts`:

```ts
'use client';

import { useCallback, useRef, useState } from 'react';
import { pauseRadio, resumeRadio } from './playbackBus';
import { readStoredVolume } from './volume';

// Shared preview-audio controller. Owns one hidden <audio>, tracks which entry
// is previewing, and coordinates with the live radio via playbackBus: a preview
// always pauses the radio; whether stopping resumes it is per-caller
// (resumeRadioOnStop) — the history list resumes, the Saved-Songs dialog does not.
export function usePreviewPlayer({ resumeRadioOnStop }: { resumeRadioOnStop: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPreviewId(null);
    if (resumeRadioOnStop) resumeRadio();
  }, [resumeRadioOnStop]);

  const toggle = useCallback((id: string, url: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (previewId === id) { stop(); return; }
    pauseRadio();                 // never overlap the live stream
    a.volume = readStoredVolume(); // match the player's volume setting
    a.src = url;
    a.play().catch(() => {});
    setPreviewId(id);
  }, [previewId, stop]);

  // `onEnded` is spread onto the <audio> by the caller; ending behaves like stop.
  return { previewId, audioRef, onEnded: stop, toggle, stop };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (new file, not yet consumed).

- [ ] **Step 3: Commit**

```bash
git add app/lib/usePreviewPlayer.ts
git commit -m "feat: usePreviewPlayer hook for preview audio"
```

---

## Task 4: `Player` auto-resumes the radio a preview paused

**Files:**
- Modify: `app/components/Player.tsx`

- [ ] **Step 1: Import the resume subscription**

In `app/components/Player.tsx`, change:

```ts
import { subscribePauseRadio } from '@/app/lib/playbackBus';
```

to:

```ts
import { subscribePauseRadio, subscribeResumeRadio } from '@/app/lib/playbackBus';
```

- [ ] **Step 2: Add the `pausedByPreview` flag**

In the `Player` function body, immediately after `const audioRef = useRef<HTMLAudioElement | null>(null);`, add:

```ts
  // True only while the live stream is paused because a preview asked it to —
  // so we resume exactly that, never audio the user paused themselves.
  const pausedByPreviewRef = useRef(false);
```

- [ ] **Step 3: Set the flag on preview-pause and add the resume handler**

Replace this exact effect:

```ts
  // Pause the live stream when something else (a saved-song preview) starts.
  useEffect(() => {
    return subscribePauseRadio(() => {
      const a = audioRef.current;
      if (a && !a.paused) { a.pause(); setPaused(true); }
    });
  }, []);
```

with:

```ts
  // Pause the live stream when a preview starts; remember we did, so we can
  // resume it when the preview ends.
  useEffect(() => {
    return subscribePauseRadio(() => {
      const a = audioRef.current;
      if (a && !a.paused) { a.pause(); setPaused(true); pausedByPreviewRef.current = true; }
    });
  }, []);

  // Resume the live stream when the preview that paused it ends — but only if a
  // preview was what paused it, and only if it's still paused (so we never
  // start playback the user didn't ask for).
  useEffect(() => {
    return subscribeResumeRadio(() => {
      if (!pausedByPreviewRef.current) return;
      pausedByPreviewRef.current = false;
      const a = audioRef.current;
      if (a && a.paused) {
        a.play().then(() => setPaused(false)).catch(() => cbRef.current('error'));
      }
    });
  }, []);
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all green (no unit tests target this file).

- [ ] **Step 6: Commit**

```bash
git add app/components/Player.tsx
git commit -m "feat: auto-resume radio after a preview that paused it"
```

---

## Task 5: `SavedSongsDialog` adopts the shared hook (no behavior change)

Replace the inline preview plumbing with `usePreviewPlayer({ resumeRadioOnStop: false })` — preserving its current "leave the radio paused" behavior. The iTunes-backfill and export logic are untouched.

**Files:**
- Modify: `app/components/SavedSongsDialog.tsx`

- [ ] **Step 1: Swap imports**

Remove these two import lines:

```ts
import { pauseRadio } from '@/app/lib/playbackBus';
import { readStoredVolume } from '@/app/lib/volume';
```

Add (next to the other `@/app/lib` imports):

```ts
import { usePreviewPlayer } from '@/app/lib/usePreviewPlayer';
```

- [ ] **Step 2: Replace the preview state + audio ref with the hook**

Remove this line:

```ts
  const [previewId, setPreviewId] = useState<string | null>(null);
```

Remove this line (and its 3 comment lines directly above it):

```ts
  // The preview <audio> stays mounted regardless of `open` so this ref is always
  // valid — letting us explicitly stop the preview when the dialog closes
  // (rather than relying on the element being unmounted).
  const audioRef = useRef<HTMLAudioElement | null>(null);
```

Immediately after `const { saved, remove, update } = useSavedSongs();`, add:

```ts
  // Saved-Songs preview leaves the radio paused after a clip (resumeRadioOnStop:
  // false) — matching the long-standing behavior of this dialog.
  const { previewId, audioRef, onEnded, toggle, stop } = usePreviewPlayer({ resumeRadioOnStop: false });
```

- [ ] **Step 3: Delete the inline `togglePreview`**

Remove this entire function:

```ts
  const togglePreview = (id: string, url: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (previewId === id) { a.pause(); setPreviewId(null); return; }
    pauseRadio();           // never overlap the live stream
    a.volume = readStoredVolume(); // match the player's volume setting
    a.src = url;
    a.play().catch(() => {});
    setPreviewId(id);
  };
```

- [ ] **Step 4: Use the hook in the close effect**

Replace this exact effect:

```ts
  // Stop any preview when the dialog closes.
  useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    /* eslint-disable react-hooks/set-state-in-effect */
    setPreviewId(null);
    setExportOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);
```

with:

```ts
  // Stop any preview when the dialog closes.
  useEffect(() => {
    if (open) return;
    stop();
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setExportOpen(false);
  }, [open, stop]);
```

- [ ] **Step 5: Point the audio element and the button at the hook**

Change:

```ts
      <audio ref={audioRef} onEnded={() => setPreviewId(null)} className="hidden" />
```

to:

```ts
      <audio ref={audioRef} onEnded={onEnded} className="hidden" />
```

Change the preview button's handler:

```ts
                                onClick={() => togglePreview(s.id, s.previewUrl)}
```

to:

```ts
                                onClick={() => toggle(s.id, s.previewUrl)}
```

(The `previewId === s.id` checks in the button's `aria-label` and `⏸`/`▶` glyph already read `previewId` from the hook — leave them.)

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (If lint flags an unused `useRef`/`useState` import, confirm they are still used elsewhere in the file — `exportRef`/`previewTried` use `useRef`; `query`/`exportOpen` use `useState` — so both imports stay.)

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add app/components/SavedSongsDialog.tsx
git commit -m "refactor: SavedSongsDialog uses usePreviewPlayer (no behavior change)"
```

---

## Task 6: `PlaylistHistory` per-row preview

**Files:**
- Modify: `app/components/PlaylistHistory.tsx`

- [ ] **Step 1: Replace the component**

Replace the ENTIRE contents of `app/components/PlaylistHistory.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { splitArtistTitle } from '@/app/lib/track';
import { humanizeGap } from '@/app/lib/trackingHistory';
import { isGap, historyRowKey } from '@/app/lib/nowPlayingTypes';
import type { HistoryItem } from '@/app/lib/nowPlayingTypes';
import { lookupITunesSong } from '@/app/lib/itunes';
import { usePreviewPlayer } from '@/app/lib/usePreviewPlayer';

// iTunes search term for a history title ("Artist - Title", or the raw string).
function termFor(raw: string): string {
  const { artist, title } = splitArtistTitle(raw);
  return ([artist, title].filter(Boolean).join(' ').trim()) || raw;
}

type PreviewState = 'idle' | 'resolving' | 'playing' | 'none';

// Session playlist log, rendered below the player controls. Carries a solid
// background + soft feather so the pulse rings dissolve smoothly into it.
// Tracked stations may include "no tracking" gap markers between runs. Each song
// row can play a ~30s iTunes preview (resolved on demand), which pauses and then
// auto-resumes the live radio.
export function PlaylistHistory({ history }: { history: HistoryItem[] }) {
  const { previewId, audioRef, onEnded, toggle, stop } = usePreviewPlayer({ resumeRadioOnStop: true });
  // iTunes term -> previewUrl, or null for a confirmed no-match. Resolved lazily
  // on click and kept for the session (history rows stay lean — nothing persisted).
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  // Abort any in-flight lookups on unmount.
  const abortRef = useRef<AbortController | null>(null);
  if (!abortRef.current) abortRef.current = new AbortController();
  useEffect(() => () => abortRef.current?.abort(), []);

  if (history.length === 0) return null;

  const onPreview = (key: string, raw: string) => {
    if (previewId === key) { stop(); return; } // this row is playing → stop it
    const term = termFor(raw);
    const cached = resolved[term];
    if (cached !== undefined) { if (cached) toggle(key, cached); return; } // cached miss → no-op
    setResolvingKey(key);
    lookupITunesSong(term, abortRef.current!.signal).then(m => {
      if (abortRef.current!.signal.aborted) return;
      const url = m?.previewUrl || null;
      setResolved(r => ({ ...r, [term]: url }));
      setResolvingKey(k => (k === key ? null : k));
      if (url) toggle(key, url);
    });
  };

  return (
    <div className="relative z-10 bg-[var(--color-bg)]">
      <audio ref={audioRef} onEnded={onEnded} className="hidden" />
      <div className="text-[11px] tracking-[1.4px] uppercase font-extrabold text-[var(--color-warm)] mb-3.5">
        ▾ Playlist history
      </div>
      {history.map((h) => {
        const key = historyRowKey(h);
        if (isGap(h)) {
          return (
            <div
              key={key}
              className="flex items-center gap-3 py-3 text-[10px] tracking-[1.4px] uppercase font-bold text-[var(--color-ink-4)]"
            >
              <span className="flex-1 h-px bg-[var(--color-line)]" aria-hidden="true" />
              <span className="shrink-0">⋯ no tracking · {humanizeGap(h.fromAt, h.toAt)} ⋯</span>
              <span className="flex-1 h-px bg-[var(--color-line)]" aria-hidden="true" />
            </div>
          );
        }
        const { artist, title } = splitArtistTitle(h.title);
        const term = termFor(h.title);
        const state: PreviewState =
          previewId === key ? 'playing'
          : resolvingKey === key ? 'resolving'
          : resolved[term] === null ? 'none'
          : 'idle';
        return (
          <div
            key={key}
            className="group grid grid-cols-[64px_1fr_auto] gap-4 py-3 border-b border-[var(--color-line)] items-baseline last:border-none"
          >
            <div className="text-[13px] text-[var(--color-ink-4)] font-semibold tracking-[0.5px] tabular-nums">{h.time}</div>
            <div className="text-base text-[var(--color-ink-2)]">
              {artist ? <><b className="text-[var(--color-ink)] font-bold">{artist}</b> — {title}</> : title}
            </div>
            <PreviewButton state={state} onClick={() => onPreview(key, h.title)} />
          </div>
        );
      })}
    </div>
  );
}

function PreviewButton({ state, onClick }: { state: PreviewState; onClick: () => void }) {
  if (state === 'none') {
    return (
      <button
        type="button"
        disabled
        title="No preview available"
        aria-label="No preview available"
        className="self-center w-7 h-7 flex items-center justify-center rounded-full text-[11px] text-[var(--color-ink-4)] opacity-30 cursor-default"
      >
        ▶
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={state === 'playing' ? 'Pause preview' : 'Play preview'}
      className={[
        'self-center w-7 h-7 flex items-center justify-center rounded-full text-[11px] cursor-pointer transition-colors border',
        state === 'playing'
          ? 'text-[var(--color-warm)] border-[var(--color-warm)]'
          : 'text-[var(--color-ink-3)] border-[var(--color-line)] opacity-70 group-hover:opacity-100 hover:text-[var(--color-warm)] hover:border-[var(--color-warm)]',
      ].join(' ')}
    >
      {state === 'resolving' ? <span className="spin-warm" /> : state === 'playing' ? '⏸' : '▶'}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add app/components/PlaylistHistory.tsx
git commit -m "feat: per-row song preview in playlist history"
```

---

## Task 7: Manual verification in the preview

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server / preview** and open the app.

- [ ] **Step 2: Verify preview + auto-resume.** Select a station and let it play (audio playing). In the playlist history, click a song's ▶. **Expected:** the live radio pauses, the ~30s clip plays (button shows ⏸). Let it finish (or click ⏸). **Expected:** the clip stops and the live radio resumes playing on its own.

- [ ] **Step 3: Verify no spurious resume.** Pause the radio first (so nothing is playing), then click a history ▶ and let the clip end. **Expected:** the clip plays, and when it ends the radio stays paused (it wasn't playing when the preview began).

- [ ] **Step 4: Verify no-match handling.** Find/trigger a history entry whose title iTunes can't match (e.g. a station-ID-ish line). **Expected:** after the lookup, that row's control is dimmed/disabled with a "No preview available" tooltip; no console error.

- [ ] **Step 5: Verify only one preview at a time.** Start one history preview, then click another row's ▶. **Expected:** the first stops and the second plays; the radio remains paused across the switch.

- [ ] **Step 6: Verify Saved-Songs unchanged.** Open Saved Songs, play a preview while the radio was playing. **Expected:** radio pauses; when the clip ends the radio stays paused (the dialog's behavior is unchanged — no auto-resume).

- [ ] **Step 7: Final full check.** Run: `npm test && npx tsc --noEmit && npm run lint` — all green.

---

## Self-review notes (already reconciled)

- **Spec coverage:** resume signal (Task 1) + Player resume w/ pausedByPreview flag (Task 4); shared hook (Task 3) adopted by SavedSongsDialog with resume off (Task 5) and PlaylistHistory with resume on (Task 6); on-demand iTunes resolution + in-session cache + no-match state (Task 6); stable content keys (Task 2 + used in Task 6); always-visible-but-subtle control (Task 6 PreviewButton); testing (Tasks 1, 2, 7).
- **Type/name consistency:** `resumeRadio`/`subscribeResumeRadio`, `usePreviewPlayer({ resumeRadioOnStop })` returning `{ previewId, audioRef, onEnded, toggle, stop }`, `historyRowKey`, `termFor`, `PreviewState` are used identically across tasks.
- **Compile-safety ordering:** the hook (Task 3) and `resumeRadio` (Task 1) exist before their consumers (Tasks 4–6). Each commit compiles.
