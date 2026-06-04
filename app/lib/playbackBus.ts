'use client';

// One-way signal: "something else is about to play audio, radio should pause".
// The Player subscribes and pauses its <audio>; the Saved-Songs preview calls
// pauseRadio() before playing so the two never overlap.
type Listener = () => void;
const listeners = new Set<Listener>();

export function pauseRadio(): void {
  for (const cb of listeners) cb();
}

export function subscribePauseRadio(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
