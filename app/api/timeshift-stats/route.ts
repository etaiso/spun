// app/api/timeshift-stats/route.ts
import { teeStats, ringStats } from '@/app/lib/server/stationTee';

// Diagnostics for the Settings debug panel: live tees (one per station with an
// open SSE/playback connection) and disk rings (tracked stations). Read-only.
export async function GET() {
  return Response.json(
    { tees: teeStats(), rings: ringStats() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
