// Spotify playlist export — Electron main side.
//
// All auth/token/network lives here (not in the Next server) because only the
// main process can use safeStorage, open the system browser, and run the
// loopback redirect listener. Exposed to the renderer via the spun:spotify:*
// IPC handlers registered in register(). PKCE — no client secret.
//
// Enabled only when SPOTIFY_CLIENT_ID is set; otherwise register() is a no-op
// and the renderer's isAvailable() guard hides the feature.

const { app, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');

const REDIRECT_PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = 'playlist-modify-private playlist-read-private';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const PLAYLIST_NAME = 'Spun';

let log = () => {};
let clientId = '';
let cache = null; // { refreshToken, accessToken, expiresAt, userId, displayName, playlistId, playlistUrl }

function tokenPath() {
  return path.join(app.getPath('userData'), 'spotify-token.bin');
}

function loadCache() {
  if (cache) return cache;
  try {
    if (!fs.existsSync(tokenPath())) return null;
    cache = JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenPath())));
  } catch (e) {
    log(`spotify: token load failed: ${e}`);
    cache = null;
  }
  return cache;
}

function saveCache(next) {
  cache = { ...(cache || {}), ...next };
  try {
    fs.writeFileSync(tokenPath(), safeStorage.encryptString(JSON.stringify(cache)));
  } catch (e) {
    log(`spotify: token save failed: ${e}`);
  }
}

function clearCache() {
  cache = null;
  try { fs.rmSync(tokenPath(), { force: true }); } catch { /* ignore */ }
}

// --- OAuth (Authorization Code + PKCE) --------------------------------------

function pkce() {
  const verifier = crypto.randomBytes(64).toString('base64url'); // ~86 chars (43..128 ok)
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`spotify token ${res.status}: ${await res.text()}`);
  return res.json();
}

// Spin up the one-shot loopback listener, open the browser, await the redirect.
function awaitAuthCode(authUrl, state) {
  return new Promise((resolve, reject) => {
    let done = false;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const page = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;text-align:center;padding:3rem;color:#1a1410"><h2>${msg}</h2><p>You can close this tab and return to Spun.</p></body>`);
      };
      const finish = (fn, arg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        setTimeout(() => { try { server.close(); } catch { /* ignore */ } }, 200);
        fn(arg);
      };
      const err = u.searchParams.get('error');
      if (err) { page('Spotify authorization was cancelled.'); finish(reject, new Error(err)); return; }
      if (u.searchParams.get('state') !== state) { page('Authorization failed (state mismatch).'); finish(reject, new Error('state mismatch')); return; }
      page('Spotify connected ✓'); finish(resolve, u.searchParams.get('code'));
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { server.close(); } catch { /* ignore */ }
      reject(new Error('timed out waiting for Spotify authorization'));
    }, 5 * 60 * 1000);
    server.on('error', reject);
    server.listen(REDIRECT_PORT, '127.0.0.1', () => { shell.openExternal(authUrl); });
  });
}

async function connect() {
  if (!clientId) throw new Error('SPOTIFY_CLIENT_ID not configured');
  const { verifier, challenge } = pkce();
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = `${AUTH_URL}?` + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  }).toString();

  const code = await awaitAuthCode(authUrl, state);
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  saveCache({
    refreshToken: tok.refresh_token,
    accessToken: tok.access_token,
    expiresAt: Date.now() + (tok.expires_in - 60) * 1000,
  });
  const me = await api('/me');
  saveCache({ userId: me.id, displayName: me.display_name || me.id });
  log(`spotify: connected as ${cache.displayName}`);
  return { ok: true, displayName: cache.displayName };
}

async function validAccessToken() {
  const c = loadCache();
  if (!c || !c.refreshToken) throw new Error('Spotify not connected');
  if (c.accessToken && Date.now() < c.expiresAt) return c.accessToken;
  const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: clientId });
  saveCache({
    accessToken: tok.access_token,
    expiresAt: Date.now() + (tok.expires_in - 60) * 1000,
    ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
  });
  return tok.access_token;
}

// --- Web API ----------------------------------------------------------------

