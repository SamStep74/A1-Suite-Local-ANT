# phase8-tube — orchestration

Tube SPA port from `ant/wip/phase8-healthcheck` (server + Zod schemas + 3
agents) into the modern web SPA at `/app/crm-tube/*`.

## Layout

- `plan.json` — top-level orchestration config the launcher reads
- `merge-order.md` — orchestrator's runbook for merging the 3 worker branches
- `tube-deals-board/` — worker 1: `/app/crm-tube` index (kanban) + `/app/crm-tube/deals/$dealId` detail + AI Action Panel
- `tube-contacts/` — worker 2: `/app/crm-tube/contacts` list + `$contactId` detail + `/app/crm-tube/inbox`
- `tube-sequences/` — worker 3: `/app/crm-tube/sequences` list + `$sequenceId` builder + `/app/crm-tube/integrations` health view

## Base ref

`ant/wip/phase8-healthcheck` — carries the Tube port (`server/crmTube.js`,
14 routes in `server/app.js`, 14 `tube_*` tables, 35 connector tests, 6
contract tests), the 7 Zod shapes appended to
`web-modern/src/lib/api/schemas.ts`, and the 3 tube agents + 16 tests under
`web-modern/src/lib/agents/tube/`.

## Final tag

`phase8-tube-v1` — pushed to `ant` after the third worker merges to `ant/main`.

## Worktrees (created by the launcher)

- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-deals-board`
- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-contacts`
- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-sequences`

## Merge order

1. `tube-deals-board` — the index page (the other 2 link into it).
2. `tube-contacts`.
3. `tube-sequences`.

## What's OUT of scope for Phase 8.13

- Real LLM calls in agents (V1 is pure functions).
- Drag-and-drop on the kanban.
- Sequence step editing UI (the steps shape is opaque; just render `Step N` cards).
- Webhook receiver UI.
- Multi-tenant org resolution.
