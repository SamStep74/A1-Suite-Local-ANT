#!/usr/bin/env bash
# healthcheck.sh — operator smoke check for the dual-process deploy.
# Curls the backend health endpoint, the SPA, the legacy hatch, and a sentinel
# /api/* path that MUST 404 (proves Fastify is not falling back to the SPA shell
# for unknown API routes).
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-4100}"
SPA_PORT="${SPA_PORT:-3000}"

probe() {
  local label="$1" url="$2"
  printf "  %-50s " "$label"
  if curl -fsS -o /dev/null -w 'HTTP %{http_code}  (time=%{time_total}s)\n' "$url"; then
    :
  else
    echo "  (unreachable)"
  fi
}

echo "==> Backend health ($HOST:$BACKEND_PORT/api/health):"
probe "/api/health"             "http://$HOST:$BACKEND_PORT/api/health"
echo "==> SPA ($HOST:$SPA_PORT/):"
probe "/"                       "http://$HOST:$SPA_PORT/"
echo "==> API sentinel (must 404, not SPA fallback) ($HOST:$BACKEND_PORT/api/foo):"
probe "/api/foo"                "http://$HOST:$BACKEND_PORT/api/foo"

echo
echo "==> DEPLOY_DEFAULT hint:"
echo "    - DEPLOY_DEFAULT=spa    → open http://$HOST:$SPA_PORT"
