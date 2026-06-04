// Shared radio-browser mirror selection + fetch helper.
// Both /api/search and /api/popular use this so the mirror is resolved
// once per server process and the UA + timeout policies stay consistent.

const UA = 'ShazamRadioPOC/0.1';
const UPSTREAM_TIMEOUT_MS = 5_000;

let mirrorPromise: Promise<string> | null = null;

async function getMirror(): Promise<string> {
  if (!mirrorPromise) {
    mirrorPromise = (async () => {
      const res = await fetch('https://all.api.radio-browser.info/json/servers', {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const servers = (await res.json()) as unknown;
      if (!Array.isArray(servers) || servers.length === 0) {
        throw new Error('no radio-browser mirrors available');
      }
      return `https://${(servers[0] as { name: string }).name}`;
    })();
    // Allow retry on next call if the lookup rejects.
    mirrorPromise.catch(() => { mirrorPromise = null; });
  }
  return mirrorPromise;
}

/**
 * Fetch a path from radio-browser. Resolves a mirror on first call and
 * caches it; sends the required User-Agent; applies a 5s timeout.
 * Returns parsed JSON. Throws on network/timeout/non-2xx.
 */
export async function fetchRadioBrowser(path: string): Promise<unknown> {
  const mirror = await getMirror();
  const res = await fetch(`${mirror}${path}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}
