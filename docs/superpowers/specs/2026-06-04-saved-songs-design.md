# Saved Songs — Design

A personal, persistent playlist of songs the user has saved from live radio
recognition. Each saved song links out to Shazam and Apple Music and can play a
short preview. Saved songs survive across sessions and are viewable any time,
independent of what's currently playing.

## Goals

- Let the user **curate** a playlist by explicitly saving the song currently
  being recognized.
- Persist saved songs across sessions (localStorage), viewable any time.
- Each entry links to **Shazam** and **Apple Music**, and offers a **~30s
  preview**.
- No regressions to the existing now-playing / tracking pipeline.

## Non-goals

- Saving arbitrary past playlist-history rows (they only carry a title, not the
  rich link data). Saving is anchored to the *currently recognized* song.
- Accounts / server-side sync. Everything is local (localStorage), like
  favorites/recent/hidden/tracking.
- Editing/reordering the playlist beyond add + remove.

## Data model

New store `app/lib/savedSongs.ts` — same `useSyncExternalStore` + `localStorage`
pattern as favorites/hidden/tracking. Key: `radio:savedSongs`.

```ts
type SavedSong = {
  id: string;            // Shazam track key when available, else `${artist}|${title}` normalized
  title: string;
  artist: string;        // may be '' if unsplittable
  raw: string;           // original "Artist - Title" string
  cover: string;         // cover art URL (Shazam coverart or iTunes fallback), may be ''
  shazamUrl: string;     // direct track page, or a Shazam search URL fallback
  appleMusicUrl: string; // direct deep link, or an Apple Music search URL fallback ('' only if both impossible)
  previewUrl: string;    // ~30s AAC clip; '' when unavailable (e.g. metadata-only tracks)
  stationName: string;   // where it was heard
  savedAt: number;       // Date.now()
};
```

API: `useSavedSongs() → { saved: SavedSong[], isSaved(id), save(song), remove(id) }`.
De-dup by `id`; `save` of an already-saved id is a no-op. Newest first.

## Recognizer + SSE plumbing

The Shazam payload already contains everything; the recognizer currently
discards it. Extend `recognizer/main.py` `/recognize` to also return:

- `shazamUrl` ← `track.share.href || track.url`
- `appleMusicUrl` ← parsed `https://music.apple.com/...` extracted from
  `track.hub.options[].actions` deep link; `""` if not extractable
- `previewUrl` ← `track.hub.actions[]` entry with a `.m4a` `uri`; `""` if none
- `key` ← `track.key` (stable Shazam track id, used for de-dup)

`app/api/now-playing/route.ts`: the `Recognized` type and the `track` SSE event
gain `shazamUrl`, `appleMusicUrl`, `previewUrl`, `key` (only set for
`source: 'shazam'`). Non-shazam (metadata) tracks omit them.

`app/components/NowPlaying.tsx`: keep the current song's `shazamUrl`,
`appleMusicUrl`, `previewUrl`, `key` in state next to `currentRaw`/`currentCover`
(reset per track, like the others). They feed the save action.

## Save action

A ♥/＋ button on the now-playing card's real-track state (the ① branch),
toggling save/unsave for the current song via `useSavedSongs`.

Building the `SavedSong` at save time:

- **id**: `key` if present, else normalized `${artist}|${title}`.
- **Shazam-recognized song**: use the recognizer's `shazamUrl`, `appleMusicUrl`,
  `previewUrl`, `cover`.
- **Metadata-only song** (no Shazam data): cover = current cover (iTunes
  lookup), `previewUrl = ''`, and **search-URL fallbacks**:
  - `shazamUrl = https://www.shazam.com/search/<encoded "artist title">`
  - `appleMusicUrl = https://music.apple.com/search?term=<encoded "artist title">`

So every saved song links out, even metadata-only ones; only the inline preview
is Shazam-only.

## Saved Songs modal

Opened from a **new top-bar button** (music-note/♥ icon, beside the settings
control). New component `app/components/SavedSongsDialog.tsx` (same modal shell /
Esc-to-close as `SettingsDialog`).

**Visual direction (chosen): the Settings-style white modal with a vertical
list** — i.e. the same dimmed-backdrop + white `rounded-2xl` modal as
`SettingsDialog`/`HiddenStationsSettings`, a `★ Saved songs` warm uppercase
header, a rounded-full search input (like the region picker), then calm,
scannable rows separated by hairlines. Not the glass/command-palette look and
not a cover grid — keep it consistent with the existing dialogs.

Each row (newest first): cover, **artist — title**, "heard on {station} ·
{HH:MM}", a **▶ preview** (only when `previewUrl`), **Shazam** + **Apple Music**
links (Apple hidden when `appleMusicUrl === ''`), and a ✕ to remove. Empty state:
"No saved songs yet — tap the heart on a recognized song to save it here."

**Search / fuzzy find.** A search input at the top of the modal filters the
list as you type, reusing the existing `fuzzyScore` from `app/lib/rank.ts`
(matched against each song's `raw`, i.e. "Artist - Title"). Empty query → full
list, newest first. Non-empty → keep entries with `fuzzyScore > 0`, sorted by
score descending (ties broken by `savedAt`, newest first). A "no matches" empty
state when nothing matches. Shown only when there are ≥ a few saved songs (so a
tiny list isn't cluttered by a search box).

## Preview ↔ radio coordination

New `app/lib/playbackBus.ts` — a tiny pub/sub:

- `pauseRadio()` emits a "pause" signal.
- `subscribePauseRadio(cb)` registers a listener (returns unsubscribe).

`Player` subscribes and pauses its `<audio>` when signalled. The modal's preview
`<audio>`, on play, calls `pauseRadio()` first — so the radio and a preview never
play at once. Preview ending does **not** auto-resume the radio. Only one preview
plays at a time (the dialog owns a single preview audio element keyed to the
playing entry).

## Edge cases

- De-dup by `id`; heart shows filled when `isSaved(id)`.
- Cross-tab sync via the `storage` event (like favorites).
- Apple Music link hidden when not extractable and search fallback also absent
  (shouldn't happen — search URL is always constructible from the title).
- Preview hidden for metadata-only tracks.
- Saving works regardless of whether the song is from Shazam or broadcast
  metadata; the data captured just differs (links/preview richness).

## Files

- `app/lib/savedSongs.ts` — store (new)
- `app/lib/playbackBus.ts` — preview/radio pause coordination (new)
- `app/components/SavedSongsDialog.tsx` — the modal (new)
- `recognizer/main.py` — return shazamUrl/appleMusicUrl/previewUrl/key (edit)
- `app/api/now-playing/route.ts` — thread the new fields through SSE (edit)
- `app/components/NowPlaying.tsx` — hold current song's rich fields + save button (edit)
- `app/components/Player.tsx` — subscribe to pauseRadio (edit)
- `app/components/TopBar.tsx` — new "Saved songs" button (edit)
- `app/page.tsx` — wire the dialog open/close + pass current-song save data (edit)

## Testing

- Unit: `savedSongs` store (add/dedup/remove/persist), the Apple Music URL
  parser, the metadata-fallback URL construction, and the fuzzy search
  filter/ordering (reusing `fuzzyScore`).
- Manual: save a Shazam-recognized song → appears in the modal with working
  Shazam/Apple links + preview; preview pauses the radio; save a metadata-only
  song → search-URL links, no preview; remove; reload → persists; cross-tab.
