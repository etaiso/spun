# Rewind Live Stations (Timeshift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewind any live station up to 1 hour (−30s/+30s, scrubber, back-to-live, jump-to-song), with active-station buffering in renderer RAM and disk buffering for up to 5 tracked stations.

**Architecture:** A server-side `StationTee` owns one upstream connection per station and fans audio bytes out to (a) the now-playing SSE's metadata/recognition flow, (b) an optional per-station disk ring (tracked stations), and (c) a new `/api/timeshift` framed byte stream that the renderer plays through MSE (`SourceBuffer`, `mode: 'sequence'`). The renderer keeps a 1-hour RAM ring as the authoritative client store; the SourceBuffer holds only a sliding window (Chromium caps audio SourceBuffers ≈12 MB). Wall-clock timestamps travel in-band via a 12-byte frame header, which is what makes seek math and jump-to-song exact.

**Tech Stack:** Next.js 16 route handlers (Node runtime), React 19, MSE, vitest, Electron.

**Spec:** `docs/superpowers/specs/2026-06-09-rewind-live-stations-timeshift-design.md`

---

## Read first (project context)

- **AGENTS.md warning:** this repo uses a nonstandard Next.js 16. If a route-handler API behaves unexpectedly, check `node_modules/next/dist/docs/` before fighting it. The existing routes (`app/api/stream/route.ts`, `app/api/now-playing/route.ts`) are known-good templates.
- **Tests:** vitest, files in `tests/*.test.ts`, **relative imports** (`import { x } from '../app/lib/x'`). Run with `npx vitest run tests/<file>.test.ts`.
- **Key existing files:**
  - `app/api/now-playing/route.ts` — SSE; downloads stream w/ `Icy-MetaData: 1`, parses titles via `parseIcy`, Shazam fallback via recognizer sidecar. Audio bytes currently discarded.
  - `app/lib/icy.ts` — `parseIcy(stream, metaInt)` async generator; `skip()`s audio.
  - `app/components/Player.tsx` — HTML5 `<audio src=/api/stream?...>`; play/pause/volume; keyboard Space/K/M/arrows; Media Session play/pause.
  - `app/components/NowPlaying.tsx` — active station SSE consumer; `currentStartRef` (epoch ms of current track); calls `recordTrack` on rollover for tracked stations.
  - `app/components/TrackingPanel.tsx` — `TrackedStationRow` opens per-station SSE when not active; calls `recordTrack(stationId, prevTitle)` on rollover.
  - `app/lib/trackingHistory.ts` — pure reducers (`applyTrack` etc.) + localStorage wrappers. `HistoryEntry.at` ≈ song END time.
  - `app/lib/nowPlayingTypes.ts` — `HistoryEntry`, `HistoryItem`, `historyRowKey`.
  - `app/components/PlaylistHistory.tsx` — history list UI (preview + save buttons per row).
  - `app/components/SettingsDialog.tsx` — toggle-row pattern at lines ~192-217 (Pulse rings).
  - `app/components/DebugPanel.tsx` — `Row` label/value convention; polls only while `active`.
  - `electron/main.js` — `startNextServer` env block at ~line 277 (`APP_DB_PATH` pattern); `app.getPath('userData')`.
- **Conventions:** pure logic in `app/lib/*` with unit tests; thin components; localStorage via `persistSet`; event buses like `app/lib/playbackBus.ts`.

## File map (what this plan creates/modifies)

| File | Role |
|---|---|
| `app/lib/timeshift/framing.ts` (new) | 12-byte frame codec `[f64 wallClockMs LE][u32 len LE][payload]` — shared client/server, no Node imports |
| `app/lib/timeshift/frameSync.ts` (new) | MP3/ADTS sync-word scanner for frame-aligned MSE appends |
| `app/lib/timeshift/ramRing.ts` (new) | 1-hour / 150 MB client ring of `{wallClock, bytes}` chunks |
| `app/lib/timeshift/timeMap.ts` (new) | buffer-time ↔ wall-clock anchor map (interpolated) |
| `app/lib/timeshift/resolveSeek.ts` (new) | pure seek-tier resolution (window / ram / disk / clamp) |
| `app/lib/timeshift/engine.ts` (new) | browser engine: fetch reader → ring → MSE; seeks; live-edge state |
| `app/lib/timeshift/bus.ts` (new) | seek-request + state event bus (page ↔ Player ↔ history) |
| `app/lib/timeshiftSetting.ts` (new) | "Rewind live radio" setting (default ON) |
| `app/lib/server/timeshiftDir.ts` (new) | buffer root dir + boot wipe |
| `app/lib/server/diskRing.ts` (new) | per-station segment-file ring + index + GC |
| `app/lib/server/stationTee.ts` (new) | per-URL upstream connection owner + fan-out + ring registry |
| `app/api/timeshift/route.ts` (new) | GET framed stream (`from=live\|epochMs`), DELETE ring |
| `app/api/timeshift-stats/route.ts` (new) | JSON stats for DebugPanel |
| `app/components/TimeshiftControls.tsx` (new) | −30/+30, LIVE pill, slim timeline + ticks |
| `app/lib/icy.ts` (modify) | add `demuxIcy` (audio+title events); `parseIcy` becomes a filter over it |
| `app/api/now-playing/route.ts` (modify) | `ts` param → tee path; emit `startedAt` on track events (both paths) |
| `app/lib/nowPlayingTypes.ts` (modify) | `HistoryEntry.startedAt?` |
| `app/lib/trackingHistory.ts` (modify) | thread `startedAt` through `applyTrack`/`recordTrack` |
| `app/components/NowPlaying.tsx` (modify) | consume `startedAt`, pass on rollover; tee param on SSE |
| `app/components/TrackingPanel.tsx` (modify) | same for tracked rows; disk param for top-5 |
| `app/components/PlaylistHistory.tsx` (modify) | jump-to-song affordance for in-buffer rows |
| `app/components/Player.tsx` (modify) | engine wiring, fallback, J/L/Shift+L keys, Media Session seek |
| `app/components/SettingsDialog.tsx` (modify) | "Rewind live radio" toggle |
| `app/components/DebugPanel.tsx` (modify) | timeshift rows |
| `app/page.tsx` (modify) | lift timeshift state; ticks + jump wiring |
| `electron/main.js` (modify) | `APP_TIMESHIFT_DIR` env + `will-quit` cleanup |

Constants used throughout (define once where noted): `RING_MAX_MS = 3_600_000`, `RING_MAX_BYTES = 150 * 1024 * 1024`, `SEGMENT_MS = 60_000`, `MAX_SEGMENTS = 60`, `MAX_DISK_RINGS = 5`, `LIVE_TAIL_BYTES = 128 * 1024`, `DISCONTINUITY_GAP_MS = 5_000`.

---

### Task 1: Frame codec (`framing.ts`)

The wire/disk format for timeshift bytes. Every chunk is `[f64 LE wallClockMs][u32 LE payloadLen][payload]`. Used by: disk ring files, `/api/timeshift` responses, and the client reader.

**Files:**
- Create: `app/lib/timeshift/framing.ts`
- Test: `tests/timeshiftFraming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/timeshiftFraming.test.ts
import { describe, it, expect } from 'vitest';
import { encodeFrame, FrameDecoder, FRAME_HEADER_BYTES } from '../app/lib/timeshift/framing';

describe('timeshift framing', () => {
  it('round-trips a single frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeFrame(1717939200123, payload);
    expect(frame.length).toBe(FRAME_HEADER_BYTES + 4);
    const dec = new FrameDecoder();
    const out = dec.push(frame);
    expect(out).toHaveLength(1);
    expect(out[0].wallClock).toBe(1717939200123);
    expect(Array.from(out[0].payload)).toEqual([1, 2, 3, 4]);
  });

  it('reassembles frames split across arbitrary push boundaries', () => {
    const a = encodeFrame(1000, new Uint8Array([9, 9]));
    const b = encodeFrame(2000, new Uint8Array([7]));
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0); joined.set(b, a.length);
    const dec = new FrameDecoder();
    const got: number[] = [];
    // push 1 byte at a time — worst case fragmentation
    for (let i = 0; i < joined.length; i++) {
      for (const f of dec.push(joined.subarray(i, i + 1))) got.push(f.wallClock);
    }
    expect(got).toEqual([1000, 2000]);
  });

  it('yields multiple frames from one push', () => {
    const a = encodeFrame(1, new Uint8Array(10));
    const b = encodeFrame(2, new Uint8Array(20));
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0); joined.set(b, a.length);
    const dec = new FrameDecoder();
    expect(dec.push(joined).map(f => f.payload.length)).toEqual([10, 20]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeshiftFraming.test.ts`
Expected: FAIL — cannot resolve `../app/lib/timeshift/framing`

- [ ] **Step 3: Implement**

```ts
// app/lib/timeshift/framing.ts
// Wire/disk format for timeshift audio: every chunk is framed as
// [f64 LE wallClockMs][u32 LE payloadLen][payload]. The in-band wall clock is
// what lets the client map buffer positions to real time exactly (seeks,
// jump-to-song) for both burst (historical) and live bytes.
// Shared by server (disk ring, /api/timeshift) and client (engine) — keep this
// file free of Node and DOM imports.

export const FRAME_HEADER_BYTES = 12;

export type Frame = { wallClock: number; payload: Uint8Array };

export function encodeFrame(wallClockMs: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  const dv = new DataView(out.buffer);
  dv.setFloat64(0, wallClockMs, true);
  dv.setUint32(8, payload.length, true);
  out.set(payload, FRAME_HEADER_BYTES);
  return out;
}

/** Incremental decoder — handles frames split across arbitrary chunk
 *  boundaries. push() returns every complete frame available so far. */
export class FrameDecoder {
  private buf = new Uint8Array(0);

  push(bytes: Uint8Array): Frame[] {
    if (this.buf.length === 0) {
      this.buf = bytes;
    } else {
      const next = new Uint8Array(this.buf.length + bytes.length);
      next.set(this.buf, 0);
      next.set(bytes, this.buf.length);
      this.buf = next;
    }
    const frames: Frame[] = [];
    let off = 0;
    while (this.buf.length - off >= FRAME_HEADER_BYTES) {
      const dv = new DataView(this.buf.buffer, this.buf.byteOffset + off, FRAME_HEADER_BYTES);
      const wallClock = dv.getFloat64(0, true);
      const len = dv.getUint32(8, true);
      if (this.buf.length - off < FRAME_HEADER_BYTES + len) break;
      // slice() (copy) so frames stay valid after we compact the buffer
      frames.push({ wallClock, payload: this.buf.slice(off + FRAME_HEADER_BYTES, off + FRAME_HEADER_BYTES + len) });
      off += FRAME_HEADER_BYTES + len;
    }
    if (off > 0) this.buf = this.buf.slice(off);
    return frames;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/timeshiftFraming.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/timeshift/framing.ts tests/timeshiftFraming.test.ts
git commit -m "feat(timeshift): frame codec for wall-clock-stamped audio chunks"
```

---

### Task 2: ICY demux (`demuxIcy`) — expose the audio bytes

`parseIcy` currently `skip()`s audio. Add `demuxIcy` that yields BOTH audio chunks and titles; reimplement `parseIcy` as a dedup filter over it so all existing tests/behavior stay intact.

**Files:**
- Modify: `app/lib/icy.ts`
- Test: `tests/icy.test.ts` (append new describe block; existing tests must keep passing)

- [ ] **Step 1: Write the failing test** (append to `tests/icy.test.ts`; reuse its `buildMetadataBlock`, `streamFromChunks`, `collect` helpers)

```ts
import { demuxIcy } from '../app/lib/icy';

describe('demuxIcy', () => {
  it('yields audio bytes and titles in stream order', async () => {
    const metaInt = 4;
    const audio = new Uint8Array([10, 11, 12, 13]);
    const meta = buildMetadataBlock("StreamTitle='A - B';");
    const audio2 = new Uint8Array([20, 21, 22, 23]);
    const zeroMeta = new Uint8Array([0]); // empty metadata block
    const stream = streamFromChunks([audio, meta, audio2, zeroMeta]);

    const events = await collect(demuxIcy(stream, metaInt));
    const audioBytes = events
      .filter((e): e is { kind: 'audio'; bytes: Uint8Array } => e.kind === 'audio')
      .flatMap(e => Array.from(e.bytes));
    const titles = events.filter(e => e.kind === 'title');
    expect(audioBytes).toEqual([10, 11, 12, 13, 20, 21, 22, 23]);
    expect(titles).toEqual([{ kind: 'title', title: 'A - B' }]);
  });

  it('emits partial audio as it arrives (no waiting for the full metaInt block)', async () => {
    const metaInt = 8;
    const stream = streamFromChunks([new Uint8Array([1, 2, 3])]); // stream ends mid-block
    const events = await collect(demuxIcy(stream, metaInt));
    expect(events).toEqual([{ kind: 'audio', bytes: new Uint8Array([1, 2, 3]) }]);
  });

  it('repeats duplicate titles (dedup is parseIcy concern)', async () => {
    const metaInt = 2;
    const m = buildMetadataBlock("StreamTitle='X';");
    const stream = streamFromChunks([new Uint8Array(2), m, new Uint8Array(2), m]);
    const titles = (await collect(demuxIcy(stream, metaInt))).filter(e => e.kind === 'title');
    expect(titles).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail and old ones pass**

Run: `npx vitest run tests/icy.test.ts`
Expected: existing `parseIcy` tests PASS; new `demuxIcy` tests FAIL (`demuxIcy` is not exported)

- [ ] **Step 3: Implement** — rewrite `app/lib/icy.ts` keeping `extractTitle`, `take`, `skip` logic but restructured:

```ts
export type IcyEvent = { title: string };
export type IcyDemuxEvent = { kind: 'audio'; bytes: Uint8Array } | { kind: 'title'; title: string };

// ... keep `decoder` and `extractTitle` exactly as they are ...

/** Demultiplexes an ICY stream into audio chunks and raw title events.
 *  Audio is emitted as soon as it arrives (low-latency tee), even mid-block.
 *  Titles are NOT deduped here — parseIcy layers that on. */
