export type IcyEvent = { title: string };

const decoder = new TextDecoder('utf-8', { fatal: false });

function extractTitle(payload: Uint8Array): string | null {
  // Strip trailing null padding before decoding.
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
  const buf: number[] = [];
  let mode: 'audio' | 'len' | 'meta' = 'audio';
  let need = metaInt;
  let metaLen = 0;
  let lastTitle: string | null = null;

  function take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = buf[i];
    buf.splice(0, n);
    return out;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    for (let i = 0; i < value.length; i++) buf.push(value[i]);

    while (true) {
      if (mode === 'audio') {
        if (buf.length < need) break;
        buf.splice(0, need);
        mode = 'len';
        need = 1;
      } else if (mode === 'len') {
        if (buf.length < 1) break;
        const lenByte = take(1)[0];
        metaLen = lenByte * 16;
        if (metaLen === 0) {
          mode = 'audio';
          need = metaInt;
        } else {
          mode = 'meta';
          need = metaLen;
        }
      } else {
        // mode === 'meta'
        if (buf.length < need) break;
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
}
