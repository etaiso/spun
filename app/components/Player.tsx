'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import { resumeAudio, connectIfRunning, disconnectElement } from '@/app/lib/audioBus';
import { subscribePauseRadio, subscribeResumeRadio, stopPreview } from '@/app/lib/playbackBus';
import { VOLUME_KEY, readStoredVolume } from '@/app/lib/volume';
import { persistSet } from '@/app/lib/persist';
import { showTitleIfTruncated } from '@/app/lib/dom';
import { StationLogo } from './StationLogo';
import { TimeshiftEngine, type TimeshiftState } from '@/app/lib/timeshift/engine';
import { timeshiftEnabled } from '@/app/lib/timeshiftSetting';
import { subscribeSeekRequests, publishTimeshiftState } from '@/app/lib/timeshift/bus';
import { TimeshiftControls } from './TimeshiftControls';

export type PlayState = 'idle' | 'connecting' | 'playing' | 'error';

type Props = {
  station: Station;
  onPlayStateChange: (s: PlayState) => void;
  // When true, render a compact bar docked to the bottom of the page instead of
  // the full inline controls — used while the Explore view is open so playback
  // continues uninterrupted (the same audio element stays mounted either way).
  dock?: boolean;
  // The current song title, shown in the dock alongside the station name.
  nowPlaying?: string | null;
  // Clicking the dock's station info returns to the full now-playing view.
  onExpand?: () => void;
  // Song tick marks for the timeshift scrubber — passed down from the page in a
  // later task; default [].
  ticks?: { atMs: number; title: string }[];
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

export function Player({ station, onPlayStateChange, dock = false, nowPlaying = null, onExpand, ticks = [] }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // True only while the live stream is paused because a preview asked it to —
  // so we resume exactly that, never audio the user paused themselves. A single
  // boolean suffices because at most one preview is ever on screen at a time
  // (the Saved-Songs preview lives in a modal; the playlist-history preview in
  // the main view — they can't both be active).
  const pausedByPreviewRef = useRef(false);
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

  // 'pending' while the engine handshakes; 'on' = MSE timeshift path; 'off' =
  // plain <audio src=/api/stream> exactly as before this feature. Reading
  // localStorage/MediaSource in the initializer is safe here for the same
  // reason as `volume`/`autoplay` above: Player only mounts after a user
  // gesture, so it never SSR-renders — no hydration mismatch.
  const [tsMode, setTsMode] = useState<'pending' | 'on' | 'off'>(() =>
    timeshiftEnabled() && typeof MediaSource !== 'undefined' ? 'pending' : 'off');
  const [tsState, setTsState] = useState<TimeshiftState | null>(null);
  const engineRef = useRef<TimeshiftEngine | null>(null);
  // Timeshift can fail transiently (e.g. a SourceBuffer error from a dev
  // Strict-Mode double-mount race, or a momentary upstream/MSE hiccup). Rather
  // than fall back to plain audio for the whole session on the first stumble,
  // retry the engine a couple of times — a clean rebuild clears the errored
  // media element. tsAttempt re-triggers the lifecycle effect.
  const [tsAttempt, setTsAttempt] = useState(0);
  const tsRetriesRef = useRef(0);
  const TS_MAX_RETRIES = 2;
  // The autoplay effect re-runs when tsMode settles, but its body must fire at
  // most once for the lifetime of this Player instance.
  const ranRef = useRef(false);

  useEffect(() => {
    persistSet(VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    persistSet(AUTOPLAY_KEY, String(autoplay));
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

  // Bring up the timeshift engine once on mount when the setting is on. The
  // engine takes over the audio element's `src` (an MSE object URL) and feeds
  // a sliding SourceBuffer window. start() resolves false on the format gate
  // (silent fallback) and onFallback fires on any later failure — both revert
  // us to the plain path, which remounts the element via the `key` below.
  useEffect(() => {
    if (tsMode !== 'pending') return;
    let cancelled = false;
    let engine: TimeshiftEngine | null = null;
    // Defer engine creation past this tick. In React Strict Mode (dev) the
    // effect runs mount→cleanup→mount synchronously; deferring + cancelling in
    // cleanup means only the surviving mount ever builds an engine, so two
    // engines never fight over the one <audio> element (which previously caused
    // intermittent SourceBuffer errors → fallback).
    const timer = setTimeout(() => {
      if (cancelled) return;
      const a = audioRef.current;
      if (!a) { setTsMode('off'); return; }
      engine = new TimeshiftEngine(a, {
        streamUrl: station.streamUrl,
        stationId: station.id,
        onState: (s) => { setTsState(s); publishTimeshiftState(s); },
        onFallback: (reason) => {
          if (cancelled) return;
          engineRef.current = null;
          setTsState(null);
          publishTimeshiftState(null);
          if (tsRetriesRef.current < TS_MAX_RETRIES) {
            tsRetriesRef.current++;
            console.warn(`[timeshift] rebuilding engine (retry ${tsRetriesRef.current}/${TS_MAX_RETRIES}):`, reason);
            // Back to 'pending' so the lifecycle effect actually rebuilds: it
            // no-ops on any other mode, so a failure after we reached 'on'
            // would otherwise strand playback with no engine and no controls.
            setTsMode('pending');
            setTsAttempt(n => n + 1); // re-trigger the effect for a fresh engine
          } else {
            console.warn('[timeshift] giving up after retries, plain audio for this session:', reason);
            setTsMode('off');
          }
        },
      });
      engineRef.current = engine;
      // A failing engine can error the media element (e.g. a decode error),
      // which pauses it — so the rebuilt engine can't infer "was playing"
      // from the element. Capture intent before start(): playing, or paused
      // BY the error rather than by the user.
      const resumeAfterStart = !a.paused || a.error !== null;
      engine.start().then(ok => {
        if (cancelled) return;
        if (ok) {
          tsRetriesRef.current = 0;
          setTsMode('on');
          if (resumeAfterStart && a.paused) {
            setPaused(false);
            a.play().catch(() => { /* gesture-gated — the next interaction resumes */ });
          }
          return;
        }
        // start() returned false = format gate (unsupported codec / no MSE).
        // That's not transient — go straight to plain, no retry.
        engineRef.current = null;
        setTsMode('off');
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      engine?.stop();
      engineRef.current = null;
      publishTimeshiftState(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tsAttempt]);

  // Jump-to-song seeks requested from PlaylistHistory go through the engine.
  useEffect(() => subscribeSeekRequests((ms) => engineRef.current?.seekToWallClock(ms)), []);

  // On mount, start playback when autoplay is enabled. Browsers block
  // audio-with-sound before any user interaction (e.g. after a reload), so we
  // call play() ourselves to catch the rejection: instead of a stuck
  // "connecting" splash we show the station ready/paused, and arm the next
  // pointer interaction to start it — the closest to autoplay the platform
  // allows without a gesture.
  useEffect(() => {
    if (tsMode === 'pending') return;       // engine still handshaking — wait
    if (ranRef.current) return;
    ranRef.current = true;
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
  }, [tsMode]);

  // Pause the live stream when a preview starts; remember we did, so we can
  // resume it when the preview ends.
  useEffect(() => {
    return subscribePauseRadio(() => {
      const a = audioRef.current;
      if (a && !a.paused) { a.pause(); setPaused(true); pausedByPreviewRef.current = true; }
    });
  }, []);

  // Resume the live stream when the preview that paused it ends — but only if a
  // preview was what paused it, and only if it's still paused (so we never
  // start playback the user didn't ask for).
  useEffect(() => {
    return subscribeResumeRadio(() => {
      if (!pausedByPreviewRef.current) return;
      pausedByPreviewRef.current = false;
      const a = audioRef.current;
      if (a && a.paused) {
        setPaused(false);
        a.play().catch(() => cbRef.current('error'));
      }
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
    // Re-attach when swapping between the full controls and the dock, since the
    // wrapper element (volWrapRef) is a different node in each layout.
  }, [dock]);

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
  // M mute, Up/Down volume, Left/Right seek ±10s (J/L ±30s). Skips when the
  // user is typing in a field and when a modifier is held (so browser
  // shortcuts still work).
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
        case 'ArrowLeft':
          e.preventDefault();
          engineRef.current?.seekBy(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          engineRef.current?.seekBy(10);
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          engineRef.current?.seekBy(-30);
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          if (e.shiftKey) engineRef.current?.goLive();
          else engineRef.current?.seekBy(30);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hardware media keys (play/pause button on media keyboards) and OS media
  // controls, for the live stream this Player owns. Prev/next are handled at
  // the page level (they cycle favorites). Mirrors the Space/K keydown logic.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const play = () => {
      const a = audioRef.current;
      if (!a) return;
      setPaused(false);
      cbRef.current('connecting');
      setupAnalysis();
      a.play().catch(() => cbRef.current('error'));
    };
    const pause = () => {
      const a = audioRef.current;
      if (!a || a.paused) return;
      a.pause();
      setPaused(true);
    };
    try {
      ms.setActionHandler('play', play);
      ms.setActionHandler('pause', pause);
      ms.setActionHandler('seekbackward', (d) => engineRef.current?.seekBy(-(d.seekOffset || 30)));
      ms.setActionHandler('seekforward', (d) => engineRef.current?.seekBy(d.seekOffset || 30));
    } catch { /* unsupported — ignore */ }
    return () => {
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
        ms.setActionHandler('seekbackward', null);
        ms.setActionHandler('seekforward', null);
      } catch { /* ignore */ }
    };
  }, []);

  // Keep the OS media UI's play/pause icon in sync with reality.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
  }, [paused]);

  // Wire the element into the Web Audio analyser once the context is running
  // (after a gesture) so the canvas visualiser can react to the live audio.
  function setupAnalysis() {
    const a = audioRef.current;
    if (!a) return;
    resumeAudio().then(() => connectIfRunning(a));
  }

  // Fires whenever the live stream actually begins playing (button, keyboard,
  // media keys, autoplay, or resume) — the single point to ensure no preview
  // keeps playing alongside it.
  function handlePlay() { stopPreview(); setPaused(false); cbRef.current('playing'); setupAnalysis(); }
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

  // The mute icon + volume slider, shared by the full controls and the dock.
  const volumeControl = (
    <div ref={volWrapRef} className="flex items-center gap-3 max-w-[280px] text-[var(--color-ink-3)]" title="Scroll to change volume">
      <button
        onClick={() => setMuted(m => !m)}
        className="shrink-0 hover:text-[var(--color-ink)] transition-colors cursor-pointer"
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
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
        className="flex-1 w-40 accent-[var(--color-brand-pink)] cursor-pointer"
        aria-label="Volume"
      />
    </div>
  );

  // The <audio> element is rendered ONCE here, outside the dock/full branch, so
  // switching layouts (e.g. opening Explore) never remounts it — playback and
  // the streaming connection survive the swap uninterrupted.
  const audioEl = (
    <audio
      ref={audioRef}
      // Inner key guards against streamUrl swaps within a single station
      // selection (e.g. mirror failover); parent typically keys by id. The
      // tsMode suffix forces a fresh element on fallback (ts → plain), so the
      // engine's MSE object URL is dropped and the plain src below takes hold.
      key={`${station.streamUrl}:${tsMode === 'off' ? 'plain' : 'ts'}`}
      // Proxied through our origin so Web Audio can analyse it for the
      // canvas visualiser (cross-origin streams can't be analysed). In
      // timeshift mode the engine owns `src` via an MSE object URL.
      src={tsMode === 'off' ? `/api/stream?url=${encodeURIComponent(station.streamUrl)}` : undefined}
      // Native autoplay attempt (some browsers/settings honor the attribute
      // more leniently than a script play()). The mount effect below also
      // calls play() to catch a block and arm a gesture-resume fallback.
      // Engine drives playback in timeshift mode.
      autoPlay={tsMode === 'off' ? autoplay : undefined}
      preload={autoplay ? 'auto' : 'none'}
      onPlay={handlePlay}
      onPlaying={handlePlay}
      onPause={handlePause}
      onWaiting={handleWaiting}
      // In timeshift mode the engine routes errors through onFallback; the
      // element's own error (e.g. a spurious one during MSE teardown) is ignored.
      onError={tsMode === 'on' ? undefined : handleError}
      onTimeUpdate={() => engineRef.current?.onTimeUpdate()}
    />
  );

  // Compact dock: fixed to the bottom of the content area (right of the
  // sidebar) so the active station keeps playing while the user browses Explore.
  if (dock) {
    return (
      <>
        {audioEl}
        <div className="fixed bottom-0 left-0 right-0 z-30 h-[72px] flex items-center gap-4 px-5 border-t border-[var(--color-line)] bg-[var(--color-bg-2)] shadow-[0_-4px_24px_rgba(60,30,10,0.08)]">
          <button
            onClick={togglePlay}
            data-autoplay-ignore
            className="shrink-0 w-12 h-12 rounded-full bg-[var(--color-ink)] text-white text-lg flex items-center justify-center shadow-[0_6px_16px_rgba(0,0,0,0.2)] cursor-pointer"
            aria-label={paused ? 'Play' : 'Pause'}
          >
            {paused ? '▶' : '⏸'}
          </button>
          <button
            onClick={onExpand}
            className="group flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
            title="Back to now playing"
          >
            <StationLogo name={station.name} favicon={station.favicon} size={44} />
            <div className="min-w-0">
              <div className="text-[14px] font-bold tracking-tight truncate group-hover:text-[var(--color-brand-purple)] transition-colors" onMouseEnter={showTitleIfTruncated}>{station.name}</div>
              <div className="text-xs text-[var(--color-ink-3)] truncate">{nowPlaying ?? 'Live'}</div>
            </div>
          </button>
          <div className="hidden sm:block">{volumeControl}</div>
        </div>
      </>
    );
  }

  return (
    <>
      {audioEl}
      <div className="relative z-10 flex items-center gap-5 pt-2 flex-wrap">
        <button
          onClick={togglePlay}
          data-autoplay-ignore
          className="w-14 h-14 rounded-full bg-[var(--color-ink)] text-white text-xl flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.2)] cursor-pointer"
          aria-label={paused ? 'Play' : 'Pause'}
        >
          {paused ? '▶' : '⏸'}
        </button>
        {volumeControl}
        <div className="flex-1" />
        <button
          onClick={() => setAutoplay(a => !a)}
          aria-pressed={autoplay}
          title="Start audio automatically when you pick a station"
          className={[
            'text-[11px] tracking-[1px] uppercase font-bold px-3 py-1.5 rounded-full border transition-colors cursor-pointer',
            autoplay
              ? 'bg-[var(--color-brand-purple)] text-white border-[var(--color-brand-purple)] shadow-[0_2px_6px_rgba(168,85,247,0.3)]'
              : 'text-[var(--color-ink-3)] border-[var(--color-line)] hover:border-[var(--color-brand-pink)] hover:text-[var(--color-ink)]',
          ].join(' ')}
        >
          Auto-play {autoplay ? 'on' : 'off'}
        </button>
      </div>
      {tsMode === 'on' && tsState && (
        <div className="relative z-10 mt-3">
          <TimeshiftControls
            state={tsState}
            onGoLive={() => engineRef.current?.goLive()}
            onSeekTo={(ms) => engineRef.current?.seekToWallClock(ms)}
            ticks={ticks ?? []}
          />
        </div>
      )}
    </>
  );
}