export async function* demuxIcy(
  stream: ReadableStream<Uint8Array>,
  metaInt: number,
): AsyncGenerator<IcyDemuxEvent> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let mode: 'audio' | 'len' | 'meta' = 'audio';
  let need = metaInt;

  // keep the existing skip()/take() helper implementations verbatim,
  // they operate over `chunks`/`buffered` exactly as before
  function take(n: number): Uint8Array { /* existing body */ }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      chunks.push(value);
      buffered += value.length;

      while (true) {
        if (mode === 'audio') {
          if (buffered === 0) break;
          const n = Math.min(buffered, need);
          yield { kind: 'audio', bytes: take(n) };
          need -= n;
          if (need > 0) break;          // wait for more of this block
          mode = 'len'; need = 1;
        } else if (mode === 'len') {
          if (buffered < 1) break;
          const metaLen = take(1)[0] * 16;
          if (metaLen === 0) { mode = 'audio'; need = metaInt; }
          else { mode = 'meta'; need = metaLen; }
        } else {
          if (buffered < need) break;
          const title = extractTitle(take(need));
          if (title !== null) yield { kind: 'title', title };
          mode = 'audio'; need = metaInt;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Title-only view with consecutive-duplicate dedup — original public API. */
export async function* parseIcy(
  stream: ReadableStream<Uint8Array>,
  metaInt: number,
): AsyncGenerator<IcyEvent> {
  let lastTitle: string | null = null;
  for await (const ev of demuxIcy(stream, metaInt)) {
    if (ev.kind === 'title' && ev.title !== lastTitle) {
      lastTitle = ev.title;
      yield { title: ev.title };
    }
  }
}
```

Note: `skip()` is no longer needed — delete it. The audio path now `take()`s.

- [ ] **Step 4: Run the FULL icy test file**

Run: `npx vitest run tests/icy.test.ts`
Expected: ALL tests pass (old parseIcy suite + new demuxIcy suite)

- [ ] **Step 5: Run the whole test suite** (parseIcy is load-bearing for recognition)

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/lib/icy.ts tests/icy.test.ts
git commit -m "feat(timeshift): demuxIcy exposes audio bytes alongside titles"
```

---

### Task 3: Frame-sync scanner (`frameSync.ts`)

When the client starts MSE appends mid-buffer (a seek), the first chunk may begin mid-MP3-frame. Scan for the codec sync word and trim to it so the SourceBuffer always receives parseable data.

**Files:**
- Create: `app/lib/timeshift/frameSync.ts`
- Test: `tests/frameSync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/frameSync.test.ts
import { describe, it, expect } from 'vitest';
import { findSyncOffset } from '../app/lib/timeshift/frameSync';

// Minimal valid MP3 frame header: 0xFF 0xFB (MPEG1 Layer III, no CRC)
const MP3_SYNC = [0xff, 0xfb, 0x90, 0x00];
// Minimal ADTS header start: 0xFF 0xF1 (MPEG-4 AAC LC, no CRC)
const ADTS_SYNC = [0xff, 0xf1, 0x50, 0x80];

describe('findSyncOffset', () => {
  it('finds an mp3 sync word after garbage', () => {
    const bytes = new Uint8Array([0x12, 0x34, ...MP3_SYNC, 0xaa]);
    expect(findSyncOffset('audio/mpeg', bytes)).toBe(2);
  });
  it('finds an adts sync word after garbage', () => {
    const bytes = new Uint8Array([0x00, ...ADTS_SYNC]);
    expect(findSyncOffset('audio/aac', bytes)).toBe(1);
  });
  it('returns 0 when the chunk already starts on a sync word', () => {
    expect(findSyncOffset('audio/mpeg', new Uint8Array(MP3_SYNC))).toBe(0);
  });
  it('rejects 0xFF bytes that are not sync words', () => {
    // 0xFF 0x00 is not a sync; real sync later
    const bytes = new Uint8Array([0xff, 0x00, ...MP3_SYNC]);
    expect(findSyncOffset('audio/mpeg', bytes)).toBe(2);
  });
  it('returns -1 when no sync word exists', () => {
    expect(findSyncOffset('audio/mpeg', new Uint8Array([1, 2, 3]))).toBe(-1);
  });
  it('passes unknown content types through at offset 0', () => {
    expect(findSyncOffset('application/octet-stream', new Uint8Array([1, 2]))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frameSync.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// app/lib/timeshift/frameSync.ts
// Codec sync-word scanners. After a seek, MSE appends restart from an arbitrary
// chunk boundary which may fall mid-frame; trimming to the next sync word keeps
// the SourceBuffer parser happy. MP3: 11 set bits + valid version/layer.
// ADTS AAC: 12 set bits + layer 00.

function isMp3Sync(b0: number, b1: number): boolean {
  // 0xFF + 0b111xxxxx, and reject reserved version (0b01) / reserved layer (0b00)
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  return version !== 0x01 && layer !== 0x00;
}

function isAdtsSync(b0: number, b1: number): boolean {
  // 0xFF + 0b1111xxx0 (syncword 0xFFF, layer must be 00)
  return b0 === 0xff && (b1 & 0xf6) === 0xf0;
}

/** Offset of the first codec frame boundary in `bytes`, or -1 if none.
 *  Unknown content types return 0 (no alignment needed/possible). */
export function findSyncOffset(contentType: string, bytes: Uint8Array): number {
  const ct = contentType.toLowerCase();
  const check = ct.includes('mpeg') || ct.includes('mp3') ? isMp3Sync
    : ct.includes('aac') ? isAdtsSync
    : null;
  if (!check) return 0;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (check(bytes[i], bytes[i + 1])) return i;
  }
  return -1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frameSync.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/timeshift/frameSync.ts tests/frameSync.test.ts
git commit -m "feat(timeshift): mp3/adts frame-sync scanner for aligned MSE appends"
```

---

### Task 4: `startedAt` in history types + reducers

`HistoryEntry` gains `startedAt` (epoch ms of when the song began airing). Thread it through the pure reducers and the localStorage wrappers.

**Files:**
- Modify: `app/lib/nowPlayingTypes.ts:9`
- Modify: `app/lib/trackingHistory.ts:64-80,127-129`
- Test: `tests/trackingHistory.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `tests/trackingHistory.test.ts`, matching its existing import/describe style)

```ts
describe('applyTrack — startedAt', () => {
  it('stores startedAt on the logged entry when provided', () => {
    let s = emptyStation();
    s = applyConnect(s, 1_000_000);
    s = applyTrack(s, 'Song A', 1_200_000, 1_050_000);
    const entry = s.items[0];
    expect(isGap(entry)).toBe(false);
    if (!isGap(entry)) {
      expect(entry.startedAt).toBe(1_050_000);
      expect(entry.at).toBe(1_200_000);
    }
  });

  it('leaves startedAt undefined when not provided (old callers)', () => {
    let s = emptyStation();
    s = applyTrack(s, 'Song B', 2_000_000);
    const entry = s.items[0];
    if (!isGap(entry)) expect(entry.startedAt).toBeUndefined();
  });
});
```

(Import `isGap` from `../app/lib/nowPlayingTypes` if the test file doesn't already.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/trackingHistory.test.ts`
Expected: new tests FAIL (TypeScript: `applyTrack` takes 3 args / `startedAt` missing on type); existing tests PASS

- [ ] **Step 3: Implement.** In `app/lib/nowPlayingTypes.ts` extend the entry type:

```ts
// A logged song. `at` (epoch ms) is set for tracking-history entries — it drives
// gap math and humanized durations; it's the moment the NEXT song was announced,
// i.e. ≈ when this one ENDED. `startedAt` (epoch ms) is when it began airing
// (ICY announce time, or Shazam detection minus the match offset) — used by the
// timeshift jump-to-song affordance. `time` (HH:MM) is for display. Both epoch
// fields are optional so pre-existing entries remain valid.
export type HistoryEntry = { time: string; title: string; at?: number; startedAt?: number };
```

In `app/lib/trackingHistory.ts`, change `applyTrack` and `recordTrack` signatures:

```ts
/** Record a finished song. Dedupes consecutive re-broadcasts, consumes an armed
 *  gap (placing it beneath the resumed song), and caps the list. `startedAt` is
 *  the song's air-start time when known (drives timeshift jump-to-song). */
export function applyTrack(s: StationHistory, finishedTitle: string, at: number, startedAt?: number): StationHistory {
  const latestSong = s.items.find((it): it is HistoryEntry => !isGap(it));
  if (latestSong && latestSong.title === finishedTitle) {
    return { ...s, lastActiveAt: at };
  }
  let items = s.items;
  if (s.gapFromAt !== undefined) {
    items = [{ gap: true, fromAt: s.gapFromAt, toAt: at }, ...items];
  }
  items = [{ time: hhmm(at), title: finishedTitle, at, startedAt }, ...items].slice(0, CAP);
  return { items, lastActiveAt: at };
}
```

```ts
/** Call when a new real track replaces `finishedTitle` (which just ended).
 *  `startedAt` = when the finished song began airing, when known. */
export function recordTrack(stationId: string, finishedTitle: string, startedAt?: number): void {
  mutate(stationId, s => applyTrack(s, finishedTitle, Date.now(), startedAt));
}
```

Also import `HistoryEntry` in trackingHistory.ts if not already imported (it currently imports `HistoryItem, HistoryEntry` — check the import line).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/trackingHistory.test.ts tests/nowPlayingTypes.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck the app compiles** (callers pass fewer args — optional param keeps them valid)

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/lib/nowPlayingTypes.ts app/lib/trackingHistory.ts tests/trackingHistory.test.ts
git commit -m "feat(timeshift): HistoryEntry.startedAt threaded through history reducers"
```

---

### Task 5: Server buffer root + disk ring

Per-station segment-file ring under a wipe-on-boot root. Segment files contain framed records (Task 1 codec), rotate every 60 s of wall-clock, GC to ≤60 segments / ≤150 MB.

**Files:**
- Create: `app/lib/server/timeshiftDir.ts`
- Create: `app/lib/server/diskRing.ts`
- Test: `tests/diskRing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/diskRing.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiskRing } from '../app/lib/server/diskRing';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spun-ring-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function drain(ring: DiskRing, fromMs: number) {
  return Array.from(ring.readFrom(fromMs));
}

describe('DiskRing', () => {
  it('round-trips appended chunks from a given wall clock', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 60, maxBytes: 1 << 20 });
    ring.append(1000, new Uint8Array([1]));
    ring.append(1500, new Uint8Array([2]));
    ring.append(2500, new Uint8Array([3])); // second segment (>= 1000ms later)
    const frames = drain(ring, 1400);
    // readFrom returns whole segments whose end >= fromMs, so the 1000ms frame
    // (same segment as 1500) is included; the caller trims by wallClock.
    expect(frames.map(f => f.wallClock)).toEqual([1000, 1500, 2500]);
    expect(drain(ring, 2400).map(f => f.wallClock)).toEqual([2500]);
    expect(drain(ring, 2600)).toEqual([]); // past the newest frame → nothing (live follows)
    ring.destroy();
  });

  it('reports startMs of the oldest retained byte', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 60, maxBytes: 1 << 20 });
    expect(ring.startMs()).toBeNull();
    ring.append(5000, new Uint8Array([1]));
    expect(ring.startMs()).toBe(5000);
    ring.destroy();
  });

  it('GCs oldest segments past maxSegments', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 2, maxBytes: 1 << 20 });
    ring.append(1000, new Uint8Array([1]));
    ring.append(2001, new Uint8Array([2]));
    ring.append(3002, new Uint8Array([3])); // rotates to 3rd segment → seg 1 GC'd
    expect(ring.startMs()).toBe(2001);
    expect(drain(ring, 0).map(f => f.wallClock)).toEqual([2001, 3002]);
    ring.destroy();
  });

  it('GCs by byte budget', () => {
    const ring = new DiskRing(dir, { segmentMs: 1000, maxSegments: 60, maxBytes: 60 });
    ring.append(1000, new Uint8Array(30)); // 42 bytes framed
    ring.append(2001, new Uint8Array(30)); // 2nd segment → 84 bytes total → GC 1st
    expect(ring.startMs()).toBe(2001);
    ring.destroy();
  });

  it('destroy removes the directory', () => {
    const sub = path.join(dir, 'x');
    const ring = new DiskRing(sub, { segmentMs: 1000, maxSegments: 2, maxBytes: 1 << 20 });
    ring.append(1, new Uint8Array([1]));
    ring.destroy();
    expect(fs.existsSync(sub)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/diskRing.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `timeshiftDir.ts`**

```ts
// app/lib/server/timeshiftDir.ts
// Root directory for timeshift disk rings. Session-only by design: wiped on
// first use after boot (crash safety-net — graceful-quit cleanup lives in
// electron/main.js), so disk usage returns to ~0 between sessions.
import fs from 'node:fs';
import path from 'node:path';

export function timeshiftRoot(): string {
  return process.env.APP_TIMESHIFT_DIR || path.join(process.cwd(), 'data', 'timeshift');
}

let wiped = false;
/** Wipe-and-recreate the root, once per server process. Call before any ring
 *  is created. Also sweeps orphan dirs from a previous crashed session. */
export function ensureCleanRoot(): string {
  const root = timeshiftRoot();
  if (!wiped) {
    wiped = true;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}
```

- [ ] **Step 4: Implement `diskRing.ts`**

```ts
// app/lib/server/diskRing.ts
// Per-station ring of segment files. Each segment holds ~SEGMENT_MS of framed
// records (see lib/timeshift/framing.ts); rotation drops the oldest segment
// past the caps — that's the continuous GC bounding each station at ≤1 hour /
// ≤150 MB. Synchronous fs is fine here: appends are ~KB-sized and reads are
// ≤ a few MB per segment, all on a local disk.
import fs from 'node:fs';
import path from 'node:path';
import { encodeFrame, FrameDecoder, type Frame } from '../timeshift/framing';

export type DiskRingOpts = { segmentMs: number; maxSegments: number; maxBytes: number };
export const DISK_RING_DEFAULTS: DiskRingOpts = {
  segmentMs: 60_000,
  maxSegments: 60,
  maxBytes: 150 * 1024 * 1024,
};

type Segment = { file: string; startMs: number; endMs: number; bytes: number };

export class DiskRing {
  private segments: Segment[] = [];
  private fd: number | null = null;
  private disabled = false;

  constructor(private dir: string, private opts: DiskRingOpts = DISK_RING_DEFAULTS) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Append one chunk. Self-disables on fs errors (station becomes live-only)
   *  without ever throwing into the tee. */
  append(wallClockMs: number, payload: Uint8Array): void {
    if (this.disabled) return;
    try {
      const cur = this.segments[this.segments.length - 1];
      if (!cur || this.fd === null || wallClockMs - cur.startMs >= this.opts.segmentMs) {
        if (this.fd !== null) fs.closeSync(this.fd);
        const file = path.join(this.dir, `seg-${Math.round(wallClockMs)}.bin`);
        this.fd = fs.openSync(file, 'w');
        this.segments.push({ file, startMs: wallClockMs, endMs: wallClockMs, bytes: 0 });
        this.gc();
      }
      const seg = this.segments[this.segments.length - 1];
      const frame = encodeFrame(wallClockMs, payload);
      fs.writeSync(this.fd!, frame);
      seg.endMs = wallClockMs;
      seg.bytes += frame.length;
    } catch {
      this.selfDisable();
    }
  }

  private gc(): void {
    while (
      this.segments.length > this.opts.maxSegments ||
      this.segments.reduce((n, s) => n + s.bytes, 0) > this.opts.maxBytes
    ) {
      // never GC the segment we're writing into
      if (this.segments.length <= 1) break;
      const oldest = this.segments.shift()!;
      try { fs.rmSync(oldest.file, { force: true }); } catch { /* ignore */ }
    }
  }

  /** All frames from every segment whose range may overlap fromMs onward.
   *  Returns whole segments — the consumer trims by frame wallClock. Reads one
   *  segment file at a time (≤ a few MB each). */
  *readFrom(fromMs: number): Generator<Frame> {
    for (const seg of [...this.segments]) {
      // Skip segments entirely older than the request. The current segment's
      // endMs advances with each append, so live data is naturally included.
      if (seg.endMs < fromMs) continue;
      let bytes: Buffer;
      try { bytes = fs.readFileSync(seg.file); } catch { continue; }
      const dec = new FrameDecoder();
      for (const f of dec.push(new Uint8Array(bytes))) yield f;
    }
  }

  /** Epoch ms of the oldest retained frame, or null when empty. */
  startMs(): number | null {
    return this.segments.length ? this.segments[0].startMs : null;
  }

  stats(): { segments: number; bytes: number; startMs: number | null } {
    return {
      segments: this.segments.length,
      bytes: this.segments.reduce((n, s) => n + s.bytes, 0),
      startMs: this.startMs(),
    };
  }

  private selfDisable(): void {
    this.disabled = true;
    try { if (this.fd !== null) fs.closeSync(this.fd); } catch { /* ignore */ }
    this.fd = null;
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    this.segments = [];
  }

  /** Close + delete everything (untrack, cap eviction, toggle off). */
  destroy(): void { this.selfDisable(); }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/diskRing.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add app/lib/server/timeshiftDir.ts app/lib/server/diskRing.ts tests/diskRing.test.ts
git commit -m "feat(timeshift): wipe-on-boot buffer root + per-station disk segment ring"
```

---

### Task 6: StationTee + registry

One upstream connection per station URL, fanned out to: title subscribers (now-playing SSE), audio subscribers (`/api/timeshift` responses), and an optional disk ring. Keeps a small RAM tail (~128 KB) so a live join can burst instantly (replicates Icecast burst-on-connect — without it, MSE playback would start seconds late).

**Files:**
- Create: `app/lib/server/stationTee.ts`
- Test: `tests/stationTee.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/stationTee.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StationTee, _resetTeesForTest, acquireTee, releaseTee } from '../app/lib/server/stationTee';

function icyResponse(chunks: Uint8Array[], headers: Record<string, string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(ch); /* stays open */ },
  });
  return new Response(body, { headers });
}

beforeEach(() => _resetTeesForTest());

describe('StationTee', () => {
  it('fans audio out to subscribers and reports content type', async () => {
    // metaint 4: [4 audio][len=0] repeating
    const chunk = new Uint8Array([1, 2, 3, 4, 0, 5, 6, 7, 8, 0]);
    const fetcher = vi.fn(async () =>
      icyResponse([chunk], { 'icy-metaint': '4', 'content-type': 'audio/mpeg' }));
    const tee = new StationTee('http://x/stream', fetcher);
    const info = await tee.ready();
    expect(info.contentType).toBe('audio/mpeg');
    expect(info.hasMeta).toBe(true);

    const got: number[] = [];
    tee.subscribeAudio({ onChunk: (_wc, b) => got.push(...b), onEnd: () => {} });
    await vi.waitFor(() => expect(got).toEqual([1, 2, 3, 4, 5, 6, 7, 8]));
    tee.shutdown();
  });

  it('replays the RAM tail to late subscribers (live-join burst)', async () => {
    const fetcher = vi.fn(async () =>
      icyResponse([new Uint8Array([9, 9, 9])], { 'content-type': 'audio/aac' })); // no metaint → raw
    const tee = new StationTee('http://x/2', fetcher);
    await tee.ready();
    await vi.waitFor(() => expect(tee.tailBytes()).toBe(3));
    const got: number[] = [];
    tee.subscribeAudio({ onChunk: (_wc, b) => got.push(...b), onEnd: () => {} });
    expect(got).toEqual([9, 9, 9]); // tail delivered synchronously on subscribe
    tee.shutdown();
  });

  it('delivers titles to title subscribers', async () => {
    // [2 audio]["StreamTitle='Hi';" metadata block]
    const payload = new TextEncoder().encode("StreamTitle='Hi';");
    const padded = Math.ceil(payload.length / 16) * 16;
    const meta = new Uint8Array(1 + padded);
    meta[0] = padded / 16; meta.set(payload, 1);
    const chunk = new Uint8Array([7, 7, ...meta]);
    const fetcher = vi.fn(async () =>
      icyResponse([chunk], { 'icy-metaint': '2', 'content-type': 'audio/mpeg' }));
    const tee = new StationTee('http://x/3', fetcher);
    const titles: string[] = [];
    tee.subscribeTitles(t => titles.push(t));
    await tee.ready();
    await vi.waitFor(() => expect(titles).toEqual(['Hi']));
    tee.shutdown();
  });

  it('registry refcounts: same tee while held, new tee after full release', async () => {
    const fetcher = vi.fn(async () =>
      icyResponse([new Uint8Array([1])], { 'content-type': 'audio/mpeg' }));
    const a = acquireTee('http://x/4', { fetcher });
    const b = acquireTee('http://x/4', { fetcher });
    expect(b).toBe(a);
    releaseTee('http://x/4');
    releaseTee('http://x/4');
    const c = acquireTee('http://x/4', { fetcher });
    expect(c).not.toBe(a);
    releaseTee('http://x/4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stationTee.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// app/lib/server/stationTee.ts
// One upstream connection per station, shared by playback and metadata.
// Unifying them (a) halves per-station bandwidth vs the old two-connection
// model and (b) aligns song timestamps with the audio buffer to sub-second —
// two Icecast connections opened at different times sit 10–30s apart in the
// stream (burst-on-connect), which would make jump-to-song land sloppily.
import { demuxIcy } from '../icy';
import { DiskRing, DISK_RING_DEFAULTS } from './diskRing';
import { ensureCleanRoot } from './timeshiftDir';
import path from 'node:path';

const UA = 'Spun/0.1';
const LIVE_TAIL_BYTES = 128 * 1024; // burst budget for instant live joins
export const MAX_DISK_RINGS = 5;

export type AudioSubscriber = {
  onChunk: (wallClockMs: number, bytes: Uint8Array) => void;
  onEnd: () => void;
};
export type TeeInfo = { contentType: string; hasMeta: boolean };
export type Fetcher = (url: string) => Promise<Response>;

const defaultFetcher: Fetcher = (url) =>
  fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': UA } });

export class StationTee {
  private audioSubs = new Set<AudioSubscriber>();
  private titleSubs = new Set<(title: string) => void>();
  private tail: { wallClock: number; bytes: Uint8Array }[] = [];
  private tailTotal = 0;
  private info: TeeInfo | null = null;
  private readyPromise: Promise<TeeInfo>;
  private abort = new AbortController();
  private bytesSeen = 0;
  private startedAtMs = 0;
  dead = false;
  ring: DiskRing | null = null;

  constructor(public url: string, fetcher: Fetcher = defaultFetcher) {
    this.readyPromise = this.run(fetcher);
  }

  private async run(fetcher: Fetcher): Promise<TeeInfo> {
    let upstream: Response;
    try {
      upstream = await fetcher(this.url);
    } catch (e) {
      this.die();
      throw new Error(`upstream fetch failed: ${String(e)}`);
    }
    if (!upstream.ok || !upstream.body) {
      this.die();
      throw new Error(`upstream returned ${upstream.status}`);
    }
    const metaInt = parseInt(upstream.headers.get('icy-metaint') || '', 10);
    const hasMeta = Number.isFinite(metaInt) && metaInt > 0;
    this.info = {
      contentType: upstream.headers.get('content-type') || 'audio/mpeg',
      hasMeta,
    };
    this.startedAtMs = Date.now();
    // Pump in the background; ready() resolves as soon as headers are known.
    void this.pump(upstream.body, hasMeta ? metaInt : 0);
    return this.info;
  }

  private async pump(body: ReadableStream<Uint8Array>, metaInt: number): Promise<void> {
    try {
      if (metaInt > 0) {
        for await (const ev of demuxIcy(body, metaInt)) {
          if (this.abort.signal.aborted) break;
          if (ev.kind === 'audio') this.onAudio(ev.bytes);
          else for (const cb of this.titleSubs) cb(ev.title);
        }
      } else {
        const reader = body.getReader();
        while (!this.abort.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          this.onAudio(value);
        }
        await reader.cancel().catch(() => {});
      }
    } catch { /* upstream died — fall through to die() */ }
    this.die();
  }

  private onAudio(bytes: Uint8Array): void {
    const wallClock = Date.now();
    this.bytesSeen += bytes.length;
    this.tail.push({ wallClock, bytes });
    this.tailTotal += bytes.length;
    while (this.tailTotal > LIVE_TAIL_BYTES && this.tail.length > 1) {
      this.tailTotal -= this.tail.shift()!.bytes.length;
    }
    this.ring?.append(wallClock, bytes);
    for (const sub of this.audioSubs) sub.onChunk(wallClock, bytes);
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.abort.abort();
    for (const sub of this.audioSubs) sub.onEnd();
    this.audioSubs.clear();
    this.titleSubs.clear();
    // NOTE: the ring is NOT destroyed here — it survives reconnects (the
    // wall-clock gap between old and new tee frames IS the discontinuity
    // marker the client renders). Rings die on untrack/cap-evict/boot-wipe.
  }

  ready(): Promise<TeeInfo> { return this.readyPromise; }

  /** Subscribe to audio; the RAM tail is replayed synchronously first so a
   *  live join starts with an instant burst. Returns an unsubscribe fn. */
  subscribeAudio(sub: AudioSubscriber): () => void {
    for (const t of this.tail) sub.onChunk(t.wallClock, t.bytes);
    this.audioSubs.add(sub);
    return () => this.audioSubs.delete(sub);
  }

  subscribeTitles(cb: (title: string) => void): () => void {
    this.titleSubs.add(cb);
    return () => this.titleSubs.delete(cb);
  }

  tailBytes(): number { return this.tailTotal; }
  bytesPerSec(): number {
    const sec = (Date.now() - this.startedAtMs) / 1000;
    return sec > 0 ? Math.round(this.bytesSeen / sec) : 0;
  }
  subscriberCount(): number { return this.audioSubs.size + this.titleSubs.size; }
  shutdown(): void { this.die(); }
}

// ---- registry ----------------------------------------------------------

type Entry = { tee: StationTee; refs: number };
const tees = new Map<string, Entry>();
const rings = new Map<string, DiskRing>(); // keyed by station id

export function acquireTee(url: string, opts?: { fetcher?: Fetcher }): StationTee {
  let entry = tees.get(url);
  if (!entry || entry.tee.dead) {
    entry = { tee: new StationTee(url, opts?.fetcher), refs: 0 };
    tees.set(url, entry);
  }
  entry.refs++;
  return entry.tee;
}

export function releaseTee(url: string): void {
  const entry = tees.get(url);
  if (!entry) return;
  entry.refs--;
  if (entry.refs <= 0) {
    entry.tee.shutdown();
    tees.delete(url);
  }
}

/** Attach (or create) the disk ring for a tracked station and wire it to the
 *  given tee. Caps at MAX_DISK_RINGS — beyond it, no ring (live-only). */
export function attachRing(stationId: string, tee: StationTee): void {
  let ring = rings.get(stationId);
  if (!ring) {
    if (rings.size >= MAX_DISK_RINGS) return;
    const root = ensureCleanRoot();
    ring = new DiskRing(path.join(root, sanitize(stationId)), DISK_RING_DEFAULTS);
    rings.set(stationId, ring);
  }
  tee.ring = ring;
}

export function getRing(stationId: string): DiskRing | undefined {
  return rings.get(stationId);
}

export function deleteRing(stationId: string): void {
  rings.get(stationId)?.destroy();
  rings.delete(stationId);
}

export function deleteAllRings(): void {
  for (const id of [...rings.keys()]) deleteRing(id);
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

export function teeStats() {
  return [...tees.entries()].map(([url, e]) => ({
    url,
    subscribers: e.tee.subscriberCount(),
    bytesPerSec: e.tee.bytesPerSec(),
    contentType: e.tee.dead ? null : (e.tee as unknown as { info: TeeInfo | null })['info']?.contentType ?? null,
  }));
}

export function ringStats() {
  return [...rings.entries()].map(([stationId, r]) => ({ stationId, ...r.stats() }));
}

export function _resetTeesForTest(): void {
  for (const [url] of tees) { tees.get(url)!.tee.shutdown(); }
  tees.clear();
  deleteAllRings();
}
```

(For `teeStats` content type, prefer adding a public `contentType(): string | null` method to `StationTee` returning `this.info?.contentType ?? null` instead of the cast shown — cleaner; do that.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stationTee.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/server/stationTee.ts tests/stationTee.test.ts
git commit -m "feat(timeshift): StationTee — single upstream connection fanned out with RAM tail burst"
```

---

### Task 7: `/api/timeshift` route (GET stream, DELETE ring)

GET serves a framed byte stream: optional disk history from `from=<epochMs>`, then follows the live tee. `from=live` skips history (the tee's RAM-tail burst still applies). DELETE drops a station's ring (untrack).

**Files:**
- Create: `app/api/timeshift/route.ts`

No unit test (route is thin glue over tested modules); verified by curl in Step 2 and end-to-end in Task 17.

- [ ] **Step 1: Implement**

```ts
// app/api/timeshift/route.ts
import { NextRequest } from 'next/server';
import { acquireTee, releaseTee, getRing, deleteRing } from '@/app/lib/server/stationTee';
import { encodeFrame } from '@/app/lib/timeshift/framing';

// Timeshift playback feed. Streams framed audio (see lib/timeshift/framing.ts):
// optionally a burst of disk-ring history from `from=<epochMs>`, then live
// chunks from the station tee, staying open until the client disconnects.
// This single endpoint is both the active station's playback feed and the
// switch-into-tracked-history feed.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  const sid = req.nextUrl.searchParams.get('sid') || '';
  const from = req.nextUrl.searchParams.get('from') || 'live';
  if (!raw) return new Response('missing url', { status: 400 });
  let url: URL;
  try { url = new URL(raw); } catch { return new Response('invalid url', { status: 400 }); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return new Response('unsupported protocol', { status: 400 });
  }
  const urlStr = url.toString();

  const tee = acquireTee(urlStr);
  let info;
  try {
    info = await tee.ready();
  } catch (e) {
    releaseTee(urlStr);
    return new Response(`upstream failed: ${String(e)}`, { status: 502 });
  }

  const ring = sid ? getRing(sid) : undefined;
  const bufferStart = ring?.startMs() ?? null;
  const fromMs = from === 'live' ? null : Number(from);

  let unsubscribe: (() => void) | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (b: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(b); } catch { closed = true; }
      };

      // Live frames can arrive while we drain disk history — queue them and
      // flush after, deduping anything the disk already covered.
      let draining = fromMs !== null && !!ring;
      const liveQueue: Uint8Array[] = [];
      let lastServedWallClock = 0;

      unsubscribe = tee.subscribeAudio({
        onChunk: (wallClock, bytes) => {
          const frame = encodeFrame(wallClock, bytes);
          if (draining) liveQueue.push(frame);
          else if (wallClock >= lastServedWallClock) safeEnqueue(frame);
        },
        onEnd: () => { closed = true; try { controller.close(); } catch { /* already closed */ } },
      });

      if (draining && ring && fromMs !== null) {
        for (const f of ring.readFrom(fromMs)) {
          if (f.wallClock < fromMs) continue; // readFrom returns whole segments
          safeEnqueue(encodeFrame(f.wallClock, f.payload));
          lastServedWallClock = f.wallClock;
        }
        draining = false;
        for (const frame of liveQueue) safeEnqueue(frame);
        liveQueue.length = 0;
      }
    },
    cancel() {
      unsubscribe?.();
      releaseTee(urlStr);
    },
  });

  req.signal.addEventListener('abort', () => {
    unsubscribe?.();
    releaseTee(urlStr);
  }, { once: true });

  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store, no-transform',
      'x-upstream-content-type': info.contentType,
      'x-buffer-start': bufferStart === null ? '' : String(bufferStart),
    },
  });
}

