# 🌍 Self-Hosting World Monitor

Run the full World Monitor stack locally with Docker/Podman.

## 📋 Prerequisites

- **Docker** or **Podman** (rootless works fine)
- **Docker Compose** or **podman-compose** (`pip install podman-compose` or `uvx podman-compose`)
- **Node.js 22+** (for running seed scripts on the host)

## 🚀 Quick Start

```bash
# 1. Clone and enter the repo
git clone https://github.com/koala73/worldmonitor.git
cd worldmonitor
npm install

# 2. Generate the REQUIRED secrets. Without these the stack will not start
#    (see the "Required Environment Variables" table below).
echo "RELAY_SHARED_SECRET=$(openssl rand -hex 32)" >> .env
echo "REDIS_PASSWORD=$(openssl rand -hex 32)"      >> .env
echo "REDIS_TOKEN=$(openssl rand -hex 32)"         >> .env
# Recommended: lets the one-shot CII warmer authenticate against the app
# (see "Warming the CII cache" below — without it get_country_risk stays empty).
echo "WORLDMONITOR_RELAY_KEY=$(openssl rand -hex 32)" >> .env

# 3. Start the stack
docker compose up -d        # or: uvx podman-compose up -d

# 4. Seed data into Redis
./scripts/run-seeders.sh

# 5. Open the dashboard
open http://localhost:3000
```

The dashboard works out of the box with public data sources (earthquakes, weather, conflicts, etc.). API keys unlock additional data feeds.

## 🔐 Required Environment Variables

These must be set before `docker compose up -d`, or one of the containers will exit on boot.

| Variable | Purpose | How to generate |
| --- | --- | --- |
| `RELAY_SHARED_SECRET` | Authenticates every non-public request the dashboard makes to the AIS relay. The relay refuses to start without it. | `openssl rand -hex 32` |
| `REDIS_PASSWORD` | Redis AUTH password (`--requirepass`). The Redis container refuses to start without it; the REST proxy uses it in its upstream connection string. | `openssl rand -hex 32` |
| `REDIS_TOKEN` | Bearer token the REST proxy (`redis-rest`) requires on every request, and the value the app sends as `UPSTASH_REDIS_REST_TOKEN`. The proxy and app containers refuse to start without it. | `openssl rand -hex 32` |

