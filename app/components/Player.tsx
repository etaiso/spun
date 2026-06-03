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

  // Stash the callback in a ref so the station-change effect can call it
  // without re-firing when the parent re-renders with a new closure.
  const cbRef = useRef(onPlayStateChange);
  useEffect(() => { cbRef.current = onPlayStateChange; });

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume;
  }, [volume]);

  // Fire 'connecting' once on mount. The parent keys this component by
  // station.id, so a station change remounts (paused state resets to its
  // useState initial value automatically — no explicit reset needed here).
  useEffect(() => {
    cbRef.current('connecting');
  }, []);

  function handlePlay() { setPaused(false); cbRef.current('playing'); }
  function handlePause() { setPaused(true); }
  function handleWaiting() { cbRef.current('connecting'); }
  function handleError() { cbRef.current('error'); }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      setPaused(false);
      a.play().catch(() => cbRef.current('error'));
    } else {
      a.pause();
      setPaused(true);
    }
  }

  function retry() {
    const a = audioRef.current;
    if (!a) return;
    a.load();
    a.play().catch(() => cbRef.current('error'));
  }

  return (
    <div className="flex items-center gap-5 pt-2">
      <audio
        ref={audioRef}
        // Inner key guards against streamUrl swaps within a single station
        // selection (e.g. mirror failover); parent typically keys by id.
        key={station.streamUrl}
        src={station.streamUrl}
        autoPlay
        onPlay={handlePlay}
        onPlaying={handlePlay}
        onPause={handlePause}
        onWaiting={handleWaiting}
        onError={handleError}
      />
      <button
        onClick={togglePlay}
        className="w-14 h-14 rounded-full bg-[var(--color-ink)] text-white text-xl flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.2)]"
        aria-label={paused ? 'Play' : 'Pause'}
      >
        {paused ? '▶' : '⏸'}
      </button>
      <div className="flex items-center gap-3 flex-1 max-w-[280px] text-[var(--color-ink-3)]">
        <span className="text-base" aria-hidden="true">🔊</span>
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
