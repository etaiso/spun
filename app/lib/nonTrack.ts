export function isNonTrack(title: string, stationName: string): boolean {
  const t = title.trim();
  if (t === '') return true;
  if (t.toLowerCase() === stationName.trim().toLowerCase()) return true;
  if (!t.includes('-') && !t.includes('—') && t.length < 4) return true;
  return false;
}
