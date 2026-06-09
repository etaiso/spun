// Root directory for timeshift disk rings. Session-only by design: wiped on
// first use after boot (crash safety-net — graceful-quit cleanup lives in
// electron/main.js), so disk usage returns to ~0 between sessions.
import fs from 'node:fs';
import path from 'node:path';

export function timeshiftRoot(): string {
  return process.env.APP_TIMESHIFT_DIR || path.join(process.cwd(), 'data', 'timeshift');
}

let wiped = false;
/** Wipe-and-recreate the root, once per server process. Call before any ring
 *  is created. Also sweeps orphan dirs from a previous crashed session. */
export function ensureCleanRoot(): string {
  const root = timeshiftRoot();
  if (!wiped) {
    wiped = true;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  fs.mkdirSync(root, { recursive: true });
  return root;
}
