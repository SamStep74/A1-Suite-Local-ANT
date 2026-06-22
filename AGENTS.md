# AGENTS.md — A1 Suite Local ANT

This file applies to every agent (human or AI) that touches the `armosphera/A1-Suite-Local-ANT`
repository. It extends, and never weakens, the global rules in
`https://github.com/Armosphera/A1-portfolio/blob/main/LICENSING.md`.

## 1. What this repo is — and how it relates to MAX

`A1-Suite-Local-ANT` is the **productionized, live** A1 Suite — sovereign, self-hostable
Armenian business operating system with phased Zoho One parity.

- **Backend:** Fastify, @fastify/cookie, @fastify/static, zero external runtime deps.
- **SPA:** web-modern (Vite) on port 3000, legacy build on port 4100 (rollback path).
- **AI:** vendored `@a1/ai` from `armosphera/A1-AI-Core`. OpenRouter opt-in only.
- **DB:** SQLite stored outside repo (e.g. `~/Library/Application Support/ArmospheraOneClaude/`).

**Sibling: [`A1-Suite-Local-MAX`](../A1-Suite-Local-MAX) is the next-gen Turbo
monorepo migration target.** ANT freezes when MAX reaches parity. New work on the
app shell should target MAX. Patches and sovereignty hardening stay on ANT.

## 2. ⚠️ This is the LIVE deploy — be careful

Customer data may be on disk in production SQLite databases. Breaking changes here are
production incidents, not unit test failures.

- Sovereignty contracts (egress, RBAC, audit chain) are locked via **Karpathy eval
  lanes** in `evals/karpathy/`. Run them before opening a PR.
- The DB is at `ARMOSPHERA_ONE_DB` (default `~/Library/Application Support/...`) —
  **never** under the repo.
- Migrations are forward-only. Backwards-compat shims are forbidden.

## 3. Sovereignty Posture — read this first

Outbound network is **OFF** by default. To allow specific outbound calls:

```bash
ARMOSPHERA_ONE_ALLOW_EGRESS=1
ARMOSPHERA_ONE_EGRESS_ALLOWLIST="api.openrouter.ai,api.open-notebook.local"
```

Loopback is always allowed. The AI core (`@a1/ai`) is wired through this gate.

**You may not:**
- Bypass the egress gate from app code.
- Add a SaaS dependency that requires persistent outbound.
- Add auto-update or telemetry calls.

## 4. Workflow — Test-Driven Development (TDD)

**Mandatory for every non-trivial change.**

1. Write the test first (RED). Tests live in `test/` (`node --test`) or `web-modern/`
   (`vitest run`).
2. Run the focused test:
   - Backend: `npm test -- --test-name-pattern="<name>"`
   - SPA: `cd web-modern && npm test -- --run <name>`
3. Run the full gate: `npm run check` (lint + typecheck + test + boundary-check).
4. Confirm it fails for the right reason. Write the impl (GREEN).
5. Re-run the focused test, then `npm run check`.
6. Coverage stays at **80% per touched module**.

## 5. The two deploy paths

ANT has **two canonical deploy paths**. Pick the right one for the customer.

### Path A — `deploy/install.sh` (bare-metal, default for sovereign single-host)

```
bash deploy/install.sh              # default: DEPLOY_DEFAULT=spa
bash deploy/install.sh rollback     # env: DEPLOY_DEFAULT=legacy
```

This is the canonical single-host path. Installs systemd unit (Linux) or launchd plist
(macOS), runs healthcheck, sets up daily backup via `deploy/backup.sh`.

### Path B — `Dockerfile` (container)

```
docker build -t a1-suite-ant .
docker run -d --network=none -p 4100:4100 -p 3000:3000 \
  -v /var/lib/a1-suite:/var/lib/a1-suite \
  -e ARMOSPHERA_ONE_ALLOW_EGRESS=0 \
  a1-suite-ant
```

For sovereign single-host: `--network=none` is the right call. The image never makes
outbound calls at runtime.

## 6. Conventional Commits

```
<type>(<scope>): <description>

<optional body>
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`.
- Subject line ≤72 chars, imperative mood, no trailing period.

## 7. No Hardcoded Secrets

- API keys, OAuth secrets, JWT signing keys come through env vars.
- `install.sh` reads `$INSTALL_ROOT/.env` (never from a flag).
- Per `scripts/deploy.sh` CLAUDE.md constraint: no hardcoded secrets.

## 8. Files, Functions, Nesting

- One concept per file. Aim for 200–400 lines, 800 hard cap.
- Functions: <50 lines, single responsibility.
- No nesting deeper than 4 levels.

## 9. JavaScript Discipline

- Backend: CommonJS, Node ≥ 22.5.
- SPA: ESM, Vite, TypeScript where useful.
- Test runner flags (16 GB Mac safety):
  ```
  node --test --test-concurrency=4 --test-timeout=60000
  ```
  Bare `node --test` is unsafe on memory-constrained hardware.

## 10. No Debug Noise in Shipped Code

- `console.log` is for development only. Use the structured logger.
- No commented-out code, no `// FIXME` left behind, no `debugger` in PRs.

## 11. Karpathy Eval Lanes

`evals/karpathy/` contains product-research eval lanes driven by `@a1/ai`. The
`egress-policy-contract` lane locks the sovereignty boundary.

- Adding a new eval lane = adding a new product-research assertion.
- The list lane `npm run karpathy:list` should always succeed.

## 12. Claude Code Config (`.claude/`)

`.claude/launch.json` defines a debug config for the `aoc` (Armosphera One Claude)
runtime. `.claude/settings.json` runs a `reap-orphan-workers.sh` SessionStart hook to
clean up worker tmux panes from previous sessions.

## 13. UI / Design

Default design source: `https://styles.refero.design/`. Trilingual (hy/en/ru) — every
UI string goes through the i18n layer.

## 14. Day-One Checklist

```
1. cat AGENTS.md             # this file — read section 3 (sovereignty) FIRST
2. cat README.md             # install + quick start + demo creds
3. cat DEPLOYMENT.md         # install + backup + transfer procedure
4. cat HANDOFF.md            # prior implementation slices, by phase
5. cat package.json          # look at `check` script — your gate
6. ls evals/karpathy/        # locked contracts — do not break
7. npm ci && npm run check   # confirm baseline green BEFORE editing
8. Now edit.
```

If `npm run check` baseline fails on a fresh clone: STOP, file an issue. Do not edit
around a broken baseline.

---

*Adapted from `armosphera/SBOS-A1-ERP/AGENTS.md`. Specializes for: live-deploy
discipline, sovereignty-first reading order, dual-path deploy story.*
*License: Proprietary (`LicenseRef-Armosphera-Proprietary`). See `LICENSE`.*