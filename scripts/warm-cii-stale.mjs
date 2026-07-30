#!/usr/bin/env node
/**
 * warm-cii-stale.mjs — break the self-host CII cold-start deadlock, and PROVE it.
 *
 * Why this exists:
 *   get_country_risk reads ONLY the Redis key risk:scores:sebuf:stale:v8
 *   (server/worldmonitor/intelligence/v1/get-country-risk.ts). No seeder
 *   writes that key — it is written solely by the app's own getRiskScores
 *   handler on a fresh leader fetch (get-risk-scores.ts, RISK_STALE_TTL =
 *   3600s). A fresh self-host with every seeder green therefore still
 *   returns upstreamUnavailable:true from get_country_risk until something
 *   GETs the LOCAL /api/intelligence/v1/get-risk-scores endpoint once.
 *   This script is that something: one warm GET, with bounded
 *   retry/backoff until the app answers or a deadline elapses.
 *
 * Why an HTTP 200 is NOT success (the verification step):
 *   A 200 from get-risk-scores can be served WITHOUT writing the stale key:
 *   the degraded fallback path computes from empty inputs and returns without
 *   persisting (get-risk-scores.ts:1633-1637), a concurrent non-leader
 *   follower returns without writing (leader gate at :1617), and even on the
 *   leader path Redis write failures are swallowed (:1555). So after a 2xx
 *   this script reads risk:scores:sebuf:stale:v8 back through the
 *   Upstash-compatible redis-rest shim (docker/redis-rest-proxy.mjs:
 *   GET /get/<key> with Authorization: Bearer <token> → {"result": ...},
 *   null when absent) and only then reports the deadlock cured. An absent
 *   key is retried briefly first: our 200 may have been a follower response
 *   racing the leader's awaited write (leader awaits before responding,
 *   get-risk-scores.ts:1617-1622, so the window is small but real).
 *   Self-host containers set no VERCEL_ENV, so keys are unprefixed
 *   (server/_shared/redis.ts:41-53); override CII_WARM_STALE_KEY if that
 *   ever changes.
 *
 * Auth (verified from source):
 *   The endpoint is NOT in PUBLIC_NO_AUTH_RPC_PATHS (server/gateway.ts) and
 *   the gateway 401s credential-less requests (api/_api-key.js). It IS in
 *   RELAY_WARM_PING_PATHS (server/gateway.ts), so presenting
 *   WORLDMONITOR_RELAY_KEY as X-WorldMonitor-Key authenticates the warm
 *   ping with least privilege (cache-warm of free endpoints only — no
 *   premium/entitlement bypass). docker-compose.yml wires the same value
 *   to the app service and to the cii-warmer one-shot.
 *
 * Env:
 *   CII_WARM_URL           Target URL. Default:
 *                          http://127.0.0.1:${WM_PORT:-3000}/api/intelligence/v1/get-risk-scores
 *                          (compose maps ${WM_PORT:-3000}:8080 for the app).
 *   WM_PORT                Host port of the local app. Default 3000.
 *   WORLDMONITOR_RELAY_KEY Sent as X-WorldMonitor-Key when set.
 *   CII_WARM_TIMEOUT_MS    Overall deadline in ms. Default 180000.
 *   CII_WARM_REDIS_URL     redis-rest shim base for write verification.
 *                          Default http://127.0.0.1:8079 (the host-published
 *                          shim port). Inside the compose network the shim is
 *                          http://redis-rest:80 — 127.0.0.1:8079 is only
 *                          valid from the HOST (compose publishes the shim
 *                          to host loopback; a container's loopback is its
 *                          own). docker-compose.yml sets this for the
 *                          cii-warmer service. UPSTASH_REDIS_REST_URL is
 *                          DELIBERATELY ignored — see the comment on the
 *                          constant below.
 *   CII_WARM_REDIS_TOKEN   Bearer token for the shim. Falls back to
 *                          REDIS_TOKEN (the SRH_TOKEN the compose shim
 *                          requires). UPSTASH_REDIS_REST_TOKEN is
 *                          DELIBERATELY ignored — same comment.
 *   CII_WARM_STALE_KEY     Key to verify. Default risk:scores:sebuf:stale:v8.
 *   CII_WARM_ALLOW_HOSTED  '1' disables the hosted-origin refusal guard.
 *                          For the hosted stack's own tooling only — never
 *                          set it on a self-host.
 *
 * Outcome: exactly one stdout/stderr line, prefixed [warm-cii-stale].
 * Exit codes:
 *   0 = warmed AND verified — HTTP 2xx and the stale key was read back as a
 *       parsable risk-scores snapshot. The deadlock is cured.
 *   1 = definitive failure — warm request failed (auth/timeout/4xx), OR the
 *       warm returned 2xx but the stale key is ABSENT (deadlock persists:
 *       degraded path answered, or the leader's write failed), OR the key
 *       exists but its value is not a usable snapshot (readers would treat
 *       it as missing — inspect and clear the key).
 *   2 = warmed but UNVERIFIED — HTTP 2xx, but the shim was unreachable,
 *       rejected the token, or answered with a malformed envelope, so the
 *       write state is UNKNOWN. Fix the verification path and re-run; do
 *       NOT read this as the deadlock persisting.
 *
 * The DEFAULT target is the local app — never the hosted origin
 * api.worldmonitor.app (the hosted stack has its own relay warmer); the
 * refusal guard above is the enforcement, CII_WARM_ALLOW_HOSTED the only
 * override.
 */

