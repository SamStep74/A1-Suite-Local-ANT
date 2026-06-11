# Worker Task: tube-contacts
- Session: `phase8-tube`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/wip/phase8-healthcheck` (carries the Tube port + Zod schemas + 3 agents)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-contacts`
- Branch: `wip/phase8-tube-tube-contacts`
- Launcher status file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase8-tube/tube-contacts/status.md`
- Launcher handoff file: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase8-tube/tube-contacts/handoff.md`
- Tag to ship: `phase8-tube-v1` (orchestrator pushes the final tag after all 3 workers merge)

## Seeded Local Overlays (read these first)
- `web-modern/src/lib/api/schemas.ts` — 7 Tube shapes appended (TubeContactSchema, TubeInboxItemSchema, TubeListResponseSchema, etc.).
- `web-modern/src/lib/agents/types.ts` — AgentContext extended with `tube.contact` / `tube.integration`.
- `web-modern/src/lib/agents/tube/` — 3 agents (deal-health, enrich-opportunity, sequence-rollout) + registry. 16/16 tests green.
- `web-modern/src/lib/apps.ts` — `crm-tube` in APP_IDS.
- `web-modern/src/routes/app/crm/index.tsx` — Pattern A reference.
- `web-modern/src/routes/app/inventory/index.tsx` — secondary reference (uses tables with action buttons).
- `web-modern/src/routes/app/healthcheck/index.tsx` + `-index.test.tsx` — the test pattern.
- `server/crmTube.js` — pure engine, has the data shape contract.
- `server/app.js` — 14 routes under `/api/crm/tube/*` already wired (the routes you'll consume are `GET /api/crm/tube/contacts`, `GET /api/crm/tube/contacts/:id`, `GET /api/crm/tube/activities?deal_id=...`, `GET /api/crm/tube/conversations`, `POST /api/crm/tube/contacts/enrich`).
- `docs/phase8-tube/design.md` — shared contract.

## Objective

You are the **contacts** worker for Phase 8.13. Goal: build the contacts list
page, the contact detail page, and the inbox view in `/app/crm-tube/...` plus
co-located vitest tests. Working in a clean git worktree branched off
`ant/wip/phase8-healthcheck`.

The 3 worker tasks split the SPA surface like this:

- **Worker 1 — deals board (lands first):** `/app/crm-tube` index + `/app/crm-tube/deals/$dealId` detail + AI Action Panel.
- **Worker 2 — contacts (YOU):** `/app/crm-tube/contacts` list + `/app/crm-tube/contacts/$contactId` detail + `/app/crm-tube/inbox`.
- **Worker 3 — sequences + connectors:** `/app/crm-tube/sequences` list + `/app/crm-tube/sequences/$sequenceId` builder + `/app/crm-tube/integrations` health view.

Each worker ships independently. **Worker 1 (deals) lands before you, so
worker 1's `web-modern/src/components/decision-card/DecisionCard.tsx` may
already exist when you start.** Check for it first; if it does, reuse it for
the contact-detail AI Action Panel. If not, build a minimal inline version
locally and worker 1 will pick it up at merge time.

## Setup (do these FIRST, in order)

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-contacts`
2. `git status` — verify you are on `wip/phase8-tube-tube-contacts` branched from `ant/wip/phase8-healthcheck`.
3. `npm --prefix web-modern install` (first install in this worktree, 2-3 min).
4. `npm --prefix web-modern test` to confirm the existing 59+ test files all pass.
5. Check whether `web-modern/src/components/decision-card/DecisionCard.tsx` exists (worker 1 may have shipped it). If yes, reuse. If no, build a minimal local one.

## Scope — THREE deliverables

### Deliverable 1: `web-modern/src/routes/app/crm-tube/contacts/index.tsx` (the contacts list)

Mirror the **shape** of `web-modern/src/routes/app/inventory/index.tsx` (table
with row actions).

Required surface:

- **Page header**: English title `Contacts` + Armenian subtitle `Կոնտակտներ · Tube`. Small `Users` icon.
- **Search bar**: a text input (Armenian placeholder: `Փնտրել (search name/email)`). Filters client-side on `full_name`, `email`, `organization_name`.
- **Filter chips**: a row of status pills above the table — `new`, `enriched`, `contacted`, `qualified`, `unqualified`, `rejected`. Click toggles the filter (multi-select).
- **Table** with columns: `Name`, `Email`, `Organization`, `Status` (colored pill), `Lead score` (0-100 number, muted if null), `Updated` (relative time, e.g. `2 days ago`).
- Each row is clickable → navigates to `/app/crm-tube/contacts/$contactId`.
- **Bulk enrich button** in the top right: a primary button labelled `Enrich selected`. Disabled when 0 rows are selected. On click, calls `POST /api/crm/tube/contacts/enrich` with `{ contactIds: [...selected], idempotencyKey: \`tube-enrich-\${Date.now()}\` }`. Show a success toast or alert on success.
- **Loading + error states**: same shape as inventory/index.tsx — `data-testid="tube-contacts"`, `data-entity="tube-contacts-list"`, error uses `role="alert"`.
- **A "Back to today" link** to `/app`.

Use:
- The schemas (`TubeContactSchema`, `TubeListResponseSchema`).
- `getJson` / `postJson` from `web-modern/src/lib/api/client.ts`.
- TanStack Query `useQuery` (list) and `useMutation` (enrich).

### Deliverable 2: `web-modern/src/routes/app/crm-tube/contacts/$contactId.tsx` (the contact detail)

Mirror `web-modern/src/routes/app/inventory/$itemId.tsx` (2-column: detail
left, AI panel right).

Required surface:

- **Detail column (left, ~70%)**:
  - Full name (large H1) + status pill + lead score.
  - Email (linked, `mailto:`).
  - Phone (linked, `tel:`).
  - Title + Organization name (linked to a placeholder `/app/crm-tube/organizations/$orgId` if org exists — the link will 404 in main until the org page is built; that's expected).
  - LinkedIn URL (linked, external).
  - **Deals list** at the bottom: a small table of deals where `contact_id = $contactId`. Each row: deal title, value, stage, status. Click → `/app/crm-tube/deals/$dealId` (deals worker owns that page; link is fine).
  - **Activities timeline** at the bottom: same shape as deal-detail activities.
- **AI Action Panel (right, ~30%)**:
  - For each agent in `tubeAgents` whose `triggers` contains `"tube.contact"`:
    - `agent.evaluate(ctx)` where `ctx = { type: "tube.contact", id: contactId, data: { contact, deal } }`.
    - Render returned suggestions as `DecisionCard` rows.
  - The onApprove handler calls the suggested action.
- **Back link** to `/app/crm-tube/contacts`.

### Deliverable 3: `web-modern/src/routes/app/crm-tube/inbox.tsx` (the inbox)

The inbox is the list of conversations + messages. Schema is `TubeInboxItemSchema`.

Required surface:

- **Page header**: English title `Inbox` + Armenian subtitle `Ն · Inbox`. Small `Inbox` icon.
- **List of conversations** (left column, ~40%): each row shows the contact name + last message preview + `Mmm dd HH:mm` + an unread badge (a violet dot if `unread_count > 0`).
- **Message thread (right column, ~60%)**: when a conversation is selected, show the messages newest-first. Each message: a small `Mmm dd HH:mm` header + body text + a channel chip (`email` / `sms` / `whatsapp` / `linkedin`).
- **Reply input** at the bottom: a textarea + a Send button. On submit, posts to `POST /api/crm/tube/conversations/:id/messages` with `{ body, idempotencyKey: \`tube-msg-\${Date.now()}\` }`. (If this endpoint doesn't exist, leave the reply input disabled with a `// TODO: POST /api/crm/tube/conversations/:id/messages not yet shipped` comment — the inbox is read-only for V1.)
- **Loading + error states** with the standard `data-testid` / `data-entity` convention.

## Deliverable 4: Co-located tests

Create:
- `web-modern/src/routes/app/crm-tube/contacts/-index.test.tsx` (mirror `inventory/-index.test.tsx`)
- `web-modern/src/routes/app/crm-tube/contacts/-contactId.test.tsx` (mirror `inventory/-itemId.test.tsx`)
- `web-modern/src/routes/app/crm-tube/-inbox.test.tsx`

Required test minimums:

**Contacts list**:
1. Renders H1 `Contacts`, Armenian subtitle contains `Կոնտակտ`.
2. Empty state: `{ contacts: [] }` → renders empty message.
3. Populated: 3 contacts → renders 3 rows.
4. Search filter: type "john" → only matching rows remain.
5. Status chip toggle: click "enriched" → only enriched contacts remain.
6. Bulk enrich button: select 2 rows + click → `postJson` called with the right path + 2 contactIds.
7. Bulk enrich disabled when 0 selected.
8. Bulk enrich error: `postJson` rejects → `role="alert"`.

**Contact detail**:
1. Renders the contact's name (H1), email, phone.
2. Renders the deals list when deals exist.
3. AI Action Panel renders DecisionCard(s) for the enrich-opportunity agent when `contact.status === "new"` and `deal.value > 100000`.
4. Back link points to `/app/crm-tube/contacts`.

**Inbox**:
1. Renders H1 `Inbox`, Armenian subtitle contains `Ն`.
2. Empty state: `{ items: [] }` → renders empty message.
3. Populated: 3 conversations → renders 3 rows; the unread one has a violet dot.
4. Click a conversation → shows the messages thread.
5. Reply input is disabled (V1).

Use the same mock pattern as healthcheck:
- `vi.mock("@tanstack/react-router", ...)` — mock `createFileRoute`, `Link`, `useNavigate`.
- `vi.mock("../../../lib/api/client", ...)` — mock `getJson` / `postJson`.
- `QueryClient` from `@tanstack/react-query` with `retry: false`.
- `@testing-library/react` for `render`, `fireEvent`, `screen`, `waitFor`.
- Mock the agents with `vi.mock("../../../lib/agents/tube/registry", ...)`.

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase8-tube-tube-contacts`
2. Read references: `crm/index.tsx`, `inventory/index.tsx`, `inventory/-itemId.test.tsx`, `healthcheck/-index.test.tsx` end-to-end.
3. Verify the seeded deliverables are in your worktree:
   - `grep -n "TubeContactSchema\|TubeInboxItemSchema" web-modern/src/lib/api/schemas.ts` should return matches.
   - `ls web-modern/src/lib/agents/tube/registry.ts` should exist.
4. Create the 3 route files. Iterate on `npm --prefix web-modern run typecheck` until clean.
5. Create the 3 test files. Iterate on `npm --prefix web-modern test -- web-modern/src/routes/app/crm-tube/` until green.
6. Run the full suite: `npm --prefix web-modern test` — must be 0 failures.
7. Regenerate the route tree: `cd web-modern && npx tsr generate`. If it fails, hand-edit `routeTree.gen.ts` — add entries for `/app/crm-tube/contacts/`, `/app/crm-tube/contacts/$contactId/`, `/app/crm-tube/inbox/` mirroring the existing inventory entries.
8. Commit: `git add -A && git commit -m "feat(tube): contacts list + detail + inbox (Phase 8.13)"`.

## Final steps

1. `npm --prefix web-modern test` — confirm green.
2. `npm --prefix web-modern run typecheck` — clean.
3. Push the branch (do NOT push to main): `git push -u ant wip/phase8-tube-tube-contacts`.
4. Write a handoff to `.orchestration/phase8-tube/tube-contacts/handoff.md` with:
   - Test count delta (X → Y tests).
   - Files created (list with paths + 1-line description each).
   - Whether `npx tsr generate` worked or you hand-edited.
   - Any gap in the server API you discovered (e.g. "POST /api/crm/tube/conversations/:id/messages doesn't exist — left reply input disabled").
5. Mark the status file as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** `web-modern/src/lib/api/schemas.ts` — that's the port's territory.
- **Do NOT touch** `web-modern/src/lib/agents/tube/*` — those are done.
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/index.tsx` or `deals/*` — that's worker 1.
- **Do NOT touch** `web-modern/src/routes/app/crm-tube/sequences/*` or `integrations/*` — that's worker 3.
- **Do NOT touch** `web-modern/e2e/*` or `server/*` or `web/*`.
- **Do NOT push to `ant/main`** — the orchestrator merges.
- **Do NOT push to `origin`** (if it exists) — only to `ant`.
- Do not spawn subagents — do it inline.
- The 59+ existing test files MUST still pass.
- The Edit tool has been seen to corrupt Armenian text on mixed-language files. **For Armenian strings, use the heredoc + python byte-level replacement workaround.** Test the file after each Armenian edit by reading it back.
- Report results in your final response. The launcher captures that response automatically.
