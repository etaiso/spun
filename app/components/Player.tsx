'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';

export type PlayState = 'idle' | 'connecting' | 'playing' | 'error';

type Props = {
  station: Station;
  onPlayStateChange: (s: PlayState) => void;
};

export function Player({ station, onPlayStateChange }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(0.65);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume;
  }, [volume]);

  useEffect(() => {
    setPaused(false);
    onPlayStateChange('connecting');
  }, [station.id, onPlayStateChange]);

  function onPlay() { onPlayStateChange('playing'); }
  function onWaiting() { onPlayStateChange('connecting'); }
  function onError() { onPlayStateChange('error'); }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPaused(false); } else { a.pause(); setPaused(true); }
  }

  function retry() {
    const a = audioRef.current;
    if (!a) return;
    a.load();
    a.play().catch(() => {});
  }

  return (
    <div className="flex items-center gap-5 pt-2">
      <audio
        ref={audioRef}
        key={station.streamUrl}
        src={station.streamUrl}
        autoPlay
        onPlay={onPlay}
        onWaiting={onWaiting}
        onError={onError}
        onPlaying={onPlay}
      />
      <button
        onClick={togglePlay}
        className="w-14 h-14 rounded-full bg-[var(--color-ink)] text-white text-xl flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.2)]"
        aria-label={paused ? 'Play' : 'Pause'}
      >
        {paused ? '▶' : '⏸'}
      </button>
      <div className="flex items-center gap-3 flex-1 max-w-[280px] text-[var(--color-ink-3)]">
        <span className="text-base">🔊</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="flex-1 accent-[var(--color-warm)]"
          aria-label="Volume"
        />
      </div>
      <button onClick={retry} className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)] underline">
        Retry
      </button>
    </div>
  );
}
