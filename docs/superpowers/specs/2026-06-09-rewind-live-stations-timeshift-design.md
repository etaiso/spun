# Rewind Live Stations (Timeshift) — Design

**Date:** 2026-06-09
**Status:** Approved for planning

## Summary

Rewind any live station up to **1 hour**: step −30 s / +30 s, drag a slim
timeline, snap back to live, and jump directly to any song in the playlist
history whose start still falls inside the buffer. Works for the **active
station** (RAM ring in the renderer, instant seeks) and for up to **5
most-recently-tracked stations** (disk rings on the server, so switching into
a tracked station gives you its past hour immediately).

The buffer stores the **original compressed stream bytes** — never
transcoded, never re-encoded. Sound quality is bit-identical to live, live
latency is unchanged, and CPU cost is negligible. The feature is **on by
default** with a Settings kill-switch that reverts to today's plain
`<audio>` path.

### Resource envelope

| Stream bitrate | 1-hour buffer size |
|---|---|
| 128 kbps (typical) | ~58 MB |
| 192 kbps | ~86 MB |
| 320 kbps (worst case) | ~144 MB |

- Active station: one RAM ring in the renderer, hard byte cap **150 MB**
  (at 320 kbps that still holds the full hour).
- Tracked stations: up to 5 disk rings, worst case ~725 MB, typically
  ~300 MB. Session-only — disk returns to ~0 when the app is closed.

## Background: why this is cheap in our architecture

- Playback today is an HTML5 `<audio>` element pointed at `/api/stream`
  (`app/api/stream/route.ts`), a pass-through proxy with no buffering.
- The tracking pipeline (`app/api/now-playing/route.ts`) **already downloads
  the full audio stream** for every tracked station — it reads the bytes to
  parse ICY metadata, then discards them. Buffering tracked stations costs
  zero extra bandwidth and zero extra CPU; only memory/disk for bytes we
  already throw away.
- Chromium's Media Source Extensions (MSE) natively accept raw MP3
  (`audio/mpeg`) and AAC/ADTS (`audio/aac`) — the formats of the vast
  majority of Icecast/Shoutcast stations. Feeding the stream into a
  `SourceBuffer` instead of a direct URL makes seeking within the buffered
  window a local operation: no reconnect, no network round trip.

## Architecture

```
                       ┌──────────────────────────── server (Next.js) ───────┐
 station ──one conn──► │ /api/now-playing reader ──► ICY metadata ──► SSE    │
                       │          │ (audio bytes, de-interleaved)            │
                       │          ▼                                          │
                       │      StationTee ──► disk ring (tracked, ≤5)         │
                       │          │                                          │
                       │          ▼                                          │
                       │   /api/timeshift?url&from=<epochMs|live> ───────────┼──► renderer
                       └──────────────────────────────────────────────────────┘
 renderer: fetch(/api/timeshift) ──► JS RAM ring (1 hr, authoritative)
                                          │
                                          ▼
                            MSE SourceBuffer (sliding ~10-min window)
                                          │
                                          ▼
                                    <audio> element
```

### One upstream connection per station

When rewind is enabled, the active station's audio is served from the
**server's tee of the metadata connection**, not from a second proxy
connection. Today the active station opens two upstream connections
(`/api/stream` + the metadata reader); Icecast's burst-on-connect can put
two connections **10–30 s apart** in the stream, which would make
jump-to-song land sloppily. Unifying them:

- drops per-station bandwidth below today's usage, and
- aligns song timestamps with the audio buffer to sub-second precision.

`/api/stream` stays untouched as the fallback path.

## Components

### 1. `StationTee` (new, `app/lib/server/stationTee.ts`)

Per-station fan-out of the `/api/now-playing` upstream connection's byte
stream. Audio bytes are de-interleaved from ICY metadata (that route already
parses the interleaving) and pushed to subscribers:

- **Disk ring writer** — attached for tracked stations (≤5).
- **`/api/timeshift` responses** — attached per playback/seek request.

A tee exists for any station that is tracked or actively playing while the
feature is enabled. When neither applies, the tee detaches and the route
behaves exactly as today.

### 2. Disk ring (tracked stations)

- Location: `<userData>/timeshift/<stationId>/`.
- Format: ~1-minute **segment files** of raw stream bytes; the oldest is
  deleted as the 61st is written (continuous GC, ≤1 hour per station).
- An in-memory index maps wall-clock → (segment, byte offset). Serving from
  mid-buffer aligns to MP3 frame sync / ADTS sync boundaries so the client's
  `SourceBuffer` always receives parseable data.
