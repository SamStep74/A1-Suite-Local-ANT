# Worker Task: tube-sequences
- Session: `phase8-tube`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/wip/phase8-healthcheck` (carries the Tube port + Zod schemas + 3 agents)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-sequences`
- Branch: `wip/phase8-tube-tube-sequences`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase8-tube/tube-sequences/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase8-tube/tube-sequences/handoff.md`
- Tag to ship: `phase8-tube-v1` (orchestrator pushes the final tag after all 3 workers merge)

## Seeded Local Overlays (read these first)
- `web-modern/src/lib/api/schemas.ts` — 7 Tube shapes appended (TubeSequenceSchema, TubeSequenceDetailSchema, TubeIntegrationSchema, etc.).
- `web-modern/src/lib/agents/types.ts` — AgentContext extended with `tube.sequence` / `tube.integration`.
- `web-modern/src/lib/agents/tube/` — 3 agents (deal-health, enrich-opportunity, sequence-rollout) + registry. 16/16 tests green.
- `web-modern/src/lib/apps.ts` — `crm-tube` in APP_IDS.
- `web-modern/src/routes/app/crm/index.tsx` — Pattern A reference.
- `web-modern/src/routes/app/inventory/index.tsx` — secondary reference.
- `web-modern/src/routes/app/healthcheck/index.tsx` + `-index.test.tsx` — the test pattern.
- `server/crmTube.js` — pure engine.
- `server/crmTube/connectors/registry.js` — 10 connectors (apollo, cloudtalk, respond-io, surfe, dexatel, make, webflow, closely, instantly, pixxi) with stub/real adapter factory. **The stub mode is the V1 default.**
- `server/app.js` — routes include `GET /api/crm/tube/sequences`, `GET /api/crm/tube/sequences/:id`, `POST /api/crm/tube/sequences`, `PATCH /api/crm/tube/sequences/:id`, `DELETE /api/crm/tube/sequences/:id`, `POST /api/crm/tube/sequences/enroll`, `GET /api/crm/tube/integrations`, `POST /api/crm/tube/integrations/:key/health-check`.
- `docs/phase8-tube/design.md` — shared contract.

## Objective

You are the **sequences + connectors** worker for Phase 8.13. Goal: build the
sequences list page, the sequence detail (builder) page, and the integrations
health view in `/app/crm-tube/...` plus co-located vitest tests. Working in a
clean git worktree branched off `ant/wip/phase8-healthcheck`.

The 3 worker tasks split the SPA surface like this:

- **Worker 1 — deals board (lands first):** `/app/crm-tube` index + `/app/crm-tube/deals/$dealId` detail + AI Action Panel.
- **Worker 2 — contacts (lands second):** `/app/crm-tube/contacts` list + `/app/crm-tube/contacts/$contactId` detail + `/app/crm-tube/inbox`.
- **Worker 3 — sequences + connectors (YOU, lands last):** `/app/crm-tube/sequences` list + `/app/crm-tube/sequences/$sequenceId` builder + `/app/crm-tube/integrations` health view.

Each worker ships independently. **Worker 1 and 2 land before you**, so the
`DecisionCard` component worker 1 built and the deal/contact routes worker 1/2
shipped should already be in your worktree at merge time. **Do not modify
their files.** Your deliverables are entirely under
`web-modern/src/routes/app/crm-tube/sequences/` and
`web-modern/src/routes/app/crm-tube/integrations/`.

## Setup (do these FIRST, in order)

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-sequences`
2. `git status` — verify you are on `wip/phase8-tube-tube-sequences` branched from `ant/wip/phase8-healthcheck`.
3. `npm --prefix web-modern install` (first install in this worktree, 2-3 min).
4. `npm --prefix web-modern test` to confirm the existing 59+ test files all pass.

## Scope — THREE deliverables

### Deliverable 1: `web-modern/src/routes/app/crm-tube/sequences/index.tsx` (the sequences list)

Mirror the **shape** of `web-modern/src/routes/app/campaigns/index.tsx` if
it exists; otherwise mirror `inventory/index.tsx`.

Required surface:

- **Page header**: English title `Sequences` + Armenian subtitle `Հ · Sequences`. Small `Mail` icon.
- **Filter bar**: a single toggle `Active only` (default on) — filters the list to `is_active === true` when on.
- **Table** with columns: `Name` (linked to detail), `Description` (muted, truncated), `Integration` (the connector key or `—`), `Steps` (count), `Status` (active/paused pill), `Updated` (relative time).
- Each row is clickable → navigates to `/app/crm-tube/sequences/$sequenceId`.
- **"+ New sequence" button** in the top right. Opens a modal/inline form with: name (required), description (optional), integration (select from the 10 connector keys), `is_active` (default true). On submit, posts to `POST /api/crm/tube/sequences` with `{ name, description?, integrationKey?, isActive, idempotencyKey: \`tube-seq-\${Date.now()}\` }`.
- **Loading + error states**: standard `data-testid="tube-sequences"`, `data-entity="tube-sequences-list"`, error uses `role="alert"`.
- **A "Back to today" link** to `/app`.

Use:
- The schemas (`TubeSequenceSchema`, `TubeListResponseSchema`).
- `getJson` / `postJson` from `web-modern/src/lib/api/client.ts`.
- TanStack Query `useQuery` (list) and `useMutation` (create).

### Deliverable 2: `web-modern/src/routes/app/crm-tube/sequences/$sequenceId.tsx` (the sequence builder)

Mirror the **shape** of `web-modern/src/routes/app/campaigns/$campaignId.tsx` if
it exists; otherwise `inventory/$itemId.tsx`.

Required surface:

- **Detail column (left, ~70%)**:
  - Sequence name (H1) + active/paused pill.
  - Description.
  - Integration chip (the connector key, e.g. `instantly` or `—`).
  - **Steps list**: a vertical list of the sequence's steps. For V1, each step is just a card showing `Step N · <action>` (the API returns `steps: z.array(z.unknown())` per `TubeSequenceDetailSchema`, so you may need to defensively type the steps and render whatever shape the engine returns). If the shape is unknown, render `Step ${i+1}` + an "Edit step" button (disabled with a TODO comment).
  - **Pause / Resume button** in the top right: toggles `is_active`. PATCH `/api/crm/tube/sequences/:id` with `{ isActive: !current, idempotencyKey: \`tube-seq-pause-\${Date.now()}\` }`.
