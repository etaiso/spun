'use client';

import { useEffect, type ReactNode } from 'react';
import type { UpdateStatus } from '@/app/lib/autoUpdate';

type Props = {
  open: boolean;
  status: UpdateStatus;
  currentVersion: string;
  onClose: () => void;
  onUpdate: () => void;   // download the available update
  onRestart: () => void;  // quit and install a downloaded update
};

// The outcome of a manual "Check now" — a small confirmation dialog layered over
// Settings. It mirrors the updater's lifecycle: ask to update when one's found,
// show download progress, then offer a restart; or simply confirm you're current.
export function UpdateModal({ open, status, currentVersion, onClose, onUpdate, onRestart }: Props) {
  // Esc closes — except mid-download, where there's no clean cancel point.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && status.state !== 'downloading') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, status.state, onClose]);

  if (!open) return null;

  const primaryBtn =
    'px-4 py-2 rounded-full text-sm font-semibold text-white bg-[var(--color-warm)] hover:opacity-90 cursor-pointer transition-opacity';
  const secondaryBtn =
    'px-4 py-2 rounded-full text-sm font-semibold text-[var(--color-ink-3)] border border-[var(--color-line)] hover:border-[var(--color-warm)] hover:text-[var(--color-ink)] cursor-pointer transition-colors';

  let title: string;
  let body: ReactNode;
  let actions: ReactNode;

  switch (status.state) {
    case 'available':
      title = 'Update available';
      body = (
        <>
          A new version{status.version ? <> <strong className="text-[var(--color-ink)]">{status.version}</strong></> : ''} is
          available{currentVersion ? ` (you’re on ${currentVersion})` : ''}. Download and install it now?
        </>
      );
      actions = (
        <>
          <button onClick={onClose} className={secondaryBtn}>Later</button>
          <button onClick={onUpdate} className={primaryBtn} autoFocus>Update now</button>
        </>
      );
      break;
    case 'downloading':
      title = 'Downloading update';
      body = (
        <div className="flex flex-col gap-2">
          <span>Downloading… {status.percent ?? 0}%</span>
          <div className="h-1.5 w-full rounded-full bg-[var(--color-line)] overflow-hidden">
            <div
              className="h-full bg-[var(--color-warm)] transition-[width] duration-200"
              style={{ width: `${status.percent ?? 0}%` }}
            />
          </div>
        </div>
      );
      actions = null;
      break;
    case 'downloaded':
      title = 'Update ready';
      body = (
        <>
          Version {status.version ? <strong className="text-[var(--color-ink)]">{status.version}</strong> : 'the update'} has
          been downloaded. Restart now to apply it?
        </>
      );
      actions = (
        <>
          <button onClick={onClose} className={secondaryBtn}>Later</button>
          <button onClick={onRestart} className={primaryBtn} autoFocus>Restart now</button>
        </>
      );
      break;
    case 'error':
      title = 'Update check failed';
      body = <>Something went wrong while checking for updates. Please try again later.</>;
      actions = <button onClick={onClose} className={primaryBtn} autoFocus>Close</button>;
      break;
    case 'none':
    default:
      title = 'You’re up to date';
      body = <>You’re running the latest version{currentVersion ? ` (${currentVersion})` : ''}.</>;
      actions = <button onClick={onClose} className={primaryBtn} autoFocus>OK</button>;
      break;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onClick={() => { if (status.state !== 'downloading') onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.25)] max-w-sm w-full p-6 flex flex-col gap-4"
      >
        <h2 className="text-base font-bold text-[var(--color-ink)]">{title}</h2>
        <div className="text-sm text-[var(--color-ink-3)] leading-relaxed">{body}</div>
        {actions && <div className="flex items-center justify-end gap-2 mt-1">{actions}</div>}
      </div>
    </div>
  );
}
