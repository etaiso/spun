'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import type { PlayState } from './Player';
import { RegionPicker } from './RegionPicker';
import { HiddenStationsDialog } from './HiddenStationsDialog';
import { DebugPanel } from './DebugPanel';
import { UpdateModal } from './UpdateModal';
import { useRingsEnabled } from '@/app/lib/visualizer';
import { useHidden } from '@/app/lib/hidden';
import { persistSet } from '@/app/lib/persist';
import { useSavedSongs } from '@/app/lib/savedSongs';
import { spotify, isAvailable as spotifyAvailable, type SpotifyStatus } from '@/app/lib/integrations/spotifyBridge';
import { pendingSongs, syncSongs } from '@/app/lib/integrations/spotifySync';
import { useSpotifyAutoSync } from '@/app/lib/spotifyPrefs';
import {
  useAutoUpdate,
  canCheckForUpdate,
  requestUpdateCheck,
  downloadUpdate,
  quitAndInstall,
  type UpdateStatus,
} from '@/app/lib/autoUpdate';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  station: Station | null;
  playState: PlayState;
  currentTrack: string | null;
};

const DEBUG_KEY = 'radio:showDebug';

// One-line summary of the updater's current state, or null when there's nothing
// worth showing. Driven by events the Electron main process forwards over IPC.
function updateStatusLine(s: UpdateStatus): string | null {
  switch (s.state) {
    case 'checking': return 'Checking for updates…';
    case 'available': return s.version ? `Found ${s.version} — downloading…` : 'Downloading update…';
    case 'downloading': return `Downloading update… ${s.percent ?? 0}%`;
    case 'downloaded': return s.version ? `Update ${s.version} ready — restart to apply.` : 'Update ready — restart to apply.';
    case 'none': return 'You’re on the latest version.';
    case 'error': return 'Update check failed — try again later.';
    default: return null;
  }
}