async function api(pathname, init = {}, retry = true) {
  const token = await validAccessToken();
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 401 && retry) {       // token rejected — force a refresh and retry once
    saveCache({ expiresAt: 0 });
    return api(pathname, init, false);
  }
  if (res.status === 429) {                // rate limited — honor Retry-After
    const wait = (Number(res.headers.get('retry-after')) || 1) * 1000;
    await new Promise(r => setTimeout(r, wait));
    return api(pathname, init, retry);
  }
  if (!res.ok) throw new Error(`spotify ${pathname} ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function search(query) {
  const data = await api(`/search?type=track&limit=10&q=${encodeURIComponent(query)}`);
  return (data?.tracks?.items || []).map(t => ({
    id: t.id,
    uri: t.uri,
    url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    name: t.name,
    artists: (t.artists || []).map(a => a.name),
    isrc: t.external_ids?.isrc,
    durationMs: t.duration_ms,
  }));
}

async function ensurePlaylist() {
  const c = loadCache();
  if (c?.playlistId) {
    try {
      const pl = await api(`/playlists/${c.playlistId}`);
      if (pl?.id) { saveCache({ playlistUrl: pl.external_urls?.spotify }); return { id: pl.id, url: cache.playlistUrl }; }
    } catch { /* deleted on Spotify — fall through and recreate */ }
  }
  // Reuse an existing owned "Spun" playlist if present.
  let next = '/me/playlists?limit=50';
  while (next) {
    const page = await api(next);
    const found = (page.items || []).find(p => p.name === PLAYLIST_NAME && p.owner?.id === c.userId);
    if (found) { saveCache({ playlistId: found.id, playlistUrl: found.external_urls?.spotify }); return { id: found.id, url: cache.playlistUrl }; }
    next = page.next ? page.next.replace(API, '') : null;
  }
  const created = await api(`/users/${encodeURIComponent(c.userId)}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name: PLAYLIST_NAME, public: false, description: 'Saved from Spun' }),
  });
  saveCache({ playlistId: created.id, playlistUrl: created.external_urls?.spotify });
  return { id: created.id, url: cache.playlistUrl };
}

async function playlistTrackIds() {
  const { id } = await ensurePlaylist();
  const ids = [];
  let next = `/playlists/${id}/tracks?fields=items(track(id)),next&limit=100`;
  while (next) {
    const page = await api(next);
    for (const it of page.items || []) if (it.track?.id) ids.push(it.track.id);
    next = page.next ? page.next.replace(API, '') : null;
  }
  return ids;
}

async function addTracks(uris) {
  if (!uris || !uris.length) return;
  const { id } = await ensurePlaylist();
  await api(`/playlists/${id}/tracks`, { method: 'POST', body: JSON.stringify({ uris }) });
}

async function getStatus() {
  const c = loadCache();
  if (!c || !c.refreshToken) return { connected: false };
  return { connected: true, displayName: c.displayName, playlistUrl: c.playlistUrl };
}

function disconnect() {
  clearCache();
  log('spotify: disconnected');
}

// --- IPC wiring -------------------------------------------------------------

/** Register spun:spotify:* handlers. No-op (returns false) when no client id is set. */
function register(ipcMain, deps = {}) {
  log = deps.log || (() => {});
  clientId = process.env.SPOTIFY_CLIENT_ID || '';
  if (!clientId) { log('spotify: SPOTIFY_CLIENT_ID not set — integration disabled'); return false; }
  if (!safeStorage.isEncryptionAvailable()) {
    log('spotify: OS keychain unavailable — tokens cannot be stored securely; integration disabled');
    return false;
  }
  const wrap = (fn) => async (_e, ...args) => fn(...args);
  ipcMain.handle('spun:spotify:get-status', wrap(getStatus));
  ipcMain.handle('spun:spotify:connect', wrap(connect));
  ipcMain.handle('spun:spotify:disconnect', wrap(disconnect));
  ipcMain.handle('spun:spotify:search', wrap(search));
  ipcMain.handle('spun:spotify:ensure-playlist', wrap(ensurePlaylist));
  ipcMain.handle('spun:spotify:playlist-track-ids', wrap(playlistTrackIds));
  ipcMain.handle('spun:spotify:add-tracks', wrap(addTracks));
  log('spotify: integration enabled');
  return true;
}

module.exports = { register };
