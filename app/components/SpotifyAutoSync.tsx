'use client';

import { useEffect, useRef } from 'react';
import { useSavedSongs } from '@/app/lib/savedSongs';
import { spotify, isAvailable } from '@/app/lib/integrations/spotifyBridge';
import { pendingSongs, syncSongs } from '@/app/lib/integrations/spotifySync';
import { autoSyncEnabled } from '@/app/lib/spotifyPrefs';

/**
 * Renderless: when Spotify is connected and auto-sync is on, append newly saved
 * songs to the "Spun" playlist. Always mounted (saves happen while the saved-songs
 * dialog is closed), debounced against bursts, and self-guarding against overlap.
 * Also reconciles anything still pending on app start.
 */
export function SpotifyAutoSync() {
  const { saved, update } = useSavedSongs();
  const running = useRef(false);

  useEffect(() => {
    if (!isAvailable() || !autoSyncEnabled()) return;
    if (!pendingSongs(saved).length) return;

    const timer = setTimeout(async () => {
      if (running.current) return;
      const status = await spotify.getStatus().catch(() => ({ connected: false }));
      if (!status.connected) return;
      running.current = true;
      try {
        await syncSongs(pendingSongs(saved), spotify, update);
      } catch {
        /* leave items pending — retried on the next save or launch */
      } finally {
        running.current = false;
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [saved, update]);

  return null;
}
