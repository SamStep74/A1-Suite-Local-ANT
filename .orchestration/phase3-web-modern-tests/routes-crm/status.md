# Status: routes-crm
- State: done
- Completed: 2026-06-10T22:19:00Z
- Worktree: `/Users/samvelstepanyan/dev/A1-Suite-Local-ANT-phase3-web-modern-tests-routes-crm`
- Branch: `wip/phase3-web-modern-routes-crm` (pushed to `ant`)
- Tag to ship: `phase3-routes-crm-v1` (pushed to `ant`)
- Test delta: 72 → 107 tests across 5 → 7 files
- Two new test files: `index.test.tsx` (23 tests) and `$quoteId.test.tsx` (26 tests)
- Full test suite (CRM tests): green
- Typecheck: clean for CRM test files (one pre-existing failure in
  seeded `inventory/__tests__/status.test.ts` overlay — out of scope)
- Baseline fix included: `@testing-library/dom@^10.4.1` added to
  `web-modern` devDependencies (also fixed `HybridBadge.test.tsx`)
