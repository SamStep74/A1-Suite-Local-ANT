# Merge Order

After every worker in session `a1-sub-plans-7-10` ships, merge branches in this order:

1. `state-integrations`
2. `asset-management`
3. `fleet-management`
4. `greenhouse-erp`

## Per-branch steps

```bash
git fetch ant
git checkout ant/main
git merge --no-ff <branch-for-step-N> -m "merge: <branch>"
git push ant main   # NOT origin
git push ant <tag-name>
```

## Conflict resolution

If the merge has conflicts, the most likely site is `server/app.js`
(each module appends a route block in its own section). For each conflict:

1. Open the conflicted file in your editor.
2. Identify the route block for the module being merged — keep it intact.
3. Drop the other side's conflicting stub if it's a placeholder.
4. Run `npm test` to confirm the route still loads + the new module's contract tests pass.
5. `git add . && git commit --no-edit` then `git push ant main`.

_See the per-worker `status.md` for the final test count and any test gaps._
