import { describe, it, expect } from 'vitest';
import { isGap } from '../app/lib/nowPlayingTypes';
import type { HistoryItem } from '../app/lib/nowPlayingTypes';

describe('isGap', () => {
  it('is true for a gap marker and false for a song entry', () => {
    const gap: HistoryItem = { gap: true, fromAt: 1, toAt: 2 };
    const song: HistoryItem = { time: '10:00', title: 'A - B', at: 3 };
    expect(isGap(gap)).toBe(true);
    expect(isGap(song)).toBe(false);
  });
});
