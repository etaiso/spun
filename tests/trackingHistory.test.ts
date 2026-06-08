import { describe, it, expect } from 'vitest';
import {
  emptyStation, applyTrack, CAP,
  type StationHistory,
} from '../app/lib/trackingHistory';
import { isGap } from '../app/lib/nowPlayingTypes';

describe('applyTrack', () => {
  it('prepends a finished song with an HH:MM time derived from `at`', () => {
    // Build `at` from a LOCAL date so the expected HH:MM is timezone-independent
    // (hhmm() reads local hours/minutes).
    const at = new Date(2026, 0, 1, 9, 5).getTime();
    const s = applyTrack(emptyStation(), 'Artist - Song', at);
    expect(s.items).toHaveLength(1);
    const e = s.items[0];
    expect(isGap(e)).toBe(false);
    if (!isGap(e)) {
      expect(e.title).toBe('Artist - Song');
      expect(e.at).toBe(at);
      expect(e.time).toBe('09:05');
    }
    expect(s.lastActiveAt).toBe(at);
  });

  it('keeps newest first', () => {
    let s = emptyStation();
    s = applyTrack(s, 'first', 1000);
    s = applyTrack(s, 'second', 2000);
    expect(s.items.map(i => (isGap(i) ? 'GAP' : i.title))).toEqual(['second', 'first']);
  });

  it('skips a consecutive re-broadcast of the same song (no duplicate)', () => {
    let s = applyTrack(emptyStation(), 'same', 1000);
    s = applyTrack(s, 'same', 2000);
    expect(s.items).toHaveLength(1);
    expect(s.lastActiveAt).toBe(2000); // still bumps activity
  });

  it('consumes an armed gap, placing it BELOW the resumed song', () => {
    const s0: StationHistory = {
      items: [{ time: '08:00', title: 'old', at: 1000 }],
      lastActiveAt: 1000,
      gapFromAt: 1000,
    };
    const s1 = applyTrack(s0, 'new', 9000);
    expect(s1.items.map(i => (isGap(i) ? 'GAP' : i.title))).toEqual(['new', 'GAP', 'old']);
    const gap = s1.items[1];
    expect(isGap(gap) && gap.fromAt).toBe(1000);
    expect(isGap(gap) && gap.toAt).toBe(9000);
    expect(s1.gapFromAt).toBeUndefined(); // gap consumed
  });

  it('caps the list at CAP items (gaps count)', () => {
    let s = emptyStation();
    for (let i = 0; i < CAP + 10; i++) s = applyTrack(s, `song ${i}`, i + 1);
    expect(s.items).toHaveLength(CAP);
    const newest = s.items[0];
    expect(isGap(newest) ? '' : newest.title).toBe(`song ${CAP + 9}`);
  });
});