export function SettingsDialog({ open, onOpenChange, station, playState, currentTrack }: Props) {
  // Audio-reactive rings toggle (persisted, on by default).
  const { enabled: ringsOn, toggle: toggleRings } = useRingsEnabled();

  // Hidden stations live in their own modal (opened below) so a long list
  // doesn't bloat Settings; here we only show the count + a way in.
  const { hidden } = useHidden();
  const [hiddenOpen, setHiddenOpen] = useState(false);

  // Whether to show the debug readout (dev only). Persisted, default off.
  const [showDebug, setShowDebug] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; }
  });

  // Auto-update preference (persisted, on by default) + live status forwarded
  // from the Electron updater. The toggle/status only mean anything in the
  // desktop build; on web `window.spun` is absent and onUpdateStatus is a no-op.
  const { enabled: autoUpdateOn, toggle: toggleAutoUpdate } = useAutoUpdate();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  // "Check now" UX: a spinner while the check is in flight, then a modal with the
  // result. `manualRef` distinguishes a user-initiated check (which gets the
  // spinner + modal) from background auto-update events (which only update the
  // ambient status line), since both arrive on the same onUpdateStatus stream.
  const [checking, setChecking] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const manualRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.spun?.onUpdateStatus) return;
    return window.spun.onUpdateStatus((s) => {
      setUpdateStatus(s);
      if (!manualRef.current) return;     // background auto-update — no spinner/modal
      if (s.state === 'checking') return; // still spinning; nothing resolved yet
      setChecking(false);                 // resolved → stop the spinner, show the modal
      setUpdateModalOpen(true);
    });
  }, []);

  const onCheckNow = () => {
    if (!canCheckForUpdate()) return;     // web build / no shell — nothing to do
    manualRef.current = true;
    setChecking(true);
    setUpdateStatus({ state: 'checking' });
    requestUpdateCheck();
  };
  const onUpdateNow = () => {
    setUpdateStatus({ state: 'downloading', percent: 0 }); // immediate feedback
    downloadUpdate();
  };
  const closeUpdateModal = () => {
    setUpdateModalOpen(false);
    manualRef.current = false;
  };

  // --- Spotify playlist export (desktop only, when SPOTIFY_CLIENT_ID set) -----
  const { saved, update } = useSavedSongs();
  const { enabled: autoSyncOn, toggle: toggleAutoSync } = useSpotifyAutoSync();
  const spotifyOn = spotifyAvailable();
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus>({ connected: false });
  const [spotifyBusy, setSpotifyBusy] = useState<null | 'connecting' | 'syncing'>(null);
  const [spotifyMsg, setSpotifyMsg] = useState('');
  useEffect(() => {
    if (!open || !spotifyOn) return;
    spotify.getStatus().then(setSpotifyStatus).catch(() => { /* shell gone */ });
  }, [open, spotifyOn]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      // When the Hidden-stations or Update modal is layered on top, let it own Escape.
      if (e.key === 'Escape' && !hiddenOpen && !updateModalOpen) onOpenChange(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, hiddenOpen, updateModalOpen]);

  if (!open) return null;

  // Show the diagnostics panel in dev AND in the desktop (Electron) build —
  // both are "power" contexts. It stays hidden in the plain production web build.
  const isDev =
    process.env.NODE_ENV === 'development' ||
    (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent));

  // The update UI (auto-update toggle + "Check now") only does anything in the
  // desktop shell, where Electron exposes the updater on window.spun. Hide it
  // entirely on the web build — there's nothing to update there.
  const isDesktop = canCheckForUpdate();

  const toggleDebug = () => {
    setShowDebug(v => {
      const next = !v;
      persistSet(DEBUG_KEY, next ? '1' : '0');
      return next;
    });
  };

  const syncedCount = saved.filter(s => s.syncState === 'synced').length;
  const notFoundCount = saved.filter(s => s.syncState === 'not_found').length;
  const pendingCount = pendingSongs(saved).length;

  // Resolve + append pending songs. includeNotFound is true for a manual "Sync now"
  // so previously-unmatched songs get re-attempted; the connect-time backfill omits it.
  const runSpotifySync = async (includeNotFound: boolean) => {
    setSpotifyBusy('syncing');
    setSpotifyMsg('Syncing…');
    try {
      const r = await syncSongs(pendingSongs(saved, includeNotFound), spotify, update);
      setSpotifyMsg(`${r.synced} synced${r.notFound ? ` · ${r.notFound} not found` : ''}`);
    } catch {
      setSpotifyMsg('Sync failed — check your connection.');
    } finally {
      setSpotifyBusy(null);
    }
  };

  const onConnectSpotify = async () => {
    setSpotifyBusy('connecting');
    setSpotifyMsg('Waiting for Spotify authorization…');
    try {
      const r = await spotify.connect();
      if (!r.ok) { setSpotifyMsg('Connection cancelled.'); setSpotifyBusy(null); return; }
      setSpotifyStatus(await spotify.getStatus());
      setSpotifyBusy(null);
      await runSpotifySync(false); // backfill all existing saved songs
    } catch {
      setSpotifyMsg('Could not connect to Spotify.');
      setSpotifyBusy(null);
    }
  };

  const onDisconnectSpotify = async () => {
    await spotify.disconnect();
    setSpotifyStatus({ connected: false });
    setSpotifyMsg('');
  };

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-6 pt-[12vh] pb-6"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
      >
        {/* Inner scroll container so the rounded corners are never clipped by
            the scrollbar. */}
        <div className="overflow-y-auto p-7">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-warm)]">
              Settings
            </h2>
            <button
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="text-lg leading-none text-[var(--color-ink-3)] hover:text-[var(--color-ink)] cursor-pointer"
            >
              ✕
            </button>
          </div>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-bold text-[var(--color-ink)]">Localization</h3>
            <RegionPicker />
          </section>

          <section className="mt-7 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">Pulse rings</h3>
                <p className="text-xs text-[var(--color-ink-3)] mt-0.5">Audio-reactive rings behind the cover.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={ringsOn}
                aria-label="Pulse rings"
                onClick={toggleRings}
                className={[
                  'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                  ringsOn ? 'bg-[var(--color-warm)]' : 'bg-[var(--color-line)]',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                    ringsOn ? 'left-[18px]' : 'left-0.5',
                  ].join(' ')}
                />
              </button>
            </div>
          </section>

          {isDesktop && (
            <section className="mt-7 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-ink)]">Software update</h3>
                  <p className="text-xs text-[var(--color-ink-3)] mt-0.5">
                    {autoUpdateOn
                      ? 'Install new versions automatically and apply them on restart.'
                      : 'Off — you won’t receive new versions until you turn this back on.'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoUpdateOn}
                  aria-label="Automatic updates"
                  onClick={toggleAutoUpdate}
                  className={[
                    'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                    autoUpdateOn ? 'bg-[var(--color-warm)]' : 'bg-[var(--color-line)]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                      autoUpdateOn ? 'left-[18px]' : 'left-0.5',
                    ].join(' ')}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-ink-4)]">{autoUpdateOn ? (updateStatusLine(updateStatus) ?? '') : ''}</p>
                <button
                  type="button"
                  onClick={onCheckNow}
                  disabled={checking}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-warm)] border border-[var(--color-line)] hover:border-[var(--color-warm)] hover:bg-[var(--color-bg)] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default disabled:hover:border-[var(--color-line)] disabled:hover:bg-transparent"
                >
                  {checking ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" />
                      Checking…
                    </span>
                  ) : 'Check now'}
                </button>
              </div>
            </section>
          )}

          {spotifyOn && (
            <section className="mt-7 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-ink)]">Spotify</h3>
                  <p className="text-xs text-[var(--color-ink-3)] mt-0.5">
                    {spotifyStatus.connected
                      ? <>Saved songs sync to your private <b>Spun</b> playlist{spotifyStatus.displayName ? ` · ${spotifyStatus.displayName}` : ''}.</>
                      : 'Export saved songs to a private “Spun” playlist. Requires Spotify Premium.'}
                  </p>
                </div>
                {spotifyStatus.connected ? (
                  <button
                    onClick={onDisconnectSpotify}
                    className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-ink-3)] border border-[var(--color-line)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] cursor-pointer transition-colors"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={onConnectSpotify}
                    disabled={spotifyBusy === 'connecting'}
                    className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-[#1DB954] hover:bg-[#1aa84a] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default"
                  >
                    {spotifyBusy === 'connecting' ? 'Connecting…' : 'Connect Spotify'}
                  </button>
                )}
              </div>

              {spotifyStatus.connected && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">Auto-sync</h4>
                      <p className="text-xs text-[var(--color-ink-3)] mt-0.5">Add new saves to the playlist automatically.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoSyncOn}
                      aria-label="Auto-sync to Spotify"
                      onClick={toggleAutoSync}
                      className={[
                        'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                        autoSyncOn ? 'bg-[var(--color-warm)]' : 'bg-[var(--color-line)]',
                      ].join(' ')}
                    >
                      <span className={['absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', autoSyncOn ? 'left-[18px]' : 'left-0.5'].join(' ')} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-[var(--color-ink-4)]">
                      {spotifyBusy === 'syncing'
                        ? (spotifyMsg || 'Syncing…')
                        : `${syncedCount} synced${notFoundCount ? ` · ${notFoundCount} not found` : ''}${pendingCount ? ` · ${pendingCount} pending` : ''}`}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {spotifyStatus.playlistUrl && (
                        <a
                          href={spotifyStatus.playlistUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-warm)] border border-[var(--color-line)] hover:border-[var(--color-warm)] cursor-pointer transition-colors"
                        >
                          Open playlist ↗
                        </a>
                      )}
                      <button
                        onClick={() => runSpotifySync(true)}
                        disabled={spotifyBusy === 'syncing'}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-warm)] border border-[var(--color-line)] hover:border-[var(--color-warm)] hover:bg-[var(--color-bg)] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default"
                      >
                        {spotifyBusy === 'syncing' ? 'Syncing…' : 'Sync now'}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {!spotifyStatus.connected && spotifyMsg && (
                <p className="text-xs text-[var(--color-ink-4)]">{spotifyMsg}</p>
              )}
            </section>
          )}

          <section className="mt-7">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">Hidden stations</h3>
                <p className="text-xs text-[var(--color-ink-3)] mt-0.5">
                  {hidden.length > 0
                    ? `${hidden.length} hidden · manage to unhide`
                    : 'Nothing hidden. Right-click a station to hide it.'}
                </p>
              </div>
              {hidden.length > 0 && (
                <button
                  onClick={() => setHiddenOpen(true)}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-warm)] border border-[var(--color-line)] hover:border-[var(--color-warm)] hover:bg-[var(--color-bg)] cursor-pointer transition-colors"
                >
                  Manage
                </button>
              )}
            </div>
          </section>

          {isDev && (
            <section className="mt-7 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--color-ink)]">
                  Debug <span className="text-[var(--color-ink-4)] font-normal">· diagnostics</span>
                </h3>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showDebug}
                  aria-label="Show debug panel"
                  onClick={toggleDebug}
                  className={[
                    'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                    showDebug ? 'bg-[var(--color-warm)]' : 'bg-[var(--color-line)]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                      showDebug ? 'left-[18px]' : 'left-0.5',
                    ].join(' ')}
                  />
                </button>
              </div>
              {showDebug && (
                <DebugPanel
                  station={station}
                  playState={playState}
                  currentTrack={currentTrack}
                  active={open && showDebug}
                />
              )}
            </section>
          )}
        </div>
      </div>
    </div>
    <HiddenStationsDialog open={hiddenOpen} onOpenChange={setHiddenOpen} />
    <UpdateModal
      open={updateModalOpen}
      status={updateStatus}
      currentVersion={process.env.appVersion ?? ''}
      onClose={closeUpdateModal}
      onUpdate={onUpdateNow}
      onRestart={quitAndInstall}
    />
    </>
  );
}
