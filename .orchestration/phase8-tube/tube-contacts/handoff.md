# Handoff: tube-contacts

## State
DONE — branch pushed to `ant/wip/phase8-tube-tube-contacts` as
`a109342`. `phase8-tube-v1` tag will be applied by the orchestrator.

## Files created (7)
- `web-modern/src/routes/app/crm-tube/contacts/index.tsx` — list
  page (search + status chips + bulk enrich)
- `web-modern/src/routes/app/crm-tube/contacts/$contactId.tsx` — 2-col
  detail (info / deals / activities + Tube AI Action Panel)
- `web-modern/src/routes/app/crm-tube/inbox.tsx` — unified activity +
  conversation feed, V1 reply disabled
- `web-modern/src/routes/app/crm-tube/contacts/-index.test.tsx`
  (12 tests)
- `web-modern/src/routes/app/crm-tube/contacts/-contactId.test.tsx`
  (9 tests)
- `web-modern/src/routes/app/crm-tube/-inbox.test.tsx` (11 tests)
- `web-modern/src/routeTree.gen.ts` (modified — 3 leaf routes
  hand-registered against `AppRouteRoute`)

## Test count delta
- Before: 1278 tests across 59 files
- After:  1310 tests across 62 files
- Delta:  +32 tests, +3 files, **0 regressions** (`tsc --noEmit`
  clean)

## routeTree.gen.ts regen status
NOT regen'd — `tanstack/router-cli` requires the parent
`/app/crm-tube/index.tsx` to exist (worker 1's territory). The 3
leaf routes were hand-registered against `AppRouteRoute` to mirror
the `/app/inventory/` + `/app/inventory/$itemId` precedent. When
the orchestrator merges worker 1's crm-tube landing page, the
generator can rewrite the file safely — all our hand patches
follow the same pattern it emits.

## API gaps surfaced (server work, not ours)
- `POST /api/crm/tube/contacts/enrich` — currently stubbed in the
  contact bulk-enrich button. Confirms the same path used by
  worker 1's deal health agent; we hit it with `{ contactIds,
  idempotencyKey }`.
- `POST /api/crm/tube/conversations/:id/messages` — does **not**
  exist on the server yet. The inbox reply form is intentionally
  disabled with a `// TODO` comment. V2 wires the mutation.
- `GET /api/crm/tube/activities` — the envelope is typed as
  `z.array(z.unknown())` in `schemas.ts`. The contact detail page
  narrows client-side with type guards at the boundary. Once the
  port team ships a proper activity schema, the narrowing becomes
  a no-op.
- `GET /api/crm/tube/conversations` returns the inbox items. No
  per-thread `unread_count` field — we compute it client-side from
  the most-recent `kind: "conversation"` item per contact.

## Notes for orchestrator
- Branch: `wip/phase8-tube-tube-contacts` tracking
  `ant/wip/phase8-healthcheck`. `git push -u ant …` already run.
- The Armenian text was preserved as UTF-8 throughout; do NOT
  re-encode the file before merging. The Edit tool has been seen
  to corrupt mixed-language lines on this branch.
- The deal-detail link in the deals table is a plain `<a href>`
  rather than a typed `<Link>` because worker 1's deals route
  isn't registered in `FileRoutesByPath` yet. This is a deliberate
  chicken-and-egg escape hatch — once worker 1 lands, the
  orchestrator can swap it for a typed Link in a one-line follow-up
  commit.

## Verification commands
```bash
npm --prefix web-modern run typecheck
npm --prefix web-modern test -- --run
```