- Cap: the **5 most-recently-tracked** stations. A station leaving the cap
  (or being untracked) has its ring directory deleted immediately.
- Disk-write failure for a station self-disables that ring (station becomes
  live-only), cleans up its partial directory, and never affects playback.

### 3. `/api/timeshift` route (new)

`GET /api/timeshift?url=<stationUrl>&from=<epochMs|live>`

Streams bytes starting at the requested wall-clock position: first from the
disk ring (if the position predates the live tee), then seamlessly follows
the live tee (chunked response, stays open). Response headers carry
`x-buffer-start` (epoch ms of the oldest buffered byte) so the client knows
the seekable range. This single endpoint is both the active station's
playback feed and the switch-into-tracked-history feed.

### 4. Renderer timeshift engine (new, `app/lib/timeshift/`)

Used by `app/components/Player.tsx` when the feature is on and the format
gate passes:

- `fetch('/api/timeshift?from=live')` → reader loop appends chunks to a
  **JS RAM ring**: an array of `{ bytes, wallClock }`, capped at 1 hour /
  150 MB. This ring is the authoritative client-side store.
- An MSE `MediaSource` + `SourceBuffer` (`mode: 'sequence'`) holds only a
  **sliding ~10-minute window** around the playhead — Chromium caps audio
  SourceBuffers at roughly 12 MB, so the full hour cannot live there.
  `SourceBuffer.remove()` evicts data behind/ahead of the window.
- **Seek resolution, fastest path first:**
  1. Target inside the SourceBuffer window → set `currentTime`. Instant.
  2. Target inside the RAM ring → flush SourceBuffer, re-append from RAM.
     ~Tens of ms.
  3. Target before the ring start but inside the station's disk ring →
     re-issue `fetch(?from=ts)`. ~50–100 ms, all local.
- Behind-live distance = wall-clock of newest ring chunk − wall-clock at the
  playhead. Drives the LIVE pill and clamps the +30 s button.
- **Pause becomes a real pause:** the ring keeps filling while paused, so
  resume continues where you stopped instead of snapping to live. (Falls out
  of the design for free; resuming at live remains one click away.)

### 5. Format gate & fallback

- Gate: upstream `Content-Type` is `audio/mpeg` or `audio/aac` **and**
  `MediaSource.isTypeSupported()` agrees. Ogg Vorbis/Opus, HLS, and exotic
  formats fail the gate.
- Gate fails → the player silently uses today's plain `<audio>` +
  `/api/stream` path and the rewind controls do not render.
- Any mid-session MSE failure → auto-fallback to the plain path at the live
  edge, with a small toast. The Settings toggle is the user-level escape
  hatch for the whole feature.

## Player UI

- **−30 s / +30 s buttons** flanking play/pause. Repeatable; clamped to the
  buffer edges (− stops at the oldest buffered second, + stops at live).
- **LIVE pill:** lit at the live edge. When behind, it dims, shows
  `−mm:ss`, and becomes a button — click to snap back to live.
- **Slim timeline** under the controls: shows the buffered region with the
  playhead; click or drag anywhere to seek. **Tick marks at song
  boundaries** (hover → title tooltip, click → jump to that song).
  Discontinuities (stream drops) render as visible breaks; seeks clamp
  around them.
- **Keyboard:** `J` / `L` for −30 s / +30 s (←/→ already cycle favorites);
  `Shift+L` for back-to-live. Media Session `seekbackward` /
  `seekforward` / `seekto` handlers wired so OS/hardware media keys work.
- When the format gate fails or the feature is off, none of the above
  renders — the player looks exactly as it does today.
- **Implementation note — variant review:** the visual design (timeline
  placement/thickness, LIVE pill styling, tick-mark treatment) is finalized
  by building 2–3 live variants behind a temporary dev switch and reviewing
  them in the running app's browser preview; the user picks one before the
  UI step is considered done.

## Playlist-history integration ("jump to song")

- `HistoryEntry` (`app/lib/nowPlayingTypes.ts`) gains **`startedAt`**
  (epoch ms, optional). The existing `at` field (≈ song end time —
  `recordTrack` fires when the *next* song is announced) stays for display.
- **Deriving `startedAt`:**
  - ICY metadata stations: the announcement time — stations announce at song
    start.
  - Shazam detections: `detectedAt − offset`, where `offset` is the
    recognizer's "seconds into the song the sample matched"
    (`recognizer/main.py`, returned today and currently used only for poll
    cadence). Accurate to a couple of seconds.
