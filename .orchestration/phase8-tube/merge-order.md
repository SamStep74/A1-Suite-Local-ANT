# Merge Order

After every worker in session `phase8-tube` ships, merge branches in this order:

1. `tube-deals-board` (the index — the other 2 link into it)
2. `tube-contacts`
3. `tube-sequences`

## Final tag to ship

`phase8-tube-v1` — push to `ant` after the third merge lands on `ant/main`.

## Per-branch steps

```bash
git fetch ant
git checkout ant/main
git merge --no-ff <branch-for-step-N> -m "merge: <branch>"
git push ant main   # NOT origin
```

## Conflict resolution

The most likely conflict site is `web-modern/src/routeTree.gen.ts` (TanStack
Router auto-regen) and `web-modern/src/lib/apps.ts` (none expected — only
Worker 1 touches the crm-tube row). For each conflict:

1. Open the conflicted file in your editor.
2. Identify the block for the worker being merged — keep it intact.
3. Drop the other side's stub if it's a placeholder.
4. Run `npm --prefix web-modern run typecheck` and `npm --prefix web-modern test`
   to confirm the SPA still builds + tests pass.
5. `git add . && git commit --no-edit` then `git push ant main`.

If a worker didn't regenerate the route tree, do it after merge with
`cd web-modern && npx tsr generate` and amend the merge commit.

_See the per-worker `status.md` for the final test count and any test gaps._

## Merge log (2026-06-11)

All 3 worker branches merged into `phase8-tube-merge` and pushed to `ant/main`:

1. `wip/phase8-tube-tube-deals-board`    (55f2360) — kanban + deal detail + AI panel
2. `wip/phase8-tube-tube-contacts`       (a109342)  — contacts list + detail + inbox
3. `wip/phase8-tube-tube-sequences`      (d4cd2fa)  — sequences + builder + integrations

A separate merge of `wip/phase8-healthcheck` (Tube port) and a rebase of
`ant/main` (to pull in the phase8-onboarding merge that landed mid-orchestration)
were both done before the worker branches.

Conflict resolved in `web-modern/src/lib/api/schemas.ts` — both the cabinet
and tube workers appended Zod blocks; kept both sides verbatim.

Post-merge fixes: removed a duplicate `patchJson` export in
`web-modern/src/lib/api/client.ts` (the sequences worker added a redundant
copy of the canonical definition at line 135).

## Final state (2026-06-11)

- `ant/main` HEAD: `f03ed25`
- Tag: `phase8-tube-v1` → `f03ed25` (pushed to `ant`)
- web-modern tests: 1449/1449 across 70 files (was 1278/1278 across 59 files before tube)
- server tests: 979/979
- tsc --noEmit: clean