const WM_PORT = process.env.WM_PORT || '3000';
const DEFAULT_URL = `http://127.0.0.1:${WM_PORT}/api/intelligence/v1/get-risk-scores`;

const url = process.env.CII_WARM_URL || DEFAULT_URL;
const relayKey = (process.env.WORLDMONITOR_RELAY_KEY || '').trim();
const timeoutMs = Number(process.env.CII_WARM_TIMEOUT_MS) > 0
  ? Number(process.env.CII_WARM_TIMEOUT_MS)
  : 180_000;
const PER_REQUEST_TIMEOUT_MS = 15_000;
const HOSTED_ORIGIN = 'api.worldmonitor.app';

// Verification target. DELIBERATELY not the UPSTASH_* pair: a hybrid .env
// (hosted Vercel/Upstash creds alongside the self-host REDIS_TOKEN — a layout
// .env.example invites) would silently point this read-back at PRODUCTION
// Upstash, where the hosted stack writes the SAME unprefixed key, producing a
// false "Deadlock cured" (or, inverted, a false "deadlock persists") against
// the wrong Redis. Same lesson run-seeders.sh already encodes — REDIS_TOKEN
// wins unconditionally (regression-pinned in
// tests/docker-compose-no-default-secrets.test.mts). A self-host that truly
// uses hosted Upstash as its cache must set CII_WARM_REDIS_URL/TOKEN
// explicitly.
const REDIS_REST_BASE = (
  process.env.CII_WARM_REDIS_URL
  || 'http://127.0.0.1:8079'
).replace(/\/+$/, '');
const REDIS_REST_TOKEN = (
  process.env.CII_WARM_REDIS_TOKEN
  || process.env.REDIS_TOKEN
  || ''
).trim();
const STALE_KEY = process.env.CII_WARM_STALE_KEY || 'risk:scores:sebuf:stale:v8';
const VERIFY_TIMEOUT_MS = 10_000;
// Absent-key retry: covers the follower-vs-leader race window only, so short.
const VERIFY_ABSENT_RETRY_DELAYS_MS = [2_000, 4_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the stale key back through the redis-rest shim.
 * Returns one of:
 *   { state: 'present', snapshotCiiCount: number | 'unparsable' }
 *   { state: 'absent' }                       — shim + Redis answered; key is not there
 *   { state: 'error',  detail: string }       — shim unreachable / auth rejected / bad envelope
 */
async function readStaleKeyBack() {
  const verifyHeaders = {
    'User-Agent': 'worldmonitor-cii-warmer/1.0 (stale-key write verification)',
    Accept: 'application/json',
  };
  if (REDIS_REST_TOKEN) verifyHeaders.Authorization = `Bearer ${REDIS_REST_TOKEN}`;

  let res;
  try {
    res = await fetch(`${REDIS_REST_BASE}/get/${encodeURIComponent(STALE_KEY)}`, {
      headers: verifyHeaders,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
  } catch (err) {
    return { state: 'error', detail: err?.cause?.code || err?.name || String(err) };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      state: 'error',
      detail: `HTTP ${res.status} from shim — token ${REDIS_REST_TOKEN ? 'REJECTED (must equal REDIS_TOKEN / SRH_TOKEN)' : 'MISSING (set CII_WARM_REDIS_TOKEN or REDIS_TOKEN)'}`,
    };
  }
  if (!res.ok) return { state: 'error', detail: `HTTP ${res.status} from shim` };

  const body = await res.json().catch(() => undefined);
  if (!body || typeof body !== 'object' || !('result' in body)) {
    return { state: 'error', detail: 'shim answered 200 with an unexpected envelope (no "result" field)' };
  }
  if (body.result === null || body.result === '') return { state: 'absent' };
  if (typeof body.result !== 'string') {
    return { state: 'error', detail: `shim "result" has unexpected type ${typeof body.result}` };
  }

  let snapshotCiiCount = 'unparsable';
  try {
    const snapshot = JSON.parse(body.result);
    snapshotCiiCount = Array.isArray(snapshot?.ciiScores) ? snapshot.ciiScores.length : 'unparsable';
  } catch { /* present but not JSON — reported below */ }
  return { state: 'present', snapshotCiiCount };
}

/** After a 2xx warm response: prove the stale key was written. Returns {code, message}. */
async function verifyStaleWrite(warmSummary) {
  let read = await readStaleKeyBack();
  for (const delayMs of VERIFY_ABSENT_RETRY_DELAYS_MS) {
    if (read.state !== 'absent') break;
    await sleep(delayMs);
    read = await readStaleKeyBack();
  }

  if (read.state === 'present') {
    if (read.snapshotCiiCount === 'unparsable') {
      // get-country-risk's JSON read would also choke on this — treat as the
      // deadlock persisting, not as success.
      return {
        code: 1,
        message:
          `VERIFY FAILED: ${warmSummary} and ${STALE_KEY} EXISTS but its value is not a parsable risk-scores snapshot — ` +
          `readers will treat it as missing, so the deadlock effectively persists. Inspect the key via the shim (${REDIS_REST_BASE}/get/...) and re-run after clearing it.`,
      };
    }
    return {
      code: 0,
      message:
        `OK ${warmSummary}; VERIFIED ${STALE_KEY} present via ${REDIS_REST_BASE} ` +
        `(snapshot ciiScores=${read.snapshotCiiCount}, TTL 3600s) — the only key get_country_risk reads. Deadlock cured.`,
    };
  }

  if (read.state === 'absent') {
    return {
      code: 1,
      message:
        `VERIFY FAILED: ${warmSummary} but ${STALE_KEY} is ABSENT (shim at ${REDIS_REST_BASE} answered; Redis has no such key) — ` +
        `the 200 came from a degraded/non-leader path or the leader's Redis write failed (write errors are swallowed, get-risk-scores.ts). ` +
        `The cold-start deadlock PERSISTS. Check the app container's logs and its UPSTASH_REDIS_REST_URL/TOKEN, then re-run.`,
    };
  }

  return {
    code: 2,
    message:
      `VERIFY UNAVAILABLE: ${warmSummary} but the redis-rest shim could not confirm the write (${read.detail}; shim base ${REDIS_REST_BASE}) — ` +
      `write state UNKNOWN, not proven absent. Do NOT read this as the deadlock persisting: fix the verification path ` +
      `(in-network http://redis-rest:80, host-side http://127.0.0.1:8079; token = REDIS_TOKEN) and re-run.`,
  };
}

/** Warm-then-verify. Returns {code, message} — the single termination point prints it. */
async function main() {
  let hostname;
  try {
    // Trailing-dot FQDNs (api.worldmonitor.app.) resolve to the same origin
    // but survive WHATWG URL parsing verbatim — normalize before comparing
    // so they cannot slip past the refusal guard.
    hostname = new URL(url).hostname.replace(/\.$/, '');
  } catch {
    return { code: 1, message: `INVALID URL: CII_WARM_URL='${url}' does not parse` };
  }
  if (hostname === HOSTED_ORIGIN && process.env.CII_WARM_ALLOW_HOSTED !== '1') {
    return {
      code: 1,
      message: `REFUSED: target is the hosted origin ${HOSTED_ORIGIN}. This warmer is for the LOCAL self-host app only (default ${DEFAULT_URL}).`,
    };
  }

  const headers = {
    'User-Agent': 'worldmonitor-cii-warmer/1.0 (self-host CII stale-key warm)',
    Accept: 'application/json',
  };
  if (relayKey) headers['X-WorldMonitor-Key'] = relayKey;

  const started = Date.now();
  let attempt = 0;
  let delayMs = 1_000;
  let lastError = 'no attempt completed';

  while (Date.now() - started < timeoutMs) {
    attempt += 1;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS) });

      if (res.ok) {
        const body = await res.json().catch(() => null);
        const count = Array.isArray(body?.ciiScores) ? body.ciiScores.length : 'unknown';
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        const warmSummary =
          `200 from ${url} (attempt ${attempt}, ${elapsed}s, ciiScores=${count} ` +
          `degraded=${body?.degraded ?? '?'} stale=${body?.stale ?? '?'})`;
        // A 2xx alone proves nothing about the stale key (degraded path / follower /
        // swallowed write error). Read it back before claiming the deadlock is cured.
        return verifyStaleWrite(warmSummary);
      }

      if (res.status === 401 || res.status === 403) {
        if (!relayKey) {
          return {
            code: 1,
            message:
              `AUTH REQUIRED: ${url} answered ${res.status} and WORLDMONITOR_RELAY_KEY is unset — ` +
              `add WORLDMONITOR_RELAY_KEY=$(openssl rand -hex 32) to .env, recreate the stack (docker compose up -d), then re-run.`,
          };
        }
        return {
          code: 1,
          message:
            `AUTH REJECTED: ${url} answered ${res.status} with WORLDMONITOR_RELAY_KEY set — ` +
            `the app service and this warmer must share the same value (check .env, then docker compose up -d --force-recreate).`,
        };
      }

      // 429 (rate limited — the global per-IP limiter still applies to the
      // warm-ping path) and 408 are retriable: fall through to backoff with
      // the rest of the deadline budget instead of failing definitively.
      if (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408) {
        return { code: 1, message: `FAILED: ${url} answered HTTP ${res.status} (not retriable) — check the app container logs.` };
      }

      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err?.cause?.code || err?.name || String(err);
    }

    const remaining = timeoutMs - (Date.now() - started);
    if (remaining > 0) await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, 10_000);
  }

  return {
    code: 1,
    message: `TIMEOUT after ${timeoutMs}ms waiting for ${url} (attempts: ${attempt}, last error: ${lastError}) — is the stack up? docker compose ps`,
  };
}

const { code, message } = await main();
(code === 0 ? console.log : console.error)(`[warm-cii-stale] ${message}`);
// Exit via exitCode + natural drain, NOT process.exit(): a synchronous exit
// while an undici fetch handle is still tearing down trips a libuv assertion
// on Windows hosts (src\win\async.c, exit 0xC0000409), clobbering the exit
// code this script's contract depends on. All handles here are drained or
// unref'd, so the loop empties promptly; the unref'd timer below is a hard
// backstop that only fires if something unexpectedly keeps the loop alive.
process.exitCode = code;
setTimeout(() => process.exit(code), 3_000).unref();
