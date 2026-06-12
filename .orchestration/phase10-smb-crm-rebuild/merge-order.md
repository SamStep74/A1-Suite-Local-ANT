# Merge Order — phase10-smb-crm-rebuild

After all 5 workers ship, merge branches in this order:

1. `wip/phase10-smb-foundation`     (tables, AI provider, blueprint)
2. `wip/phase10-smb-records`        (customer/deal/task/quote/activity/goal CRUD)
3. `wip/phase10-smb-assist`         (sales-assist, message-assist, customer-summary, feedback)
4. `wip/phase10-smb-automations`    (automations, webhooks, integrations, import, accounting)
5. `wip/phase10-smb-spa`            (React SPA: onboarding, blueprint, kanban, etc.)

## Per-branch steps

```bash
cd /Users/samvelstepanyan/dev/A1-Suite-Local-ANT
git fetch ant
# Use the explicit refspec form to bypass the local `ant/main` ambiguity:
git push ant HEAD:ant/main   # after each local merge, in order
git push ant phase10-smb-crm-v1   # after the 5th merge
```

## Conflict resolution

The most likely conflict sites:
- `server/db.js` — all 5 workers add `ensure*Schema` functions. Each is a separate `IF NOT EXISTS` block; they can be merged as separate function declarations + separate calls in the boot sequence.
- `server/app.js` — 5 workers add thin routes. They should be in their own sections (just like the crm-tube block).
- `web-modern/src/lib/api/schemas.ts` — 5 workers append Zod shapes. All appended to EOF in the same convention as Tube.
- `web-modern/src/routeTree.gen.ts` — auto-regen byproduct; reset with `git checkout -- web-modern/src/routeTree.gen.ts` before each merge.

For each conflict:
1. Open the conflicted file in your editor.
2. Identify the rbac + foundation + records + assist + automations + spa blocks — keep them all intact.
3. Run `npm test` to confirm the 1449+ baseline + the new tests pass.
4. `git add . && git commit --no-edit` then push.

## Final state

- `ant/main` HEAD: the 5th merge commit.
- Tag: `phase10-smb-crm-v1` → the 5th merge commit (pushed to `ant`).
- web-modern tests: ~1545 + ~50 from the SPA track.
- server tests: ~984 + ~40 from the 4 backend tracks.

## Verifier flow

After the workers mark themselves done, the orchestrator spawns a verifier
session (read-only) that audits each branch against `contract.md` §3's
deliverable checklists + the 7+12+8+10+~5 contract tests. Verdict to
`verifier-report.md` in this directory.
