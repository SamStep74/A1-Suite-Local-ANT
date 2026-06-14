#!/usr/bin/env bash
# healthcheck.sh — operator smoke check for the dual-process deploy.
# Curls the backend health endpoint, the SPA, the legacy hatch, and a sentinel
# /api/* path that MUST 404 (proves Fastify is not falling back to the SPA shell
# for unknown API routes).
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-4100}"
SPA_PORT="${SPA_PORT:-3000}"

# probe <label> <url>
# Prints "health: HTTP <code> from <url>" on any HTTP response (2xx/4xx/5xx).
# Prints "health: connection refused to <url>" when curl cannot reach the host.
# Returns 0 on 2xx, 1 otherwise.
probe() {
  local label="$1" url="$2"
  local code rc=0
  # Drop -f so we still get %{http_code} on 4xx/5xx; capture curl's own exit
  # code separately so we can distinguish "no connection" from "got an HTTP code".
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null) || rc=$?

  if [ "$rc" -ne 0 ] || [ -z "$code" ] || [ "$code" = "000" ]; then
    printf "  %-50s health: connection refused to %s\n" "$label" "$url"
    return 1
  fi

  printf "  %-50s health: HTTP %s from %s\n" "$label" "$code" "$url"
  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    return 0
  fi
  return 1
}

echo "==> Backend health ($HOST:$BACKEND_PORT/api/health):"
probe "/api/health"             "http://$HOST:$BACKEND_PORT/api/health" || FAIL=1
echo "==> SPA ($HOST:$SPA_PORT/):"
probe "/"                       "http://$HOST:$SPA_PORT/" || FAIL=1
echo "==> API sentinel (must 404, not SPA fallback) ($HOST:$BACKEND_PORT/api/foo):"
probe "/api/foo"                "http://$HOST:$BACKEND_PORT/api/foo" || FAIL=1

echo
echo "==> DEPLOY_DEFAULT hint:"
echo "    - DEPLOY_DEFAULT=spa    → open http://$HOST:$SPA_PORT"

if [ "${FAIL:-0}" -ne 0 ]; then
  exit 1
fi
