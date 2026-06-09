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
