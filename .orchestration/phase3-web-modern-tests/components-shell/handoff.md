# Handoff: components-shell

## Summary
Test-writing worker for Phase 3 of the web-modern app. Added **7 fresh
component test files** (59 new tests) to shell, UI, and feedback
components in `web-modern/src/components/`. No source files modified.
No entries added to or removed from the apps list in `lib/apps.ts`.

## Branch / tag
- Branch: `wip/phase3-web-modern-components-shell` (pushed to `ant`)
- Tag:    `phase3-components-shell-v1` (pushed to `ant`)

## Components tested
| # | Component | Test file | Tests |
|---|-----------|-----------|------:|
| 1 | `components/ui/Kbd.tsx`            | `Kbd.test.tsx`            |  4 |
| 2 | `components/ui/Button.tsx`         | `Button.test.tsx`         | 11 |
| 3 | `components/feedback/Toaster.tsx`  | `feedback/Toaster.test.tsx` |  6 |
| 4 | `components/shell/BottomBar.tsx`   | `shell/BottomBar.test.tsx` |  7 |
| 5 | `components/shell/Topbar.tsx`      | `shell/Topbar.test.tsx`  | 11 |
| 6 | `components/shell/LeftRail.tsx`    | `shell/LeftRail.test.tsx` |  8 |
| 7 | `components/shell/AppLauncher.tsx` | `shell/AppLauncher.test.tsx` | 12 |
| **Total** | | | **59** |

## Test count delta
**5 passing test files (58 tests) → 11 passing test files (117 tests)**
(Component tests: 1 file / 5 tests → 8 files / 64 tests. The remaining
delta comes from agent/schema suites already in tree.)

## Pre-existing failures (unchanged, outside scope)
Two seeded-overlay failures remain — present before this worker started
and unrelated to component testing:

1. `web-modern/src/lib/inventory/__tests__/status.test.ts` — references
   a missing module `../status`. The corresponding `status.ts` source
   is not present in this worktree (also untracked). This file is in
   the seeded overlays list and is the responsibility of a different
   worker.
2. `HybridBadge.test.tsx` was originally failing due to a missing peer
   dep `@testing-library/dom`. Fixed by `npm install --save-dev
   @testing-library/dom` (committed as part of the Kbd test commit so
   the dep is part of the diff). The existing test now passes.

## App-list count note
The seeded task description referred to a "13-apps list" but the
current `APP_IDS` array in `web-modern/src/lib/apps.ts` contains
**14 entries** (`crm`, `finance`, `copilot`, `desk`, `campaigns`,
`projects`, `inventory`, `purchase`, `people`, `docs`, `analytics`,
`flow`, `forms`, `cfo`). My tests iterate `APP_IDS` directly so they
adapt to whatever count is in the catalog — they do not hard-code 13 or
14. **No entries were added or removed**; the list was left exactly as
found.

## Mock patterns established (reuse in future tests)
1. **Sonner** — mock at module boundary; assert on the props passed to
   `<Toaster />`:
   ```ts
   const sonnerSpy = vi.fn((props) => <div data-testid="sonner" />);
   vi.mock("sonner", () => ({ Toaster: (p) => sonnerSpy(p) }));
   // assert: sonnerSpy.mock.calls[0][0].toastOptions.classNames.success, etc.
   ```
2. **TanStack Router** — mock `Link` (children-only passthrough) and
   `useLocation` (returns a mutable pathname ref). For `AppLauncher` I
   also mocked `useNavigate` and captured the navigation calls:
   ```ts
   const navigateMock = vi.fn();
   vi.mock("@tanstack/react-router", () => ({
     Link: ({ children }) => <>{children}</>,
     useNavigate: () => navigateMock,
   }));
   // assert: navigateMock.toHaveBeenCalledWith({ to, params })
   ```
3. **AppCatalyst pattern** — render `AppLauncher` and `LeftRail` against
   the **real** `lib/apps` catalog (no mock) so the tests double as
   regression guards on the apps list. Iterate `APP_IDS` instead of
   hard-coding names.
4. **Provider hook mocks** — `useTheme` and `useDensity` are mocked at
   the `ThemeProvider` / `DensityProvider` module boundary (not
   wrapped in a provider). The mock returns a stable object whose
   setters are `vi.fn()` so individual tests can override per-call:
   ```ts
   const useDensity = vi.fn(() => ({ density: "comfortable", setDensity: vi.fn() }));
   vi.mock("../../lib/density/DensityProvider", () => ({
     useDensity: () => useDensity(),
     DENSITIES: ["comfortable", "compact", "spacious"],
   }));
   ```
5. **localStorage state** — clear in `beforeEach` (try/catch for
   private mode) and use `localStorage.setItem` + remount to test
   hydration paths.

## Verification performed
- `npm --prefix web-modern test` — **117 passed**, 1 pre-existing
  failure (`status.test.ts`).
- `npm --prefix web-modern run typecheck` — clean for all 7 new
  test files; the only remaining error is the pre-existing seeded
  `status.test.ts` import.
- `git push -u ant wip/phase3-web-modern-components-shell` — pushed.
- `git push ant phase3-components-shell-v1` — pushed.

## Per-component commit list
- `bca955b` test(components): Kbd
- `603598b` test(components): Button
- `15f2df6` test(components): Toaster
- `504c327` test(components): BottomBar
- `578b6b9` test(components): Topbar
- `9e5a6d3` test(components): LeftRail
- `0b5b704` test(components): AppLauncher
- `c880100` test(components): address typecheck nits in shell tests
