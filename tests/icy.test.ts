import { describe, it, expect } from 'vitest';
import { parseIcy, demuxIcy } from '../app/lib/icy';

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

describe('parseIcy — edge cases', () => {
  it('emits nothing for an L=0 (no-change) marker', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      new Uint8Array([0]),         // L=0 → no metadata payload
      new Uint8Array(metaInt),
      new Uint8Array([0]),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([]);
  });

  it('parses a UTF-8 title with non-ASCII characters', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock("StreamTitle='Beyoncé - Déjà Vu';"),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([{ title: 'Beyoncé - Déjà Vu' }]);
  });

  it('emits nothing and does not throw on malformed metadata', async () => {
    const metaInt = 4;
    const stream = streamFromChunks([
      new Uint8Array(metaInt),
      buildMetadataBlock('garbage with no StreamTitle field'),
    ]);

    const events = await collect(parseIcy(stream, metaInt));
    expect(events).toEqual([]);
  });
});

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
