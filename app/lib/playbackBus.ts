'use client';

// One-way signals coordinating the single audio output. "pause": something else
// is about to play (a preview) — the radio should pause. "resume": that preview
// ended — the radio may resume (the Player decides, only if a preview paused it).
// The Player subscribes to both; previews call pauseRadio() before playing and
// (optionally) resumeRadio() when they stop.
type Listener = () => void;

const pauseListeners = new Set<Listener>();
const resumeListeners = new Set<Listener>();

export function pauseRadio(): void {
  for (const cb of pauseListeners) cb();
}

export function subscribePauseRadio(cb: Listener): () => void {
  pauseListeners.add(cb);
  return () => { pauseListeners.delete(cb); };
}

export function resumeRadio(): void {
  for (const cb of resumeListeners) cb();
}

export function subscribeResumeRadio(cb: Listener): () => void {
  resumeListeners.add(cb);
  return () => { resumeListeners.delete(cb); };
}
