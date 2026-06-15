# Known-failing e2e tests — 66 specs at 879165b

**Generated:** 2026-06-15
**Base ref:** `879165b` (= `ant/main` = `ant/integration/phase10-9-d`)
**Source data:** `/tmp/phase10-10-audit-v2.json` (json reporter, 110 specs total)
**Companion docs:**
- [audit-runtime.md](audit-runtime.md) — the e2e runtime audit that produced this list
- [plan.md](plan.md) — Phase 10.10 plan
- [STATE.md](../../STATE.md) — 10.9 (d) wave-1..5 postmortems (informs the "history" column)

## Why this doc exists

The 110-spec e2e suite has 44 green + 66 red at base ref `879165b`. The Phase 10.10 split moves the green 44 into the `@smoke` tag and the red 66 into the nightly `test:e2e:full` run (see `.github/workflows/e2e-full-nightly.yml`). This doc is the **work-list** for any future attempt to flip the red specs green — whether that's a 10.9 (d) wave-6 attempt, a different refactor approach, or per-spec UI fixes.

## Bucket summary

| Bucket | Count | Typical cause |
|---|---:|---|
| **Timeout (DOM not appearing)** | 20 | `expect(locator).toBeVisible()` fails — element never renders, or H1/testid structure changed |
| **Timeout waiting for element** | 13 | `locator.waitFor()` exceeds 15s — race condition, hydration not finishing, or selector drift |
| **No error message** | 12 | Test fails but `result.error.message` is empty — usually a precondition or navigation error |
| **Locator visibility / content mismatch** | 10 | Element found but assertion text/role doesn't match — DOM drift |
| **Assertion (visible/contains)** | 4 | `toContain` / `toBeVisible` mismatch on existing element — content drift |
| **Element is not an input/textarea** | 4 | Selector points at a wrapper div instead of the actual `<input>` — selector drift |
| **toBeEnabled / waitForResponse** | 3 | Misc — usually a button-disabled state or page-closed race |
| **Total** | **66** | |

## Per-file failure list (66 total, 18 files)

Sorted by failure count descending. Each row is one test() call. The "Bucket" column maps to the table above. The "Deferral status" column says what an engineer should look at first.

### `document-steppers.spec.ts` — 9 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | renders the wizard header, the stepper, and the customer step | Visibility mismatch | Stepper testid structure likely changed; check `data-testid="wizard-step-*"` |
| 2 | advance through every step, fill the wizard, and submit | Timeout | Form-fill selector drift; `getByLabel` may be broken |
| 3 | documents stepper: draft → review → sign | Timeout | Stepper click handlers may have lost testids |
| 4 | validate required fields block progress | Visibility mismatch | Required-field error message DOM drift |
| 5 | back navigation preserves state | Timeout | Back button selector drift |
| 6 | locale switcher renders in the wizard | Timeout | Locale switcher might not render in document context |
| 7 | cancels + returns to documents list | Visibility mismatch | Cancel button selector drift |
| 8 | opens the right-side peek panel | Timeout | Peek panel testid may have moved |
| 9 | refresh after submit re-renders the list | waitForResponse (page closed) | Race condition — page closed before response arrived |

### `onboarding.spec.ts` — 8 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | first-run shows the launcher with a 5-tour badge | — | The badge count may not match the seeded tour count |
| 2 | advance through every step of ask-ai, finish, and persist the done flag | Timeout | Tour advance selectors may have changed |
| 3 | back decrements; skip closes without marking done | Timeout | Back button on tour stepper |
| 4 | hide-tour-launcher removes the button from the Topbar | Timeout | "hide-tour-launcher" action may be wired differently |
| 5 | walk every stop of the documents tour; the last stop shows 'Done' | Timeout | Tour stop navigation selectors |
| 6 | a finished tour persists across a full page reload | Timeout | localStorage key for tour state may have changed |
| 7 | hide-tour-launcher persists across a full page reload | Timeout | Persistence on the hide action |
| 8 | locale switcher reflects the active locale (ru via ?lang=) | Timeout | Locale switcher testid inside onboarding overlay |

