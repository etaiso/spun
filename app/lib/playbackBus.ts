'use client';

// One-way signals coordinating the single audio output. "pause": something else
// is about to play (a preview) — the radio should pause. "resume": that preview
// ended — the radio may resume (the Player decides, only if a preview paused it).
// "stopPreview": the live radio is (re)starting — any preview must stop so the
// two never overlap. The Player subscribes to pause/resume and emits stopPreview;
// previews emit pause/resume and subscribe to stopPreview.
type Listener = () => void;

const pauseListeners = new Set<Listener>();
const resumeListeners = new Set<Listener>();
const stopPreviewListeners = new Set<Listener>();

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

export function stopPreview(): void {
  for (const cb of stopPreviewListeners) cb();
}

export function subscribeStopPreview(cb: Listener): () => void {
  stopPreviewListeners.add(cb);
  return () => { stopPreviewListeners.delete(cb); };
}