- The now-playing flow threads the current track's `startedAt` through so
  `recordTrack` (`app/lib/trackingHistory.ts`) persists it. Entries written
  before this feature simply lack `startedAt` and are not jumpable — no
  migration.
- **UI:** history rows whose `startedAt` falls inside the station's buffered
  range get a subtle play/jump affordance; clicking seeks to
  `startedAt − 3 s` (a small pad so the song's opening is never missed).
  Out-of-buffer rows render as plain text, exactly as today. The same data
  feeds the timeline tick marks.
- Because playback audio and metadata share one upstream connection, these
  timestamps align with the audio buffer to sub-second precision.

## Tracked-station behavior

- **Buffering scope:** every tracked station gets a disk ring automatically,
  up to the 5-station cap (most recently tracked win). No per-station
  configuration.
- **Switching into a tracked station:** playback joins at the **live edge**
  (no added latency, current behavior preserved); the timeline immediately
  exposes the station's buffered history from its disk ring. The previous
  active station's RAM ring is discarded — if that station is tracked, its
  disk ring continues server-side uninterrupted.

## Lifecycle & cleanup

Two stores with deliberately different lifetimes:

| Store | Contents | Lifetime |
|---|---|---|
| Disk rings (`<userData>/timeshift/`) | compressed audio bytes | session-only |
| Playlist history (`radio:trackingHistory`) | song names + timestamps | durable (unchanged) |

Disk-ring rules:

- **Graceful close:** delete the entire `timeshift/` directory in the
  Electron `will-quit` handler.
- **App start:** blanket-wipe `timeshift/` **before** any tee starts
  writing — the safety net for crashes, force-kills, and power loss, which
  also sweeps orphan directories for stations no longer tracked.
- **Untrack / fall out of the 5-station cap (mid-session):** that station's
  ring directory is deleted immediately.
- **Rolling GC:** within a live ring, the oldest 1-minute segment is deleted
  as the 61st is written.
- **Settings toggle OFF:** tear down all tees and delete `timeshift/`
  immediately.

Consequences: reopening the app means the pre-close hour is gone (history
still lists the songs — they're just not jumpable); disk usage is ~0
whenever the app is not running; no bytes are ever retained for a station
the user has stopped tracking. The active station's RAM ring needs no
cleanup — it is discarded on station switch and freed with the renderer.

Playlist history is untouched by all of the above: it remains
localStorage-durable across restarts per the existing tracked-station
history design, gaining only the `startedAt` field. Untracking a station
deletes its **audio**, never its song-name history.

## Settings

One toggle: **"Rewind live radio"**, default **ON**. Off means: no tees, no
disk writes, plain `<audio>` playback, no rewind controls — byte-for-byte
today's behavior. (Opt-out rather than opt-in because the feature changes
neither sound quality nor live latency; the costs are RAM/disk and a new
code path, both reverted by the toggle.)

## Edge cases & resilience

- **Upstream reconnects:** insert a timestamped discontinuity marker in the
  ring; the timeline renders a gap and seeks clamp around it.
- **System sleep/resume:** behaves as a discontinuity (gap), same handling.
- **Unknown/variable bitrate:** rings are byte-capped (150 MB RAM /
  60 segments disk), so a hot stream simply yields a slightly shorter
  window rather than unbounded growth.
- **Disk-write failure:** per-station ring self-disables; playback and
  recognition unaffected.
- **MSE runtime error:** auto-fallback to plain `<audio>` at live edge +
  toast.
- **Feature off / gate failed:** recognizer, tracking, and history flows are
  completely untouched.

## Testing

Follows the project's pure-reducer pattern (`app/lib/trackingHistory.ts`):

- **Unit (pure functions):** RAM-ring append/evict math, wall-clock ↔
  buffer-offset mapping, seek resolution (window → ring → disk →
  clamp), disk-ring segment index + GC, tracked-cap eviction, `startedAt`
  derivation (ICY vs. Shazam-offset), jump-target padding.
- **Fixture tests:** MP3 frame-sync and ADTS-sync boundary alignment against
  real stream snippets.
- **Integration:** end-to-end against live stations via the preview tools —
  seek latency, back-to-live, jump-to-song accuracy, fallback on an
  Ogg/Opus station, toggle off/on.

## Out of scope

- Timeshift for Ogg Vorbis/Opus or HLS stations (graceful fallback to
  live-only).
- Rings surviving app restarts ("DVR mode").
- Exporting/saving buffered audio to files.
- Configurable buffer length or tracked-buffer count (1 hour / 5 stations,
  fixed).
