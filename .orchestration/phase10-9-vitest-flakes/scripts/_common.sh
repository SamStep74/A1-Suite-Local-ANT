#!/usr/bin/env bash
# Phase 10.9 (g) vitest-flakes — single-worker launcher.
#
# Mirrors the wave-3 _common.sh pattern: 12 CRITICAL RULES baked into the
# worker's system prompt. Bounded bash, audit gates, no debug, no
# mcp__claude-in-chrome__*, no subagents.

set -euo pipefail

REPO_ROOT="/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-queue"
WORKER_SLUG="${1:-vitest-flakes}"

# Validate worker
case "$WORKER_SLUG" in
  vitest-flakes) ;;
  *) echo "Unknown worker: $WORKER_SLUG" >&2; exit 2 ;;
esac

WORKTREE_DIR="$REPO_ROOT-phase10-9-vitest-flakes-$WORKER_SLUG"
TASK_FILE="$REPO_ROOT/.orchestration/phase10-9-vitest-flakes/$WORKER_SLUG/task.md"
HANDOFF_FILE="$REPO_ROOT/.orchestration/phase10-9-vitest-flakes/$WORKER_SLUG/handoff.md"
STATUS_FILE="$REPO_ROOT/.orchestration/phase10-9-vitest-flakes/$WORKER_SLUG/status.md"

if [ ! -d "$WORKTREE_DIR" ]; then
  echo "ERROR: worktree $WORKTREE_DIR does not exist. Run setup script first." >&2
  exit 3
fi

# CRITICAL RULES (12)
SYSTEM_PROMPT="You are worker '${WORKER_SLUG}' in phase10.9 (g) vitest flakes cleanup. CRITICAL RULES: (1) Every bash command MUST be wrapped in 'timeout 300' (5-min cap) or 'timeout 120' (2-min cap for quick checks). NO unbounded bash. (2) Vitest is 'timeout 300 pnpm vitest run --bail=1 <file>'. (3) Run vitest in worktree's web-modern subdir: 'cd ${WORKTREE_DIR}/web-modern && timeout 300 pnpm vitest run --bail=1 ...'. (4) Set NODE_OPTIONS=--max-old-space-size=2048 to avoid OOM in 16 GB shared system (wave-3 workers are using ~10 GB). (5) Commit per-fix, NOT one big commit at the end. (6) Pick the lowest-hanging fruit first, audit and fix, then move on. If a test is too complex in 5 minutes, mark it DEFER in status.md and move on. (7) Total wall-clock budget: 30 min. (8) Do NOT touch web-modern/src/components/shell/AppLauncher.tsx, web-modern/src/routes/app/fiscal-gates/index.tsx, web-modern/src/lib/fleet/panels/index.tsx, or any source file. (9) Do NOT touch _helpers.ts, playwright.config.ts, package.json, tsconfig.json, vite.config.ts. (10) Do NOT add debug instrumentation (console.log, page.on('console')). (11) Do NOT spawn subagents — do the work inline. (12) If bash hits timeout, do NOT retry the same command without changing something. Your task file is at ${TASK_FILE} — read it first, do exactly what it says, and write your handoff to ${HANDOFF_FILE} when done."

# Initialize status.md if not present
if [ ! -f "$STATUS_FILE" ]; then
  cat > "$STATUS_FILE" <<EOF
# Status: ${WORKER_SLUG}
- State: launched at $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Worktree: \`${WORKTREE_DIR}\`
EOF
fi

cd "$WORKTREE_DIR"

# Spawn claude with the worker task
exec claude --model sonnet --dangerously-skip-permissions \
  --add-dir "$REPO_ROOT" \
  --append-system-prompt "$SYSTEM_PROMPT"
