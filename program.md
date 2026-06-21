# program.md — extend A1 Suite Local ANT (LIVE deploy — be careful)

You are an autonomous extension agent. Your job: **add a feature to the LIVE
`A1-Suite-Local-ANT`** while preserving all sovereignty contracts.

## ⚠️ THIS IS THE LIVE DEPLOY — read AGENTS.md §"How this relates to MAX" first

ANT is the productionized, customer-facing A1 Suite. **MAX is the next-gen
migration target.** New work on the app shell should target MAX, not ANT.

Patches and sovereignty hardening stay on ANT. Anything that grows the surface
area (new apps, new AI features, new architecture) belongs on MAX.

## The task

Given a target feature (e.g. "harden the egress gate", "add a backup-rotation
cron", "patch a sovereignty contract"), produce:

1. Code change in `server/` (Fastify backend) or `web-modern/` (Vite SPA).
2. Tests (vitest for SPA, `node --test` for backend).
3. Updated `egress-policy-contract` Karpathy eval lane if a sovereignty contract
   changed.
4. Updated `DEPLOYMENT.md` and `HANDOFF.md`.

## The loop

```
1. Read AGENTS.md §"LIVE deploy" + this file (loop)
2. Confirm the task is a patch, not a new surface — if new, redirect to MAX
3. Read HANDOFF.md to see prior slices (don't repeat, extend)
4. Make the change with TDD (red → green → improve)
5. Run npm run check (lint + typecheck + test + boundary-check)
6. Run npm run karpathy:run -- egress-policy-contract — must stay green
7. Update HANDOFF.md and DEPLOYMENT.md
8. Commit with conventional prefix
9. Mark .orchestration/<slice>-done
```

## Files you'll touch

| File | Why |
|---|---|
| `server/*.js` | Backend (Fastify) |
| `web-modern/src/**` | SPA (Vite + React) |
| `test/**/*.test.js` | Backend tests |
| `web-modern/src/**/*.test.ts(x)` | SPA tests |
| `evals/karpathy/<lane>/...` | Locked contracts |
| `HANDOFF.md` | Implementation narrative |
| `DEPLOYMENT.md` | Deploy runbook |

## Files you must NOT touch

- `Dockerfile` casually. If your change needs a Dockerfile change, write a
  rollback plan in the PR.
- `deploy/install.sh` — bare-metal install path is operator-tested.
- `ARMOSPHERA_ONE_ALLOW_EGRESS` default (must remain 0).
- `ARMOSPHERA_ONE_EGRESS_ALLOWLIST` semantics — deny-until-listed is the rule.

## Rules of engagement

- **TDD mandatory.** Backend: `node --test`. SPA: `vitest run`.
- **Coverage ≥80% per touched module.**
- **Sovereignty contracts are locked via Karpathy eval lanes.** Don't break
  `egress-policy-contract`. If you must evolve it, update the lane in the same PR.
- **Migration safety:** if your change touches the SQLite schema, write a
  forward-only migration. No backwards-compat shims.
- **The demo DB at `ARMOSPHERA_ONE_DB` is OUTSIDE the repo.** Never write a test
  that touches the real demo DB.

## Environment

- Node ≥ 22.5 (engines in `package.json`).
- `npm install` (Fastify + Vite + vitest + playwright).
- `npm run check` — the gate.
- `npm run karpathy:*` — eval lanes.

## When to stop

- **Patch is shipped + HANDOFF.md updated + Karpathy lane still green.**
- **Surface growth detected:** STOP. Redirect to A1-Suite-Local-MAX.
- **Sovereignty contract violation:** STOP. File a critical-severity issue.

## Logging

Use conventional commits with `fix(<area>): ...` or `feat(<area>): ...` prefix.
Keep commit body short — the full slice narrative goes in HANDOFF.md.

## Coordination

- **Cross-app data:** ANT is monolithic. No cross-app imports. If you need shared
  logic, the answer is `vendor/a1-localization-am/`, not a new package.
- **`@a1/ai` bumps:** out of scope for ANT patches. Coordinate separately.
- **Sovereignty contracts:** every contract change ships as `(contract change) +
  (Karpathy lane update) + (deploy doc update)` in one PR.

---

*Companion to `AGENTS.md`. AGENTS.md = rules (live deploy discipline, sovereignty
posture). This file = day-to-day patch loop.*