- **Enroll side panel (right, ~30%)**:
  - Title `Enroll a contact`.
  - A contact picker (text input + autocomplete from `GET /api/crm/tube/contacts?limit=10`).
  - An `Enroll` button. On click, `POST /api/crm/tube/sequences/enroll` with `{ sequenceId, contactIds: [contactId], idempotencyKey: \`tube-enroll-\${Date.now()}\` }`. Show a success toast or alert.
  - **AI Action Panel** below the enroll form: the `sequence-rollout` agent evaluates `{ type: "tube.sequence", id: sequenceId, data: { sequence, enrollments } }` and renders the returned suggestions as `DecisionCard` rows. (The `DecisionCard` component should already exist from worker 1 — `web-modern/src/components/decision-card/DecisionCard.tsx`. If it doesn't, build a minimal local one.)
- **Back link** to `/app/crm-tube/sequences`.

### Deliverable 3: `web-modern/src/routes/app/crm-tube/integrations/index.tsx` (the integrations health view)

Required surface:

- **Page header**: English title `Integrations` + Armenian subtitle `Ինտ · 10 connectors`. Small `Plug` icon.
- **Grid of 10 connector cards** (3-4 columns on desktop, 1 column on mobile). Each card shows:
  - Connector display name (Armenian + English subtitle).
  - Status pill: `planned` (gray), `connected` (green), `paused` (yellow), `error` (red). The V1 default for all 10 is `planned` because the stub mode keeps outbound OFF.
  - Last health status (e.g. `OK · 12ms`) and last health at (`Mmm dd HH:mm`) — both `—` until first health check.
  - **"Run health check"** button. On click, posts to `POST /api/crm/tube/integrations/:key/health-check`. The response updates the card in place.
  - Mode chip: `stub` (default) or `real` (shown only if `<KEY>_ENABLED=1` is set in the env — and it's NOT set in V1, so every card should show `stub`).
- **Loading + error states**: standard `data-testid="tube-integrations"`, `data-entity="tube-integrations-grid"`, error uses `role="alert"`.
- **A "Back to today" link** to `/app`.

## Deliverable 4: Co-located tests

Create:
- `web-modern/src/routes/app/crm-tube/sequences/-index.test.tsx`
- `web-modern/src/routes/app/crm-tube/sequences/-sequenceId.test.tsx`
- `web-modern/src/routes/app/crm-tube/integrations/-index.test.tsx`

Required test minimums:

**Sequences list**:
1. Renders H1 `Sequences`, Armenian subtitle contains `Հ`.
2. Empty state: `{ sequences: [] }` → renders empty message.
3. Populated: 3 sequences → renders 3 rows.
4. `Active only` toggle off → renders ALL sequences including the paused one.
5. New sequence form: fill name + submit → `postJson` called with `/api/crm/tube/sequences` and the right body.
6. New sequence error: `postJson` rejects → `role="alert"`.

**Sequence detail**:
1. Renders the sequence name (H1) + active/paused pill.
2. Renders the steps list.
3. Pause/Resume button click → `patchJson` called with the right path + body.
4. Enroll form: type a contact name, click Enroll → `postJson` called with `/api/crm/tube/sequences/enroll`.
5. Back link points to `/app/crm-tube/sequences`.

**Integrations**:
1. Renders H1 `Integrations`, Armenian subtitle contains `Ինտ`.
2. Renders 10 connector cards.
3. Each card shows the `stub` mode chip.
4. Click `Run health check` on the Apollo card → `postJson` called with `/api/crm/tube/integrations/apollo/health-check`.
5. After health check, the card updates to show the new status (mock the response).

Use the same mock pattern as healthcheck:
- `vi.mock("@tanstack/react-router", ...)` — mock `createFileRoute`, `Link`, `useNavigate`.
- `vi.mock("../../../lib/api/client", ...)` — mock `getJson` / `postJson` / `patchJson`.
- `QueryClient` from `@tanstack/react-query` with `retry: false`.
- `@testing-library/react` for `render`, `fireEvent`, `screen`, `waitFor`.
- Mock the agents with `vi.mock("../../../lib/agents/tube/registry", ...)`.

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-sequences`
2. Read references: `crm/index.tsx`, `inventory/index.tsx`, `healthcheck/-index.test.tsx` end-to-end.
3. Verify the seeded deliverables are in your worktree:
   - `grep -n "TubeSequenceSchema\|TubeIntegrationSchema" web-modern/src/lib/api/schemas.ts` should return matches.
   - `ls server/crmTube/connectors/registry.js` should exist.
4. Create the 3 route files. Iterate on `npm --prefix web-modern run typecheck` until clean.
5. Create the 3 test files. Iterate on `npm --prefix web-modern test -- web-modern/src/routes/app/crm-tube/` until green.
6. Run the full suite: `npm --prefix web-modern test` — must be 0 failures.
7. Regenerate the route tree: `cd web-modern && npx tsr generate`. If it fails, hand-edit `routeTree.gen.ts` — add entries for `/app/crm-tube/sequences/`, `/app/crm-tube/sequences/$sequenceId/`, `/app/crm-tube/integrations/` mirroring the existing inventory entries.
8. Commit: `git add -A && git commit -m "feat(tube): sequences + builder + integrations health (Phase 8.13)"`.

## Final steps

1. `npm --prefix web-modern test` — confirm green.
2. `npm --prefix web-modern run typecheck` — clean.
3. Push the branch (do NOT push to main): `git push -u ant wip/phase8-tube-tube-sequences`.
4. Write a handoff to `.orchestration/phase8-tube/tube-sequences/handoff.md` with:
   - Test count delta (X → Y tests).
   - Files created (list with paths + 1-line description each).
   - Whether `npx tsr generate` worked or you hand-edited.
   - Any gap in the server API you discovered (e.g. "POST /api/crm/tube/sequences/:id/steps doesn't exist — step editing is deferred to 8.14").
   - Confirmation that all 10 connectors are visible in the grid.
5. Mark the status file as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** `web-modern/src/lib/api/schemas.ts` — that's the port's territory.
- **Do NOT touch** `web-modern/src/lib/agents/tube/*` — those are done.
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/index.tsx` or `deals/*` — that's worker 1.
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/contacts/*` or `inbox.tsx` — that's worker 2.
- **Do NOT touch** `web-modern/e2e/*` or `server/*` or `web/*` or `server/crmTube/connectors/registry.js` (the registry is done).
- **Do NOT push to `ant/main`** — the orchestrator merges.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents — do it inline.
- The 59+ existing test files MUST still pass.
- The Edit tool has been seen to corrupt Armenian text on mixed-language files. **For Armenian strings, use the heredoc + python byte-level replacement workaround.** Test the file after each Armenian edit by reading it back.
- Report results in your final response. The launcher captures that response automatically.