// Drop a tracked station's disk ring immediately (user untracked it, or it
// fell out of the 5-station cap). Audio only — playlist history is untouched.
export async function DELETE(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get('sid');
  if (!sid) return new Response('missing sid', { status: 400 });
  deleteRing(sid);
  return new Response(null, { status: 204 });
}
```

Note the dedupe subtlety: after a disk drain, queued live frames may overlap the drained range (the live tee was appending to the ring while we read it). The simple guard above (`liveQueue` filled only during drain, then flushed wholesale) can double-serve a frame in that window. Fix it by tracking `lastServedWallClock` through the flush: when flushing `liveQueue`, decode is unnecessary — instead capture wallClock alongside the frame in the queue (`liveQueue: Array<{ wallClock: number; frame: Uint8Array }>`), and flush only entries with `wallClock > lastServedWallClock`. Implement it that way.

- [ ] **Step 2: Manual verification with a real station**

Run: `npm run dev` (background), then:
```bash
curl -s -D - -o /tmp/ts.bin --max-time 5 "http://localhost:3000/api/timeshift?url=$(python3 -c "import urllib.parse;print(urllib.parse.quote('http://ice1.somafm.com/groovesalad-128-mp3'))")&from=live" ; ls -la /tmp/ts.bin
```
Expected: headers include `x-upstream-content-type: audio/mpeg`; `/tmp/ts.bin` grows to ~80 KB+ (5 s of 128 kbps + tail burst). (On Windows/PowerShell adapt with `Invoke-WebRequest`; any always-on MP3 Icecast station works.)

- [ ] **Step 3: Typecheck + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add app/api/timeshift/route.ts
git commit -m "feat(timeshift): /api/timeshift framed stream route (history burst + live follow)"
```

