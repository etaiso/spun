'use client';

// Shared player volume, persisted in localStorage. The Player owns writing it;
// other audio (e.g. saved-song previews) read it so they play at the same
// level the user set for the radio.

export const VOLUME_KEY = 'radio:volume';
export const DEFAULT_VOLUME = 0.65;

export function readStoredVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const v = parseFloat(raw);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}
