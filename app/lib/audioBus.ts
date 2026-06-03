'use client';

// A single shared Web Audio graph for the whole app:
//   <audio> ──MediaElementSource──► AnalyserNode ──► destination
// The AnalyserNode lets the visualiser read the live waveform. We only tap an
// element once the AudioContext is actually running (i.e. after a user
// gesture), so routing through the graph can never silence playback.

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freq: Uint8Array<ArrayBuffer> | null = null;
const wired = new WeakSet<HTMLMediaElement>();

function ensure(): boolean {
  if (typeof window === 'undefined') return false;
  if (!ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    analyser.connect(ctx.destination);
    freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  }
  return true;
}

/** Resume the context (call from a user gesture / on play). */
export async function resumeAudio(): Promise<void> {
  if (!ensure() || !ctx) return;
  if (ctx.state !== 'running') {
    try { await ctx.resume(); } catch { /* blocked until a gesture */ }
  }
}

/**
 * Route an audio element through the analyser — but only if the context is
 * running, so we never reroute (and mute) audio that's playing on a suspended
 * context. Idempotent per element. Returns true once wired.
 */
export function connectIfRunning(el: HTMLMediaElement): boolean {
  if (!ensure() || !ctx || ctx.state !== 'running') return false;
  if (wired.has(el)) return true;
  try {
    const source = ctx.createMediaElementSource(el);
    source.connect(analyser!);
    wired.add(el);
    return true;
  } catch {
    return false; // already connected elsewhere, or not allowed
  }
}

/** AudioContext state for debugging: 'none' | 'suspended' | 'running' | … */
export function getContextState(): string {
  return ctx ? ctx.state : 'none';
}

/** Current low-frequency (bass-weighted) energy, 0…1. 0 when no signal. */
export function getEnergy(): number {
  if (!analyser || !freq) return 0;
  analyser.getByteFrequencyData(freq);
  const n = Math.min(32, freq.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += freq[i];
  return sum / n / 255;
}
