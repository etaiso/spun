export type IcyEvent = { title: string };
export type IcyDemuxEvent = { kind: 'audio'; bytes: Uint8Array } | { kind: 'title'; title: string };

const decoder = new TextDecoder('utf-8', { fatal: false });

function extractTitle(payload: Uint8Array): string | null {
  let end = payload.length;
  while (end > 0 && payload[end - 1] === 0) end--;
  const text = decoder.decode(payload.subarray(0, end));
  const match = text.match(/StreamTitle='((?:[^']|\\')*)'/);
  return match ? match[1] : null;
}

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

  function take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      const head = chunks[0];
      const remaining = n - written;
      if (head.length <= remaining) {
        out.set(head, written);
        written += head.length;
        chunks.shift();
      } else {
        out.set(head.subarray(0, remaining), written);
        chunks[0] = head.subarray(remaining);
        written = n;
      }
    }
    buffered -= n;
    return out;
  }

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
