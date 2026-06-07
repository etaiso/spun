import { describe, it, expect } from 'vitest';
import { computeAffinity } from '../app/lib/taste';

const empty = { favorites: [], tracked: [], recent: [], playCounts: {} };

describe('computeAffinity', () => {
  it('returns empty scores and no top genres with no signals', () => {
    const a = computeAffinity(empty);
    expect(a.scores).toEqual({});
    expect(a.top).toEqual([]);
  });

  it('normalizes the strongest genre to 1', () => {
    const a = computeAffinity({ ...empty, favorites: [{ tags: ['pop'] }] });
    expect(a.scores.pop).toBe(1);
    expect(a.top).toEqual(['pop']);
  });

  it('weights favorites (x4) above recents (x1)', () => {
    const a = computeAffinity({
      ...empty,
      favorites: [{ tags: ['pop'] }],
      recent: [{ tags: ['rock'] }],
    });
    expect(a.scores.pop).toBe(1);
    expect(a.scores.rock).toBeCloseTo(0.25, 5);
    expect(a.top[0]).toBe('pop');
  });

  it('weights tracked (x2) between favorites and recents', () => {
    const a = computeAffinity({
      ...empty,
      favorites: [{ tags: ['a'] }],
      tracked: [{ tags: ['b'] }],
      recent: [{ tags: ['c'] }],
    });
    expect(a.bySource.favorites.a).toBe(4);
    expect(a.bySource.tracked.b).toBe(2);
    expect(a.bySource.recent.c).toBe(1);
  });

  it('uses play count as the play-weight multiplier', () => {
    const a = computeAffinity({
      ...empty,
      playCounts: { s1: { count: 5, tags: ['jazz'], lastAt: 0 } },
    });
    expect(a.bySource.play.jazz).toBe(5);
    expect(a.scores.jazz).toBe(1);
  });

  it('returns at most topN genres, highest first', () => {
    const a = computeAffinity({
      ...empty,
      favorites: [{ tags: ['a'] }, { tags: ['a'] }, { tags: ['b'] }, { tags: ['c'] }, { tags: ['d'] }],
    }, 2);
    expect(a.top).toEqual(['a', 'b']);
  });

  it('blends the same genre across sources (favorites + play count both count)', () => {
    const a = computeAffinity({
      ...empty,
      favorites: [{ tags: ['pop'] }],                          // +4
      playCounts: { s1: { count: 3, tags: ['pop'], lastAt: 0 } }, // +3
      recent: [{ tags: ['rock'] }],                            // +1 (competing)
    });
    // pop raw = 4 + 3 = 7 (top → 1), rock raw = 1 → 1/7
    expect(a.scores.pop).toBe(1);
    expect(a.scores.rock).toBeCloseTo(1 / 7, 5);
    expect(a.bySource.favorites.pop).toBe(4);
    expect(a.bySource.play.pop).toBe(3);
  });
});
