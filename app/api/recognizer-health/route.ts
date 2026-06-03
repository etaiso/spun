import { NextResponse } from 'next/server';

const RECOGNIZER_URL = process.env.RECOGNIZER_URL || 'http://127.0.0.1:8755';

// Server-side health check for the Shazam recognizer sidecar. Lets the dev
// debug panel show up/down status without hitting CORS from the browser.
export async function GET() {
  const started = Date.now();
  try {
    const res = await fetch(`${RECOGNIZER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    return NextResponse.json({ up: res.ok, url: RECOGNIZER_URL, ms: Date.now() - started });
  } catch {
    return NextResponse.json({ up: false, url: RECOGNIZER_URL, ms: Date.now() - started });
  }
}
