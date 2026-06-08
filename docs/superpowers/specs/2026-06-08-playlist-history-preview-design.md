# Playlist-History Song Preview — Design

Let the user play a ~30s preview of any song listed in the playlist history,
directly from the history list under the player — the same kind of preview the
Saved Songs dialog already offers. Because the user is typically listening to
the live station while the history is on screen, a preview pauses the radio and
then **auto-resumes** it when the clip ends or is stopped.

## Goals

- A per-row preview control in `PlaylistHistory`: click to play a ~30s clip of
  that past song, click again (or let it end) to stop.
- Resolve the clip on demand from iTunes (history rows carry only a title), with
  graceful "no preview available" handling when there's no match.
- Pause the live radio while a preview plays and **auto-resume** it afterward
  (only if the preview was the thing that paused it).
- Reuse the existing preview machinery; no overlap between the radio and a
  preview, and only one preview playing at a time.
- No behavior change to the existing Saved Songs preview.

## Non-goals

- Persisting resolved preview URLs into the tracking-history store. History rows
  stay lean (title only), consistent with the saved-songs design note that
  history rows "only carry a title, not the rich link data". Resolution is
  cached in memory per session.
- Cover art / Apple Music links / save button on history rows. Out of scope —
  this adds preview only. (Saving a recognized song remains the Now-Playing
  card's job.)
- Cross-coordination between the Saved-Songs preview and the history preview.
  They can't be on screen at once (the dialog is a modal backdrop), so each owns
  its own `<audio>`; only the radio is coordinated via the bus.

## Architecture overview

```
PlaylistHistory row ▶ ── resolve (iTunes, cached) ──► usePreviewPlayer.toggle(key, url)
                                                          │  pauseRadio()  ──► Player pauses, flags pausedByPreview
                                                          │  <audio>.play()
                              onEnded / toggle-off / stop ─┘  resumeRadio() ──► Player resumes (if pausedByPreview)
```

## Components & changes

### 1. `app/lib/playbackBus.ts` — add a symmetric resume signal

Add `resumeRadio()` and `subscribeResumeRadio(cb)` mirroring the existing
`pauseRadio`/`subscribePauseRadio` pair (same `Set<Listener>` pub/sub). The pause
pair is unchanged.

### 2. `app/components/Player.tsx` — auto-resume only what a preview paused

Add a `pausedByPreviewRef = useRef(false)`.

- The existing `subscribePauseRadio` handler (today: `if (a && !a.paused) { a.pause(); setPaused(true); }`)
  also sets `pausedByPreviewRef.current = true` when it actually pauses a playing
  stream.
- A new `subscribeResumeRadio` handler: if `pausedByPreviewRef.current` is true,
  clear it and, if the audio is currently paused, `a.play().catch(() => cbRef.current('error'))`
  and `setPaused(false)`.

This guarantees a preview started while the radio was already paused never
spuriously starts playback. Manual user play/pause during a preview is benign:
resume only acts when the audio is still paused, so re-playing an already-playing
stream is a no-op.

### 3. `app/lib/usePreviewPlayer.ts` — shared preview-audio hook (new)

Encapsulates the audio dance currently inline in `SavedSongsDialog`.

```ts
type Options = { resumeRadioOnStop: boolean };
function usePreviewPlayer(opts: Options): {
  previewId: string | null;
  audioProps: { ref; onEnded };      // spread onto a hidden <audio>
  toggle: (id: string, url: string) => void;
  stop: () => void;                  // pause + (optional) resume, clear previewId
};
```

- `toggle(id, url)`: if `id === previewId` → `stop()`. Else: `pauseRadio()`, set
  `audio.volume = readStoredVolume()`, `audio.src = url`, `play().catch(()=>{})`,
  `setPreviewId(id)`. (Switching previews calls `pauseRadio` again — a no-op when
  already paused — and does **not** resume.)
- `stop()`: pause the audio, `setPreviewId(null)`, and if `resumeRadioOnStop`,
  call `resumeRadio()`.
- `onEnded`: same as `stop()`.

`SavedSongsDialog` migrates to this hook with `resumeRadioOnStop: false`,
preserving its current "leave radio paused" behavior. Its iTunes-backfill (on
open, persisted) and export logic are untouched; only the inline `audioRef` /
`previewId` / `togglePreview` plumbing is replaced by the hook. The dialog's
"stop preview when dialog closes" effect calls the hook's `stop()`.

### 4. `app/components/PlaylistHistory.tsx` — per-row preview

Becomes a stateful client component using `usePreviewPlayer({ resumeRadioOnStop: true })`.

- **Stable row keys.** Replace the array-index `key` with a content key so a
  prepended entry (history grows while you listen/track) doesn't shift which row
  shows ⏸: songs → `${entry.at ?? entry.time}::${entry.title}`, gaps →
  `gap::${fromAt}::${toAt}`. `previewId` uses the same song key.
- **Resolution.** On a song row's ▶ click, look up the clip via
  `lookupITunesSong([artist, title].filter(Boolean).join(' ') || raw)` (artist/
  title from `splitArtistTitle(entry.title)`). Cache the outcome in a
  `useRef<Map<string, string | null>>` keyed by the resolved term — `string` =
  previewUrl, `null` = confirmed no match. Subsequent clicks on the same song
  (any row) skip the network. Abort in-flight lookups on unmount.
- **Per-row control states** (right side of the row):
  - idle → ▶ (subtle/dimmed, brightens on hover; always rendered for
    discoverability),
  - resolving → small spinner,
  - playing (`previewId === key`) → ⏸ (prominent),
  - no match (cache `null`) → dimmed, disabled ▶ with `title="No preview available"`.
- Gap rows render exactly as today (no control).
- A single hidden `<audio>` (from the hook) lives at the component root.

### Data flow / edge cases

- Only one preview at a time (single `previewId`); starting another switches.
- Lookup miss / network error → cache `null` → "no preview" state, no crash
  (mirrors `lookupITunesSong` returning `null`).
- Radio auto-resumes on clip end or manual stop, but only if it was playing when
  the preview began (the `pausedByPreviewRef` flag).
- History prepends mid-preview keep the active ⏸ on the correct song (content
  key).
- `PlaylistHistory` returns `null` for empty history (unchanged).

## Files

- `app/lib/playbackBus.ts` — add `resumeRadio` / `subscribeResumeRadio` (edit)
- `app/lib/usePreviewPlayer.ts` — shared preview-audio hook (new)
- `app/components/Player.tsx` — `pausedByPreviewRef` + resume subscription (edit)
- `app/components/SavedSongsDialog.tsx` — adopt the hook (`resumeRadioOnStop: false`),
  no behavior change (edit)
- `app/components/PlaylistHistory.tsx` — per-row preview controls + resolution +
  stable keys (edit)

## Testing

- **Unit (Vitest):** `resumeRadio` / `subscribeResumeRadio` notify + unsubscribe
  (mirroring the existing `playbackBus` test); the pure `rowKey(entry)` helper
  (song key incl. `at`-vs-`time` fallback, gap key).
- **Manual / preview:** play a history preview → radio pauses, clip plays;
  let it end → radio auto-resumes; stop early → radio resumes; play a preview
  while radio is already paused → radio stays paused after; a song with no iTunes
  match → dimmed "no preview" control, no error; Saved-Songs preview still leaves
  the radio paused (unchanged); a preview's ⏸ stays on the right row after a new
  history entry prepends.
