#!/bin/sh
set -e

# Docker secrets → env var bridge
# Reads /run/secrets/KEYNAME files and exports as env vars.
# Secrets take priority over env vars set via docker-compose environment block.
if [ -d /run/secrets ]; then
  for secret_file in /run/secrets/*; do
    [ -f "$secret_file" ] || continue
    key=$(basename "$secret_file")
    value=$(cat "$secret_file" | tr -d '\n')
    export "$key"="$value"
  done
fi

node /app/validate-session-secret.mjs

# This image is always the public Docker ingress, with or without Compose.
# The sidecar's default (desktop) mode serves /api/local-* management to any
# caller nginx forwards with the internal token, so the mode is not optional.
export LOCAL_API_MODE=docker
export LOCAL_API_PORT="${LOCAL_API_PORT:-46123}"
if [ -z "${LOCAL_API_TOKEN:-}" ]; then
  LOCAL_API_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
  export LOCAL_API_TOKEN
fi

# ADV-34 (the-synactic): self-host premium credential for browser-origin API
# calls. Written as an included snippet rather than templated into nginx.conf so
# that leaving SELFHOST_PREMIUM_KEY unset emits NO directive at all — an empty
# proxy_set_header would strip a caller's own X-WorldMonitor-Key and break
# /api/mcp. Regenerated every boot; never baked into the image.
rm -rf /tmp/selfhost-premium
mkdir -p /tmp/selfhost-premium
if [ -n "${SELFHOST_PREMIUM_KEY:-}" ]; then
  printf 'proxy_set_header X-WorldMonitor-Key "%s";\n' "${SELFHOST_PREMIUM_KEY}" \
    > /tmp/selfhost-premium/premium-key.conf
  chmod 600 /tmp/selfhost-premium/premium-key.conf
fi

node /app/render-nginx-realip.mjs
envsubst '$LOCAL_API_PORT $LOCAL_API_TOKEN' < /etc/nginx/nginx.conf.template > /tmp/nginx.conf
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/worldmonitor.conf
