import { describe, it, expect } from 'vitest';
import { parseIcy } from '../app/lib/icy';

// Helpers to build ICY-format buffers for tests.
function buildMetadataBlock(payload: string): Uint8Array {
  const bytes = new TextEncoder().encode(payload);
  // round up to multiple of 16
  const padded = Math.ceil(bytes.length / 16) * 16;
  const out = new Uint8Array(1 + padded);
  out[0] = padded / 16;
  out.set(bytes, 1);
  // remaining bytes are 0 (null-padded), which is what we want
  return out;
}

function buildEmptyMetaMarker(): Uint8Array {
  return new Uint8Array([0]); // L=0 → no metadata
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('parseIcy — happy path', () => {
  it('yields a title from a single well-formed block', async () => {
    const metaInt = 4;
    const audio = new Uint8Array(metaInt); // 4 bytes of "audio"
    const meta = buildMetadataBlock("StreamTitle='Miles Davis - So What';");
    const stream = streamFromChunks([audio, meta]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Miles Davis - So What' }]);
  });

  it('emits twice when the title changes between blocks', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='A - one';"),
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='B - two';"),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'A - one' }, { title: 'B - two' }]);
  });

  it('dedupes consecutive identical titles', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='Same - song';"),
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='Same - song';"),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Same - song' }]);
  });

  it('reassembles data split across multiple chunks mid-metadata', async () => {
    const metaInt = 4;
    const audio = new Uint8Array(metaInt);
    const meta = buildMetadataBlock("StreamTitle='Split - test';");
    // split the metadata block in half
    const half = Math.floor(meta.length / 2);
    const stream = streamFromChunks([audio, meta.slice(0, half), meta.slice(half)]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Split - test' }]);
  });

  it('cancels the upstream reader when the consumer breaks out early', async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(buildMetadataBlock("StreamTitle='Only - song';"));
        // never closes — would hang if cancel didn't propagate
      },
      cancel() { canceled = true; },
    });

    for await (const ev of parseIcy(stream, 4)) {
      expect(ev.title).toBe('Only - song');
      break;
    }
    expect(canceled).toBe(true);
  });
});