---

### Task 8: `/api/now-playing` — tee path + `startedAt` emission

Two changes: (1) every `track` SSE event gains `startedAt` (epoch ms — `Date.now()` for metadata titles, `Date.now() - offsetSec*1000` for Shazam matches); (2) a new `ts` query param (`1` = tee, `disk` = tee + disk ring) routes the connection through the StationTee instead of its own fetch. **With no `ts` param the route must behave byte-for-byte as today** (that's the Settings-off fallback).

**Files:**
- Modify: `app/api/now-playing/route.ts`

- [ ] **Step 1: Add `startedAt` to the legacy path.** In the metadata loop (currently `send({ type: 'track', title: event.title, source: 'metadata' })`):

```ts
send({ type: 'track', title: event.title, source: 'metadata', startedAt: Date.now() });
```

In `tryFingerprint`'s match branch, before `send`, compute:

```ts
const startedAt = match.offsetSec !== null ? Date.now() - match.offsetSec * 1000 : Date.now();
```

and add `startedAt` to the `track` event object.

- [ ] **Step 2: Add the tee path.** At the top of `GET`, read the params:

```ts
const ts = req.nextUrl.searchParams.get('ts');     // null | '1' | 'disk'
const sid = req.nextUrl.searchParams.get('sid') || '';
```

Then branch: when `ts` is null, run the existing code untouched. When set, replace the upstream fetch + parseIcy loop with the tee:

```ts
import { acquireTee, releaseTee, attachRing } from '@/app/lib/server/stationTee';

// ...inside GET, after URL validation, when ts !== null:
const tee = acquireTee(streamUrlStr);
let teeInfo;
try {
  teeInfo = await tee.ready();
} catch (e) {
  releaseTee(streamUrlStr);
  return new Response(`upstream failed: ${String(e)}`, { status: 502 });
}
if (ts === 'disk' && sid) attachRing(sid, tee);
const hasMeta = teeInfo.hasMeta;
```

Inside the ReadableStream `start`, replace the `for await (parseIcy(...))` block with a title subscription that reproduces the same semantics (junk → fingerprint nudge, real title → wins, dedup):

```ts
let unsubTitles: (() => void) | null = null;
if (hasMeta) {
  let lastRawTitle: string | null = null;
  unsubTitles = tee.subscribeTitles((title) => {
    if (closed) return;
    if (title === lastRawTitle) return;     // parseIcy deduped consecutive repeats
    lastRawTitle = title;
    if (title === '' || isJunkMetadata(title)) {
      tryFingerprint();
      return;
    }
    haveMetaTitle = true;
    (fpAbort as AbortController | null)?.abort();
    if (title !== lastTitle) {
      lastTitle = title;
      send({ type: 'track', title, source: 'metadata', startedAt: Date.now() });
    }
  });
}
// Stay open until the client goes away or the tee dies (EventSource
// auto-reconnects, which re-acquires a fresh tee — same as today's behavior
// when the upstream drops).
await new Promise<void>((resolve) => {
  req.signal.addEventListener('abort', () => resolve(), { once: true });
});
```

And in the `finally`/`cancel` of the tee branch: `unsubTitles?.(); releaseTee(streamUrlStr);` instead of `upstreamController.abort()`. The fingerprint loop, keepalive, and all SSE event types are shared between both branches — factor the stream-body construction so the only difference is the title source (direct parseIcy loop vs tee subscription) and the teardown. Keep the legacy branch's code physically intact.

Note for the tee branch: stations with no ICY metadata keep their upstream OPEN (the tee needs audio for the buffer) — unlike the legacy branch, which aborts it. That's intentional and is the cost of buffering those stations.

- [ ] **Step 3: Typecheck + existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean

- [ ] **Step 4: Manual SSE smoke test**

With `npm run dev` running:
```bash
curl -N --max-time 20 "http://localhost:3000/api/now-playing?url=<encoded-mp3-station>&ts=1&sid=test1"
```
Expected: same SSE events as without `ts`, with `startedAt` present on `track` events. Then repeat without `ts` — identical behavior minus `startedAt`'s absence is NOT expected (legacy path also emits `startedAt` now); the only difference should be connection topology.

- [ ] **Step 5: Commit**

```bash
git add app/api/now-playing/route.ts
git commit -m "feat(timeshift): now-playing rides the station tee + emits startedAt"
```

---

### Task 9: `/api/timeshift-stats` route

Read-only JSON for the DebugPanel.

**Files:**
- Create: `app/api/timeshift-stats/route.ts`

- [ ] **Step 1: Implement**

```ts
// app/api/timeshift-stats/route.ts
import { teeStats, ringStats } from '@/app/lib/server/stationTee';

// Diagnostics for the Settings debug panel: live tees (one per station with an
// open SSE/playback connection) and disk rings (tracked stations). Read-only.
export async function GET() {
  return Response.json(
    { tees: teeStats(), rings: ringStats() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
```

- [ ] **Step 2: Verify**

Run: `curl -s http://localhost:3000/api/timeshift-stats` (dev server running)
Expected: `{"tees":[...],"rings":[...]}` (arrays may be empty)

- [ ] **Step 3: Commit**

```bash
git add app/api/timeshift-stats/route.ts
git commit -m "feat(timeshift): stats route for debug panel"
```

---

### Task 10: Client pure modules — `ramRing`, `timeMap`, `resolveSeek`

The engine's testable core: the authoritative RAM ring, the buffer-time↔wall-clock map, and the seek-tier decision.

**Files:**
- Create: `app/lib/timeshift/ramRing.ts`
- Create: `app/lib/timeshift/timeMap.ts`
- Create: `app/lib/timeshift/resolveSeek.ts`
- Test: `tests/ramRing.test.ts`, `tests/timeMap.test.ts`, `tests/resolveSeek.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ramRing.test.ts
import { describe, it, expect } from 'vitest';
import { RamRing } from '../app/lib/timeshift/ramRing';

describe('RamRing', () => {
  it('stores chunks and reports range', () => {
    const r = new RamRing({ maxMs: 10_000, maxBytes: 1000 });
    r.push(1000, new Uint8Array(10));
    r.push(2000, new Uint8Array(10));
    expect(r.startMs()).toBe(1000);
    expect(r.endMs()).toBe(2000);
    expect(r.totalBytes()).toBe(20);
  });

  it('evicts by duration', () => {
    const r = new RamRing({ maxMs: 5_000, maxBytes: 1 << 20 });
    r.push(1000, new Uint8Array(1));
    r.push(7000, new Uint8Array(1)); // span 6000 > 5000 → evict first
    expect(r.startMs()).toBe(7000);
  });

  it('evicts by bytes', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 15 });
    r.push(1, new Uint8Array(10));
    r.push(2, new Uint8Array(10));
    expect(r.startMs()).toBe(2);
    expect(r.totalBytes()).toBe(10);
  });

  it('indexAt finds the first chunk at/after a wall clock', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20 });
    r.push(1000, new Uint8Array(1));
    r.push(2000, new Uint8Array(1));
    r.push(3000, new Uint8Array(1));
    expect(r.indexAt(1500)).toBe(1);
    expect(r.indexAt(2000)).toBe(1);
    expect(r.indexAt(99999)).toBe(-1);
    expect(r.indexAt(0)).toBe(0);
  });

  it('chunksFrom iterates from an index', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20 });
    r.push(1, new Uint8Array([1]));
    r.push(2, new Uint8Array([2]));
    expect([...r.chunksFrom(1)].map(c => c.wallClock)).toEqual([2]);
  });

  it('detects discontinuities (wall-clock jump beyond threshold)', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20, gapMs: 5000 });
    r.push(1000, new Uint8Array(1));
    r.push(2000, new Uint8Array(1));
    r.push(9000, new Uint8Array(1)); // 7s jump → discontinuity
    expect(r.discontinuities()).toEqual([{ fromMs: 2000, toMs: 9000 }]);
  });

  it('clear resets everything', () => {
    const r = new RamRing({ maxMs: 1 << 30, maxBytes: 1 << 20 });
    r.push(1, new Uint8Array(1));
    r.clear();
    expect(r.startMs()).toBeNull();
    expect(r.totalBytes()).toBe(0);
  });
});
```

```ts
// tests/timeMap.test.ts
import { describe, it, expect } from 'vitest';
import { TimeMap } from '../app/lib/timeshift/timeMap';

describe('TimeMap', () => {
  it('interpolates wall clock between anchors', () => {
    const m = new TimeMap();
    m.addAnchor(0, 10_000);   // buffer 0s ↔ wall 10s
    m.addAnchor(10, 20_000);  // buffer 10s ↔ wall 20s
    expect(m.wallClockAt(5)).toBe(15_000);
    expect(m.bufferTimeAt(15_000)).toBe(5);
  });

  it('clamps outside the anchored range', () => {
    const m = new TimeMap();
    m.addAnchor(0, 10_000);
    m.addAnchor(10, 20_000);
    expect(m.wallClockAt(-5)).toBe(10_000);
    expect(m.wallClockAt(99)).toBe(20_000);
  });

  it('returns null with no anchors', () => {
    const m = new TimeMap();
    expect(m.wallClockAt(0)).toBeNull();
    expect(m.bufferTimeAt(0)).toBeNull();
  });

  it('reset clears anchors', () => {
    const m = new TimeMap();
    m.addAnchor(0, 1);
    m.reset();
    expect(m.wallClockAt(0)).toBeNull();
  });

  it('caps anchor count (keeps newest)', () => {
    const m = new TimeMap(10);
    for (let i = 0; i < 100; i++) m.addAnchor(i, i * 1000);
    expect(m.wallClockAt(99)).toBe(99_000);
  });
});
```

```ts
// tests/resolveSeek.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSeek } from '../app/lib/timeshift/resolveSeek';

const win = { startMs: 5000, endMs: 6000 };
const ram = { startMs: 3000, endMs: 6000 };
const disk = { startMs: 1000, endMs: 6000 };

describe('resolveSeek', () => {
  it('window tier when target is inside the SourceBuffer window', () => {
    expect(resolveSeek(5500, win, ram, disk)).toEqual({ tier: 'window', targetMs: 5500 });
  });
  it('ram tier when inside the ring but outside the window', () => {
    expect(resolveSeek(3500, win, ram, disk)).toEqual({ tier: 'ram', targetMs: 3500 });
  });
  it('disk tier when before the ring but inside the disk buffer', () => {
    expect(resolveSeek(2000, win, ram, disk)).toEqual({ tier: 'disk', targetMs: 2000 });
  });
  it('clamps to the oldest buffered point', () => {
    expect(resolveSeek(1, win, ram, disk)).toEqual({ tier: 'disk', targetMs: 1000 });
    expect(resolveSeek(1, win, ram, null)).toEqual({ tier: 'ram', targetMs: 3000 });
  });
  it('clamps to live (ring end)', () => {
    expect(resolveSeek(99_999, win, ram, disk)).toEqual({ tier: 'window', targetMs: 6000 });
  });
  it('handles missing window (right after a rebuild)', () => {
    expect(resolveSeek(3500, null, ram, disk)).toEqual({ tier: 'ram', targetMs: 3500 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ramRing.test.ts tests/timeMap.test.ts tests/resolveSeek.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `ramRing.ts`**

```ts
// app/lib/timeshift/ramRing.ts
// The authoritative client-side buffer for the active station: 1 hour /
// 150 MB of original compressed chunks stamped with wall-clock arrival time.
// The MSE SourceBuffer holds only a small window of this (Chromium caps audio
// SourceBuffers ≈12 MB) — seeks outside that window re-append from here.
export type RingChunk = { wallClock: number; bytes: Uint8Array };
export type RamRingOpts = { maxMs: number; maxBytes: number; gapMs?: number };

export const RING_MAX_MS = 3_600_000;
export const RING_MAX_BYTES = 150 * 1024 * 1024;
export const DISCONTINUITY_GAP_MS = 5_000;

export class RamRing {
  private chunks: RingChunk[] = [];
  private bytes = 0;
  private gaps: { fromMs: number; toMs: number }[] = [];
  private gapMs: number;

  constructor(private opts: RamRingOpts = { maxMs: RING_MAX_MS, maxBytes: RING_MAX_BYTES }) {
    this.gapMs = opts.gapMs ?? DISCONTINUITY_GAP_MS;
  }

  push(wallClock: number, bytes: Uint8Array): void {
    const last = this.chunks[this.chunks.length - 1];
    if (last && wallClock - last.wallClock > this.gapMs) {
      this.gaps.push({ fromMs: last.wallClock, toMs: wallClock });
    }
    this.chunks.push({ wallClock, bytes });
    this.bytes += bytes.length;
    while (
      this.chunks.length > 1 &&
      (this.bytes > this.opts.maxBytes ||
        wallClock - this.chunks[0].wallClock > this.opts.maxMs)
    ) {
      this.bytes -= this.chunks.shift()!.bytes.length;
    }
    const start = this.chunks[0]?.wallClock ?? 0;
    this.gaps = this.gaps.filter(g => g.toMs >= start);
  }

  /** Index of the first chunk with wallClock >= ms (binary search), or -1. */
  indexAt(ms: number): number {
    let lo = 0, hi = this.chunks.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.chunks[mid].wallClock >= ms) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return ans;
  }

  *chunksFrom(index: number): Generator<RingChunk> {
    for (let i = index; i < this.chunks.length; i++) yield this.chunks[i];
  }

  chunkAt(index: number): RingChunk | undefined { return this.chunks[index]; }
  length(): number { return this.chunks.length; }
  startMs(): number | null { return this.chunks[0]?.wallClock ?? null; }
  endMs(): number | null { return this.chunks[this.chunks.length - 1]?.wallClock ?? null; }
  totalBytes(): number { return this.bytes; }
  discontinuities(): { fromMs: number; toMs: number }[] { return [...this.gaps]; }
  clear(): void { this.chunks = []; this.bytes = 0; this.gaps = []; }
}
```

- [ ] **Step 4: Implement `timeMap.ts`**

```ts
// app/lib/timeshift/timeMap.ts
// Maps the <audio> element's buffer time (seconds since the SourceBuffer was
// (re)built) to wall-clock epoch ms and back. Anchors are added after each MSE
// append: (sourceBuffer.buffered.end, wallClock of the appended chunk).
// Interpolation between anchors gives sub-second behind-live math without ever
// parsing codec frames.
type Anchor = { bufferTime: number; wallClock: number };

