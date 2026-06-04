'use client';

import { useEffect } from 'react';
import { hydrateFromServer } from '@/app/lib/persist';

// Pulls persisted state from the SQLite-backed /api/state into localStorage on
// load (server is the source of truth), then imports any local-only keys.
// Renders nothing.
export function PersistenceBootstrap() {
  useEffect(() => { void hydrateFromServer(); }, []);
  return null;
}
