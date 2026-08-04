import { sleep } from './_seed-utils.mjs';

// Honest declared bot UA.
//
// CONTEXT.md boundary 2 v9 forbids any measure whose PURPOSE is to make a
// party who refused us think we are someone else. This helper previously did
// two of those at once:
//
//   1. It sent CHROME_UA (browser impersonation) to archive-api.open-meteo.com.
//   2. On exhausted retries it fell through to a two-leg Decodo proxy cascade
//      whose own comment stated the intent outright: "Decodo gateway gets a
//      different egress IP that is not (yet) on Open-Meteo's per-IP throttle."
//      That is per-IP quota evasion — the throttle is Open-Meteo declining to
//      serve us more, and routing around it via a different egress IP is
//      exactly the prohibited posture.
//
// Both are gone. We identify ourselves, we accept the answer we are given, and
// when the upstream says no we FAIL LOUDLY with its status rather than
// degrading silently. The approved remedy for a quota we keep hitting is
// re-sourcing to a different sanctioned provider — see
// scripts/seed-climate-zone-normals.mjs, which now takes its 1991-2020 normals
// from NASA POWER (public domain, no key) instead of asking this endpoint for
// 30 years of daily data per zone.
//
// Value matches the same honest-UA string used at scripts/_conflict-hapi.mjs
// (HDX_HONEST_UA). The shared HONEST_UA exported by _seed-utils.mjs is a
// different, older string and is deliberately NOT reused here.
const ARCHIVE_UA = 'the-synactic/2.10 (+https://github.com/clduab11/the-synactic)';

const MAX_RETRY_AFTER_MS = 60_000;
// 429 is DELIBERATELY ABSENT. It is the publisher enforcing a published quota,
// and boundary 2 requires backing off rather than retrying through it. This
// helper is called with maxRetries: 4, so treating 429 as retryable meant five
// requests into a refusal — a milder form of the same posture the Decodo proxy
// cascade was removed from this file for. The seeder runs on a 3h/24h loop, so
// the next cycle IS the backoff; a rate-limited run records its reason and stops.
// 503 stays: that is a transient fault on their side, not a refusal aimed at us.
const RETRYABLE_STATUSES = new Set([503]);

export function chunkItems(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function normalizeArchiveBatchResponse(payload) {
  return Array.isArray(payload) ? payload : [payload];
}

export function parseRetryAfterMs(value) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) {
    return Math.min(Math.max(retryAt - Date.now(), 1000), MAX_RETRY_AFTER_MS);
  }

  return null;
}

export async function fetchOpenMeteoArchiveBatch(zones, opts) {
  const {
    startDate,
    endDate,
    daily,
    timezone = 'UTC',
    timeoutMs = 30_000,
    maxRetries = 3,
    retryBaseMs = 2_000,
    label = zones.map((zone) => zone.name).join(', '),
  } = opts;

  const params = new URLSearchParams({
    latitude: zones.map((zone) => String(zone.lat)).join(','),
    longitude: zones.map((zone) => String(zone.lon)).join(','),
    start_date: startDate,
    end_date: endDate,
    daily: daily.join(','),
    timezone,
  });
  const url = `https://archive-api.open-meteo.com/v1/archive?${params.toString()}`;

  // Carry the upstream signal to the throw site. `lastStatus` is the last
  // non-OK HTTP status Open-Meteo actually returned; `lastTransportError` is
  // the last thrown fetch error (timeout, ECONNRESET, DNS). They are tracked
  // SEPARATELY and neither clears the other: a run that 429s and then times
  // out must still report the 429, because "we are over the per-IP quota" and
  // "the socket died" call for different operator responses.
  let lastStatus = null;
  let lastTransportError = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': ARCHIVE_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastTransportError = err;
      if (attempt < maxRetries) {
        const retryMs = retryBaseMs * 2 ** attempt;
        console.log(`  [OPEN_METEO] ${err?.message ?? err} for ${label}; retrying batch in ${Math.round(retryMs / 1000)}s`);
        await sleep(retryMs);
        continue;
      }
      break;
    }

    if (resp.ok) {
      const data = normalizeArchiveBatchResponse(await resp.json());
      if (data.length !== zones.length) {
        throw new Error(`Open-Meteo batch size mismatch for ${label}: expected ${zones.length}, got ${data.length}`);
      }
      return data;
    }

    lastStatus = resp.status;

    if (RETRYABLE_STATUSES.has(resp.status) && attempt < maxRetries) {
      const retryMs = parseRetryAfterMs(resp.headers.get('retry-after')) ?? (retryBaseMs * 2 ** attempt);
      console.log(`  [OPEN_METEO] ${resp.status} for ${label}; retrying batch in ${Math.round(retryMs / 1000)}s`);
      await sleep(retryMs);
      continue;
    }

    // Non-retryable status, or the retry budget is spent. There is no second
    // path: a 429 here means Open-Meteo's per-IP free-tier throttle has
    // declined to serve us, and the honest response to that is to stop and
    // say so, not to reappear from a different egress IP.
    break;
  }

  // Fail loudly with the upstream status. Callers (seed-climate-zone-normals,
  // seed-climate-anomalies) log this message verbatim into their per-batch
  // failure reasons, so the status must be IN the message — a generic
  // "retries exhausted" would erase the one detail that distinguishes a quota
  // refusal (429) from an upstream outage (5xx) from a network fault.
  const detail = lastStatus != null
    ? `last upstream status: HTTP ${lastStatus}`
    : `last upstream status: none (transport error: ${lastTransportError?.message ?? 'unknown'})`;
  const cause = lastTransportError ?? (lastStatus != null ? new Error(`HTTP ${lastStatus}`) : null);
  throw new Error(
    `Open-Meteo retries exhausted for ${label} after ${attempts} attempt(s) — ${detail}`,
    cause ? { cause } : undefined,
  );
}