export class TimeMap {
  private anchors: Anchor[] = [];
  constructor(private maxAnchors = 4096) {}

  addAnchor(bufferTime: number, wallClock: number): void {
    this.anchors.push({ bufferTime, wallClock });
    if (this.anchors.length > this.maxAnchors) {
      this.anchors.splice(0, this.anchors.length - this.maxAnchors);
    }
  }

  wallClockAt(bufferTime: number): number | null {
    return this.lookup(bufferTime, 'bufferTime', 'wallClock');
  }

  bufferTimeAt(wallClock: number): number | null {
    return this.lookup(wallClock, 'wallClock', 'bufferTime');
  }

  private lookup(x: number, from: keyof Anchor, to: keyof Anchor): number | null {
    const a = this.anchors;
    if (a.length === 0) return null;
    if (x <= a[0][from]) return a[0][to];
    if (x >= a[a.length - 1][from]) return a[a.length - 1][to];
    // binary search for the surrounding pair
    let lo = 0, hi = a.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (a[mid][from] <= x) lo = mid; else hi = mid;
    }
    const l = a[lo], r = a[hi];
    const t = (x - l[from]) / (r[from] - l[from] || 1);
    return l[to] + t * (r[to] - l[to]);
  }

  reset(): void { this.anchors = []; }
}
```

- [ ] **Step 5: Implement `resolveSeek.ts`**

```ts
// app/lib/timeshift/resolveSeek.ts
// Decides how a seek to a wall-clock target is served, fastest tier first:
//   window — target is in the live SourceBuffer → set currentTime (instant)
//   ram    — in the RAM ring → rebuild the SourceBuffer from memory (~100 ms)
//   disk   — before the ring but in the tracked station's disk ring → re-fetch
// Targets outside every buffer clamp to the nearest edge.
export type Range = { startMs: number; endMs: number } | null;
export type SeekPlan = { tier: 'window' | 'ram' | 'disk'; targetMs: number };

export function resolveSeek(targetMs: number, win: Range, ram: Range, disk: Range): SeekPlan {
  const oldest = disk?.startMs ?? ram?.startMs ?? targetMs;
  const newest = ram?.endMs ?? targetMs;
  const t = Math.min(Math.max(targetMs, oldest), newest);
  if (win && t >= win.startMs && t <= win.endMs) return { tier: 'window', targetMs: t };
  if (ram && t >= ram.startMs && t <= ram.endMs) return { tier: 'ram', targetMs: t };
  if (disk && t >= disk.startMs && t <= disk.endMs) return { tier: 'disk', targetMs: t };
  // Between buffers (e.g. inside a discontinuity) — snap into the ram ring.
  return { tier: 'ram', targetMs: Math.max(t, ram?.startMs ?? t) };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/ramRing.test.ts tests/timeMap.test.ts tests/resolveSeek.test.ts`
Expected: PASS (all)

- [ ] **Step 7: Commit**

```bash
git add app/lib/timeshift/ramRing.ts app/lib/timeshift/timeMap.ts app/lib/timeshift/resolveSeek.ts tests/ramRing.test.ts tests/timeMap.test.ts tests/resolveSeek.test.ts
git commit -m "feat(timeshift): client pure core — ram ring, time map, seek resolution"
```

---

### Task 11: Timeshift engine + bus

The browser orchestrator. Not unit-testable (MSE/fetch are DOM APIs — vitest here has no jsdom MSE); its logic lives in the Task 10 modules, and behavior is verified live in Tasks 13/17. Keep this file thin and defensive: ANY internal error → `onFallback()` so the Player reverts to the plain `<audio>` path.

**Files:**
- Create: `app/lib/timeshift/engine.ts`
- Create: `app/lib/timeshift/bus.ts`

- [ ] **Step 1: Implement `bus.ts`** (mirrors `app/lib/playbackBus.ts` pattern)

```ts
// app/lib/timeshift/bus.ts
'use client';

// Tiny event bus decoupling the timeshift engine (owned by Player) from the
// rest of the UI: PlaylistHistory requests jump-to-song seeks; the page and
// DebugPanel read the latest engine state.
import type { TimeshiftState } from './engine';

type SeekListener = (wallClockMs: number) => void;
const seekListeners = new Set<SeekListener>();

export function requestSeekToWallClock(ms: number): void {
  for (const cb of seekListeners) cb(ms);
}
export function subscribeSeekRequests(cb: SeekListener): () => void {
  seekListeners.add(cb);
  return () => seekListeners.delete(cb);
}

let lastState: TimeshiftState | null = null;
type StateListener = (s: TimeshiftState | null) => void;
const stateListeners = new Set<StateListener>();

export function publishTimeshiftState(s: TimeshiftState | null): void {
  lastState = s;
  for (const cb of stateListeners) cb(s);
}
export function getTimeshiftState(): TimeshiftState | null { return lastState; }
export function subscribeTimeshiftState(cb: StateListener): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}
```

- [ ] **Step 2: Implement `engine.ts`**

```ts
// app/lib/timeshift/engine.ts
'use client';

// MSE playback engine for the active station. Pulls the framed /api/timeshift
// stream, keeps the authoritative RamRing (1 hr), and feeds a SourceBuffer
// ('sequence' mode) a sliding window around the playhead. Seeks resolve
// fastest-tier-first (resolveSeek). Every failure path calls onFallback() —
// the Player then reverts to today's plain <audio> + /api/stream.
import { FrameDecoder } from './framing';
import { findSyncOffset } from './frameSync';
import { RamRing } from './ramRing';
import { TimeMap } from './timeMap';
import { resolveSeek, type Range } from './resolveSeek';

const AHEAD_MAX_SEC = 45;      // stop appending this far ahead of the playhead
const BEHIND_KEEP_SEC = 180;   // evict SourceBuffer data older than this
const STATE_TICK_MS = 500;

export type TimeshiftState = {
  active: true;
  behindSec: number;            // 0 at the live edge
  playheadMs: number | null;    // wall clock at the playhead
  liveEdgeMs: number | null;
  bufferStartMs: number | null; // oldest seekable (disk-aware)
  ramStartMs: number | null;
  ramBytes: number;
  sourceBufferAhead: number;    // seconds buffered ahead of playhead
  lastSeekTier: 'window' | 'ram' | 'disk' | null;
  discontinuities: { fromMs: number; toMs: number }[];
  contentType: string;
};

export type EngineOpts = {
  streamUrl: string;
  stationId: string;
  onState: (s: TimeshiftState) => void;
  onFallback: (reason: string) => void;
};

function mseMime(contentType: string): string | null {
  const ct = contentType.toLowerCase();
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'audio/mpeg';
  if (ct.includes('aac')) return 'audio/aac';
  return null;
}

export class TimeshiftEngine {
  private ring = new RamRing();
  private timeMap = new TimeMap();
  private mediaSource: MediaSource | null = null;
  private sb: SourceBuffer | null = null;
  private fetchAbort: AbortController | null = null;
  private appendCursor = 0;          // ring index of the next chunk to append
  private appendedWallClocks: number[] = []; // wallClock per in-flight append
  private contentType = '';
  private mime = '';
  private diskStartMs: number | null = null;
  private lastSeekTier: TimeshiftState['lastSeekTier'] = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private objectUrl: string | null = null;

  constructor(private audio: HTMLAudioElement, private opts: EngineOpts) {}

  /** Resolves true when MSE playback is wired up; false → caller uses the
   *  plain path (no error UI — this is the format gate). */
  async start(): Promise<boolean> {
    if (typeof MediaSource === 'undefined') return false;
    try {
      const ok = await this.openStream('live');
      if (!ok) return false;
      await this.buildMediaSource(/* fromIndex */ 0);
      this.stateTimer = setInterval(() => this.publishState(), STATE_TICK_MS);
      return true;
    } catch (e) {
      this.fail(`start: ${String(e)}`);
      return false;
    }
  }

  /** Open (or re-open) the framed stream. from='live' or epoch ms. Returns
   *  false when the format gate fails (not an error). */
  private async openStream(from: 'live' | number): Promise<boolean> {
    this.fetchAbort?.abort();
    this.fetchAbort = new AbortController();
    const url = `/api/timeshift?url=${encodeURIComponent(this.opts.streamUrl)}` +
      `&sid=${encodeURIComponent(this.opts.stationId)}&from=${from}`;
    const res = await fetch(url, { signal: this.fetchAbort.signal });
    if (!res.ok || !res.body) throw new Error(`timeshift route ${res.status}`);
    this.contentType = res.headers.get('x-upstream-content-type') || '';
    const mime = mseMime(this.contentType);
    if (!mime || !MediaSource.isTypeSupported(mime)) {
      this.fetchAbort.abort();
      return false; // format gate — silent fallback
    }
    this.mime = mime;
    const bufStart = res.headers.get('x-buffer-start');
    this.diskStartMs = bufStart ? Number(bufStart) : null;
    if (from !== 'live') this.ring.clear(); // disk seek replays through to live
    void this.pump(res.body, this.fetchAbort.signal);
    return true;
  }

