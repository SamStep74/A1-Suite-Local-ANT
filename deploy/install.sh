#!/usr/bin/env bash
set -euo pipefail
# Armosphera One Claude — sovereign local-server installer (offline-first; outbound OFF by default).
#
# Phase 10.1: dual-build + start-all wrapper + rollback via DEPLOY_DEFAULT.
#   DEPLOY_DEFAULT=spa    → SPA is the default UI on :3000 (web-modern, new)
#   DEPLOY_DEFAULT=legacy → legacy build on :4100 (old `web/` Vite app, escape hatch)
#
# Both builds are produced on every install so rollback is just an env-var flip
# + service restart — no rebuild required.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"
PORT="${PORT:-4100}"
SPA_PORT="${SPA_PORT:-3000}"
DEPLOY_DEFAULT="${DEPLOY_DEFAULT:-spa}"
OS="$(uname -s)"

if [ "$DEPLOY_DEFAULT" != "spa" ] && [ "$DEPLOY_DEFAULT" != "legacy" ]; then
  echo "ERROR: DEPLOY_DEFAULT must be 'spa' or 'legacy' (got '$DEPLOY_DEFAULT')."
  exit 1
fi

echo "==> Armosphera One Claude installer ($MODE, DEPLOY_DEFAULT=$DEPLOY_DEFAULT)"

# --- Prereqs ---
command -v node >/dev/null || { echo "ERROR: Node.js >=22.5 is required."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then echo "ERROR: Node.js >=22.5 required (found $(node -v))."; exit 1; fi
echo "  node $(node -v) OK"

# --- Build ---
cd "$ROOT"
npm install

# Primary build (fatal on failure) — matches DEPLOY_DEFAULT.
if [ "$DEPLOY_DEFAULT" = "spa" ]; then
  echo "==> Building web-modern SPA (primary)..."
  npm run build:ui || { echo "ERROR: SPA build failed."; exit 1; }
  echo "==> Building legacy UI (secondary, non-fatal — needed for rollback)..."
  npm run build:ui:legacy || echo "  WARNING: legacy build failed; rollback to DEPLOY_DEFAULT=legacy will be broken until fixed."
else
  echo "==> Building legacy UI (primary)..."
  npm run build:ui:legacy || { echo "ERROR: legacy build failed."; exit 1; }
  echo "==> Building web-modern SPA (secondary, non-fatal)..."
  npm run build:ui || echo "  WARNING: SPA build failed; DEPLOY_DEFAULT=spa will be broken until fixed."
fi

# --- Optional: legal KB ---
if [ -n "${LAWS_DB_SOURCE:-}" ] || [ -f "$HOME/Library/Application Support/HayHashvapahWebClaude/data/laws.sqlite" ]; then
  node scripts/install-laws.js "${LAWS_DB_SOURCE:-}" || echo "  (legal KB not installed — optional; law search/RAG stays empty until a laws.sqlite is provided)"
else
  echo "  (no legal KB source found — run 'node scripts/install-laws.js <path>' later to enable Armenian law search)"
fi

# --- Template lint (macOS only) ---
if [ "$OS" = "Darwin" ] && command -v plutil >/dev/null; then
  plutil -lint "$ROOT/deploy/com.armosphera.one.plist.tmpl" >/dev/null && echo "  launchd template OK"
fi

if [ "$MODE" = "--check" ]; then
  echo "==> --check passed (prereqs + build + templates). Service NOT installed."
  exit 0
fi

# --- Service install ---
if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.armosphera.one.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  sed -e "s#__NODE__#$(command -v node)#g" \
      -e "s#__ROOT__#$ROOT#g" \
      -e "s#__PORT__#$PORT#g" \
      -e "s#__SPA_PORT__#$SPA_PORT#g" \
      -e "s#__DEPLOY_DEFAULT__#$DEPLOY_DEFAULT#g" \
      "$ROOT/deploy/com.armosphera.one.plist.tmpl" > "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "==> launchd service com.armosphera.one started (DEPLOY_DEFAULT=$DEPLOY_DEFAULT)"
elif [ "$OS" = "Linux" ]; then
  echo "==> Linux: install the systemd unit (edit placeholders first):"
  echo "    sed -e \"s#__NODE__#$(command -v node)#g\" \\"
  echo "        -e \"s#__ROOT__#$ROOT#g\" \\"
  echo "        -e \"s#__PORT__#$PORT#g\" \\"
  echo "        -e \"s#__SPA_PORT__#$SPA_PORT#g\" \\"
  echo "        -e \"s#__DEPLOY_DEFAULT__#$DEPLOY_DEFAULT#g\" \\"
  echo "        -e \"s#__USER__#$USER#g\" \\"
  echo "        $ROOT/deploy/armosphera-one.service.tmpl | sudo tee /etc/systemd/system/armosphera-one.service"
  echo "    sudo systemctl daemon-reload && sudo systemctl enable --now armosphera-one"
else
  echo "==> Unknown OS — run 'DEPLOY_DEFAULT=$DEPLOY_DEFAULT PORT=$PORT SPA_PORT=$SPA_PORT npm run start:all' to launch manually."
fi

# --- Deploy summary ---
echo
echo "==> Deploy summary:"
echo "    Backend:    http://127.0.0.1:$PORT  (Fastify, /api/*)"
echo "    SPA:        http://127.0.0.1:$SPA_PORT  (web-modern, DEPLOY_DEFAULT=$DEPLOY_DEFAULT)"
echo "    Rollback:   DEPLOY_DEFAULT=legacy bash deploy/install.sh"
echo
echo "==> Health: bash deploy/scripts/healthcheck.sh"
echo "==> Open http://127.0.0.1:$SPA_PORT  | data: OS app-support dir | outbound network OFF by default."