> Earlier releases shipped `wm-local-token` as a default for the REST token. That default has been removed (#3804) — the proxy was only reachable from `127.0.0.1:8079` so external exposure required a hostile `docker-compose.override.yml`, but any user who flipped that binding to `0.0.0.0` was instantly authenticated by a publicly documented string. Fresh installs and existing clones both need to set `REDIS_TOKEN` and `REDIS_PASSWORD` in `.env` from this release onward.

> Need to bring the relay up without auth for local debugging? Set `I_UNDERSTAND_THIS_DISABLES_AUTH=true` (the deprecated `ALLOW_UNAUTHENTICATED_RELAY=true` is still accepted). The relay will log a loud `[SECURITY]` warning at boot and every 5 minutes, and every non-public route will be reachable by anyone who can hit the port — **never use this on an internet-reachable host.**

## 🔑 API Keys

Create a `docker-compose.override.yml` to inject your keys. This file is **gitignored** — your secrets stay local.

```yaml
services:
  the-synactic:
    environment:
      # 🤖 LLM — pick one or both (used for intelligence assessments)
      GROQ_API_KEY: ""            # https://console.groq.com (free, 14.4K req/day)
      OPENROUTER_API_KEY: ""      # https://openrouter.ai (free, 50 req/day)

      # 📊 Markets & Economics
      FINNHUB_API_KEY: ""         # https://finnhub.io (free tier)
      FRED_API_KEY: ""            # https://fred.stlouisfed.org/docs/api/api_key.html (free)
      EIA_API_KEY: ""             # https://www.eia.gov/opendata/ (free)

      # ⚔️ Conflict & Unrest
      ACLED_EMAIL: ""             # https://acleddata.com (free for researchers)
      ACLED_PASSWORD: ""          # OAuth flow — tokens auto-refresh (preferred over ACLED_ACCESS_TOKEN)
      ACLED_ACCESS_TOKEN: ""      # Alternative: static token (expires every 24h)

      # 🛰️ Earth Observation
      NASA_FIRMS_API_KEY: ""      # REQUIRED for seed-fire-detections.mjs — https://firms.modaps.eosdis.nasa.gov (free)

      # ✈️ Aviation
      AVIATIONSTACK_API: ""       # https://aviationstack.com (free tier)
      TRAVELPAYOUTS_API_TOKEN: "" # https://travelpayouts.com (flight price search — optional)
      # 🚢 Maritime
      AISSTREAM_API_KEY: ""       # https://aisstream.io (free)

      # 🌐 Internet Outages (paid)
      CLOUDFLARE_API_TOKEN: ""    # https://dash.cloudflare.com (requires Radar access)

      # 🔌 Self-hosted LLM (optional — any OpenAI-compatible endpoint)
      LLM_API_URL: ""             # e.g. http://localhost:11434/v1/chat/completions
      LLM_API_KEY: ""
      LLM_MODEL: ""

  ais-relay:
    environment:
      AISSTREAM_API_KEY: ""       # same key as above — relay needs it too
```

### 💰 Free vs Paid

| Status | Keys |
|--------|------|
| 🟢 No key needed | Earthquakes, weather, natural events, UNHCR displacement, prediction markets, stablecoins, crypto, spending, climate anomalies, submarine cables, BIS data, cyber threats |
| 🟢 Free signup | GROQ, FRED, EIA, NASA FIRMS, AISSTREAM, Finnhub, AviationStack, ACLED, OpenRouter |
| 🟡 Free (limited) | OpenSky (higher rate limits with account) |
| 🔴 Paid | Cloudflare Radar (internet outages) |

## 🌱 Seeding Data

The seed scripts fetch upstream data and write it to Redis. They run **on the host** (not inside the container) and need the Redis REST proxy to be running.

```bash
# Run all seeders (auto-sources API keys from docker-compose.override.yml)
./scripts/run-seeders.sh
```

**⚠️ Important:** Redis data persists across container restarts via the `redis-data` volume, but is lost on `docker compose down -v`. Re-run the seeders if you remove volumes or see stale data.

The compose stack automates the most perishable slice for you: the `seed-loop`
service re-runs the six short-TTL seeders (security advisories, aviation, cyber
threats, prediction markets, radiation, internet outages — all 2-3h TTLs) every
45 minutes, so those keys no longer lapse between manual runs. Inspect it with
`docker compose logs seed-loop`. Everything else (the long-TTL majority) still
comes from `run-seeders.sh`; to automate the full sweep too, add a cron job:

```bash
# Re-seed every 30 minutes
*/30 * * * * cd /path/to/worldmonitor && ./scripts/run-seeders.sh >> /tmp/wm-seeders.log 2>&1
```

**Per-seeder timeout (`SEED_TIMEOUT`):** standalone seeders are each wrapped in a
wall-clock cap so one hung upstream can't starve the rest of the run. It defaults
to `1800` (30 min); override with `SEED_TIMEOUT=<seconds>`, or `SEED_TIMEOUT=0` to
disable. Bundle seeders (`seed-bundle-*.mjs`) are exempt — they already bound each
section internally. Requires the `timeout` command (GNU coreutils); if it's absent
the cap is silently skipped.

### 🔧 Manual seeder invocation

If you prefer to run seeders individually:

```bash
# Source .env so REDIS_TOKEN (and any API keys it holds) become available.
# Quick-start puts REDIS_TOKEN in .env, not in your shell — without this,
# the next line fails-loud with "REDIS_TOKEN: parameter null or not set".
set -a; . ./.env; set +a

export UPSTASH_REDIS_REST_URL=http://localhost:8079
export UPSTASH_REDIS_REST_TOKEN="${REDIS_TOKEN:?set REDIS_TOKEN in .env first}"
node scripts/seed-earthquakes.mjs
node scripts/seed-military-flights.mjs
# ... etc
```

`./scripts/run-seeders.sh` auto-sources `REDIS_TOKEN` from `.env`, so the wrapper is the simpler path. Use the manual form only when iterating on a single seeder.

### 🌡️ Warming the CII cache (cold-start deadlock)

`get_country_risk` (the per-country risk RPC / MCP tool) reads **only** the Redis key `risk:scores:sebuf:stale:v8`. **No seeder writes that key** — it is written by the app's own `/api/intelligence/v1/get-risk-scores` handler, with a 3600s TTL. So a fresh stack with every seeder green still returns `upstreamUnavailable: true` from `get_country_risk` — until something requests the **local** get-risk-scores endpoint once.

The compose stack does this automatically, twice over. The one-shot `cii-warmer` service runs on every `docker compose up -d`, waits for the app, and GETs the local endpoint. And because the stale key's 3600s TTL means a single warm silently lapses an hour later, the companion `cii-warmer-loop` service re-warms every 45 minutes (retrying in 5 on any failure) so the key stays present continuously. Inspect either with:

```bash
docker compose logs cii-warmer
docker compose logs cii-warmer-loop
```

The endpoint is auth-gated even on self-host, so the warmer authenticates via the gateway's relay warm-ping path: set `WORLDMONITOR_RELAY_KEY` in `.env` (`openssl rand -hex 32`) **before** `up -d` (see Quick Start step 2). Without it the warmer exits with `AUTH REQUIRED` and the deadlock remains.

An HTTP 200 from the endpoint does **not** by itself prove the key was written — the handler's degraded fallback answers 200 without persisting, and Redis write failures are swallowed. So after the warm GET the script reads `risk:scores:sebuf:stale:v8` back through the `redis-rest` proxy and reports one of three outcomes on its single output line:

| Exit | Meaning |
| --- | --- |
| `0` | Warmed **and verified** — the stale key was read back as a parsable risk-scores snapshot. Deadlock cured. |
| `1` | Definitive failure — the warm request failed, **or** it returned 200 but the key is absent (deadlock persists; check the app container's logs and its Redis config), **or** the key exists but its value is corrupt (inspect and clear it). |
| `2` | Warmed but **unverified** — the `redis-rest` proxy was unreachable, rejected the token, or answered with a malformed envelope. The write state is unknown; fix the verification path and re-run. Do **not** read this as the deadlock persisting. |

To warm manually from the host (e.g. after `down -v` + reseed, or a non-compose setup):

```bash
set -a; . ./.env; set +a   # picks up WORLDMONITOR_RELAY_KEY and REDIS_TOKEN
node scripts/warm-cii-stale.mjs
```

`CII_WARM_URL` overrides the target (default `http://127.0.0.1:${WM_PORT:-3000}/api/intelligence/v1/get-risk-scores`). The read-back defaults to `http://127.0.0.1:8079` (the host-published `redis-rest` port) with `REDIS_TOKEN` as the bearer token; inside the compose network it is `http://redis-rest:80` (compose sets this for the `cii-warmer` service — a container cannot reach the host's `127.0.0.1:8079`). Override with `CII_WARM_REDIS_URL` / `CII_WARM_REDIS_TOKEN`.

> The read-back **deliberately ignores** `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, so sourcing a hybrid `.env` that also carries hosted Vercel/Upstash credentials cannot point verification at production Redis (same rule the seeder section above applies — the local `REDIS_TOKEN` wins). If your self-host genuinely uses hosted Upstash as its cache, set `CII_WARM_REDIS_URL`/`CII_WARM_REDIS_TOKEN` explicitly.

Never point the warmer at the hosted `api.worldmonitor.app` — the hosted stack has its own relay warmer, and the script refuses that origin.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│                 localhost:3000               │
│                   (nginx)                    │
├──────────────┬──────────────────────────────┤
│ Static Files │      /api/* proxy            │
│  (Vite SPA)  │         │                    │
│              │    Node.js API (:46123)       │
│              │    50+ route handlers         │
│              │         │                     │
│              │    Redis REST proxy (:8079)   │
│              │         │                     │
│              │      Redis (:6379)            │
└──────────────┴──────────────────────────────┘
         AIS Relay (WebSocket → AISStream)
```

| Container | Purpose | Port |
|-----------|---------|------|
| `the-synactic` | nginx + Node.js API (supervisord) | 3000 → 8080 |
| `the-synactic-redis` | Data store | 6379 (internal) |
| `the-synactic-redis-rest` | Upstash-compatible REST proxy | 8079 |
| `the-synactic-ais-relay` | Live vessel tracking WebSocket | 3004 (internal) |

> **`redis-rest` command allowlist**: the bundled proxy (`docker/redis-rest-proxy.mjs`) only
> forwards a fixed allowlist of Redis commands and rejects `EVAL`/`EVALSHA`/`SCRIPT` (no Lua
> scripting). Two consequences for a self-hosted stack:
>
> - `@upstash/ratelimit`'s Lua-based sliding-window limiter (`server/_shared/rate-limit.ts`,
>   `api/_rate-limit.js`) can't run against it. Both automatically detect the rejection once and
>   fall back to a non-Lua fixed-window limiter (`INCR` + `EXPIRE NX`) for the rest of the
>   process — rate limiting still enforces, just with fixed- instead of sliding-window semantics.
> - `scripts/ais-relay.cjs`'s own in-container seed loops (`UPSTASH_ENABLED`) also require
>   `UPSTASH_REDIS_REST_URL` to start with `https://` by default, which the plain-HTTP proxy
>   never satisfies. Set `UPSTASH_ALLOW_INSECURE_HTTP=true` on the `ais-relay` service (already
>   wired for `redis-rest` in `docker-compose.yml`) to opt into using the proxy from
>   inside the relay container.

## 🔨 Building from Source

```bash
# Frontend only (for development)
npx vite build

# Full Docker image
docker build -t the-synactic:latest -f Dockerfile .

# Rebuild and restart
docker compose down && docker compose up -d
./scripts/run-seeders.sh
```

### ⚠️ Build Notes

- The Docker image uses **Node.js 22 Alpine** for both builder and runtime stages
- Blog site build is skipped in Docker (separate dependencies)
- The runtime stage needs `gettext` (Alpine package) for `envsubst` in the nginx config
- Docker nginx mirrors Vercel's `script-src` policy and does not allow `'unsafe-inline'`; hash-pin any custom inline scripts before adding them to a self-hosted build.
- If you hit `npm ci` sync errors in Docker, regenerate the lockfile with the container's npm version:
  ```bash
  docker run --rm -v "$(pwd)":/app -w /app node:24-alpine npm install --package-lock-only
  ```

## 🌐 Connecting to External Infrastructure

### Shared Redis (optional)

If you run other stacks that share a Redis instance, connect via an external network:

```yaml
# docker-compose.override.yml
services:
  redis:
    networks:
      - infra_default

networks:
  infra_default:
    external: true
```

### Self-Hosted LLM

Any OpenAI-compatible endpoint works (Ollama, vLLM, llama.cpp server, etc.):

```yaml
# docker-compose.override.yml
services:
  the-synactic:
    environment:
      LLM_API_URL: "http://your-host:8000/v1/chat/completions"
      LLM_API_KEY: "your-key"
      LLM_MODEL: "your-model-name"
    extra_hosts:
      - "your-host:192.168.1.100"  # if not DNS-resolvable
```

## 🐛 Troubleshooting

| Issue | Fix |
|-------|-----|
| 📡 `0/55 OK` on health check | Seeders haven't run — `./scripts/run-seeders.sh` |
| 🔴 nginx won't start | Check `podman logs the-synactic` — likely missing `gettext` package |
| 🔑 Seeders say "Missing UPSTASH_REDIS_REST_URL" | Stack isn't running, or run via `./scripts/run-seeders.sh` (auto-sets env vars) |
| 📦 `npm ci` fails in Docker build | Lockfile mismatch — regenerate with `docker run --rm -v $(pwd):/app -w /app node:24-alpine npm install --package-lock-only` |
| 🚢 No vessel data | Set `AISSTREAM_API_KEY` in both `the-synactic` and `ais-relay` services |
| 🔥 No wildfire data | Set `NASA_FIRMS_API_KEY` |
| 🌐 No outage data | Requires `CLOUDFLARE_API_TOKEN` (paid Radar access) |