  private async pump(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const dec = new FrameDecoder();
    try {
      while (!signal.aborted && !this.stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const f of dec.push(value)) this.ring.push(f.wallClock, f.payload);
        this.tryAppend();
      }
    } catch (e) {
      if (!signal.aborted && !this.stopped) this.fail(`stream: ${String(e)}`);
    }
  }

  /** (Re)create the MediaSource pipeline appending from a ring index. Used on
   *  start and for ram/disk-tier seeks (recreate > surgical SourceBuffer
   *  remove/re-append — simpler and immune to 'sequence' timestamp drift). */
  private buildMediaSource(fromIndex: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      const ms = new MediaSource();
      this.mediaSource = ms;
      this.sb = null;
      this.timeMap.reset();
      this.appendCursor = fromIndex;
      this.appendedWallClocks = [];
      this.objectUrl = URL.createObjectURL(ms);
      const wasPaused = this.audio.paused;
      this.audio.src = this.objectUrl;
      ms.addEventListener('sourceopen', () => {
        try {
          const sb = ms.addSourceBuffer(this.mime);
          sb.mode = 'sequence';
          this.sb = sb;
          sb.addEventListener('updateend', () => this.onUpdateEnd());
          sb.addEventListener('error', () => this.fail('sourcebuffer error'));
          this.tryAppend();
          if (!wasPaused) this.audio.play().catch(() => { /* gesture-gated */ });
          resolve();
        } catch (e) { reject(e); }
      }, { once: true });
    });
  }

  /** Append the next ring chunk when allowed: SourceBuffer idle, playhead not
   *  too far behind the append head (AHEAD_MAX), frame-aligned at (re)starts. */
  private tryAppend(): void {
    const sb = this.sb;
    if (!sb || sb.updating || this.stopped) return;
    if (this.appendCursor >= this.ring.length()) return;
    // Don't run unboundedly ahead of the playhead (12 MB Chromium quota).
    const buffered = sb.buffered;
    if (buffered.length > 0 &&
        buffered.end(buffered.length - 1) - this.audio.currentTime > AHEAD_MAX_SEC &&
        !this.audio.paused) {
      return; // timeupdate listener re-kicks us
    }
    const chunk = this.ring.chunkAt(this.appendCursor);
    if (!chunk) return;
    let bytes = chunk.bytes;
    if (this.appendedWallClocks.length === 0) {
      // First append after a (re)build — align to a codec frame boundary.
      const off = findSyncOffset(this.contentType, bytes);
      if (off < 0) { this.appendCursor++; this.tryAppend(); return; }
      bytes = bytes.subarray(off);
    }
    try {
      this.evictBehind();
      sb.appendBuffer(bytes as BufferSource);
      this.appendedWallClocks.push(chunk.wallClock);
      this.appendCursor++;
    } catch (e) {
      if ((e as DOMException)?.name === 'QuotaExceededError') {
        this.evictBehind(true);
        // retried on the next updateend/tick
      } else {
        this.fail(`append: ${String(e)}`);
      }
    }
  }

  private onUpdateEnd(): void {
    const sb = this.sb;
    if (!sb) return;
    const wc = this.appendedWallClocks.shift();
    const buffered = sb.buffered;
    if (wc !== undefined && buffered.length > 0) {
      this.timeMap.addAnchor(buffered.end(buffered.length - 1), wc);
    }
    this.tryAppend();
  }

  private evictBehind(aggressive = false): void {
    const sb = this.sb;
    if (!sb || sb.updating) return;
    const buffered = sb.buffered;
    if (buffered.length === 0) return;
    const keep = aggressive ? 30 : BEHIND_KEEP_SEC;
    const cut = this.audio.currentTime - keep;
    if (cut > buffered.start(0)) {
      try { sb.remove(buffered.start(0), cut); } catch { /* updating — later */ }
    }
  }

  // ---- public controls -------------------------------------------------

  seekBy(deltaSec: number): void {
    const playheadMs = this.playheadWallClock();
    if (playheadMs === null) return;
    this.seekToWallClock(playheadMs + deltaSec * 1000);
  }

  goLive(): void {
    const end = this.ring.endMs();
    if (end !== null) this.seekToWallClock(end);
  }

  seekToWallClock(targetMs: number): void {
    try {
      const win = this.windowRange();
      const ram: Range = this.ring.startMs() !== null
        ? { startMs: this.ring.startMs()!, endMs: this.ring.endMs()! } : null;
      const disk: Range = this.diskStartMs !== null && ram
        ? { startMs: this.diskStartMs, endMs: ram.endMs } : null;
      const plan = resolveSeek(targetMs, win, ram, disk);
      this.lastSeekTier = plan.tier;
      if (plan.tier === 'window') {
        const bt = this.timeMap.bufferTimeAt(plan.targetMs);
        if (bt !== null) this.audio.currentTime = bt;
      } else if (plan.tier === 'ram') {
        const idx = this.ring.indexAt(plan.targetMs);
        if (idx >= 0) void this.buildMediaSource(idx).catch(e => this.fail(String(e)));
      } else {
        // disk: re-open the stream from the target; ring is cleared and
        // rebuilt from the replayed history through to live.
        void this.openStream(plan.targetMs)
          .then(() => this.buildMediaSource(0))
          .catch(e => this.fail(String(e)));
      }
      this.publishState();
    } catch (e) {
      this.fail(`seek: ${String(e)}`);
    }
  }

  /** Call from the audio element's timeupdate — keeps the append loop fed. */
  onTimeUpdate(): void { this.tryAppend(); }

  // ---- state -------------------------------------------------------------

  private windowRange(): Range {
    const sb = this.sb;
    if (!sb || sb.buffered.length === 0) return null;
    const start = this.timeMap.wallClockAt(sb.buffered.start(0));
    const end = this.timeMap.wallClockAt(sb.buffered.end(sb.buffered.length - 1));
    return start !== null && end !== null ? { startMs: start, endMs: end } : null;
  }

  private playheadWallClock(): number | null {
    return this.timeMap.wallClockAt(this.audio.currentTime);
  }

  getState(): TimeshiftState {
    const playheadMs = this.playheadWallClock();
    const liveEdgeMs = this.ring.endMs();
    const sb = this.sb;
    const ahead = sb && sb.buffered.length > 0
      ? Math.max(0, sb.buffered.end(sb.buffered.length - 1) - this.audio.currentTime)
      : 0;
    return {
      active: true,
      behindSec: playheadMs !== null && liveEdgeMs !== null
        ? Math.max(0, (liveEdgeMs - playheadMs) / 1000) : 0,
      playheadMs,
      liveEdgeMs,
      bufferStartMs: this.diskStartMs ?? this.ring.startMs(),
      ramStartMs: this.ring.startMs(),
      ramBytes: this.ring.totalBytes(),
      sourceBufferAhead: ahead,
      lastSeekTier: this.lastSeekTier,
      discontinuities: this.ring.discontinuities(),
      contentType: this.contentType,
    };
  }

  private publishState(): void {
    if (!this.stopped) this.opts.onState(this.getState());
  }

  private fail(reason: string): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onFallback(reason);
  }

  stop(): void {
    this.stopped = true;
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.fetchAbort?.abort();
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.ring.clear();
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add app/lib/timeshift/engine.ts app/lib/timeshift/bus.ts
git commit -m "feat(timeshift): MSE engine + seek/state bus"
```

---

### Task 12: Settings toggle ("Rewind live radio")

Default ON. Mirrors the `useRingsEnabled` / autoplay localStorage pattern; also a plain getter for non-React reads (Player decides its mode before effects run).

**Files:**
- Create: `app/lib/timeshiftSetting.ts`
- Modify: `app/components/SettingsDialog.tsx` (new section after "Pulse rings", ~line 217)
- Test: `tests/timeshiftSetting.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/timeshiftSetting.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { timeshiftEnabled, TIMESHIFT_KEY } from '../app/lib/timeshiftSetting';

// vitest environment is node — emulate the storage shape we read.
beforeEach(() => {
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      store: {} as Record<string, string>,
      getItem(k: string) { return (this.store as Record<string, string>)[k] ?? null; },
      setItem(k: string, v: string) { (this.store as Record<string, string>)[k] = v; },
    },
  };
});

