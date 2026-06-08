'use client';

import { useCallback, useRef, useState } from 'react';
import { pauseRadio, resumeRadio } from './playbackBus';
import { readStoredVolume } from './volume';

// Shared preview-audio controller. Owns one hidden <audio>, tracks which entry
// is previewing, and coordinates with the live radio via playbackBus: a preview
// always pauses the radio; whether stopping resumes it is per-caller
// (resumeRadioOnStop) — the history list resumes, the Saved-Songs dialog does not.
export function usePreviewPlayer({ resumeRadioOnStop }: { resumeRadioOnStop: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPreviewId(null);
    if (resumeRadioOnStop) resumeRadio();
  }, [resumeRadioOnStop]);

  const toggle = useCallback((id: string, url: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (previewId === id) { stop(); return; }
    pauseRadio();                 // never overlap the live stream
    a.volume = readStoredVolume(); // match the player's volume setting
    a.src = url;
    a.play().catch(() => {});
    setPreviewId(id);
  }, [previewId, stop]);

  // `onEnded` is spread onto the <audio> by the caller; ending behaves like stop.
  return { previewId, audioRef, onEnded: stop, toggle, stop };
}
