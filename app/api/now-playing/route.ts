import { NextRequest } from 'next/server';
import { parseIcy } from '@/app/lib/icy';
import { isJunkMetadata } from '@/app/lib/nonTrack';
import { computeNextDelayMs, FINGERPRINT_INTERVAL_MS } from '@/app/lib/recognitionSchedule';
import type { FingerprintOutcome } from '@/app/lib/recognitionSchedule';
import { acquireTee, releaseTee, attachRing, type StationTee } from '@/app/lib/server/stationTee';

const UA = 'Spun/0.1';

// Python ShazamIO sidecar (recognizer/). When a station's broadcast metadata
// doesn't name the current song, we ask it to fingerprint a few seconds of
// the stream. If it's not running, fingerprinting silently no-ops and we fall
// back to the no-song / no-metadata states.
const RECOGNIZER_URL = process.env.RECOGNIZER_URL || 'http://127.0.0.1:8755';

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

type Recognized = {
  raw: string;
  cover: string | null;
  shazamUrl: string;
  appleMusicUrl: string;
  previewUrl: string;
  key: string;
  // Position-in-song (seconds) and full track length (ms), used to predict when
  // the song ends and time the next fingerprint. Null when the sidecar can't
  // resolve them (older sidecar, or no Apple Music match for the duration).
  offsetSec: number | null;
  durationMs: number | null;
};

