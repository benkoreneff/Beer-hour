'use strict';

// ── Developer config ───────────────────────────────────────────────────────
// Set this to your Spotify app's Client ID from developer.spotify.com/dashboard
const SP_CLIENT_ID = '0148fcfc0cb84f32a08dfea80c66baf4';

// ── Scopes & storage keys ──────────────────────────────────────────────────
const SP_SCOPES  = 'playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state';
const LS_TOKENS  = 'bh_sp_tokens';
const LS_VERIFIER = 'bh_sp_verifier';
const LS_PLAYLIST = 'bh_sp_playlist';

// ── PKCE ───────────────────────────────────────────────────────────────────
function _randStr(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), b => chars[b % chars.length]).join('');
}

async function _pkceChallenge(verifier) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Token helpers ──────────────────────────────────────────────────────────
function spIsConnected() { return !!localStorage.getItem(LS_TOKENS); }

function spClearAuth() {
  localStorage.removeItem(LS_TOKENS);
  localStorage.removeItem(LS_VERIFIER);
}

function spGetTokens() {
  try { return JSON.parse(localStorage.getItem(LS_TOKENS)); } catch { return null; }
}

function spSaveTokens(data) {
  const prev = spGetTokens() || {};
  localStorage.setItem(LS_TOKENS, JSON.stringify({
    ...prev, ...data,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  }));
}

async function spGetAccessToken() {
  const t = spGetTokens();
  if (!t) return null;
  if (Date.now() < t.expires_at - 60000) return t.access_token;

  if (!t.refresh_token) { spClearAuth(); return null; }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: SP_CLIENT_ID,
    }),
  });
  if (!res.ok) { spClearAuth(); return null; }
  const data = await res.json();
  spSaveTokens({ ...t, ...data });
  return data.access_token;
}

// ── OAuth PKCE flow ────────────────────────────────────────────────────────
function spRedirectUri() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return window.location.origin + window.location.pathname.replace(/\/$/, '');
  }
  return 'https://powerhour.fi';
}

async function spInitiateAuth() {
  const verifier  = _randStr(64);
  const challenge = await _pkceChallenge(verifier);
  localStorage.setItem(LS_VERIFIER, verifier);

  const params = new URLSearchParams({
    response_type: 'code', client_id: SP_CLIENT_ID, scope: SP_SCOPES,
    redirect_uri: spRedirectUri(), code_challenge_method: 'S256', code_challenge: challenge,
  });
  window.location.href = 'https://accounts.spotify.com/authorize?' + params;
}

async function spHandleCallback(code) {
  const verifier = localStorage.getItem(LS_VERIFIER);
  if (!verifier) throw new Error('Missing auth state — try connecting again.');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: spRedirectUri(), client_id: SP_CLIENT_ID, code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || 'Token exchange failed');
  }
  const data = await res.json();
  spSaveTokens(data);
  localStorage.removeItem(LS_VERIFIER);
}

// ── Spotify API ────────────────────────────────────────────────────────────
async function spFetch(path, opts = {}) {
  const token = await spGetAccessToken();
  if (!token) throw new Error('Not authenticated with Spotify');

  const url = path.startsWith('https://') ? path : 'https://api.spotify.com/v1' + path;
  const res  = await fetch(url, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Spotify API error', res.status, url, JSON.stringify(err));
    const msg = err?.error?.message || res.statusText || 'unknown';
    throw new Error(`Spotify ${res.status}: ${msg} [${url.replace('https://api.spotify.com/v1', '')}]`);
  }
  return res.json();
}

async function spFetchPlaylists() {
  const items = [];
  let next = '/me/playlists?limit=50';
  while (next) {
    const d = await spFetch(next);
    items.push(...(d.items || []));
    next = d.next || null;
  }
  return items;
}

async function spFetchTracks(playlistId) {
  const tracks = [];
  let next = `/playlists/${playlistId}/tracks?limit=100&additional_types=track`;
  while (next) {
    const d = await spFetch(next);
    for (const item of (d.items || [])) {
      const t = item?.track;
      if (!t || !t.uri || t.uri.startsWith('spotify:local:')) continue;
      if (t.type && t.type !== 'track') continue;
      if (t.restrictions?.reason) continue;
      if (!(t.duration_ms > 0)) continue;
      tracks.push({ uri: t.uri, name: t.name, artist: t.artists?.[0]?.name || '', duration_ms: t.duration_ms });
    }
    next = d.next || null;
  }
  return tracks;
}

async function spGetActiveDevice() {
  const d = await spFetch('/me/player/devices');
  if (!d?.devices?.length) return null;
  return d.devices.find(x => x.is_active) || d.devices[0];
}

async function spPlay(uri, position_ms, deviceId) {
  const qs = deviceId ? '?device_id=' + deviceId : '';
  await spFetch('/me/player/play' + qs, {
    method: 'PUT', body: JSON.stringify({ uris: [uri], position_ms }),
  });
}

async function spPause(deviceId) {
  const qs = deviceId ? '?device_id=' + deviceId : '';
  await spFetch('/me/player/pause' + qs, { method: 'PUT' });
}

async function spResume(deviceId) {
  const qs = deviceId ? '?device_id=' + deviceId : '';
  await spFetch('/me/player/play' + qs, { method: 'PUT' });
}

