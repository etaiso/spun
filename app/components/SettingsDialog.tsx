'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/app/lib/stations';
import type { PlayState } from './Player';
import { RegionPicker } from './RegionPicker';
import { HiddenStationsDialog } from './HiddenStationsDialog';
import { DebugPanel } from './DebugPanel';
import { UpdateModal } from './UpdateModal';
import { useRingsEnabled } from '@/app/lib/visualizer';
import { useTimeshiftEnabled } from '@/app/lib/timeshiftSetting';
import { useHidden, useHideConfirm } from '@/app/lib/hidden';
import { persistSet } from '@/app/lib/persist';
import { useCloseToTray, canCloseToTray } from '@/app/lib/closeToTray';
import {
  useAutoUpdate,
  canCheckForUpdate,
  canSelfInstallUpdate,
  requestUpdateCheck,
  downloadUpdate,
  openReleasePage,
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
function updateStatusLine(s: UpdateStatus, selfInstall: boolean): string | null {
  switch (s.state) {
    case 'checking': return 'Checking for updates…';
    case 'available':
      if (!selfInstall) return s.version ? `Version ${s.version} available — download it.` : 'A new version is available — download it.';
      return s.version ? `Found ${s.version} — downloading…` : 'Downloading update…';
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

  // Rewind live radio toggle (persisted, on by default).
  const { enabled: timeshiftOn, toggle: toggleTimeshift } = useTimeshiftEnabled();

  // Hidden stations live in their own modal (opened below) so a long list
  // doesn't bloat Settings; here we only show the count + a way in.
  const { hidden } = useHidden();
  // Surfaced so the Hidden-stations entry stays reachable when the only thing to
  // manage is re-enabling the hide confirmation (no stations currently hidden).
  const { skipConfirm } = useHideConfirm();
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

  // Close-to-tray preference (persisted, on by default). Windows desktop only —
  // the shell exposes the setter there; hidden everywhere else.
  const { enabled: closeToTrayOn, toggle: toggleCloseToTray } = useCloseToTray();
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
    if (!canSelfInstallUpdate()) {          // unsigned macOS — the install can't self-apply
      openReleasePage();                     // hand off to the browser for a manual download
      closeUpdateModal();
      return;
    }
    setUpdateStatus({ state: 'downloading', percent: 0 }); // immediate feedback
    downloadUpdate();
  };
  const closeUpdateModal = () => {
    setUpdateModalOpen(false);
    manualRef.current = false;
  };

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

  // Gate the diagnostics panel behind the `?debug=true` query param, and never
  // expose it in the desktop (Electron) build — there's no URL to opt in there,
  // and we don't want diagnostics shipped to desktop users.
  const isElectron =
    typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);
  const debugEnabled =
    !isElectron &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true';

  // The update UI (auto-update toggle + "Check now") only does anything in the
  // desktop shell, where Electron exposes the updater on window.spun. Hide it
  // entirely on the web build — there's nothing to update there.
  const isDesktop = canCheckForUpdate();
  // The close-to-tray toggle only means anything on the Windows desktop shell.
  const showTrayToggle = canCloseToTray();
  // On unsigned macOS the shell can't self-install — it detects updates and the
  // user downloads them manually. Drives the copy and the modal's primary action.
  const selfInstall = canSelfInstallUpdate();

  const toggleDebug = () => {
    setShowDebug(v => {
      const next = !v;
      persistSet(DEBUG_KEY, next ? '1' : '0');
      return next;
    });
  };

  const handleTimeshiftToggle = () => {
    const turningOff = timeshiftOn; // current value → new value is !timeshiftOn
    toggleTimeshift();
    if (turningOff) void fetch('/api/timeshift?sid=*', { method: 'DELETE' });
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
            <h2 className="text-[11px] tracking-[1.6px] uppercase font-extrabold text-[var(--color-brand-purple)]">
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
                  ringsOn ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
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

          <section className="mt-7 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">Rewind live radio</h3>
                <p className="text-xs text-[var(--color-ink-3)] mt-0.5">
                  {timeshiftOn
                    ? 'Buffer the last hour so you can rewind and replay songs.'
                    : 'Off — playback is live-only and nothing is buffered.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={timeshiftOn}
                aria-label="Rewind live radio"
                onClick={handleTimeshiftToggle}
                className={[
                  'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                  timeshiftOn ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                    timeshiftOn ? 'left-[18px]' : 'left-0.5',
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
                      ? (selfInstall
                          ? 'Install new versions automatically and apply them on restart.'
                          : 'Check for new versions automatically — you download and install them.')
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
                    autoUpdateOn ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
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
                <p className="text-xs text-[var(--color-ink-4)]">{autoUpdateOn ? (updateStatusLine(updateStatus, selfInstall) ?? '') : ''}</p>
                <button
                  type="button"
                  onClick={onCheckNow}
                  disabled={checking}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-brand-purple)] border border-[var(--color-line)] hover:border-[var(--color-brand-pink)] hover:bg-[var(--color-bg)] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default disabled:hover:border-[var(--color-line)] disabled:hover:bg-transparent"
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

          {showTrayToggle && (
            <section className="mt-7 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-ink)]">Close to tray</h3>
                  <p className="text-xs text-[var(--color-ink-3)] mt-0.5">
                    {closeToTrayOn
                      ? 'Closing the window keeps Spun running in the system tray.'
                      : 'Closing the window quits Spun.'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={closeToTrayOn}
                  aria-label="Close to tray"
                  onClick={toggleCloseToTray}
                  className={[
                    'relative h-5 w-9 rounded-full transition-colors cursor-pointer shrink-0',
                    closeToTrayOn ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                      closeToTrayOn ? 'left-[18px]' : 'left-0.5',
                    ].join(' ')}
                  />
                </button>
              </div>
            </section>
          )}

          <section className="mt-7">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--color-ink)]">Hidden stations</h3>
                <p className="text-xs text-[var(--color-ink-3)] mt-0.5">
                  {hidden.length > 0
                    ? `${hidden.length} hidden · manage to unhide`
                    : skipConfirm
                      ? 'Nothing hidden · hides skip confirmation'
                      : 'Nothing hidden. Right-click a station to hide it.'}
                </p>
              </div>
              {(hidden.length > 0 || skipConfirm) && (
                <button
                  onClick={() => setHiddenOpen(true)}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold text-[var(--color-brand-purple)] border border-[var(--color-line)] hover:border-[var(--color-brand-pink)] hover:bg-[var(--color-bg)] cursor-pointer transition-colors"
                >
                  Manage
                </button>
              )}
            </div>
          </section>

          {debugEnabled && (
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
                    showDebug ? 'bg-[var(--color-brand-purple)]' : 'bg-[var(--color-line)]',
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

          <div className="mt-7 pt-4 border-t border-[var(--color-line)]">
            <p className="text-[11px] text-center text-[var(--color-ink-4)]">
              Version {process.env.appVersion ?? '—'}
            </p>
          </div>
        </div>
      </div>
    </div>
    <HiddenStationsDialog open={hiddenOpen} onOpenChange={setHiddenOpen} />
    <UpdateModal
      open={updateModalOpen}
      status={updateStatus}
      currentVersion={process.env.appVersion ?? ''}
      canSelfInstall={selfInstall}
      onClose={closeUpdateModal}
      onUpdate={onUpdateNow}
      onRestart={quitAndInstall}
    />
    </>
  );
}
