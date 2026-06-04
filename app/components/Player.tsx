'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { resumeAudio, connectIfRunning, disconnectElement } from '@/app/lib/audioBus';
import { subscribePauseRadio } from '@/app/lib/playbackBus';
import { VOLUME_KEY, readStoredVolume } from '@/app/lib/volume';

export type PlayState = 'idle' | 'connecting' | 'playing' | 'error';

type Props = {
  station: Station;
  onPlayStateChange: (s: PlayState) => void;
};

const AUTOPLAY_KEY = 'radio:autoplay';
const DEFAULT_AUTOPLAY = false;

function readStoredAutoplay(): boolean {
  if (typeof window === 'undefined') return DEFAULT_AUTOPLAY;
  try {
    return window.localStorage.getItem(AUTOPLAY_KEY) === 'true';
  } catch {
    return DEFAULT_AUTOPLAY;
  }
}

export function Player({ station, onPlayStateChange }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volWrapRef = useRef<HTMLDivElement | null>(null);
  // Lazy init: Player is only rendered after a user gesture (selectedStation
  // starts null), so no SSR happens here — safe to read localStorage on
  // first render without a hydration mismatch.
  const [volume, setVolume] = useState<number>(readStoredVolume);
  const [muted, setMuted] = useState(false);
  const [autoplay, setAutoplay] = useState<boolean>(readStoredAutoplay);
  // `autoplay` is the per-Player-instance value read on mount. Each station
  // change remounts the component, so it picks up the latest setting then.
  // Initial paused state mirrors !autoplay so the button icon is correct.
  const [paused, setPaused] = useState<boolean>(!autoplay);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Safari private mode / quota — best-effort persistence.
    }
  }, [volume]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTOPLAY_KEY, String(autoplay));
    } catch {
      // best-effort
    }
  }, [autoplay]);

  // Stash the callback in a ref so the on-mount effect can call it without
  // re-firing when the parent re-renders with a new closure.
  const cbRef = useRef(onPlayStateChange);
  useEffect(() => { cbRef.current = onPlayStateChange; });

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume;
  }, [volume]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = muted;
  }, [muted]);

  // On mount, start playback when autoplay is enabled. Browsers block
  // audio-with-sound before any user interaction (e.g. after a reload), so we
  // call play() ourselves to catch the rejection: instead of a stuck
  // "connecting" splash we show the station ready/paused, and arm the next
  // pointer interaction to start it — the closest to autoplay the platform
  // allows without a gesture.
  useEffect(() => {
    if (!autoplay) { cbRef.current('idle'); return; }
    const a = audioRef.current;
    if (!a) return;

    let cancelled = false;
    let disarm: (() => void) | undefined;

    // If the native autoplay attribute already started playback, leave the
    // 'playing' state from onPlay alone; otherwise report connecting.
    if (a.paused) cbRef.current('connecting');
    a.play().catch(() => {
      if (cancelled) return;
      // Blocked until a gesture — reflect reality and wait for one.
      setPaused(true);
      cbRef.current('idle');
      const onPointer = (e: PointerEvent) => {
        // The play/pause button starts playback itself; don't double-fire and
        // race it (which would immediately re-pause).
        if ((e.target as HTMLElement | null)?.closest('[data-autoplay-ignore]')) {
          disarm?.();
          return;
        }
        disarm?.();
        setPaused(false);
        cbRef.current('connecting');
        setupAnalysis();
        a.play().catch(() => cbRef.current('error'));
      };
      window.addEventListener('pointerdown', onPointer, { capture: true });
      disarm = () => window.removeEventListener('pointerdown', onPointer, { capture: true });
    });

    return () => { cancelled = true; disarm?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause the live stream when something else (a saved-song preview) starts.
  useEffect(() => {
    return subscribePauseRadio(() => {
      const a = audioRef.current;
      if (a && !a.paused) { a.pause(); setPaused(true); }
    });
  }, []);

  // Adjust volume by scrolling the wheel over the volume control. Registered as
  // a non-passive native listener because React's synthetic onWheel is passive,
  // so preventDefault() there wouldn't stop the page from scrolling.
  useEffect(() => {
    const el = volWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1; // wheel up = louder
      setMuted(false);
      // Small step per wheel event — trackpads/mice fire many events per
      // scroll, so a large step races to the ends too fast.
      setVolume(v => Math.min(1, Math.max(0, +(v + dir * 0.02).toFixed(2))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // On unmount (station switch), explicitly tear down the audio element so its
  // proxied connection is released immediately. Without this, rapid switching
  // leaves stale streaming connections open; in dev (HTTP/1.1, ~6 connections
  // per origin) they pile up until new requests can't connect — playback gets
  // stuck with no sound. Also drop the Web Audio node so the graph doesn't leak.
  //
  // Guard on `a.isConnected`: React Strict Mode (dev) simulates an
  // unmount+remount on mount WITHOUT removing the DOM node, so this cleanup
  // would otherwise strip the src of the still-live element (leaving it silent,
  // since the component doesn't re-render to re-apply src). On a real unmount
  // the passive cleanup runs after the node has left the DOM, so isConnected is
  // false and we tear down for real.
  useEffect(() => {
    const a = audioRef.current;
    return () => {
      if (!a || a.isConnected) return;
      disconnectElement(a);
      try {
        a.pause();
        a.removeAttribute('src');
        a.load(); // forces the browser to abort the in-flight stream request
      } catch { /* best-effort teardown */ }
    };
  }, []);

  // Global media keyboard shortcuts for the audio it owns: Space/K play-pause,
  // M mute, Up/Down volume. Skips when the user is typing in a field and when
  // a modifier is held (so browser shortcuts still work).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      // Skip only when typing into a text field — NOT the volume slider
      // (type="range"), so M / Space / arrows still work while it's focused.
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (t && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const a = audioRef.current;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          if (!a) return;
          if (a.paused) {
            setPaused(false);
            cbRef.current('connecting');
            a.play().catch(() => cbRef.current('error'));
          } else {
            a.pause();
            setPaused(true);
          }
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          setMuted(m => !m);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setMuted(false);
          setVolume(v => Math.min(1, +(v + 0.05).toFixed(2)));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(v => Math.max(0, +(v - 0.05).toFixed(2)));
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wire the element into the Web Audio analyser once the context is running
  // (after a gesture) so the canvas visualiser can react to the live audio.
  function setupAnalysis() {
    const a = audioRef.current;
    if (!a) return;
    resumeAudio().then(() => connectIfRunning(a));
  }

  function handlePlay() { setPaused(false); cbRef.current('playing'); setupAnalysis(); }
  function handlePause() { setPaused(true); }
  function handleWaiting() { cbRef.current('connecting'); }
  function handleError() { cbRef.current('error'); }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      setPaused(false);
      cbRef.current('connecting');
      setupAnalysis(); // resume/connect within the click gesture
      a.play().catch(() => cbRef.current('error'));
    } else {
      a.pause();
      setPaused(true);
    }
  }

  return (
    <div className="relative z-10 flex items-center gap-5 pt-2 flex-wrap">
      <audio
        ref={audioRef}
        // Inner key guards against streamUrl swaps within a single station
        // selection (e.g. mirror failover); parent typically keys by id.
        key={station.streamUrl}
        // Proxied through our origin so Web Audio can analyse it for the
        // canvas visualiser (cross-origin streams can't be analysed).
        src={`/api/stream?url=${encodeURIComponent(station.streamUrl)}`}
        // Native autoplay attempt (some browsers/settings honor the attribute
        // more leniently than a script play()). The mount effect below also
        // calls play() to catch a block and arm a gesture-resume fallback.
        autoPlay={autoplay}
        preload={autoplay ? 'auto' : 'none'}
        onPlay={handlePlay}
        onPlaying={handlePlay}
        onPause={handlePause}
        onWaiting={handleWaiting}
        onError={handleError}
      />
      <button
        onClick={togglePlay}
        data-autoplay-ignore
        className="w-14 h-14 rounded-full bg-[var(--color-ink)] text-white text-xl flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.2)] cursor-pointer"
        aria-label={paused ? 'Play' : 'Pause'}
      >
        {paused ? '▶' : '⏸'}
      </button>
      <div ref={volWrapRef} className="flex items-center gap-3 max-w-[280px] text-[var(--color-ink-3)]" title="Scroll to change volume">
        <button
          onClick={() => setMuted(m => !m)}
          className="shrink-0 hover:text-[var(--color-ink)] transition-colors cursor-pointer"
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute'}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
          >
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            {muted ? (
              <>
                <line x1="22" y1="9" x2="16" y2="15" />
                <line x1="16" y1="9" x2="22" y2="15" />
              </>
            ) : (
              <>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </>
            )}
          </svg>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="flex-1 w-40 accent-[var(--color-warm)] cursor-pointer"
          aria-label="Volume"
        />
      </div>
      <div className="flex-1" />
      <button
        onClick={() => setAutoplay(a => !a)}
        aria-pressed={autoplay}
        title="Start audio automatically when you pick a station"
        className={[
          'text-[11px] tracking-[1px] uppercase font-bold px-3 py-1.5 rounded-full border transition-colors cursor-pointer',
          autoplay
            ? 'bg-[var(--color-warm)] text-white border-[var(--color-warm)] shadow-[0_2px_6px_rgba(210,105,30,0.3)]'
            : 'text-[var(--color-ink-3)] border-[var(--color-line)] hover:border-[var(--color-warm)] hover:text-[var(--color-ink)]',
        ].join(' ')}
      >
        Auto-play {autoplay ? 'on' : 'off'}
      </button>
    </div>
  );
}
