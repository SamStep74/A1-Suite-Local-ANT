# Worker Task: tube-deals-board
- Session: `phase8-tube`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/wip/phase8-healthcheck` (carries the Tube port + Zod schemas + 3 agents)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-deals-board`
- Branch: `wip/phase8-tube-tube-deals-board`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase8-tube/tube-deals-board/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase8-tube/tube-deals-board/handoff.md`
- Tag to ship: `phase8-tube-v1` (orchestrator pushes the final tag after all 3 workers merge)

## Seeded Local Overlays (read these first)
- `web-modern/src/lib/api/schemas.ts` — has the 7 Tube shapes appended (TubeTubeSchema, TubeStageSchema, TubeDealSchema, TubeContactSchema, TubeSequenceSchema, TubeSequenceDetailSchema, TubeIntegrationSchema, TubeInboxItemSchema, TubeListResponseSchema).
- `web-modern/src/lib/agents/types.ts` — AgentContext + AgentSuggestion extended with `tube.deal` / `tube.contact` / `tube.sequence` / `tube.integration`.
- `web-modern/src/lib/agents/tube/` — 3 agents (deal-health, enrich-opportunity, sequence-rollout) + registry. 16/16 tests green.
- `web-modern/src/lib/apps.ts` — `crm-tube` in APP_IDS (Armenian Խողող, violet accent, RadioTower icon, `legacyMountId: "suite-app-crm-tube"`).
- `web-modern/src/routes/app/crm/index.tsx` — Pattern A reference route. Read it line by line.
- `web-modern/src/routes/app/inventory/index.tsx` — secondary reference (uses kanban-style stages).
- `web-modern/src/routes/app/healthcheck/index.tsx` + `-index.test.tsx` — the test pattern.
- `server/crmTube.js` — pure engine, has the data shape contract.
- `server/app.js` — 14 routes under `/api/crm/tube/*` already wired.
- `docs/phase8-tube/design.md` — shared contract.
- `test/crmTube.test.js` — 6/6 server contract tests (the SPA's job is to consume what these tests already prove).

## Objective

You are the **deals board** worker for Phase 8.13. Goal: build the Pattern A
route at `/app/crm-tube` — the kanban deals board, the deal detail page, the
AI Action Panel with the 3 tube agents — plus co-located vitest tests. Working
in a clean git worktree branched off `ant/wip/phase8-healthcheck`.

The 3 worker tasks (this is worker 1 of 3) split the SPA surface like this:

- **Worker 1 — deals board (YOU):** `/app/crm-tube` index (the kanban) + `/app/crm-tube/deals/$dealId` detail + AI Action Panel for the 3 tube agents.
- **Worker 2 — contacts:** `/app/crm-tube/contacts` list + `/app/crm-tube/contacts/$contactId` detail + inbox view.
- **Worker 3 — sequences + connectors:** `/app/crm-tube/sequences` list + `/app/crm-tube/sequences/$sequenceId` builder + `/app/crm-tube/integrations` health view.

Each worker ships independently. **The other 2 worktrees will land AFTER
yours.** Your route may `Link` to `/app/crm-tube/contacts/...` and
`/app/crm-tube/sequences/...` — the links will 404 in main until worker 2/3
merge, but that's expected. Do not stub the destination pages.

## Setup (do these FIRST, in order)

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-deals-board`
2. `git status` — verify you are on `wip/phase8-tube-tube-deals-board` branched from `ant/wip/phase8-healthcheck`.
3. `npm --prefix web-modern install` (first install in this worktree, 2-3 min; package-lock.json is present).
4. `npm --prefix web-modern test` to confirm the existing 59 test files all pass (including the 3 new tube agent tests).

## Scope — THREE deliverables

### Deliverable 1: `web-modern/src/routes/app/crm-tube/index.tsx` (the kanban deals board)

Mirror the **shape** of `web-modern/src/routes/app/crm/index.tsx` and the
**structure** of `web-modern/src/routes/app/inventory/index.tsx` (which has
kanban-style stage columns).

Required surface (Phase 8.13 — *minimal but real*):

- **Page header**: English title `Tube` + Armenian subtitle `Խողող · Deals pipeline`. Small `RadioTower` icon.
- **Tube tabs (small)**: a horizontal tab strip at the top that switches between the 2 seeded tubes (`Standard Sales` + `Inbound`). Use `useState` for tab selection; default to the first tube.
- **Kanban board** for the selected tube:
  - 1 column per stage (the stages come from `GET /api/crm/tube/tubes/:id` which returns `tube.stages[]`).
  - Each column shows stage name + a small `probability%` chip.
  - Each deal is a card: title, value (formatted as `1,250,000 AMD`), contact name (if any), `expected_close_at` (muted, in `Mmm dd`).
  - Click a card → navigates to `/app/crm-tube/deals/$dealId`.
  - **Drag and drop is OUT of scope for V1.** Cards are click-only.
- **"+ New deal" mini-button** in the top right of the board. Opens a
  modal/inline form (pick whichever is simpler) that posts to
  `POST /api/crm/tube/deals` with `{ title, value, currency: "AMD", stage_id, contact_id?, idempotencyKey: \`tube-deal-\${Date.now()}\` }`.
- **Loading + error states**: same shape as crm/index.tsx — `data-testid="tube-board"`, `data-entity="tube-list"`, error uses `role="alert"`.
- **A "Back to today" link** to `/app` (like healthcheck).

The route should use **only**:
- The schemas from `web-modern/src/lib/api/schemas.ts` (TubeTubeSchema, TubeStageSchema, TubeDealSchema, TubeListResponseSchema).
- `getJson` / `postJson` from `web-modern/src/lib/api/client.ts`.
- TanStack Query `useQuery` (list) and `useMutation` (create deal).
- TanStack Router `createFileRoute` + `Link`.
- The `tubeAgents` registry from `web-modern/src/lib/agents/tube/registry.ts` (read-only — wire them in Deliverable 3).

**Forbidden**:
- Do not import anything from `web/src/*` (the legacy SPA).
- Do not call `/api/crm/tube/sequences/enroll` or `/api/crm/tube/contacts/enrich` — those are worker 2/3's surface.

### Deliverable 2: `web-modern/src/routes/app/crm-tube/deals/$dealId.tsx` (the deal detail page)

Mirror the **shape** of `web-modern/src/routes/app/inventory/$itemId.tsx`
(which has a 2-column layout: detail on the left, AI action panel on the right).

Required surface:

- **Detail column (left, ~70%)**:
  - Deal title + value + status pill (`open` / `won` / `lost`).
  - Stage badge (colored chip from the stage's `color` field).
  - Contact name (linked to `/app/crm-tube/contacts/$contactId` if exists).
  - Organization name.
  - Expected close date.
  - Activities timeline — fetch from `GET /api/crm/tube/activities?deal_id=$dealId` and render newest-first. Each row: `Mmm dd HH:mm` + a short note.
- **AI Action Panel (right, ~30%)**:
  - For each agent in `tubeAgents` whose `triggers` contains `"tube.deal"`:
    - Call `agent.evaluate(ctx)` where `ctx = { type: "tube.deal", id: dealId, data: { deal, activities, contact } }` (only the contact's `id` and `status` are needed for the 3 agents).
    - Render the returned suggestions as `DecisionCard` rows.
  - **Use the existing `DecisionCard` component** from `web-modern/src/components/decision-card/` (or wherever it lives — find it via `grep -r "export.*DecisionCard" web-modern/src/`). If a `DecisionCard` doesn't exist, build a minimal inline `<DecisionCard title={...} rationale={...} onApprove={...} />` and put it in a new file `web-modern/src/components/decision-card/DecisionCard.tsx`.
  - The onApprove handler calls `postJson(suggestion.proposedAction.path, suggestion.proposedAction.body, <appropriate response schema>)`. The mutation must invalidate the deal query (so the page refreshes).
- **Loading + error states**: same as the index.
- **Back link** to `/app/crm-tube`.

### Deliverable 3: `web-modern/src/routes/app/crm-tube/-index.test.tsx` (co-located route test)

Mirror the **structure** of `web-modern/src/routes/app/healthcheck/-index.test.tsx`. Required tests (minimum):

1. Renders the page shell — H1 `Tube`, Armenian subtitle contains `Խող` (or any Armenian substring).
2. Empty state: `getJson` resolves to `{ tubes: [{ stages: [], deals: [] }] }` → renders an empty-board message.
3. Populated state: 1 tube, 3 stages, 2 deals in different stages → renders 2 deal cards.
4. Tab switch: click the second tube tab → calls `GET /api/crm/tube/tubes/<id2>` and shows its stages.
5. New deal form: fill title + value + submit → `postJson` called with `/api/crm/tube/deals` and the right body.
6. New deal error: `postJson` rejects → `role="alert"` message renders.
7. Deal card click: clicking a card navigates (mock the router's `useNavigate`).
8. AI Action Panel on detail: deal detail page with 1 activity older than 14 days → renders at least 1 Decision Card with the deal-health agent's title.

For the detail test, also create `web-modern/src/routes/app/crm-tube/deals/-dealId.test.tsx` (mirror `web-modern/src/routes/app/inventory/-itemId.test.tsx`).

Use the **same mock pattern** as healthcheck:
- `vi.mock("@tanstack/react-router", ...)` — mock `createFileRoute`, `Link`, `useNavigate`.
- `vi.mock("../../../lib/api/client", ...)` — mock `getJson` / `postJson`.
- `QueryClient` from `@tanstack/react-query` with `retry: false`.
- `@testing-library/react` for `render`, `fireEvent`, `screen`, `waitFor`.
- Mock the 3 tube agents with `vi.mock("../../../lib/agents/tube/registry", ...)` so the test is deterministic.

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-deals-board`
2. Read the references: `crm/index.tsx`, `inventory/index.tsx`, `healthcheck/index.tsx`, `healthcheck/-index.test.tsx`, `inventory/-itemId.test.tsx` end-to-end.
3. Verify the seeded deliverables are in your worktree:
   - `grep -n "TubeTubeSchema\|TubeDealSchema" web-modern/src/lib/api/schemas.ts` should return matches.
   - `ls web-modern/src/lib/agents/tube/` should show the 3 agent files + registry + 3 test files.
   - If either is missing, **stop and write to handoff** that the base branch is wrong.
4. Create `web-modern/src/routes/app/crm-tube/index.tsx`. Iterate on `npm --prefix web-modern run typecheck` until clean.
5. Create `web-modern/src/routes/app/crm-tube/deals/$dealId.tsx`. Iterate on typecheck.
6. Create `web-modern/src/routes/app/crm-tube/-index.test.tsx` and `deals/-dealId.test.tsx`. Iterate on `npm --prefix web-modern test -- web-modern/src/routes/app/crm-tube/` until green.
7. Run the full suite: `npm --prefix web-modern test` — must be 0 failures.
8. Regenerate the route tree: `cd web-modern && npx tsr generate`. If `npx tsr generate` fails, edit `routeTree.gen.ts` directly — add entries for `/app/crm-tube/` and `/app/crm-tube/deals/$dealId/` mirroring the existing `/app/inventory/` entries. Commit the regenerated file.
9. Commit: `git add -A && git commit -m "feat(tube): kanban deals board + detail + AI action panel (Phase 8.13)"`.

## Final steps

1. `npm --prefix web-modern test` — confirm green.
2. `npm --prefix web-modern run typecheck` — clean.
3. Push the branch (do NOT push to main): `git push -u ant wip/phase8-tube-tube-deals-board`.
4. Write a handoff to `.orchestration/phase8-tube/tube-deals-board/handoff.md` with:
   - Test count delta (X → Y tests).
   - Files created (list with paths + 1-line description each).
   - Mock pattern used (if different from healthcheck).
   - Whether `npx tsr generate` worked or you had to hand-edit `routeTree.gen.ts`.
   - Anything worker 2/3 should know (e.g. "the DecisionCard lives at /components/decision-card/DecisionCard.tsx; reuse it").
5. Mark the status file as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** `web-modern/src/lib/api/schemas.ts` — that's the port's territory. If you find a schema gap, write to the handoff and stop.
- **Do NOT touch** `web-modern/src/lib/agents/tube/*` — those are done.
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/contacts/*` or `web-modern/src/routes/app/crm-tube/sequences/*` or `web-modern/src/routes/app/crm-tube/integrations/*` — that's worker 2/3.
- **Do NOT touch** `web-modern/e2e/*` or `server/*` or `web/*`.
- **Do NOT push to `ant/main`** — the orchestrator merges.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents — do it inline.
- The 59+ existing test files on `wip/phase8-healthcheck` MUST still pass.
- The Edit tool has been seen to corrupt Armenian text on mixed-language files. **For Armenian strings, use the heredoc + python byte-level replacement workaround** (write the file with `__ARMENIAN_TEXT__` placeholder, then `python3 -c "..."`). Test the file after each Armenian edit by reading it back.
- Report results in your final response. The launcher captures that response automatically.
