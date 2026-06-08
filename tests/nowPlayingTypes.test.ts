import { describe, it, expect } from 'vitest';
import { isGap, historyRowKey } from '../app/lib/nowPlayingTypes';
import type { HistoryItem } from '../app/lib/nowPlayingTypes';

describe('isGap', () => {
  it('is true for a gap marker and false for a song entry', () => {
    const gap: HistoryItem = { gap: true, fromAt: 1, toAt: 2 };
    const song: HistoryItem = { time: '10:00', title: 'A - B', at: 3 };
    expect(isGap(gap)).toBe(true);
    expect(isGap(song)).toBe(false);
  });
});

describe('historyRowKey', () => {
  it('keys a song by its epoch `at` and title when present', () => {
    expect(historyRowKey({ time: '10:00', title: 'A - B', at: 1234 })).toBe('1234::A - B');
  });
  it('falls back to `time` when a song has no `at`', () => {
    expect(historyRowKey({ time: '10:00', title: 'A - B' })).toBe('10:00::A - B');
  });
  it('keys a gap by its bounds', () => {
    expect(historyRowKey({ gap: true, fromAt: 5, toAt: 9 })).toBe('gap::5::9');
  });
});
