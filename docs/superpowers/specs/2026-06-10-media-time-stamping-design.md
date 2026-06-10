# Timeshift — Media-Time Chunk Stamps — Design

**Date:** 2026-06-10
**Status:** Implemented
**Context:** Follow-up called out in the
[timeline live UX design](2026-06-10-timeline-live-ux-design.md) addendum.

## Problem

`StationTee.onAudio` stamped every chunk with `Date.now()` at receive. Icecast
delivers in bursts — worst at burst-on-connect, where ~60 s of past audio
arrives within seconds — so stamps lie about broadcast time (measured: 70.6 s
of buffered audio carrying 13.5 s of stamp span right after a tee reconnect).
Downstream, the client timeMap inherits the lie: behind-live creeps/jitters
(masked client-side by `BehindSmoother`), and song ticks / jump-to-song land
sloppily inside burst zones because playlist-history timestamps are real wall
clock while audio stamps are compressed.

## Design

A chunk's stamp is the **broadcast wall-clock of its newest sample**, derived
from audio duration (`bytes·8 / bitrate`), maintained by a new pure class
`app/lib/server/mediaClock.ts` (time injected, no I/O):

- **Settling phase (connect → burst drained).** Stamps are provisional
  arrival times; live fan-out is NOT delayed (instant playback joins keep
  working). The tee holds ring appends in a pending list whose records are
  shared with the RAM tail.
- **Settle detection.** Settled when ≥ 8 s have passed since first audio AND
  the trailing 8 s window carries ≤ 12 s of audio (one burst-cadence lump of
  slack). Force-settle after 25 s or 32 MB pending, so a pathological
  upstream degrades to today's arrival-stamp behavior instead of buffering
  forever.
- **Back-stamping.** On settle, the newest chunk's audio ends "now" (its
  arrival); earlier stamps walk backwards by each chunk's duration, clamped
  so no chunk is stamped after its own arrival (broadcast precedes arrival).
  Tail entries are corrected in place; the pending list then flushes to the
  disk ring.
- **Settled clock.** Each chunk advances the clock by its duration, clamped
  to never exceed `Date.now()` (an early arrival re-anchors the clock to the
  smaller observed delay) and to never decrease.
- **Bitrate sources**, in order: `icy-br` / `ice-audio-info` header →
  chain-validated MP3 frame-header sniff (`mp3FrameInfoAt`, exported from
  `frameSync.ts`) → measured bytes/sec after ≥ 10 s of settled delivery →
  128 kbps fallback. Declared values outside 8–2048 kbps are ignored.

### Disk-ring & discontinuity semantics

The wall-clock gap between frames remains the discontinuity marker, and gets
*more* truthful: a reconnect burst is back-stamped into the past, so the tee
flushes only frames stamped **after `DiskRing.endMs()`** (new accessor).
Overlap with audio the previous tee already persisted is dropped — ring
stamps stay strictly increasing and history replay loses the duplicated
minute it used to record. If the outage outlasts burst coverage, the
remaining gap survives as a genuine hole (client renders it as a
discontinuity, threshold unchanged at 30 s).

### Known, accepted imperfections

- Live subscribers attached during the settle window received provisional
  arrival stamps the server cannot retroactively correct (no protocol for
  it). The client `BehindSmoother` masks this, and it self-heals on the next
  stream open. Late joiners replay the corrected tail.
- Streams with no declared bitrate and non-MP3 codecs run on the 128 kbps
  fallback until the measured rate kicks in (~10 s after settle); stamps sag
  briefly if the fallback is off, then the `Date.now()` clamp re-anchors.
- A burst that arrives only after ≥ 8 s of initial silence can settle on its
  first chunk and be stamped arrival-style (≈ old behavior). Real Icecast
  bursts start with the response, so this stays theoretical.

## Testing

`tests/mediaClock.test.ts` (pure, injected time): provisional stamps, burst
back-stamp math, per-chunk arrival clamps, wall-clock clamp + re-anchor,
monotonicity under clock steps, all four bitrate sources, both force-settle
paths. `tests/stationTee.test.ts`: live fan-out vs corrected tail replay,
held-then-flushed ring appends, reconnect overlap trim, outage gap
preservation (fake `Date` only; stream pump driven by microtasks).
`tests/frameSync.test.ts` / `tests/diskRing.test.ts`: new `mp3FrameInfoAt`
and `endMs()` accessors.

## Out of scope

- A wire protocol for retro-correcting frames already sent to a live client.
- VBR-exact per-frame duration parsing (byte-rate math is within ~1% for
  radio CBR; the clamp bounds drift).
- Client-side changes — `timeMap`, `RamRing`, `BehindSmoother` are untouched
  and simply receive honest stamps now.