describe('timeshiftEnabled', () => {
  it('defaults to true', () => {
    expect(timeshiftEnabled()).toBe(true);
  });
  it('respects a stored false', () => {
    (window as unknown as { localStorage: Storage }).localStorage.setItem(TIMESHIFT_KEY, 'false');
    expect(timeshiftEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeshiftSetting.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement** (modeled on `app/lib/tracking.ts` store + hook shape)

```ts
// app/lib/timeshiftSetting.ts
'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { persistSet } from './persist';

// "Rewind live radio" — default ON. Off reverts to the plain <audio> +
// /api/stream path: no tees, no disk rings, no rewind controls.
export const TIMESHIFT_KEY = 'radio:timeshift';

export function timeshiftEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(TIMESHIFT_KEY) !== 'false'; } catch { return true; }
}

const listeners = new Set<() => void>();
function emit() { for (const cb of listeners) cb(); }
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTimeshiftEnabled() {
  const enabled = useSyncExternalStore(subscribe, timeshiftEnabled, () => true);
  const toggle = useCallback(() => {
    persistSet(TIMESHIFT_KEY, timeshiftEnabled() ? 'false' : 'true');
    emit();
  }, []);
  return { enabled, toggle };
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/timeshiftSetting.test.ts`
Expected: PASS

- [ ] **Step 5: Add the Settings row.** In `SettingsDialog.tsx`, import `useTimeshiftEnabled`, call it in the component (`const { enabled: timeshiftOn, toggle: toggleTimeshift } = useTimeshiftEnabled();`), and insert this section directly after the Pulse-rings `</section>` (line ~217), copying the existing switch markup exactly:

```tsx
<section className="mt-7 flex flex-col gap-3">
  <div className="flex items-center justify-between">
    <div>
      <h3 className="text-sm font-bold text-[var(--color-ink)]">Rewind live radio</h3>
      <p className="text-xs text-[var(--color-ink-3)] mt-0.5">
        {timeshiftOn
          ? 'Buffer the last hour so you can rewind and replay songs.'
          : 'Off — playback is live-only and nothing is buffered.'}
      </p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={timeshiftOn}
      aria-label="Rewind live radio"
      onClick={toggleTimeshift}
      className={[
        'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
        timeshiftOn ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          timeshiftOn ? 'left-[18px]' : 'left-0.5',
        ].join(' ')}
      />
    </button>
  </div>
</section>
```

Toggling OFF must also clean up server state: in the `toggle` flow (do it in the SettingsDialog `onClick`, after `toggleTimeshift()`), when the new value is false, fire-and-forget `fetch('/api/timeshift?sid=*', { method: 'DELETE' })` — and extend the route's DELETE to accept `sid=*` meaning `deleteAllRings()` (one-line addition in `app/api/timeshift/route.ts`: `if (sid === '*') { deleteAllRings(); return new Response(null, { status: 204 }); }` plus the import). Tees close on their own as clients drop their connections (the Player remounts off the timeshift path).

- [ ] **Step 6: Typecheck + verify in dev**

Run: `npx tsc --noEmit`. Then in the running app: open Settings → the toggle renders, flips, persists across reload.

- [ ] **Step 7: Commit**

```bash
git add app/lib/timeshiftSetting.ts app/components/SettingsDialog.tsx app/api/timeshift/route.ts tests/timeshiftSetting.test.ts
git commit -m "feat(timeshift): rewind setting (default on) + settings toggle"
```

---

### Task 13: Player integration

Player gains a timeshift mode: when the setting is on, it starts the engine instead of setting `src`; on gate-fail/error it reverts to the plain path. Adds J/L/Shift+L keys and Media Session seek handlers. Renders `TimeshiftControls` (built in Task 14 — for this task, wire state and stub the component with a minimal `<div>` so the Player compiles; Task 14 replaces it).

**Files:**
- Modify: `app/components/Player.tsx`
- Create: `app/components/TimeshiftControls.tsx` (minimal stub)

- [ ] **Step 1: Stub `TimeshiftControls.tsx`**

```tsx
'use client';

import type { TimeshiftState } from '@/app/lib/timeshift/engine';

export type TimeshiftControlsProps = {
  state: TimeshiftState;
  onSeekBy: (deltaSec: number) => void;
  onGoLive: () => void;
  onSeekTo: (wallClockMs: number) => void;
  ticks: { atMs: number; title: string }[];
};

// Placeholder — Task 14 builds the real controls (variants reviewed live).
export function TimeshiftControls({ state, onSeekBy, onGoLive }: TimeshiftControlsProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-ink-3)]">
      <button onClick={() => onSeekBy(-30)} className="cursor-pointer">−30s</button>
      <button onClick={() => onSeekBy(30)} className="cursor-pointer">+30s</button>
      <button onClick={onGoLive} className="cursor-pointer">
        {state.behindSec < 3 ? 'LIVE' : `−${Math.round(state.behindSec)}s → LIVE`}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire the engine into `Player.tsx`.** Changes, in order:

a) New imports + props:

```tsx
import { TimeshiftEngine, type TimeshiftState } from '@/app/lib/timeshift/engine';
import { timeshiftEnabled } from '@/app/lib/timeshiftSetting';
import { subscribeSeekRequests, publishTimeshiftState } from '@/app/lib/timeshift/bus';
import { TimeshiftControls } from './TimeshiftControls';
```

Props gain: `ticks?: { atMs: number; title: string }[]` (song tick marks, passed down from the page in Task 15; default `[]`).

b) Mode state + engine ref (after the existing `useState` block):

```tsx
// 'pending' while the engine handshakes; 'on' = MSE timeshift path; 'off' =
// plain <audio src=/api/stream> exactly as before this feature.
const [tsMode, setTsMode] = useState<'pending' | 'on' | 'off'>(() =>
  timeshiftEnabled() && typeof MediaSource !== 'undefined' ? 'pending' : 'off');
const [tsState, setTsState] = useState<TimeshiftState | null>(null);
const engineRef = useRef<TimeshiftEngine | null>(null);
```

c) Engine lifecycle effect (place before the autoplay effect):

```tsx
useEffect(() => {
  if (tsMode !== 'pending') return;
  const a = audioRef.current;
  if (!a) { setTsMode('off'); return; }
  const engine = new TimeshiftEngine(a, {
    streamUrl: station.streamUrl,
    stationId: station.id,
    onState: (s) => { setTsState(s); publishTimeshiftState(s); },
    onFallback: () => { engineRef.current = null; setTsState(null); publishTimeshiftState(null); setTsMode('off'); },
  });
  engineRef.current = engine;
  let cancelled = false;
  engine.start().then(ok => {
    if (cancelled) return;
    setTsMode(ok ? 'on' : 'off');
    if (!ok) { engineRef.current = null; }
  });
  return () => {
    cancelled = true;
    engine.stop();
    engineRef.current = null;
    publishTimeshiftState(null);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

d) Seek-request subscription (jump-to-song from PlaylistHistory):

```tsx
useEffect(() => subscribeSeekRequests((ms) => engineRef.current?.seekToWallClock(ms)), []);
```

e) Audio element changes: `src` only in plain mode, and feed the engine's append loop:

```tsx
<audio
  ref={audioRef}
  key={`${station.streamUrl}:${tsMode === 'off' ? 'plain' : 'ts'}`}
  src={tsMode === 'off' ? `/api/stream?url=${encodeURIComponent(station.streamUrl)}` : undefined}
  autoPlay={tsMode === 'off' ? autoplay : undefined}
  preload={autoplay ? 'auto' : 'none'}
  onPlay={handlePlay}
  onPlaying={handlePlay}
  onPause={handlePause}
  onWaiting={handleWaiting}
  onError={tsMode === 'on' ? undefined : handleError}
  onTimeUpdate={() => engineRef.current?.onTimeUpdate()}
/>
```

(In timeshift mode the engine owns `src` via object URL and errors route through `onFallback`, not the element handler — an MSE teardown fires a spurious element `error`.)

f) Autoplay effect: change its guard so it waits for the mode to settle — replace the `useEffect(..., [])` dependency with `[tsMode]` and add at the top:

```tsx
if (tsMode === 'pending') return;       // engine still handshaking — wait
```

Keep the rest of the body identical (it calls `a.play()`, which works the same once the engine has set `a.src` to the object URL). Add a `ranRef = useRef(false)` guard so the body only ever runs once (`if (ranRef.current) return; ranRef.current = true;` after the pending check).

g) Keyboard: in the existing `onKey` switch, add:

```tsx
case 'j': case 'J':
  e.preventDefault();
  engineRef.current?.seekBy(-30);
  break;
case 'l': case 'L':
  e.preventDefault();
  if (e.shiftKey) engineRef.current?.goLive();
  else engineRef.current?.seekBy(30);
  break;
```

(The existing handler early-returns on `e.metaKey || e.ctrlKey || e.altKey` — `shiftKey` is not in that list, so Shift+L reaches the switch; verify, don't assume.)

h) Media Session: in the existing media-session effect add seek handlers next to play/pause:

```tsx
ms.setActionHandler('seekbackward', (d) => engineRef.current?.seekBy(-(d.seekOffset || 30)));
ms.setActionHandler('seekforward', (d) => engineRef.current?.seekBy(d.seekOffset || 30));
```

(and null them in the cleanup, in the same try/catch style).

i) Render controls in the full (non-dock) layout, after the autoplay button:

```tsx
{tsMode === 'on' && tsState && (
  <TimeshiftControls
    state={tsState}
    onSeekBy={(d) => engineRef.current?.seekBy(d)}
    onGoLive={() => engineRef.current?.goLive()}
    onSeekTo={(ms) => engineRef.current?.seekToWallClock(ms)}
    ticks={ticks ?? []}
  />
)}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean

- [ ] **Step 4: Live verification (preview tools).** Start the dev server, pick an MP3 station, then verify: (1) audio plays via MSE — DevTools Network shows one `/api/timeshift` fetch and NO `/api/stream`; (2) `−30s` then `+30s` then LIVE work with no audible glitch; (3) pause 60 s → resume continues where paused (not live); (4) press J/L; (5) pick an Ogg/Opus station (e.g. many SomaFM `…-64-aac` work, find an `application/ogg` one) → silent fallback to plain `<audio>`, controls absent; (6) Settings toggle OFF → remount uses `/api/stream` exactly as before.

- [ ] **Step 5: Commit**

```bash
git add app/components/Player.tsx app/components/TimeshiftControls.tsx
git commit -m "feat(timeshift): Player rides the MSE engine with plain-audio fallback"
```

---

### Task 14: TimeshiftControls UI — live variants, user picks

Build the real controls per spec: −30/+30 flanking play/pause visually (they render beside the Player's controls row), LIVE pill (lit at edge; behind → dims, shows `−mm:ss`, click to snap), slim timeline with buffered region, playhead, drag/click seek, song ticks with tooltips, discontinuity breaks.

**Process requirement (user preference, see spec "Implementation note — variant review"):** build **3 variants behind a dev switch**, present them in the running app via the browser preview, let the user pick, then delete the losers and the switch.

**Files:**
- Modify: `app/components/TimeshiftControls.tsx` (replace stub)

- [ ] **Step 1: Implement the shared logic + 3 visual variants.** One component, variant chosen by `localStorage['radio:tsuiVariant']` (`'a' | 'b' | 'c'`, default `'a'`) or `?tsui=` query param. Shared behavior for all variants:

```tsx
'use client';

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { TimeshiftState } from '@/app/lib/timeshift/engine';

export type TimeshiftControlsProps = {
  state: TimeshiftState;
  onSeekBy: (deltaSec: number) => void;
  onGoLive: () => void;
  onSeekTo: (wallClockMs: number) => void;
  ticks: { atMs: number; title: string }[];
};

function fmtBehind(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `−${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function readVariant(): 'a' | 'b' | 'c' {
  if (typeof window === 'undefined') return 'a';
  const q = new URLSearchParams(window.location.search).get('tsui');
  const v = q || window.localStorage.getItem('radio:tsuiVariant') || 'a';
  return v === 'b' || v === 'c' ? v : 'a';
}

export function TimeshiftControls(props: TimeshiftControlsProps) {
  const variant = readVariant();
  if (variant === 'b') return <VariantB {...props} />;
  if (variant === 'c') return <VariantC {...props} />;
  return <VariantA {...props} />;
}
```

The timeline (shared sub-component, used by all variants with different styling knobs):

```tsx
function Timeline({ state, onSeekTo, ticks, height }: {
  state: TimeshiftState; onSeekTo: (ms: number) => void;
  ticks: TimeshiftControlsProps['ticks']; height: number;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const { bufferStartMs, liveEdgeMs, playheadMs } = state;
  const span = (liveEdgeMs ?? 0) - (bufferStartMs ?? 0);
  const frac = useCallback((ms: number) =>
    span > 0 ? Math.min(1, Math.max(0, (ms - (bufferStartMs ?? 0)) / span)) : 1,
    [bufferStartMs, span]);

  const seekFromPointer = (e: ReactPointerEvent) => {
    const el = barRef.current;
    if (!el || bufferStartMs === null || liveEdgeMs === null) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSeekTo(bufferStartMs + f * span);
  };

  if (bufferStartMs === null || liveEdgeMs === null || span < 10_000) return null;
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Rewind position"
      aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(frac(playheadMs ?? liveEdgeMs) * 100)}
      onPointerDown={seekFromPointer}
      className="relative w-full cursor-pointer group/tl"
      style={{ height: height + 8, paddingTop: 4, paddingBottom: 4 }}
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-[var(--color-line)]" style={{ height }}>
        {/* buffered region = whole bar; played-behind portion tinted */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-[var(--color-brand-purple)]/40"
          style={{ width: `${frac(playheadMs ?? liveEdgeMs) * 100}%` }}
        />
        {/* discontinuity breaks */}
        {state.discontinuities.map(g => (
          <div key={g.fromMs}
            className="absolute top-0 h-full bg-[var(--color-bg)]"
            style={{ left: `${frac(g.fromMs) * 100}%`, width: `${Math.max(0.5, (frac(g.toMs) - frac(g.fromMs)) * 100)}%` }} />
        ))}
        {/* song ticks */}
        {ticks.filter(t => t.atMs >= bufferStartMs && t.atMs <= liveEdgeMs).map(t => (
          <button
            key={t.atMs}
            title={t.title}
            aria-label={`Jump to ${t.title}`}
            onPointerDown={(e) => { e.stopPropagation(); onSeekTo(t.atMs - 3000); }}
            className="absolute top-1/2 -translate-y-1/2 w-[3px] h-[150%] rounded bg-[var(--color-brand-pink)]/70 hover:bg-[var(--color-brand-pink)] cursor-pointer"
            style={{ left: `${frac(t.atMs) * 100}%` }}
          />
        ))}
        {/* playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--color-ink)] shadow opacity-0 group-hover/tl:opacity-100 transition-opacity"
          style={{ left: `calc(${frac(playheadMs ?? liveEdgeMs) * 100}% - 5px)` }}
        />
      </div>
    </div>
  );
}
```

The LIVE pill + step buttons (shared):

```tsx
function StepButton({ delta, onSeekBy }: { delta: number; onSeekBy: (d: number) => void }) {
  return (
    <button
      onClick={() => onSeekBy(delta)}
      aria-label={delta < 0 ? 'Back 30 seconds' : 'Forward 30 seconds'}
      title={delta < 0 ? 'Back 30s (J)' : 'Forward 30s (L)'}
      className="w-9 h-9 rounded-full border border-[var(--color-line)] text-[11px] font-bold text-[var(--color-ink-3)] hover:border-[var(--color-brand-pink)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
    >
      {delta < 0 ? '−30' : '+30'}
    </button>
  );
}

function LivePill({ state, onGoLive }: { state: TimeshiftState; onGoLive: () => void }) {
  const atEdge = state.behindSec < 3;
  return (
    <button
      onClick={onGoLive}
      disabled={atEdge}
      aria-label={atEdge ? 'Live' : `Behind live by ${fmtBehind(state.behindSec)} — back to live`}
      title={atEdge ? 'Live' : 'Back to live (Shift+L)'}
      className={[
        'px-3 py-1.5 rounded-full text-[11px] tracking-[1px] uppercase font-bold transition-colors',
        atEdge
          ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] cursor-default'
          : 'border border-[var(--color-line)] text-[var(--color-ink-3)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] cursor-pointer',
      ].join(' ')}
    >
      {atEdge ? '● Live' : `${fmtBehind(state.behindSec)} · Live`}
    </button>
  );
}
```

Variants (each a thin layout over the shared pieces):
- **VariantA — "inline slim"**: one row `[−30][+30] ——timeline—— [LIVE pill]`, 3px-high timeline, ticks visible on hover only. Most discreet.
- **VariantB — "stacked"**: timeline (4px) full-width above a row with `[−30] [LIVE pill] [+30]` centered. Closest to podcast players.
- **VariantC — "pill-forward"**: prominent LIVE pill left, then `[−30][+30]`, then a 5px timeline with always-visible ticks. Most discoverable.

```tsx
function VariantA(p: TimeshiftControlsProps) {
  return (
    <div className="flex items-center gap-3 w-full">
      <StepButton delta={-30} onSeekBy={p.onSeekBy} />
      <StepButton delta={30} onSeekBy={p.onSeekBy} />
      <div className="flex-1"><Timeline state={p.state} onSeekTo={p.onSeekTo} ticks={p.ticks} height={3} /></div>
      <LivePill state={p.state} onGoLive={p.onGoLive} />
    </div>
  );
}
function VariantB(p: TimeshiftControlsProps) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <Timeline state={p.state} onSeekTo={p.onSeekTo} ticks={p.ticks} height={4} />
      <div className="flex items-center justify-center gap-3">
        <StepButton delta={-30} onSeekBy={p.onSeekBy} />
        <LivePill state={p.state} onGoLive={p.onGoLive} />
        <StepButton delta={30} onSeekBy={p.onSeekBy} />
      </div>
    </div>
  );
}
function VariantC(p: TimeshiftControlsProps) {
  return (
    <div className="flex items-center gap-3 w-full">
      <LivePill state={p.state} onGoLive={p.onGoLive} />
      <StepButton delta={-30} onSeekBy={p.onSeekBy} />
      <StepButton delta={30} onSeekBy={p.onSeekBy} />
      <div className="flex-1"><Timeline state={p.state} onSeekTo={p.onSeekTo} ticks={p.ticks} height={5} /></div>
    </div>
  );
}
```

Place the controls on their own row beneath the Player's main controls row (full layout only; the dock stays untouched for now — YAGNI until requested).

- [ ] **Step 2: Live variant review (USER GATE — do not skip).** Start the dev server with the preview tools, play an MP3 station, and capture a screenshot of each variant (`?tsui=a`, `?tsui=b`, `?tsui=c`) after seeking back ~2 min so the behind-live state shows. Present all three to the user with `AskUserQuestion` (one option per variant, screenshots as preview content) and let them pick. **Wait for the answer.**

- [ ] **Step 3: Remove the losing variants and the dev switch.** Delete the unused variant components, `readVariant`, and the query-param logic; the winner becomes the only render path.

- [ ] **Step 4: Typecheck + lint + visual re-verify**

Run: `npx tsc --noEmit && npm run lint`, then screenshot the final state (at live edge AND behind live) for the record.

- [ ] **Step 5: Commit**

```bash
git add app/components/TimeshiftControls.tsx
git commit -m "feat(timeshift): rewind controls — buttons, LIVE pill, slim timeline with song ticks"
```

---

### Task 15: History integration — `startedAt` threading + jump-to-song

Wire `startedAt` from SSE events into the history stores, add the SSE tee params, surface jump buttons on in-buffer history rows, and feed song ticks to the timeline.

**Files:**
- Modify: `app/components/NowPlaying.tsx`
- Modify: `app/components/TrackingPanel.tsx`
- Modify: `app/components/PlaylistHistory.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: `NowPlaying.tsx` (active station).**

a) SSE URL gains tee params. Where the EventSource is created (search for `new EventSource`), change to:

```tsx
import { timeshiftEnabled } from '@/app/lib/timeshiftSetting';
// ...
const ts = timeshiftEnabled() ? (trackedRef.current ? 'disk' : '1') : null;
const es = new EventSource(
  `/api/now-playing?url=${encodeURIComponent(station.streamUrl)}` +
  (ts ? `&ts=${ts}&sid=${encodeURIComponent(station.id)}` : ''),
);
```

b) Consume `startedAt`: the `track` message type gains `startedAt?: number`. The component already keeps `currentStartRef` (epoch ms of the current track) — set it from the event when present (`currentStartRef.current = msg.startedAt ?? Date.now()`), and keep a parallel `prevStartedAtRef` so that when a NEW title arrives and the finished one is logged (the `recordTrack(station.id, prev)` call and the session-history prepend), it passes the finished song's start:

```tsx
recordTrack(station.id, prev, prevStartedAtRef.current ?? undefined);
```

and for the non-tracked session history prepend, include `startedAt: prevStartedAtRef.current ?? undefined` on the entry object. Update `prevStartedAtRef.current = msg.startedAt ?? Date.now()` at the same point `prevTitleRef` is updated.

- [ ] **Step 2: `TrackingPanel.tsx` (tracked rows).** In `TrackedStationRow`'s effect:

a) Compute the disk param — the 5 most-recently-tracked get rings. `useTracking()`'s `tracked` array is newest-first, so pass the row's index down from `TrackingPanel` (`<TrackedStationRow index={i} …>`) and:

```tsx
const ts = timeshiftEnabled() ? (index < 5 ? 'disk' : '1') : null;
const es = new EventSource(
  `/api/now-playing?url=${encodeURIComponent(station.streamUrl)}` +
  (ts ? `&ts=${ts}&sid=${encodeURIComponent(station.id)}` : ''),
);
```

b) Thread `startedAt` exactly as in NowPlaying: msg type gains `startedAt?: number`; add `prevStartedAtRef`; pass it to the existing `recordTrack(station.id, prev)` call.

c) On untrack, delete the server ring. In `TrackingPanel`, wrap the existing `untrack`:

```tsx
const onUntrack = (id: string) => {
  untrack(id);
  void fetch(`/api/timeshift?sid=${encodeURIComponent(id)}`, { method: 'DELETE' });
};
```

and pass `onUntrack={() => onUntrack(s.id)}` to the row.

- [ ] **Step 3: `PlaylistHistory.tsx` — jump affordance.** Props gain:

```tsx
export function PlaylistHistory({ history, stationName, jumpRange = null, onJumpTo }: {
  history: HistoryItem[]; stationName: string;
  jumpRange?: { startMs: number; endMs: number } | null;
  onJumpTo?: (wallClockMs: number) => void;
}) {
```

In the song-row render, before the PreviewButton, add a jump button for in-buffer rows:

```tsx
{onJumpTo && jumpRange && h.startedAt !== undefined &&
 h.startedAt >= jumpRange.startMs && h.startedAt <= jumpRange.endMs && (
  <button
    onClick={() => onJumpTo(h.startedAt! - 3000)}
    aria-label={`Replay ${title} from the buffer`}
    title="Replay from the live buffer"
    className="self-center w-7 h-7 flex items-center justify-center rounded-full text-[11px] cursor-pointer transition-colors border text-[var(--color-brand-purple)] border-[var(--color-line)] opacity-70 group-hover:opacity-100 hover:border-[var(--color-brand-purple)]"
  >
    ↩
  </button>
)}
```

(The `- 3000` pre-pad means jumps land 3 s before the song's start so its opening is never missed — same constant as the timeline ticks.)

- [ ] **Step 4: `app/page.tsx` — glue.** The page already holds `playlistHistory` and renders `<PlaylistHistory …>` and `<Player …>`. Add:

```tsx
import { subscribeTimeshiftState, requestSeekToWallClock } from '@/app/lib/timeshift/bus';
import type { TimeshiftState } from '@/app/lib/timeshift/engine';
// ...
const [tsState, setTsState] = useState<TimeshiftState | null>(null);
useEffect(() => subscribeTimeshiftState(setTsState), []);

// Song ticks: history entries with a known start inside the buffered range.
const ticks = useMemo(() => {
  if (!tsState?.bufferStartMs || !tsState.liveEdgeMs) return [];
  return playlistHistory
    .filter((h): h is HistoryEntry => !isGap(h) && h.startedAt !== undefined)
    .filter(h => h.startedAt! >= tsState.bufferStartMs! && h.startedAt! <= tsState.liveEdgeMs!)
    .map(h => ({ atMs: h.startedAt!, title: h.title }));
}, [playlistHistory, tsState]);
```

Pass `ticks={ticks}` to `<Player>`, and to `<PlaylistHistory>` pass:

```tsx
jumpRange={tsState && tsState.bufferStartMs !== null && tsState.liveEdgeMs !== null
  ? { startMs: tsState.bufferStartMs, endMs: tsState.liveEdgeMs } : null}
onJumpTo={requestSeekToWallClock}
```

(Adjust imports — `isGap`, `HistoryEntry` from `@/app/lib/nowPlayingTypes`; match the page's existing import style.)

- [ ] **Step 5: Typecheck + lint + full tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: clean

- [ ] **Step 6: Live verification.** Play a tracked MP3 station with metadata, wait for 2+ song changes, then: history rows show ↩ on in-buffer songs → click one → playback lands ~3 s before the song start; timeline shows matching ticks; LIVE pill shows behind-time; click LIVE → back to the edge. Switch to another tracked station and back → its buffered history is seekable from before the switch.

- [ ] **Step 7: Commit**

```bash
git add app/components/NowPlaying.tsx app/components/TrackingPanel.tsx app/components/PlaylistHistory.tsx app/page.tsx
git commit -m "feat(timeshift): startedAt threading + jump-to-song from history and timeline"
```

---

### Task 16: Electron lifecycle — buffer dir env + quit cleanup

**Files:**
- Modify: `electron/main.js` (env block ~line 277; app lifecycle handlers)

- [ ] **Step 1: Pass the buffer root to the Next server.** In `startNextServer`'s `env` object (next to `APP_DB_PATH`):

```js
APP_TIMESHIFT_DIR: path.join(app.getPath('userData'), 'timeshift'),
```

- [ ] **Step 2: Delete on graceful quit.** Near the other `app.on(...)` lifecycle registrations (search for `will-quit` — if absent, add the handler after the existing `window-all-closed`/`before-quit` handlers):

```js
// Timeshift buffers are session-only: wipe on quit. (Boot also wipes — see
// app/lib/server/timeshiftDir.ts — covering crashes where this never runs.)
app.on('will-quit', () => {
  try {
    fs.rmSync(path.join(app.getPath('userData'), 'timeshift'), { recursive: true, force: true });
  } catch { /* best-effort */ }
});
```

(`fs` and `path` are already required at the top of main.js.)

- [ ] **Step 3: Verify.** Run the desktop dev flow (`npm run electron:dev`), play + track a couple of stations for a minute, confirm `<userData>/timeshift/<sid>/seg-*.bin` files exist, quit the app, confirm the directory is gone.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat(timeshift): session-only disk buffers — userData dir + quit cleanup"
```

---

### Task 17: DebugPanel rows

Read-only diagnostics per the spec's "Debug panel" section. Client-side state from the bus; server stats from `/api/timeshift-stats` on the panel's existing 5 s cadence.

**Files:**
- Modify: `app/components/DebugPanel.tsx`

- [ ] **Step 1: Implement.** Imports + state in `DebugPanel`:

```tsx
import { getTimeshiftState } from '@/app/lib/timeshift/bus';
import { timeshiftEnabled } from '@/app/lib/timeshiftSetting';
import type { TimeshiftState } from '@/app/lib/timeshift/engine';

type TsStats = {
  tees: { url: string; subscribers: number; bytesPerSec: number; contentType: string | null }[];
  rings: { stationId: string; segments: number; bytes: number; startMs: number | null }[];
} | null;

const [ts, setTs] = useState<TimeshiftState | null>(null);
const [tsStats, setTsStats] = useState<TsStats>(null);

// Sample engine state on the panel's fast cadence.
useEffect(() => {
  if (!active) return;
  const id = setInterval(() => setTs(getTimeshiftState()), 250);
  return () => clearInterval(id);
}, [active]);

// Server stats on the slow cadence.
useEffect(() => {
  if (!active || !timeshiftEnabled()) return;
  let alive = true;
  const poll = async () => {
    try {
      const r = await fetch('/api/timeshift-stats', { cache: 'no-store' });
      const d = (await r.json()) as TsStats;
      if (alive) setTsStats(d);
    } catch { if (alive) setTsStats(null); }
  };
  poll();
  const id = setInterval(poll, 5000);
  return () => { alive = false; clearInterval(id); };
}, [active]);
```

Helpers (top of file, beside `Row`):

```tsx
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
```

Rows (after the existing "Energy" row, before the Favorites row):

```tsx
<Row label="Timeshift">
  {!timeshiftEnabled() ? 'off (setting)'
    : ts ? <span className="text-green-600 font-semibold">on · MSE · {ts.contentType || '?'}</span>
    : 'off (gate/fallback)'}
</Row>
{ts && (
  <>
    <Row label="Buffer">
      {ts.ramStartMs !== null && ts.liveEdgeMs !== null
        ? `${mmss(ts.liveEdgeMs - ts.ramStartMs)} / 60:00 · ${mb(ts.ramBytes)}`
        : '—'}
    </Row>
    <Row label="Playhead">
      {ts.behindSec < 3 ? 'live' : `−${mmss(ts.behindSec * 1000)} behind`}
      <span className="text-[var(--color-ink-4)]"> · tier {ts.lastSeekTier ?? '—'} · ahead {ts.sourceBufferAhead.toFixed(1)}s</span>
    </Row>
    <Row label="Gaps">
      {ts.discontinuities.length === 0 ? 'none'
        : `${ts.discontinuities.length} · last ${mmss(Date.now() - ts.discontinuities[ts.discontinuities.length - 1].toMs)} ago`}
    </Row>
  </>
)}
{tsStats && tsStats.tees.length > 0 && (
  <Row label="Tees">
    {tsStats.tees.map(t => `${t.subscribers} sub · ${(t.bytesPerSec / 1024).toFixed(0)} KB/s`).join(' | ')}
  </Row>
)}
{tsStats && tsStats.rings.length > 0 && (
  <Row label="Disk rings">
    {tsStats.rings.length}/5 · {mb(tsStats.rings.reduce((n, r) => n + r.bytes, 0))} ·{' '}
    {tsStats.rings.map(r => `${r.segments} segs`).join(', ')}
  </Row>
)}
```

- [ ] **Step 2: Verify in dev.** Open Settings → enable the debug readout (`?debug=true` on web dev) while playing + tracking stations: rows populate, Buffer duration climbs, seeking back flips Playhead off "live" and shows the tier used.

- [ ] **Step 3: Typecheck + lint, then commit**

```bash
git add app/components/DebugPanel.tsx
git commit -m "feat(timeshift): debug panel diagnostics (buffer, playhead tier, tees, rings)"
```

---

### Task 18: End-to-end verification + ARCHITECTURE.md note

**Files:**
- Modify: `docs/ARCHITECTURE.md` (add a short Timeshift section: tee diagram, framed protocol, ring locations, session-only lifecycle — 10-15 lines in the doc's existing style)

- [ ] **Step 1: Full suite + typecheck + lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all clean

- [ ] **Step 2: Behavioral checklist (preview tools; use real stations).** Verify and screenshot/log each:

1. MP3 station: plays via `/api/timeshift` (Network tab), −30/+30/LIVE/J/L/Shift+L all work, no audible glitches, no double `/api/stream` connection.
2. Pause 1 min → resume continues from pause point; LIVE pill shows behind-time; click → live.
3. Drag the timeline to several points incl. near the buffer start.
4. Tracked station for 10+ min in background → switch to it → timeline exposes pre-switch history; jump to a song logged before the switch.
5. 6+ tracked stations → only 5 get rings (`/api/timeshift-stats`).
6. Untrack a station → its ring disappears from stats (and from disk in dev: `data/timeshift/`).
7. Ogg/Opus or HLS station → silent fallback, no controls, audio fine.
8. Settings toggle OFF → plain `/api/stream` playback, controls gone, rings deleted; toggle ON → timeshift returns on next station (re)mount.
9. Debug panel rows live-update; seek tiers report window/ram/disk as exercised.
10. Memory sanity: after 20+ min on a 128 kbps station, renderer heap growth ≈ stream size (~20 MB), not multiples of it.

- [ ] **Step 3: Update ARCHITECTURE.md, commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: timeshift architecture notes"
```

- [ ] **Step 4: Final review request.** Use the superpowers:requesting-code-review skill against the full branch diff before opening/refreshing the PR.

---

## Self-review notes (already applied)

- **Spec coverage check:** buffering (T5/T6/T10), one-connection unification (T6/T8), `/api/timeshift` + burst (T7), MSE engine + seek tiers + pause-is-real (T11/T13), format gate + fallback (T11/T13), UI + variant gate (T14), jump-to-song + `startedAt` (T4/T8/T15), tracked cap + untrack deletion (T6/T15), session-only lifecycle (T5/T16), Settings default-ON (T12), debug panel (T17), tests-as-pure-reducers (T1-T5, T10). No spec section is uncovered.
- **Known simplification vs spec:** discontinuity markers are *derived* (wall-clock jumps in frame timestamps) rather than stored; equivalent behavior, less machinery.
- **Risk register for the executor:** (1) `sequence`-mode timestamp behavior across SourceBuffer rebuilds is the most likely source of audible glitches — if seeks click, check that rebuilds always go through `buildMediaSource` (never partial `remove`); (2) `vi.waitFor` exists in vitest 4 — if the tee tests flake, add explicit small `setTimeout` flushes; (3) Next.js 16 here is nonstandard — if `ReadableStream` route responses misbehave, read `node_modules/next/dist/docs` route-handler guide before changing approach.

