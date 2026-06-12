# Worker Task: phase10-smb-spa
- Session: `phase10-smb-crm-rebuild`
- Repo root: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT`
- Base branch: `ant/ant/main` (after foundation + records + assist + automations merged)
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-spa`
- Branch: `wip/phase10-smb-spa`
- Tag to ship: `phase10-smb-crm-v1`

## Contract

`/Users/samvelstepanyan/dev/A1-Suite-Local-ANT/.orchestration/phase10-smb-crm-rebuild/contract.md` — your Track 5 deliverables in §3 Track 5.

## Setup

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-spa`
2. `git fetch ant` to make sure you're at current `ant/ant/main`.
3. `npm --prefix web-modern install --legacy-peer-deps`
4. `npm --prefix web-modern test` to confirm baseline.

## Scope — NINE deliverables

### Deliverable 1: 8 SPA routes in `web-modern/src/routes/app/smb-crm/`

- `web-modern/src/routes/app/smb-crm/index.tsx` — the AI-onboarding questionnaire. 7-step form in HY/EN/RU, with the LiveLanguageSwitcher from Phase 10.3. On submit, `POST /api/smb-crm/generate-blueprint` then redirect to the blueprint viewer.
- `web-modern/src/routes/app/smb-crm/blueprint/$blueprintId.tsx` — the blueprint viewer (modules, stages, fields, opportunities, tasks). Includes an "Apply" button that calls `POST /api/smb-crm/blueprints/:id/apply`.
- `web-modern/src/routes/app/smb-crm/customers/index.tsx` — customer list with search + status filter + branch filter.
- `web-modern/src/routes/app/smb-crm/customers/$customerId.tsx` — customer detail with deals + tasks + activities + customer summary.
- `web-modern/src/routes/app/smb-crm/deals/index.tsx` — kanban deals board.
- `web-modern/src/routes/app/smb-crm/automations/index.tsx` — automation list + run log.
- `web-modern/src/routes/app/smb-crm/integrations/index.tsx` — integration health view.

Mirror the existing `web-modern/src/routes/app/crm-tube/*` (Tube SPA from Phase 8.13) for the Pattern A reference.

### Deliverable 2: 2 SPA widgets

- `web-modern/src/components/chat-widget/ChatWidget.tsx` — the chat widget (mirrors the legacy `chat-widget.js`).
- `web-modern/src/components/portal-access/PortalAccess.tsx` — the customer portal access view.

### Deliverable 3: App registration

- `web-modern/src/lib/apps.ts` — add `smb-crm` to APP_IDS (Armenian display name, violet accent, Building icon, `legacyMountId: "suite-app-smb-crm"`).
- `web/src/suite-routes.js` — add `smb-crm` to SUITE_APP_IDS.
- `web/src/main.jsx` — add `suite-app-smb-crm` dashboard anchor.

### Deliverable 4: Co-located tests (~5 SPA test files)

- `web-modern/src/routes/app/smb-crm/-index.test.tsx` — onboarding questionnaire
- `web-modern/src/routes/app/smb-crm/customers/-index.test.tsx` — customer list
- `web-modern/src/routes/app/smb-crm/customers/-customerId.test.tsx` — customer detail
- `web-modern/src/routes/app/smb-crm/deals/-index.test.tsx` — kanban deals
- `web-modern/src/routes/app/smb-crm/automations/-index.test.tsx` — automation list
- `web-modern/src/routes/app/smb-crm/integrations/-index.test.tsx` — integration health

Use the same mock pattern as the crm-tube / healthcheck / inventory tests.

## Tests — ~5 SPA test files (12+ tests per file = 60+ tests)

Required test minimums (1 per file is fine — they're entry tests):
- Onboarding: H1 + 7 steps + submit button + `postJson('/api/smb-crm/generate-blueprint')`
- Customer list: empty + populated + search filter + status chip + bulk action
- Customer detail: H1 + email + deals table + activities timeline + customer summary loaded
- Kanban deals: tab switch + deal card + new deal form
- Automations: list + run button + run-log table
- Integrations: 10 connector cards + health check

## Workflow

1. `cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-spa`
2. Read the contract. Read the foundation + records + assist + automations handoffs.
3. Build the 8 SPA routes + 2 widgets.
4. Register `smb-crm` in `apps.ts` + `suite-routes.js` + `main.jsx`.
5. Build the 6 co-located test files.
6. Run `npm --prefix web-modern test` to confirm all tests pass.
7. Regenerate the route tree: `cd web-modern && npx tsr generate`. If it fails, hand-edit `routeTree.gen.ts`.
8. Commit: `git add -A && git commit -m "feat(smb-crm): SPA surface (8 routes + 2 widgets + 6 tests)"`.

## Final steps

1. `npm --prefix web-modern test` — confirm all SPA tests pass; full web-modern suite still green.
2. `npm --prefix web-modern run typecheck` — clean.
3. Push: `git push -u ant wip/phase10-smb-spa`.
4. Write the handoff.
5. Mark status.md as: `state=done, completed=<iso timestamp>`.

## Constraints (HARD)

- **Do NOT touch** any of the backend modules (`server/crmTube*`, `server/tenants.js`, `server/blueprintGenerator.js`, `server/smbCrmRecords.js`, `server/smbCrmAssist.js`, `server/smbCrmAutomations.js`, `server/rbac.js`). Your work is *consuming* those, not building them.
- **Do NOT push to `ant/ant/main`**.
- Do not spawn subagents — do it inline.
- The 70+ existing test files MUST still pass.
- The Edit tool has been seen to corrupt Armenian text. Use the heredoc + python byte-level replacement workaround. Test the file after each Armenian edit by reading it back.
- Report results in your final response.
