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
