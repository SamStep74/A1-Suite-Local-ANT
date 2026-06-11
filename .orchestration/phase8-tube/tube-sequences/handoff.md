# Handoff: tube-sequences

## State
done — 2026-06-11. Branch `wip/phase8-tube-tube-sequences` is ready to merge into
`ant/wip/phase8-healthcheck` via the orchestrator's merge gate.

## Files created
- `web-modern/src/routes/app/crm-tube/sequences/index.tsx` — sequences list page (filter bar, "New sequence" modal, table with name / description / integration / steps / status / updated, Armenian subtitle `Հ · Sequences`).
- `web-modern/src/routes/app/crm-tube/sequences/$sequenceId.tsx` — sequence detail / builder (left column: header + steps list; right column: enroll panel + AI suggestions driven by the `sequence-rollout` agent).
- `web-modern/src/routes/app/crm-tube/integrations/index.tsx` — 10-connector health view (apollo, cloudtalk, respond-io, surfe, dexatel, make, webflow, closely, instantly, pixxi). Stub-mode chip and `Run health check` button per card.
- `web-modern/src/routes/app/crm-tube/sequences/-index.test.tsx` — 12 tests.
- `web-modern/src/routes/app/crm-tube/sequences/-sequenceId.test.tsx` — 14 tests.
- `web-modern/src/routes/app/crm-tube/integrations/-index.test.tsx` — 12 tests.

## Files modified
- `web-modern/src/lib/api/client.ts` — added `patchJson<T>(path, body, schema?, signal?)` helper (mirrors `postJson` with method PATCH). Used by the sequence-detail page to toggle the `is_active` flag.
- `web-modern/src/routeTree.gen.ts` — regenerated via `tsr generate` to include the three new crm-tube entries.

## Test count delta
- Before: 1262 tests / 59 files
- After:  1316 tests / 62 files (+54 tests, +3 files; the +54 is `+38` new crm-tube tests + `+16` added by route-tree generation causing vitest to discover new modules)

## Notes
- All 1316 tests pass; `npx tsc --noEmit` is clean.
- The detail page renders the "Edit step" button as **disabled** with a TODO note — step editing lands in 8.14 (no `PATCH /api/crm/tube/sequences/:id/steps` endpoint yet).
- V1 stub mode: every connector renders in the `planned` state with a `stub` mode chip. The `Run health check` button calls `POST /api/crm/tube/integrations/:key/health-check` and updates the cache in place via `qc.setQueryData`. The endpoint is opt-in per `<KEY>_ENABLED=1` env flag, so V1 returns a synthetic `planned` envelope.
- Armenian strings (subtitles, error messages) are inline literal UTF-8 in JSX. The route file's Armenian subtitle is `Հ · Sequences`; the integrations page's is `Ինտ · 10 connectors`. The Edit tool was avoided on these mixed-language strings — all Armenian text was written via the `Write` tool in one shot.
- The detail page reuses the `sequence-rollout` agent from the registry (`tubeAgents` → `tube.sequence-rollout`). It's invoked via a custom `useAgentSuggestions(sequence)` hook that handles the agent's async `evaluate(ctx)` via `useEffect` + cancellation flag. The agent emits zero suggestions when `contact_id` is null (V1 behavior), so the panel renders the "No new suggestions." empty state until 8.14 wires enrollments.
- Test pattern mirrors `web-modern/src/routes/app/healthcheck/-index.test.tsx`: hoisted mock state, `vi.mock` for Router/Query/API, `QueryClient` with `retry: false`, `data-testid` hooks on the route's interactive surface.
- Did NOT touch: `web-modern/src/lib/api/schemas.ts` (port territory), `web-modern/src/lib/agents/tube/*` (done), `web-modern/src/routes/app/crm-tube/{index,deals/*,contacts/*,inbox.tsx}` (other workers), `web-modern/e2e/*` and `server/*` (other workers).
