# Patch roadmap — A1 Suite Local ANT (LIVE)

Status checklist. `[x]` = shipped + tests green + `npm run check` passing +
`karpathy:egress-policy-contract` green + HANDOFF.md updated +
`.orchestration/<slice>-done` touched.

## Patches shipped (recent, in HANDOFF.md)

- [x] CFO printable financial statements (Phase 7) — DONE on `main`
- [x] CI workflow (Phase 6) — 3 jobs: server, web-modern, e2e
- [x] Phase 5b agents — payrcompletell, crm-enrichment, inventory-reorder, platform-copilot
- [x] Multi-stage Dockerfile + .dockerignore

## Patches to add (roadmap)

- [ ] **Sovereignty hardening:** add `--no-egress-debug` CLI flag (default off)
- [ ] **Backup rotation:** cron-able backup with N-day retention
- [ ] **Restore drill:** scripted restore test against a known fixture DB
- [ ] **Audit log read API:** customers can query their own audit chain
- [ ] **Karpathy eval lane `vendor-smoke-contract`:** lock the vendor recipe for
      `a1-localization-am` against drift

## Coordination

- Sibling `A1-Suite-Local-MAX` is the next-gen migration target. **New surface
  area → MAX.**
- `@a1/ai` SHA bumps affect `karpathy-eval.mjs`. Coordinate.

## When ANT freezes

When MAX reaches parity on a domain (e.g. inventory, crm), ANT freezes that
domain. Roadmap items above apply to unfrozen domains only.