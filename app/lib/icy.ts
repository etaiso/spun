export type IcyEvent = { title: string };

const decoder = new TextDecoder('utf-8', { fatal: false });

function extractTitle(payload: Uint8Array): string | null {
  let end = payload.length;
  while (end > 0 && payload[end - 1] === 0) end--;
  const text = decoder.decode(payload.subarray(0, end));
  const match = text.match(/StreamTitle='((?:[^']|\\')*)'/);
  return match ? match[1] : null;
}

export async function* parseIcy(
  stream: ReadableStream<Uint8Array>,
  metaInt: number,
): AsyncGenerator<IcyEvent> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let mode: 'audio' | 'len' | 'meta' = 'audio';
  let need = metaInt;
  let lastTitle: string | null = null;

  function skip(n: number): void {
    let remaining = n;
    while (remaining > 0) {
      const head = chunks[0];
      if (head.length <= remaining) {
        remaining -= head.length;
        chunks.shift();
      } else {
        chunks[0] = head.subarray(remaining);
        remaining = 0;
      }
    }
    buffered -= n;
  }

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
          if (buffered < need) break;
          skip(need);
          mode = 'len';
          need = 1;
        } else if (mode === 'len') {
          if (buffered < 1) break;
          const lenByte = take(1)[0];
          const metaLen = lenByte * 16;
          if (metaLen === 0) {
            mode = 'audio';
            need = metaInt;
          } else {
            mode = 'meta';
            need = metaLen;
          }
        } else {
          if (buffered < need) break;
          const payload = take(need);
          const title = extractTitle(payload);
          if (title !== null && title !== lastTitle) {
            lastTitle = title;
            yield { title };
          }
          mode = 'audio';
          need = metaInt;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
