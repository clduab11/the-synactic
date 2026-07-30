#!/usr/bin/env node
/**
 * ACLED OAuth helper — password grant with refresh-token rotation.
 *
 * ACLED issues a 24h access token and a 14d refresh token from
 * https://acleddata.com/oauth/token using grant_type=password. There is no
 * scoped API key: refreshing requires the account password, so credentials
 * are read from the environment and expected to arrive via Docker secrets.
 *
 * Never logs the password. Tokens are masked in all output.
 *
 * Env:
 *   ACLED_USERNAME   myACLED account email        (required in live mode)
 *   ACLED_PASSWORD   myACLED account password     (required in live mode)
 *   ACLED_TOKEN_CACHE  path to the token cache    (default .acled-token.json)
 *
 * Add the cache path to .gitignore. It holds a live bearer token.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_URL = 'https://acleddata.com/oauth/token';
const CACHE_PATH = process.env.ACLED_TOKEN_CACHE
  ? resolve(process.env.ACLED_TOKEN_CACHE)
  : resolve(ROOT, '.acled-token.json');

// Honest User-Agent. CHROME_UA exists in _seed-utils for scraping-adjacent
// sources; ACLED is a licensed API we intend to be a named customer of, and
// spoofing a browser at a licensor is the wrong posture.
const UA = 'the-synactic/0.1 (Praxen internal research tool; +chrisldukes@gmail.com)';

// Refresh this far before nominal expiry so a long seeder run cannot straddle it.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

function mask(t) {
  if (typeof t !== 'string' || t.length < 12) return '<redacted>';
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return null; // corrupt cache is a miss, not a crash
  }
}

function writeCache(payload) {
  writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2) + '\n');
  try {
    chmodSync(CACHE_PATH, 0o600);
  } catch {
    /* best effort — Windows/NTFS may reject POSIX modes */
  }
}

async function postForm(body, label) {
  // NOTE: fetch.bind(globalThis) is BANNED in this repo (see AGENTS.md).
  const res = await ((...a) => globalThis.fetch(...a))(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!res.ok) {
    // Deliberately does not echo the response body — a failed password grant
    // can reflect submitted credentials back in the error payload.
    throw new Error(`ACLED ${label} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function store(json) {
  const now = Date.now();
  const accessTtlMs = (Number(json.expires_in) || 86400) * 1000;
  const refreshTtlMs = (Number(json.refresh_expires_in) || 14 * 86400) * 1000;
  const cache = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    access_expires_at: now + accessTtlMs,
    refresh_expires_at: now + refreshTtlMs,
    obtained_at: new Date(now).toISOString(),
  };
  writeCache(cache);
  return cache;
}

async function mint() {
  const username = process.env.ACLED_USERNAME;
  const password = process.env.ACLED_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'ACLED_USERNAME and ACLED_PASSWORD are required for a live token mint. ' +
        'Set them via Docker secrets, not .env. Or run in fixture mode (ACLED_MODE=fixture).',
    );
  }
  const json = await postForm(
    { username, password, grant_type: 'password', client_id: 'acled', scope: 'authenticated' },
    'token mint',
  );
  const cache = store(json);
  console.log(`  [acled-auth] minted access token ${mask(cache.access_token)} (24h)`);
  return cache;
}

async function refresh(refreshToken) {
  const json = await postForm(
    { refresh_token: refreshToken, grant_type: 'refresh_token', client_id: 'acled' },
    'token refresh',
  );
  const cache = store(json);
  console.log(`  [acled-auth] refreshed access token ${mask(cache.access_token)}`);
  return cache;
}

/**
 * Return a valid ACLED access token, minting or refreshing as needed.
 * @returns {Promise<string>}
 */
export async function getAcledAccessToken() {
  const now = Date.now();
  const cached = readCache();

  if (cached?.access_token && cached.access_expires_at - EXPIRY_MARGIN_MS > now) {
    return cached.access_token;
  }

  if (cached?.refresh_token && cached.refresh_expires_at - EXPIRY_MARGIN_MS > now) {
    try {
      return (await refresh(cached.refresh_token)).access_token;
    } catch (err) {
      console.warn(`  [acled-auth] refresh failed (${err.message}); falling back to full mint`);
    }
  }

  return (await mint()).access_token;
}

/** Authorization header ready for an ACLED API call. */
export async function acledAuthHeaders() {
  return {
    Authorization: `Bearer ${await getAcledAccessToken()}`,
    'User-Agent': UA,
    Accept: 'application/json',
  };
}

export { UA as ACLED_USER_AGENT, mask as maskAcledToken };