### `fleet.spec.ts` — 7 failing (2 of 9 pass → already in @smoke)

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | filling the form + clicking submit POSTs to /api/fleet/vehicles with the idempotency key | Element not input | Form input selector drift on the create-vehicle form |
| 2 | filling the form + clicking submit POSTs to /api/fleet/drivers with the idempotency key | Element not input | Same — driver form input selector |
| 3 | submitting a trip then clicking Departed POSTs + PATCHes the status envelope | Element not input | Trip form input selector |
| 4 | submitting a fuel log + the efficiency rollup table renders | Timeout | Efficiency table not appearing within 15s |
| 5 | submitting a repair + the backlog rollup table renders | Timeout | Backlog table not appearing within 15s |
| 6 | filling the form + clicking submit POSTs to /api/fleet/tires/install with the idempotency key | Element not input | Tires form input selector |
| 7 | selecting vehicle + category + clicking compute GETs the compliance report and the breaches list renders | Timeout | Compliance report rendering |

### `greenhouse.spec.ts` — 7 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | loads, renders the H1 + tabs, defaults to Crops, and points back to /app/inventory | Visibility mismatch | H1 / tab structure drift |
| 2 | adds a crop + the new crop renders in the list | Timeout | Form submit + list re-render |
| 3 | adds a zone + the new zone renders in the list | Timeout | Zone form input selectors |
| 4 | adds a sensor reading + the new reading renders in the list | Timeout | Sensor form input selectors |
| 5 | switches the active zone and the readings filter to that zone | Timeout | Zone-switcher testid drift |
| 6 | renders the analytics dashboard with at least one chart | Timeout | Analytics charts not loading |
| 7 | PDF export button POSTs and renders the URL | Timeout | Export PDF endpoint not responding |

### `assets.spec.ts` — 5 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | exposes the Asset ID input + submit button and the submit is | Assertion (toContain) | "404" expected — likely the route renders an error/empty state |
| 2 | submitting the form POSTs /api/assets with the idempotency key | No error message | Submit may not be wired |
| 3 | the asset list re-renders with the new row | Timeout | List re-render not happening |
| 4 | click row → opens detail panel with metadata | Visibility mismatch | Detail panel selector drift |
| 5 | delete confirms + removes the row | Timeout | Delete confirmation flow |

### `ask-ai.spec.ts` — 4 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | stub question: type, submit, observe streamed answer + ≥1 cited source | No error message | Stream may be hanging or stub not wired |
| 2 | empty submit is blocked (button disabled) | No error message | Button-disabled state check |
| 3 | error path: 502 from /api/ask surfaces the error toast | No error message | Error toast not rendered |
| 4 | locale persists across reload | Timeout | Localstorage state propagation |

### `fiscal-gates.spec.ts` — 4 failing (1 of 5 pass → already in @smoke)

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | opens the period-close wizard from a fiscal-gate row | Timeout | "open wizard" action may have moved |
| 2 | submits the period close and re-renders the row as Done | Timeout | Submit + state transition |
| 3 | blocked rows render the blocked-state badge | Visibility mismatch | Badge testid drift |
| 4 | unblocking a blocked row updates the list | Timeout | Unblock action may be a different testid |

### `warehouse.spec.ts` — 4 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | Lots form is wired to POST /api/warehouse/lots and renders the new lot | waitForResponse (page closed) | Page closed before response — race |
| 2 | ColdStorage form is wired to POST /api/warehouse/cold-storage/readings | No error message | ColdStorage form input selectors |
| 3 | Analytics renders the ABC bucket badges and the forecast copilot-result block | Visibility mismatch | Analytics render failing |
| 4 | clicking the inventory back-link returns to /app/inventory | No error message | Back-link testid drift |

### `locale-switching.spec.ts` — 3 failing (3 of 6 pass → already in @smoke)

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | switching to ru re-renders the UI in Russian (Dashboard tab → Сводка) | Visibility mismatch | "Сводка" string not appearing — ru catalog may not be loaded |
| 2 | switching back to hy restores the source locale state | Timeout | Round-trip locale state |
| 3 | LinguiProvider integration: the DOM matches the new locale, not the old one | Timeout | LinguiProvider integration selector |

### `ai-onboarding.spec.ts` — 2 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | loads, renders the model grid, save button, and back-link | Visibility mismatch | Model grid render failing |
| 2 | renders the form (not a 403) when logged in as Owner | Visibility mismatch | Form render for Owner role |

### `apps.spec.ts` — 2 failing (17 of 19 pass → 17 already in @smoke)

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | `<appId> → /app/<appId>/` renders ... for one of the 2 missing appIds | Timeout waiting for element | Two of the `APP_IDS` apps fail to render their H1 within 15s |
| 2 | `<appId> → /app/<appId>/` renders ... for the other missing appId | Timeout waiting for element | Same — one of the apps is likely misconfigured or removed from the route table |

