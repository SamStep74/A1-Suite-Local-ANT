# phase10-smb-crm-rebuild — orchestration

Phase 10 = rebuild the A1-SMB-CRM-HY product (56 API + 90 lib + 42 test files
of vanilla-JS Node + 3300-line vanilla-JS frontend) into the A1-Suite-Local-ANT
shell (Fastify + TanStack Start + React + TS + SQLite).

## Layout

- `contract.md` — the shared spec every worker reads
- `merge-order.md` — orchestrator's runbook
- `worker-foundation/` — Track 1 (auth + tenants + AI-onboarding + blueprint)
- `worker-records/` — Track 2 (customer/deal/task/quote/activity/goal CRUD)
- `worker-assist/` — Track 3 (sales-assist + message-assist + customer-summary + feedback)
- `worker-automations/` — Track 4 (automations + 7 webhooks + integrations + import + accounting)
- `worker-spa/` — Track 5 (React SPA: onboarding + blueprint + kanban + chat-widget + portal)
- `verifier-report.md` — verdict (pending)

## Merge order

1. foundation → 2. records → 3. assist → 4. automations → 5. spa
2. Tag: `phase10-smb-crm-v1` after the 5th merge.

## Worktrees (created by the launcher)

- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-foundation`
- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-records`
- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-assist`
- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-automations`
- `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase10-smb-spa`

## Tags

- `phase10-smb-crm-v1` (pushed to `ant` after the 5th merge)
