'use client';

import { useEffect } from 'react';
import { hydrateFromServer } from '@/app/lib/persist';
import { syncToShell as syncAutoUpdateToShell } from '@/app/lib/autoUpdate';
import { syncToShell as syncCloseToTrayToShell } from '@/app/lib/closeToTray';

// Pulls persisted state from the SQLite-backed /api/state into localStorage on
// load (server is the source of truth), then imports any local-only keys.
// Renders nothing.
export function PersistenceBootstrap() {
  useEffect(() => {
    // Hydrate first so the desktop shell hears the *persisted* preferences
    // (server wins), not the pre-hydration defaults. No-op on web.
    void hydrateFromServer().then(() => {
      syncAutoUpdateToShell();
      syncCloseToTrayToShell();
    });
  }, []);
  return null;
}