async function fingerprint(streamUrl: string, external?: AbortSignal): Promise<Recognized | null> {
  // Own controller aborted by either a timeout (capture ~6s + recognition +
  // headroom) or the caller's external signal (a broadcast title arriving
  // mid-fingerprint). Avoids AbortSignal.any() for older-Node compatibility.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 25_000);
  const onExternal = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', onExternal, { once: true });
  }
  try {
    const res = await fetch(`${RECOGNIZER_URL}/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: streamUrl, seconds: 6 }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      match?: boolean; raw?: string; cover?: string;
      shazamUrl?: string; appleMusicUrl?: string; previewUrl?: string; key?: string;
      offset?: number | null; durationMs?: number | null;
    };
    return data?.match && data?.raw
      ? {
          raw: data.raw,
          cover: data.cover || null,
          shazamUrl: data.shazamUrl || '',
          appleMusicUrl: data.appleMusicUrl || '',
          previewUrl: data.previewUrl || '',
          key: data.key || '',
          offsetSec: typeof data.offset === 'number' ? data.offset : null,
          durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
        }
      : null;
  } catch {
    // Sidecar down / timeout / aborted — graceful no-op.
    return null;
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener('abort', onExternal);
  }
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

  // Timeshift routing. With no `ts` param the route behaves exactly as before
  // (its own upstream fetch + parseIcy). With `ts` set it rides a shared
  // StationTee so song timestamps align with the /api/timeshift audio buffer.
  //   ts === '1'    → tee (RAM tail only)
  //   ts === 'disk' → tee + disk ring (requires sid)
  const ts = req.nextUrl.searchParams.get('ts'); // null | '1' | 'disk'
  const sid = req.nextUrl.searchParams.get('sid') || '';

  const encoder = new TextEncoder();
  const streamUrlStr = streamUrl.toString();

  // --- title source + teardown differ per branch; everything else is shared.
  let hasMeta: boolean;
  // Legacy branch state:
  const upstreamController = new AbortController();
  let upstream: Response | null = null;
  // Tee branch state:
  let tee: StationTee | null = null;
  let released = false; // guards releaseTee to exactly one call per request

  if (ts === null) {
    // === Legacy path (unchanged): own upstream fetch ===
    req.signal.addEventListener('abort', () => upstreamController.abort(), { once: true });
    try {
      upstream = await fetch(streamUrl, {
        headers: { 'Icy-MetaData': '1', 'User-Agent': UA },
        signal: upstreamController.signal,
      });
    } catch (e) {
      return new Response(`upstream fetch failed: ${String(e)}`, { status: 502 });
    }
    if (!upstream.ok) {
      upstreamController.abort();
      return new Response(`upstream returned ${upstream.status}`, { status: 502 });
    }
    const metaIntHeader = upstream.headers.get('icy-metaint');
    const metaInt = metaIntHeader ? parseInt(metaIntHeader, 10) : NaN;
    hasMeta = Boolean(metaInt) && Boolean(upstream.body);

    return buildResponse(metaInt);
  }

  // === Tee path: shared upstream connection per station ===
  tee = acquireTee(streamUrlStr);
  let teeInfo;
  try {
    teeInfo = await tee.ready();
  } catch (e) {
    releaseTee(streamUrlStr, tee);
    return new Response(`upstream failed: ${String(e)}`, { status: 502 });
  }
  if (ts === 'disk' && sid) attachRing(sid, tee);
  hasMeta = teeInfo.hasMeta;

  return buildResponse(NaN);

  // ----------------------------------------------------------------------
  // Shared body. The only per-branch differences are the title source (direct
  // parseIcy loop vs tee subscription) and the teardown of the upstream.
  function buildResponse(metaInt: number): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastTitle: string | null = null; // last title we sent (any source)
      let haveMetaTitle = false; // metadata gave a real (non-empty) title
      let fpInFlight = false;
      let fpAbort: AbortController | null = null; // cancels an in-flight fingerprint

      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sseLine(obj))); } catch {}
      };

      const keepalive = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch {}
      }, 15_000);

      // Fingerprint fallback. No-ops once metadata has named a song, or if
      // another attempt is already running. `silent` skips the "recognizing"
      // status (used for the initial parallel attempt on metadata stations, so
      // a quick broadcast title doesn't get preceded by an Identifying… flash).
      // Returns the attempt's outcome (matched + offset/duration) so the poll
      // loop can time the next attempt, or null when it was a no-op.
      async function tryFingerprint(silent = false): Promise<FingerprintOutcome | null> {
        if (closed || haveMetaTitle || fpInFlight) return null;
        fpInFlight = true;
        if (!silent) send({ type: 'recognizing' });
        fpAbort = new AbortController();
        const match = await fingerprint(streamUrlStr, fpAbort.signal);
        fpAbort = null;
        fpInFlight = false;
        // Metadata may have arrived (and aborted us) while we were working.
        if (closed || haveMetaTitle) return null;
        if (match) {
          if (match.raw !== lastTitle) {
            lastTitle = match.raw;
            const startedAt =
              match.offsetSec !== null ? Date.now() - match.offsetSec * 1000 : Date.now();
            send({
              type: 'track', title: match.raw, source: 'shazam', startedAt,
              cover: match.cover ?? undefined,
              shazamUrl: match.shazamUrl || undefined,
              appleMusicUrl: match.appleMusicUrl || undefined,
              previewUrl: match.previewUrl || undefined,
              key: match.key || undefined,
            });
          }
          return { matched: true, durationMs: match.durationMs, offsetSec: match.offsetSec };
        }
        // Couldn't identify — report the honest "no song" state. Distinguish
        // a station with a metadata channel (no-song) from one without it
        // (no-metadata).
        send({ type: hasMeta ? 'no-song' : 'no-metadata' });
        return { matched: false, durationMs: null, offsetSec: null };
      }

      // Self-rescheduling fingerprint loop. After each attempt we time the next
      // from what we learned: coast toward the predicted song end, probe tightly
      // near the boundary, or fall back to the fixed cadence when there's no
      // duration to predict against (see computeNextDelayMs). Once metadata
      // names a song the loop stops — broadcast titles drive updates from there.
      let fpTimer: ReturnType<typeof setTimeout> | null = null;
      const runFingerprintLoop = async (silent = false) => {
        const outcome = await tryFingerprint(silent);
        if (closed || haveMetaTitle) return;
        const delay = outcome ? computeNextDelayMs(outcome) : FINGERPRINT_INTERVAL_MS;
        fpTimer = setTimeout(() => { void runFingerprintLoop(); }, delay);
      };

      // Kick off recognition immediately on connect, in parallel with the
      // metadata wait — whichever resolves first wins, with metadata preferred
      // (it aborts the fingerprint if it arrives). On metadata stations the
      // first attempt is silent to avoid a recognizing flash before the title.
      const fpInitial = setTimeout(() => { void runFingerprintLoop(hasMeta); }, 0);

      // Tee-branch unsubscribes (no-ops in the legacy branch).
      let unsubTitles: (() => void) | null = null;
      let unsubAudio: (() => void) | null = null;

      try {
        if (tee) {
          // === Tee branch: title source is the shared StationTee. ===
          // Real titles win over fingerprinting and dedup against the last
          // emitted title; junk/empty titles nudge the fingerprint fallback.
          // demuxIcy does NOT dedup consecutive repeats (parseIcy does), so we
          // replicate that here with lastRawTitle.
          if (hasMeta) {
            let lastRawTitle: string | null = null;
            unsubTitles = tee.subscribeTitles((title) => {
              if (closed) return;
              if (title === lastRawTitle) return; // parseIcy deduped consecutive repeats
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
          // Close the SSE when the tee dies (upstream drop) so the client's
          // EventSource reconnects and re-acquires a fresh tee. A no-op audio
          // subscriber is the only hook the tee gives us for death (titleSubs
          // aren't notified on die()). Stations with no ICY metadata keep their
          // upstream OPEN here — the tee needs audio for the buffer; that's the
          // intentional cost of buffering metadata-less stations.
          // The resolver is created first so the subscribe assignment stays in
          // linear flow (assigning unsubAudio inside the executor callback would
          // hide it from control-flow narrowing in the finally block).
          let resolveDeath!: () => void;
          const death = new Promise<void>((resolve) => { resolveDeath = resolve; });
          req.signal.addEventListener('abort', () => resolveDeath(), { once: true });
          unsubAudio = tee.subscribeAudio({ onChunk: () => {}, onEnd: () => resolveDeath() });
          await death;
        } else if (hasMeta) {
          for await (const event of parseIcy(upstream!.body!, metaInt)) {
            if (event.title === '' || isJunkMetadata(event.title)) {
              // Station isn't naming the song (empty, or just CDN/station
              // branding like "Powered By … CDN") — let the fingerprint
              // fallback try (fire-and-forget; it debounces via fpInFlight).
              tryFingerprint();
              continue;
            }
            // Real broadcast title always wins — cancel any in-flight fingerprint.
            haveMetaTitle = true;
            (fpAbort as AbortController | null)?.abort();
            if (event.title !== lastTitle) {
              lastTitle = event.title;
              send({ type: 'track', title: event.title, source: 'metadata', startedAt: Date.now() });
            }
          }
        } else {
          // No metadata channel at all. We don't need the audio body here —
          // the recognizer pulls its own copy. Keep the SSE open so the
          // fingerprint loop can push results.
          upstreamController.abort();
          await new Promise<void>((resolve) => {
            req.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      } catch (e) {
        send({ type: 'error', message: String(e) });
      } finally {
        closed = true;
        clearInterval(keepalive);
        if (fpTimer) clearTimeout(fpTimer);
        clearTimeout(fpInitial);
        try { controller.close(); } catch {}
        if (tee) {
          unsubTitles?.();
          unsubAudio?.();
          if (!released) { released = true; releaseTee(streamUrlStr, tee); }
        } else {
          upstreamController.abort();
        }
      }
    },
    cancel() {
      if (tee) {
        if (!released) { released = true; releaseTee(streamUrlStr, tee); }
      } else {
        upstreamController.abort();
      }
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
}
