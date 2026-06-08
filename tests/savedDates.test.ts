import { describe, it, expect } from 'vitest';
import { playedTime, rangeFilter, groupByDate, formatPlayed } from '../app/lib/savedDates';
import { buildSavedSong } from '../app/lib/savedSongs';
import type { SavedSong } from '../app/lib/savedSongs';

// Fixed reference point: Mon Jun 8 2026, 12:00 local.
const now = new Date(2026, 5, 8, 12, 0, 0).getTime();
const at = (mo: number, d: number, h: number, m = 0) => new Date(2026, mo, d, h, m).getTime();

function song(id: string, opts: { playedAt?: number; savedAt?: number }): SavedSong {
  return buildSavedSong({
    raw: id, artist: id, title: id, key: id, stationName: 'S',
    savedAt: opts.savedAt ?? now,
    ...(opts.playedAt != null ? { playedAt: opts.playedAt } : {}),
  });
}

const today = song('today', { playedAt: at(5, 8, 9, 0) });        // Jun 8 09:00
const yest = song('yest', { playedAt: at(5, 7, 22, 0) });          // Jun 7 22:00
const thisWeek = song('week', { playedAt: at(5, 5, 10, 0) });      // Jun 5 10:00 (3 days ago)
const earlier = song('earlier', { playedAt: at(4, 29, 8, 0) });    // May 29 08:00 (10 days ago)
const legacy = song('legacy', { savedAt: at(5, 8, 7, 0) });        // no playedAt

describe('playedTime', () => {
  it('uses playedAt when present, else savedAt', () => {
    expect(playedTime(today)).toBe(at(5, 8, 9, 0));
    expect(playedTime(legacy)).toBe(at(5, 8, 7, 0));
  });
});

describe('rangeFilter', () => {
  const all = [today, yest, thisWeek, earlier];
  it('all → unchanged', () => {
    expect(rangeFilter(all, 'all', now)).toEqual(all);
  });
  it('today → only songs since local midnight', () => {
    expect(rangeFilter(all, 'today', now).map(s => s.id)).toEqual(['today']);
  });
  it('week → today + previous 6 days', () => {
    expect(rangeFilter(all, 'week', now).map(s => s.id)).toEqual(['today', 'yest', 'week']);
  });
  it('month → last 30 days', () => {
    expect(rangeFilter(all, 'month', now).map(s => s.id)).toEqual(['today', 'yest', 'week', 'earlier']);
  });
  it('filters legacy songs (no playedAt) by their savedAt', () => {
    // `legacy` has savedAt = Jun 8 07:00 (today) and no playedAt.
    expect(rangeFilter([legacy], 'today', now).map(s => s.id)).toEqual(['legacy']);
    expect(rangeFilter([song('old', { savedAt: at(4, 1, 9, 0) })], 'today', now)).toEqual([]);
  });
  it('returns [] for empty input', () => {
    expect(rangeFilter([], 'week', now)).toEqual([]);
  });
  it('includes a song exactly at today midnight (>= boundary)', () => {
    const midnight = song('midnight', { playedAt: at(5, 8, 0, 0) });
    expect(rangeFilter([midnight], 'today', now).map(s => s.id)).toEqual(['midnight']);
  });
});

describe('groupByDate', () => {
  it('buckets by played time, drops empties, preserves order', () => {
    const groups = groupByDate([today, yest, thisWeek, earlier], now);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'This week', 'Earlier']);
    expect(groups[0].songs.map(s => s.id)).toEqual(['today']);
  });
  it('omits a bucket with no songs', () => {
    const groups = groupByDate([today, earlier], now);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Earlier']);
  });
  it('returns [] for empty input', () => {
    expect(groupByDate([], now)).toEqual([]);
  });
});

describe('formatPlayed', () => {
  it('today/yesterday show time only (header carries the day)', () => {
    expect(formatPlayed(today, now)).toBe('09:00');
    expect(formatPlayed(yest, now)).toBe('22:00');
  });
  it('this-week shows weekday + time', () => {
    expect(formatPlayed(thisWeek, now)).toBe('Fri 10:00');
  });
  it('earlier shows month/day + time', () => {
    expect(formatPlayed(earlier, now)).toBe('May 29 · 08:00');
  });
  it('legacy (no playedAt) is labeled as saved', () => {
    expect(formatPlayed(legacy, now)).toBe('Saved Jun 8');
  });
});
