#!/usr/bin/env bash
# start-all.sh — launched by launchd / systemd as the single process for com.armosphera.one.
# Starts the Fastify backend + the web-modern SPA, waits for both to be healthy,
# and forwards signals / child exits to each other.
#
# Env (set by the plist / unit — not from .env, to keep the service contract explicit):
#   DEPLOY_DEFAULT  spa | legacy  (informational — since 10.2e the legacy UI is retired; "legacy" is a no-op label preserved for compat)
#   BACKEND_PORT    default 4100
#   SPA_PORT        default 3000
#   HOST            default 127.0.0.1
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SPA_PORT="${SPA_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-4100}"
DEPLOY_DEFAULT="${DEPLOY_DEFAULT:-spa}"
HOST="${HOST:-127.0.0.1}"

export SPA_PORT BACKEND_PORT DEPLOY_DEFAULT HOST

mkdir -p "$ROOT/logs"

start_backend() {
  echo "[start-all] starting Fastify backend on $HOST:$BACKEND_PORT"
  PORT="$BACKEND_PORT" HOST="$HOST" node server/index.js \
    >>"$ROOT/logs/backend.out.log" 2>>"$ROOT/logs/backend.err.log" &
  BACKEND_PID=$!
}

start_spa() {
  echo "[start-all] starting web-modern SPA on $HOST:$SPA_PORT"
  PORT="$SPA_PORT" FASTIFY_BACKEND_URL="http://$HOST:$BACKEND_PORT" \
    node web-modern/scripts/serve-spa.mjs \
    >>"$ROOT/logs/spa.out.log" 2>>"$ROOT/logs/spa.err.log" &
  SPA_PID=$!
}

cleanup() {
  echo "[start-all] cleanup (DEPLOY_DEFAULT=$DEPLOY_DEFAULT)"
  [ -n "${SPA_PID:-}" ] && kill -TERM "$SPA_PID" 2>/dev/null || true
  [ -n "${BACKEND_PID:-}" ] && kill -TERM "$BACKEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

start_backend
start_spa

# Wait up to 15s for both to come up
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  BACKEND_OK=$(curl -fsS -o /dev/null -w '%{http_code}' "http://$HOST:$BACKEND_PORT/api/health" 2>/dev/null || echo "000")
  SPA_OK=$(curl -fsS -o /dev/null -w '%{http_code}' "http://$HOST:$SPA_PORT/" 2>/dev/null || echo "000")
  if [ "$BACKEND_OK" = "200" ] && [ "$SPA_OK" = "200" ]; then
    echo "[start-all] both processes up (backend=$BACKEND_OK, spa=$SPA_OK after ${i}s)"
    break
  fi
done

echo "[start-all] ready — open http://$HOST:$SPA_PORT"

# Block on the children; if either dies, kill the other.
wait -n
EXIT_CODE=$?
echo "[start-all] a child exited (code=$EXIT_CODE) — killing the other"
cleanup