The 2 failing appIds are NOT in the `APPS_SMOKE` set in `e2e/apps.spec.ts:35`, so they don't pollute the smoke signal.

### `export-docs.spec.ts` — 2 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | selecting a template, validating, finalizing, and starting next | Assertion (received null) | Template submit returning null |
| 2 | refresh after finalize re-renders the list | Timeout | List re-render after submit |

### `procurement.spec.ts` — 2 failing (1 of 3 pass → already in @smoke)

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | loads, renders 5 tabs, defaults to Requisition, and points back to /app/purchase | Timeout | Page load timing |
| 2 | chains Requisition → RFQ → Quote → PO → Receipt and fills all 5 id pills | Timeout | Multi-step form chain timing |

### `shared-components-canary.spec.ts` — 2 failing (1 of 3 pass → already in @smoke)

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | selecting a row reveals the BulkActionBar | Visibility mismatch | BulkActionBar testid |
| 2 | clicking a row body opens the PeekPanel; the X button closes it | Visibility mismatch | PeekPanel testid |

### `spa-mode.spec.ts` — 2 failing (2 of 4 pass → already in @smoke)

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | JS hydrates within 5 s (data-spa-hydrated appears) | Timeout | Hydration testid not appearing in time |
| 2 | /app/cfo renders the CFO toolbar (proves route tree intact) | Timeout | Route tree hydration timing |

### `cabinet.spec.ts` — 1 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | loads, renders the filter bar, create form, and back-link | toBeEnabled | "create" button may be disabled in initial state |

### `healthcheck.spec.ts` — 1 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | `?app-state=down` renders the global error overlay | Visibility mismatch | Error overlay testid |

### `keyboard-grammar.spec.ts` — 1 failing

| # | Spec title (source-level) | Bucket | Deferral status |
|---:|---|---|---|
| 1 | ? opens cheatsheet, ESC closes, j/k navigate rows, g+t jumps, mod+k opens palette | Timeout | Keyboard handler not firing |

## Common root-cause themes (consolidation)

Looking across the 66 failures, the most common root causes are:

1. **DOM/testid drift** (~30 specs) — the testids / H1 structure changed in a recent commit and the spec wasn't updated. Fix: grep the component source for the current testid, update the spec.
2. **Race conditions on hydration** (~12 specs) — page hydration takes longer than 15s on this run. Fix: add `waitForHydration()` helper or increase per-test timeout for slow pages.
3. **Selector drift on form inputs** (~8 specs) — `getByLabel` or `getByTestId` points at a wrapper div, not the actual `<input>`. Fix: re-derive the selector from the current form component.
4. **Pre-existing 10.9 (d) issues** (~10 specs) — these are the same 5 wave-1/2/3 fixes that haven't been re-applied in wave-4/5. Cross-ref STATE.md:1300 (wave-4 audit) for the specific deferral history.
5. **Stub/mock drift** (~6 specs) — `ask-ai.spec.ts` tests rely on AI stubs that may have been renamed or removed.

## Recommended next action

A future 10.9 (d) wave-6 attempt should NOT use the multi-worker wave-N approach (per the `wave-n-worker-death-pattern` memory, 3+ consecutive NOOP/INFRA waves means STOPPED). Instead:

- **Pick the 2 all-PASS or partial-PASS files with the most failures** (e.g. `document-steppers.spec.ts` 9 fails, `onboarding.spec.ts` 8 fails). They likely share root causes with the green specs in the same files.
- **Fix per-file, single-orchestrator, no tmux** — same model as 10.10.
- **Re-run the audit at base ref + the new commits** and confirm the spec count drops from 66 → N<66.
- **If a flipped-green spec looks like a smoke candidate, add it to `APPS_SMOKE` (apps.spec.ts:35) or add ` @smoke` to its test title.**

## Out of scope for Phase 10.10

- Fixing the 66 failures (this is the 10.9 (d) wave-N problem space; 10.10 explicitly defers it)
- Re-running the wave-N orchestration
- Vitest flakes (separate phase, 10.9 (g) already closed NOOP)
- Shared helper refactor (10.9 (e), not in scope)

## Related

- [audit-runtime.md](audit-runtime.md) — per-spec smoke list
- [STATE.md](../../STATE.md) — 10.9 (d) wave-1..5 history
- [plan.md](plan.md) — Phase 10.10 plan
- `.github/workflows/e2e-full-nightly.yml` — the cron that runs these 66 specs nightly
