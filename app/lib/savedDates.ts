import type { SavedSong } from './savedSongs';

export type DateRange = 'all' | 'today' | 'week' | 'month';
export type DateGroup = { label: string; songs: SavedSong[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The timestamp a saved song is dated by: when it played, falling back to
 *  when it was saved (legacy songs predate play-time tracking). */
export function playedTime(song: SavedSong): number {
  return song.playedAt ?? song.savedAt;
}

/** Local midnight `days` days before the day containing `ts` (DST-safe — uses
 *  calendar arithmetic, not fixed 24h offsets). */
function dayStartBack(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnight (00:00) of the day containing `ts`. */
function startOfDay(ts: number): number {
  return dayStartBack(ts, 0);
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function monDay(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Keep songs whose played time falls within `range` relative to `now`. */
export function rangeFilter(songs: SavedSong[], range: DateRange, now: number): SavedSong[] {
  if (range === 'all') return songs;
  const today = startOfDay(now);
  const min =
    range === 'today' ? today :
    range === 'week' ? dayStartBack(now, 6) :   // today + previous 6 days = 7 calendar days
    dayStartBack(now, 29);                        // 30 calendar days
  return songs.filter(s => playedTime(s) >= min);
}

/** Bucket songs into Today / Yesterday / This week / Earlier by played time.
 *  Input order is preserved within each bucket; empty buckets are dropped. */
export function groupByDate(songs: SavedSong[], now: number): DateGroup[] {
  const today = startOfDay(now);
  const yesterday = dayStartBack(now, 1);
  const weekStart = dayStartBack(now, 6);
  const buckets: Record<string, SavedSong[]> = { Today: [], Yesterday: [], 'This week': [], Earlier: [] };
  for (const s of songs) {
    const t = playedTime(s);
    if (t >= today) buckets.Today.push(s);
    else if (t >= yesterday) buckets.Yesterday.push(s);
    else if (t >= weekStart) buckets['This week'].push(s);
    else buckets.Earlier.push(s);
  }
  return (['Today', 'Yesterday', 'This week', 'Earlier'] as const)
    .filter(label => buckets[label].length > 0)
    .map(label => ({ label, songs: buckets[label] }));
}

/** The row's time label. The list is always grouped (the header states the
 *  day), so: today/yesterday → time only ("HH:MM"); this-week (2–6 days ago) →
 *  "Weekday HH:MM"; earlier → "Mon D · HH:MM"; legacy songs (no playedAt) →
 *  "Saved Mon D" so they're never mislabeled as a known play time. */
export function formatPlayed(song: SavedSong, now: number): string {
  const t = playedTime(song);
  if (song.playedAt == null) return `Saved ${monDay(t)}`;
  const yesterday = dayStartBack(now, 1);
  const weekStart = dayStartBack(now, 6);
  if (t >= yesterday) return hhmm(t);                                  // Today / Yesterday
  if (t >= weekStart) return `${WEEKDAYS[new Date(t).getDay()]} ${hhmm(t)}`; // This week
  return `${monDay(t)} · ${hhmm(t)}`;                                  // Earlier
}