// ── Player module (consumed by script.js) ─────────────────────────────────
const spotify = {
  enabled:    false,
  tracks:     [],
  trackIndex: 0,
  deviceId:   null,

  reset() {
    this.trackIndex = 0;
    this.deviceId   = null;
    spHideNowPlaying();
  },

  async playNextTrack() {
    if (!this.enabled || !this.tracks.length) return;
    try {
      if (!this.deviceId) {
        const dev = await spGetActiveDevice();
        if (!dev) {
          spShowError('No active Spotify device found.\nOpen Spotify on any device first.');
          return;
        }
        this.deviceId = dev.id;
      }
      const track = this.tracks[this.trackIndex];
      this.trackIndex = (this.trackIndex + 1) % this.tracks.length;
      const position_ms = Math.floor(track.duration_ms * 0.30);
      await spPlay(track.uri, position_ms, this.deviceId);
      spShowNowPlaying(track);
    } catch (err) {
      this.deviceId = null; // device may have changed; retry next time
      spShowError(err.message);
    }
  },

  async pausePlayback()  {
    if (!this.enabled) return;
    try { await spPause(this.deviceId); } catch (_) {}
  },

  async resumePlayback() {
    if (!this.enabled) return;
    try { await spResume(this.deviceId); } catch (_) {}
  },

  async stopPlayback()   {
    if (!this.enabled) return;
    try { await spPause(this.deviceId); } catch (_) {}
  },
};

// ── UI helpers ─────────────────────────────────────────────────────────────
function spShowError(msg) {
  const el = document.getElementById('spotify-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 6000);
}

function spShowNowPlaying(track) {
  const el = document.getElementById('now-playing');
  if (!el) return;
  document.getElementById('now-playing-name').textContent   = track.name;
  document.getElementById('now-playing-artist').textContent = track.artist;
  el.classList.remove('hidden');
}

function spHideNowPlaying() {
  document.getElementById('now-playing')?.classList.add('hidden');
}

// ── Setup screen UI ────────────────────────────────────────────────────────
async function spInitUI() {
  const _dbgTokens = spGetTokens();
  if (_dbgTokens) console.log('[Spotify] granted scope:', _dbgTokens.scope);

  // Handle OAuth callback
  const p    = new URLSearchParams(window.location.search);
  const code = p.get('code');
  if (code || p.get('error')) {
    window.history.replaceState({}, '', window.location.pathname);
    if (code) {
      try { await spHandleCallback(code); }
      catch (e) { spShowError(e.message); }
    }
  }

  // Wire listeners (once)
  document.getElementById('spotify-connect-btn').addEventListener('click', () => {
    spInitiateAuth();
  });

  document.getElementById('spotify-disconnect-btn').addEventListener('click', () => {
    spClearAuth();
    localStorage.removeItem(LS_PLAYLIST);
    spotify.enabled = false;
    spotify.tracks  = [];
    document.getElementById('spotify-toggle').checked = false;
    spUpdateUI();
  });

  document.getElementById('spotify-playlist-select').addEventListener('change', async function () {
    const id = this.value;
    localStorage.setItem(LS_PLAYLIST, id);
    document.getElementById('spotify-toggle').checked = false;
    spotify.enabled = false;
    spotify.tracks  = [];
    if (!id) return;

    this.disabled = true;
    this.style.opacity = '0.5';
    const toggle = document.getElementById('spotify-toggle');
    toggle.disabled = true;
    try {
      spotify.tracks = await spFetchTracks(id);
      if (!spotify.tracks.length) spShowError('No playable tracks found in this playlist.');
    } catch (e) {
      spShowError('Failed to load tracks: ' + e.message);
    }
    this.disabled = false;
    this.style.opacity = '';
    toggle.disabled = false;
  });

  document.getElementById('spotify-toggle').addEventListener('change', function () {
    if (this.checked && !spotify.tracks.length) {
      spShowError('Select a playlist first and wait for it to load.');
      this.checked = false;
      return;
    }
    spotify.enabled = this.checked;
  });

  spUpdateUI();
}

async function spUpdateUI() {
  const connected = spIsConnected();
  document.getElementById('sp-not-connected').classList.toggle('hidden', connected);
  document.getElementById('sp-connected').classList.toggle('hidden', !connected);

  if (!connected) return;

  const select = document.getElementById('spotify-playlist-select');
  select.innerHTML = '<option value="">Loading playlists…</option>';
  select.disabled  = true;

  try {
    const playlists = await spFetchPlaylists();
    select.innerHTML = '<option value="">Select a playlist…</option>';
    for (const p of playlists) {
      const opt = document.createElement('option');
      opt.value       = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    }
    const savedId = localStorage.getItem(LS_PLAYLIST);
    if (savedId && playlists.some(p => p.id === savedId)) {
      select.value = savedId;
      const toggle = document.getElementById('spotify-toggle');
      toggle.disabled = true;
      try {
        spotify.tracks = await spFetchTracks(savedId);
        if (!spotify.tracks.length) spShowError('No playable tracks found in this playlist.');
      } catch (e) {
        spShowError('Failed to load tracks: ' + e.message);
      }
      toggle.disabled = false;
    }
  } catch (e) {
    spShowError('Failed to load playlists: ' + e.message);
    select.innerHTML = '<option value="">Could not load playlists</option>';
  }
  select.disabled = false;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', spInitUI);
} else {
  spInitUI();
}
