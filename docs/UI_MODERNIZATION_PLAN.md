# A1 Suite ANT — UI Modernization & Migration Plan

**Status:** Proposed (audit + research complete, awaiting ratification)
**Date:** 2026-06-12
**Repo:** SamStep74/A1-Suite-Local-ANT, GitHub default/mainline branch **`refs/heads/ant/main`** at `2b88b51`
(legacy branch `main` is stale at `f4ef8e7` / Phase 8.3, but CI filters still need the
explicit branch-topology retargeting in §8 R10 before this topology is safe)
**Scope:** finish the in-flight legacy→`web-modern` migration safely, ship `web-modern` to
production, and close the gap between what's built and best-in-class business-software UX.
**Inputs:** (a) three-agent repo audit of `web-modern/`, remaining `web/`, and the
`.orchestration/` phase system (2026-06-12); (b) the three research sweeps behind the sibling
plan [A1-Suite-Local PR #100](https://github.com/SamStep74/A1-Suite-Local/pull/100)
(`docs/UI_MODERNIZATION_PLAN.md` there): UX patterns of Linear/Attio/Mercury/Stripe/Midday/
Twenty/Odoo/ERPNext/Xero/QuickBooks; toolchains verified from 10 comparable products'
`package.json`; migration postmortems (Slack, Shopify Polaris, Airbnb).

**How this differs from the sibling plan:** A1-Suite-Local is at square one (plan = start a
strangler-fig). ANT is **mid-flight**: `web-modern` exists with real screens for all 15 apps,
phase 8 has already migrated-and-deleted 9 legacy modules, and HANDOFF.md records the
2026-06-11 pivot "legacy is out of the product." This plan is therefore a **gap analysis and
course-alignment**, slotted into ANT's own phase numbering — not a from-zero migration plan.

---

## 1. Goals and non-goals

**Goals**

1. **Unblock and execute the legacy kill (Phase 8.12) safely** — it is currently unsafe
   (§2.4: ~6,500 lines of legacy-only screens still live exclusively in `main.jsx`).
2. **Ship `web-modern` to production** — today the deploy pipeline builds and serves only the
   legacy app; `web-modern` has never been deployed (§2.3).
3. Close the **UX pattern gaps** vs the research target (§4 scorecard): saved views, undo,
   peek panels, virtualized tables, skeletons, error boundaries, fiscal preview-confirm gates.
4. Fix the **i18n inversion**: modern screens shipped hardcoded **English-first** while the
   product's users and worker-brief invariants are Armenian-first, and the server speaks
   AM/RU (§5 D2).
5. Keep the offline, self-hosted, single-bundle deployment story intact.

**Non-goals**

- No backend/API changes beyond what parity contracts already require (the API is the
  parity contract — HANDOFF.md:16).
- No new visual redesign of already-migrated Pattern A screens; upgrades are additive
  components, not reskins.
- No second orchestration system — everything slots into `.orchestration/` sessions run by
  `scripts/orchestrate-worktrees.js` with the existing 3-layer grammar (§7).

---

## 2. Current state (audit, 2026-06-12)

### 2.1 web-modern — what's already built (and is genuinely good)

- **Stack:** TanStack Start 1.168 (React 19, TS strict + noUnused* + verbatimModuleSyntax),
  Tailwind v4 CSS-first, TanStack Router file-based routes + Query 5, zod 4, cmdk, sonner,
  lucide. 171 TS files; 21,523 lines of route TSX.
- **Coverage:** real screens (not stubs) for **all 15 apps** (13 legacy ids + `crm-tube` +
  `cfo`), each with list + detail routes; plus migrated extension modules nested
  (inventory/warehouse, purchase/procurement, cfo/export-docs, cfo/state-integrations,
  copilot/onboarding, assets, cabinet, fleet, greenhouse, healthcheck) — `src/lib/apps.ts:30-46`.
- **Design tokens (`src/styles/tokens.css`, 222 lines):** 3 themes (light/dark/AAA-contrast
  via `[data-theme]`), **3 densities** (`[data-density]` + palette switcher), agent-vs-
  deterministic semantic colors, color-blind-safe tag palette, documented WCAG ratios.
  System fonts only — offline-safe by construction.
- **Data layer:** typed `api<T>(path, zodSchema)` client that `safeParse`s every response and
  throws structured `ApiError` on drift (`lib/api/client.ts:113-119`); **2,391-line
  `schemas.ts` with 181 zod schemas**, each annotated with the `server/app.js` line it
  mirrors; ERP-tuned `QueryClient` defaults.
- **⌘K palette:** implemented (nav + theme + density + sign-out) — static command list,
  "Ask AI" documented as future work (`AskCommandPalette.tsx:6-8`).
- **DecisionCard** (`components/decision-card/`): why/source/confidence/preview-diff/risk/
  approve-reject — *the explainable-AI approval primitive the research says is the only
  acceptable AI in accounting*. Live for one path (Desk WhatsApp reply approval).
- **Readable deep links** via `validateSearch` in 25 routes (`?view=kanban&status=sent`).
- **Tests/CI:** 70 vitest files (~1,474 cases), 5 Playwright specs (smoke over all 15 apps +
  cabinet/cfo-reports/crm-detail/healthcheck), dedicated CI jobs (vitest + tsc + Playwright).

### 2.2 Phase system — where the migration stands (mainline `ant/main` @ 2b88b51)

Per-module playbook (proven 10×): **layer 1** schemas+helpers (append-only `schemas.ts`,
pure `lib/<mod>/status.ts`, 100% coverage) → **layer 2** Pattern A route + co-located tests
(`tsr generate`) → **layer 3** Playwright e2e + server parity contract test
(`test/<mod>-modern-parity.test.js` with exact-key-set lock) + **legacy file deleted in the
same commit**. Tagged `phase8-<module>-v1`, no-ff merged in declared order, serialized on
`schemas.ts`/`routeTree.gen.ts` conflicts.

| Sub-phase | Module | Status |
|---|---|---|
| 8.1–8.8, 8.11 | healthcheck, cabinet, warehouse, procurement, assets, fleet, greenhouse, state-integrations, ai-onboarding | **Done** (legacy files deleted) |
| 8.13 | Tube CRM (new module) | **Done** (`phase8-tube-v1`) |
| 8.9 | export-docs | Layers 1–2 merged (`2b88b51`); **layer 3 (legacy-drop) pending** |
| 8.10 | compliance | Planned, not dispatched |
| 8.12 | **delete legacy** (`rm -rf web/ public/legacy/`, strip legacy static mounts while preserving modern `public/`) | **Done in 10.2e** (legacy build retired; row kept for historical reference) |
| 9 | RBAC (M14.3 RLS + M14.5 RBAC, ANT+MAX, shared contract + verifier) | Dispatched, workers pending |

### 2.3 Production gap — web-modern has never shipped

`deploy/install.sh` → root `build:ui` → builds **legacy `web/`** into `public/` → Fastify
serves it (`server/app.js:7106-7117`). Nothing in `deploy/` or the launchd/systemd templates
references `web-modern`, `:4173`, or `.output`. Auth is already dual-track (legacy `sid`
cookie; modern `Authorization: Bearer <sid>`, mirrored in the login body at
`server/app.js:337-344`) — the server is ready; the deploy pipeline is not. **All migrated
UI value is currently invisible to a production install.**

### 2.4 The remaining legacy tail — why 8.12 is blocked

`web/src` on mainline: `main.jsx` **12,791 lines** + `styles.css` 12,747 (byte-identical to
the sibling repo's, untouched, 0 `@layer`, plus a known undefined-token bug papered over by
`polish.css`) + cabinet/exportDocs (drops pending) + compliance.jsx (8.10).

**Legacy-only screens with no web-modern counterpart** (grep-verified zero matches):

- **The 85 `Pilot*Panel` pipeline components** — `main.jsx:6861→~12,540`, ≈5,600 lines,
  **~44% of main.jsx**. The pilot/commercial-readiness workflow exists nowhere in modern.
- **SecurityMfaPanel** (MFA *enrollment*, :5531 — modern has only the login MFA challenge),
  **SessionGovernancePanel** (:5579), **RoleDashboardPanel** (:5480).
- **IntegrationHubPanel** (WhatsApp/connectors, :6805), **WebhookDeliveries** panel.
- **ReceivablesAgingPanel** (:6248), **ForecastPanel** (:6314), **QuoteApprovalPanel** (:6391).
- **ProductionReadinessPanel** (compliance.jsx — covered by planned 8.10).
- The legacy login + post-login **workspace loader** (~100 datasets via `loadOr`).

Running 8.12 as written today (`rm -rf web/`) would delete the only implementation of all of
the above. **8.12 must be re-gated on a new migration track (Phase 10.2, §6).**

### 2.5 Modern-side debts found by the audit

- **i18n inversion:** `@inlang/paraglide-js` is a **dead dependency** (no project.inlang, no
  catalogs, zero imports). Modern UI strings are hardcoded **English** (tabs, buttons, empty
  states) with only `labelAm` app names — this *violates the repo's own Armenian-first
  worker invariant* and regresses vs the legacy app's Armenian UI. No Russian anywhere
  despite the server's AM↔RU locale switch.
- **Unused installed deps:** `@tanstack/react-table`, `nuqs`, `motion`, `mode-watcher` —
  zero imports (tables are hand-rolled; URL state via `validateSearch`).
- **Missing target deps:** react-hook-form, TanStack Virtual, dnd-kit (Kanban is raw HTML5
  DnD), Recharts (ForecastSummaryCard is "the V1 substitute for a chart"), Vercel AI SDK.
- **No route-level `errorComponent`/`pendingComponent` anywhere**; skeletons in only 2 files;
  no undo affordance; no saved views; no peek panels; bulk actions only partial.
- Warts: duplicate `PricingEvidence` component (two copies), `console.log` in the prod proxy
  (`routes/api/$.ts:42,46`), hardcoded demo period `2026-06` in `cfo/index.tsx:113-129`,
  5 route files over the 800-line guideline, both `package-lock.json` and `pnpm-lock.yaml`
  present, stale `.react-router` tsconfig leftovers, stale "Phase N" copy in `$appId.tsx:59`.

---

## 3. Research foundation (carried over; full detail in sibling plan §3–4)

The toolchain ANT already chose matches the verified 2026 industry consensus almost exactly
(TanStack Router/Query, zod 4, Tailwind v4, cmdk, sonner, lucide, TS strict). The research's
top-15 UX patterns (Cmd+K palette; one excellent data table; saved dynamic views; peek
panels; optimistic+undo with fiscal preview-confirm gates; suite-wide keyboard grammar;
triage inbox; AI-with-approval-gates; period-close checklist; bulk actions; document pipeline
steppers; one suite shell; LCH/token theming; teaching empty states; skeletons + readable
URLs) and the accounting-specific imperatives (table excellence, document flows as state
machines, 3-tier audit-trail UX, don't move accountants' cheese) apply unchanged. The
QuickBooks-2025 lesson — users revolt at click-count regressions and forced migration — binds
the deployment flip in §6 (10.1).

---

## 4. Pattern scorecard — ANT web-modern vs the research target

| # | Pattern | ANT status | Evidence |
|---|---|---|---|
| 1 | ⌘K palette (nav + actions + record search) | **Partial** — nav/theme/density only; no actions, no record search, no Ask-AI | `AskCommandPalette.tsx` |
| 2 | One excellent data table (virtualized, frozen col, density, column config) | **Partial** — density tokens exist; tables hand-rolled, react-table installed-unused, no virtualization, no column config | tokens.css:184-222; grep |
| 3 | Saved dynamic views | **Missing** (URL-state filters exist — good substrate) | 25 routes w/ `validateSearch` |
| 4 | Peek side panel | **Missing** — details are full routes | — |
| 5 | Optimistic UI + undo; fiscal preview-confirm gates | **Partial** — DecisionCard is exactly the gate primitive (live for 1 path); no undo anywhere | DecisionCard.tsx |
| 6 | Suite-wide keyboard grammar | **Partial** — ⌘K + Kbd component; no single-key/chord grammar | — |
| 7 | Triage inbox (doc/bank matching) | **Missing** (crm-tube has an `inbox.tsx` for Tube only) | crm-tube/inbox.tsx |
| 8 | AI copilot side panel w/ artifacts + approval | **Partial** — copilot routes via plain Query; AI SDK absent; DecisionCard ready to be the approval surface | copilot/* |
| 9 | Period-close checklist | **Missing** — finance has a read-only month-close list | finance/index.tsx |
| 10 | Bulk actions everywhere | **Partial** — crm-tube contacts bulk-enrich; desk tag-bulk | audits |
| 11 | Document pipeline steppers | **Missing** | — |
| 12 | One suite shell | **Done** — Topbar/LeftRail/BottomBar/AppLauncher across all 15 apps | app/route.tsx |
| 13 | Token theming (light/dark/contrast) + density | **Done** — arguably ahead of target (AAA theme, agent/deterministic semantics) | tokens.css |
| 14 | Teaching empty states + demo data | **Partial** — empty-state copy exists per route; no onboarding checklist/sample-company |
| 15 | Skeletons + readable URLs | **Partial** — URLs done; skeletons in 2 files; no route pending/error components | grep |

**Verdict:** the foundation (shell, tokens, data layer, test rig, process) is strong; the
gaps are concentrated in *interaction* patterns (#2–#5, #15) and *product* patterns (#7–#9, #11).

---

## 5. Architecture decisions to ratify (D1–D5)

**D1 — TanStack Start: switch SSR → SPA-mode output.**
Today Start runs full SSR (`vite.config.ts:141`, Nitro server, `node .output/server/index.mjs`)
yet the auth gate is **client-only** (`app/route.tsx:27-32` reads sessionStorage), so the
server renders nothing user-specific; the prod `/api/$` proxy adds a second server runtime +
extra hop to the offline bundle, and the deploy story (one Fastify process serving static
files) breaks. The research recommendation (and the self-hosted comparable, Twenty) is a
static SPA. **Recommendation:** enable Start's SPA mode (`spa` prerender config — one config
change; file-based routing, Router, and all route code are unchanged), output static assets,
and let **Fastify serve them** exactly as it serves `public/` today. The `/api/$` server
route and the Nitro server then disappear from prod. Fallback option if SPA-mode misbehaves:
eject to plain Vite + TanStack Router (the route files are framework-agnostic); rejected as
default because it churns `router.tsx`/entry files for no user value.

**D2 — i18n: adopt Lingui v5; drop the dead paraglide dep; hy is the source locale.**
Research verdict: Lingui (compile-time ICU MessageFormat, .po catalogs, Vite plugin) is what
the genuinely multilingual comparables (Twenty, Documenso) use, and ICU plurals are needed
for ru (one/few/many). Paraglide was never wired (zero imports) — remove it. Catalogs:
**hy (source) + ru + en**; money/dates already centralized for AMD (`lib/utils/money.ts`) —
extend to a locale-aware module mirroring `server/locale.js` money semantics (AMD subunit 0,
RUB subunit 2) and add the missing central date module. Extraction is per-screen DoD
(lint-block new hardcoded strings), not a later project. This also *restores* the repo's
Armenian-first invariant that English-first modern screens currently violate.

**D3 — Dependency hygiene: wire-or-remove.**
Wire when their pattern lands: `@tanstack/react-table` (+ add `@tanstack/react-virtual`) in
the shared DataTable (10.4); add `react-hook-form` + `@hookform/resolvers` (forms currently
manual useState); add `recharts` (analytics/cfo/forecast); add `dnd-kit` when Tube kanban V2
lands (design doc already defers DnD); add Vercel AI SDK (`ai` + `@ai-sdk/react` +
`streamdown`) for copilot/Ask-AI (already named as the V2 plan in the tube design doc).
Remove now: `@inlang/paraglide-js` (per D2), `mode-watcher`, `motion` (until used), `nuqs`
(`validateSearch` won — keep the URL-state pattern consistent). Pick ONE lockfile (npm —
CI uses it); delete `pnpm-lock.yaml`.

**D4 — Deployment flip with an escape hatch (the QuickBooks lesson).**
New root `build:ui` builds **web-modern** into `public/` (SPA output per D1); legacy build
moves to `public/legacy/` behind a `/legacy` mount + a visible "switch to classic" link for
one transition window. The legacy bundle must be built with a `/legacy/` Vite base, Fastify
must serve a prefixed `/legacy/*` index fallback before the root SPA fallback, and the legacy
router helpers must either run with a `/legacy` basename or rewrite `appIdFromLocation()` /
`appRoute()` so classic navigation stays under `/legacy/app/...`. Non-MFA login/session already
work on both (Bearer + cookie); the flip is gated on an MFA login parity test covering
`/api/login` returning `mfaRequired` + `challengeId`, verification at `/api/login/mfa`, and
storing the returned `sid`, plus a browser test proving web-modern carries `challengeId` into
`/login/mfa`, posts `{ challengeId, code }` to `/api/login/mfa`, and persists the returned
`sid`. Rollback = restore the legacy root contract, not just repoint
`build:ui`: rebuild legacy with the root Vite base/basename, return classic router helpers to
root `/app/...`, and restore the root static/index fallback while disabling the `/legacy/*`
fallback. The transition window ends at 8.12 (legacy deletion), which deletes the escape hatch too.

**D5 — Keep the orchestration grammar; add the verifier.**
All Phase 10 work ships as `.orchestration/<session>/` sessions (plan.json, per-worker
task.md/status.md/handoff.md, merge-order.md, shared design/contract docs), 3-layer worker
split, append-only `schemas.ts`, `tsr generate` for routeTree, no-ff merges in declared order
through the chosen R10 explicit-ref flow (preferred: fetch
`refs/heads/ant/main:refs/remotes/ant/ant/main`, reset from `refs/remotes/ant/ant/main`, push
`HEAD:refs/heads/ant/main`; fallback: fetch `refs/heads/main:refs/remotes/ant/main`, reset from
`refs/remotes/ant/main`, push `HEAD:refs/heads/main`), `phase10-*-v1` tags to remote `ant`,
serialized against any other session touching `schemas.ts`. Adopt phase 9's read-only
**verifier session** for every Phase 10 session (it caught nothing yet only because phase 9 hasn't
run; the pattern is right).

---

## 6. The plan — finish Phase 8, then Phase 10 in six tracks

> Phase numbering: 8.9/8.10/8.12 stay in Phase 8 (the legacy-kill track already planned).
> Everything new is **Phase 10** (Phase 9 = RBAC is dispatched and runs first/parallel).
> Per-screen Definition of Done for all NEW work: strict TSX · tokens only · Lingui strings
> (hy+ru) · zod-validated Query data · vitest + Playwright (incl. locale run) · keystroke
> parity vs legacy documented · same-PR legacy deletion where applicable.

### Finish Phase 8 (already planned, unchanged scope)
- **8.9 export-docs layer 3** (legacy-drop) — branches exist; merge after CI green.
- **8.10 compliance** — smallest module, as planned (`/app/cfo/compliance`).
- **8.12 delete legacy** — **re-gated**: now requires 10.1 (deploy flip) + 10.2 (main.jsx
  remainder) complete. Scope is `rm -rf web/` plus `public/legacy/` and the `/legacy` escape
  hatch/fallback, while preserving modern production assets in `public/`; strip the legacy
  mount and rewrite Dockerfile/package.json only where they still point at the legacy build.

### Phase 10.0 — Ratify D1–D5 + hygiene sweep (1 session, ~1 week)
SPA-mode flip (D1); dep wire-or-remove (D3); fix audit warts: duplicate PricingEvidence,
proxy console.logs, cfo hardcoded `2026-06` period, stale `$appId.tsx` copy, tsconfig
`.react-router` leftovers, lockfile dedupe; add **default `errorComponent`/
`pendingComponent`** at the root route + skeleton primitives (closes the no-error-boundary
hole product-wide in one layer); split the 5 over-800-line route files.
*Exit:* CI green; `npm start` story replaced by static serve; error/pending defaults render
on every route.

### Phase 10.1 — Deployment flip (1 session, ~1 week; after 10.0)
D4 as specified: `build:ui` → web-modern; legacy at `/legacy` with `/legacy/` Vite base,
a prefixed Fastify legacy index fallback before the root SPA fallback, and legacy router
basename/prefix handling so `appRoute()` and `appIdFromLocation()` do not escape to root
`/app/...`; deploy/install.sh + launchd/systemd templates updated; **offline smoke job**
(network-blocked Playwright) added to CI; bundle-size budget baseline recorded; MFA login parity
covered before production flip.
*Exit:* a fresh `deploy/install.sh` install boots into web-modern at `:4100` with legacy
reachable at `/legacy`; navigating classic app tiles stays under `/legacy/app/...`; MFA-enabled
login completes and stores `sid`; rollback rehearsed.

### Phase 10.2 — main.jsx remainder migration (the 8.12 unblocker; 3–5 sessions)
Apply the proven 3-layer playbook to the legacy-only surface (§2.4), in this order:

1. **10.2a Pilot pipeline** — the 85 `Pilot*Panel`s are one templated cohort (they mirror the
   `pilot_*` table family): build ONE generic `PilotStagePanel` route family + config, not 85
   bespoke screens. Layer 1 schemas for the pilot endpoints; layer 2 a `/app/cfo/pilot/*` (or
   `/app/compliance`-adjacent) route tree; layer 3 parity contracts + drop ~5,600 lines.
   Biggest single de-risk of 8.12.
2. **10.2b Security & governance** — MFA enrollment, SessionGovernance, RoleDashboard →
   `/app/people/security` or org-admin settings area; **coordinate with Phase 9 RBAC V2**
   (its contract already owes an `rbac-management` page — same session family, one design doc).
3. **10.2c Finance panels** — ReceivablesAging, Forecast, QuoteApproval → finance/crm routes
   (QuoteApproval is a natural first **preview-confirm gate** beyond DecisionCard's desk path).
4. **10.2d Integration hub + webhook deliveries** → `/app/flow/integrations` (Tube's
   integrations route is prior art).
5. **10.2e Login + shell retirement** — modern login already exists; kill the legacy
   workspace loader last.
*Exit:* zero legacy-only screens; `main.jsx` reduced to the shell that 8.12 deletes.

### Phase 10.3 — i18n (2 sessions; can start parallel with 10.2)
D2: Lingui wiring (vite plugin, hy/ru/en catalogs, lint rule); extraction sweep over
web-modern (automatable per-route with review); locale-aware money/date module; **Playwright
e2e gains a ru-locale run** (Armenian/Russian word lengths break layouts English passes).
*Exit:* zero hardcoded UI strings (lint-enforced); both locale e2e suites green.

### Phase 10.4 — Shared interaction components (2–3 sessions; after 10.0)
Closes scorecard #2–#5/#10/#15: **DataTable** (react-table + react-virtual + existing density
tokens; frozen first column; right-aligned tabular-numeral money columns; column show/hide;
row-height from `[data-density]`) → adopt in the heaviest lists (finance invoices, inventory,
tube contacts); **saved views** (named filter-sets persisted per user over the existing
`validateSearch` URL state); **peek panel** (Space/click side panel over lists, full page one
key away); **undo + optimistic mutations** (sonner action-toast + Query optimistic updates;
drafts/metadata only); **bulk-select bar** generalized from crm-tube's.
*Exit:* the 3 heaviest lists run on DataTable with saved views + peek + bulk; undo live on
≥3 mutation paths.

### Phase 10.5 — Product differentiators (sequenced backlog; after 10.2–10.4)
- **Fiscal gates everywhere:** generalize DecisionCard into the preview-confirm surface for
  post/finalize/submit (invoices, VAT, payroll, period close). Never auto-post.
- **Ask-AI palette + copilot on Vercel AI SDK** (`useChat` + streamdown artifacts), every
  agent action through DecisionCard + audit trail (the palette's documented Phase-1 plan).
- **Triage Inbox:** generalize Tube's inbox into suite-level — SRC e-invoices, receipts, bank
  lines auto-matched to transactions as confirm/reassign/snooze cards (Linear inbox × Midday
  Magic Inbox; the regional killer feature).
- **Period-close checklist** on the finance periods substrate; **document pipeline steppers**
  (quote→invoice→payment); **keyboard grammar** (`C`/`E`/`X`, `G then …`, `?` overlay);
  onboarding checklist + "load sample company".

**Sequencing summary:** 8.9L3 → 8.10 → [Phase 9 runs] → 10.0 → 10.1 → {10.2 ∥ 10.3} → 10.4 →
**8.12 (legacy deleted)** → 10.5. Realistic calendar at the demonstrated phase-8 cadence
(one module ≈ 1–2 days of orchestrated workers + merge): 10.0–10.1 ≈ 2 weeks; 10.2 ≈ 3–5
weeks (Pilot cohort dominates); 10.3 ≈ 2 weeks; 10.4 ≈ 3 weeks; 8.12 lands ~2–3 months out;
10.5 is a rolling backlog after.

> **Historical note (Phase 10.2e, 2026-06-12):** 10.2e retired the `/legacy` escape hatch and
> deleted `web/` + `public/legacy/` while preserving modern `public/`; the 8.12 row above is now historical — the actual cutover
> happened as part of 10.2e (the unblocking of 8.12 by the 10.2 migrations) rather than as
> a standalone 8.12 session.

---

## 7. Process: how Phase 10 sessions are structured (per D5)

Each session = `.orchestration/phase10-<name>/` with `plan.json` (baseRef set to the
chosen topology's unambiguous remote ref: preferred **`refs/remotes/ant/ant/main`** or fallback
**`refs/remotes/ant/main`**, never shorthand `ant/main`; branchPrefix `wip/phase10-<name>-`,
seedPaths for `schemas.ts`/`routeTree.gen.ts`/templates),
shared `design.md` or `contract.md`, 2–4 workers with territorial file ownership
(schemas/helpers → routes/components → e2e/parity[/legacy-drop]), a **read-only verifier**
worker, `merge-order.md`, no-ff merges via the D5/R10 explicit-ref flow + `phase10-<name>-v1`
tag to remote `ant`.
The orchestrator must fetch the selected remote-tracking `baseRef` with an explicit refspec
before `git worktree add`; a missing or stale `refs/remotes/ant/...` base is a hard stop, not
a reason to fall back to shorthand refs.
Standing invariants carry over: append-only schemas.ts; `tsr generate` for route tree;
Armenian-first (now: Lingui hy-source); push only to `ant`; 45–60 min worker budget;
blockers >10 min → status.md and stop; **never merge from detached HEAD** (cabinet lesson);
serialize sessions that touch schemas.ts.

---

## 8. Top risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **8.12 deletes legacy-only functionality** (Pilot pipeline, MFA enrollment, governance, integrations, webhooks) | 8.12 re-gated on 10.2 exit criteria; a grep-based "legacy-only inventory" check in CI (list of main.jsx panel names that must have modern counterparts) turns the gate mechanical. |
| R2 | SPA-mode flip (D1) breaks SSR-era assumptions (server proxy, head tags, per-request router) | One session, one PR, full e2e before/after; fallback = eject to Vite+Router (route files unchanged); the client-only auth gate proves no screen depends on SSR data today. |
| R3 | Deploy flip regresses real users (QuickBooks lesson) | `/legacy` escape hatch + visible switch link for the whole transition window; keystroke-parity notes in each 10.2 screen's DoD; rollback restores the legacy root base/basename and static fallback per D4. |
| R4 | Pilot-cohort migration (10.2a) under-models 85 panels' variance | Layer-0 discovery worker first: enumerate all 85 panels' props/endpoints and confirm the templated-cohort hypothesis before layer 1; if >15% are bespoke, split into template + bespoke tracks. |
| R5 | i18n extraction debt explodes / English-first regression continues | Lint rule blocks new hardcoded strings from 10.3 layer 1 onward; extraction is per-screen DoD; ru-locale e2e run catches layout breaks. |
| R6 | `schemas.ts` (2,391 lines) merge conflicts across parallel sessions | Existing serialization rule enforced in plan.json scheduling; mid-term: split schemas.ts per-module (append-only per file) as a 10.0 hygiene item if conflicts recur. |
| R7 | No error boundaries today → any new component crash blanks a route | 10.0 ships root-level errorComponent/pendingComponent BEFORE feature tracks start. |
| R8 | Parity contracts don't exist for main.jsx panels (unlike modules) | 10.2 layer 3 writes `test/<area>-modern-parity.test.js` per track exactly as phase 8 did for modules — the contract test remains the definition of done. |
| R9 | Offline/bundle regression via new deps (AI SDK, recharts) | Bundle budget in CI from 10.1; lazy-load charts/AI routes; network-blocked Playwright job every release. |
| R10 | **Branch confusion ships work to the wrong mainline** — GitHub default is the actual branch `refs/heads/ant/main`, legacy branch `refs/heads/main` still exists, CI filters still target `main`, scripts still checkout `ant/main` and push `git push ant main`, and a stale local branch literally named `ant/main` can shadow the remote | Pick one topology before relying on branch protection. Preferred: keep GitHub default on `refs/heads/ant/main`, update `.github/workflows/ci.yml` so `pull_request.branches` includes `ant/main` and e2e push refs include `refs/heads/ant/main`, update worker `plan.baseRef` values and merge preflights to the unambiguous `refs/remotes/ant/ant/main`, replace merge checkout/push code with an explicit remote ref flow (`git fetch ant refs/heads/ant/main:refs/remotes/ant/ant/main`, checkout/reset from `refs/remotes/ant/ant/main`, push `HEAD:refs/heads/ant/main`), delete/retire legacy `refs/heads/main`, and delete stale local shadow branches. Fallback: retarget GitHub default back to `refs/heads/main`, keep CI on `main`, keep scripts checking out and pushing `main`, and assert worker `baseRef` == `refs/remotes/ant/main` HEAD. Do not mix the two. |

---

## 9. Governance & metrics

Weekly dashboard: legacy-only panel count (R1 inventory), `main.jsx` LOC remaining,
scorecard items closed (§4), Lingui extraction % per app, bundle size, e2e flake rate,
sessions merged vs planned. CI gates: existing (vitest+tsc+Playwright) + offline smoke +
bundle budget + hardcoded-string lint + legacy-only inventory check. Release gate for 8.12:
all R1 inventory items migrated + parity contracts green + escape-hatch window completed.

## 10. Immediate next steps

1. Ratify D1–D5 (§5) — the SPA-mode and Lingui calls gate everything downstream.
2. Merge 8.9 layer 3 (branch exists); dispatch 8.10 compliance (already planned).
3. Let Phase 9 RBAC complete (its V2 `rbac-management` UI joins 10.2b).
4. Dispatch **phase10-hygiene** (10.0) as the first new orchestration session.
5. Fix R10 (branch topology) — 5-minute task, prevents an expensive class of mistakes.

---

## Appendix A — Audit evidence index

Modern app: `web-modern/src/lib/apps.ts:30-46` (15 apps), `vite.config.ts:141` (SSR),
`routes/api/$.ts:38-56` (prod proxy), `lib/api/schemas.ts` (2,391 lines/181 schemas),
`lib/api/client.ts:113-119` (safeParse gate), `styles/tokens.css:115,151,184-222`
(themes/densities), `AskCommandPalette.tsx:6-8`, `components/decision-card/DecisionCard.tsx`,
tsconfig strict block `:31-35`. Legacy: `web/src/main.jsx` (12,791 lines on mainline; 85
`Pilot*Panel`s :6861-12,540; SecurityMfaPanel :5531; SessionGovernancePanel :5579;
RoleDashboardPanel :5480; IntegrationHubPanel :6805; ReceivablesAging :6248; Forecast :6314;
QuoteApproval :6391), `styles.css` (14 tokens, 397 rgba literals, 0 @layer; undefined-token
bug per `polish.css:9-12`), drop commits `3cb2b0a cc27e62 f7531fb 7ef38f2 ddb2725 e8b3b57
ac187a1 d3f4beb`. Deploy: `deploy/install.sh:18`, root `package.json` build:ui,
`server/app.js:337-344,7106-7117`. Process: `HANDOFF.md:3-34`,
`scripts/orchestrate-worktrees.js`, `.orchestration/phase8-cabinet/*/task.md`,
`.orchestration/phase9-rbac/contract.md`, `.orchestration/phase8-tube/merge-order.md`.
Research sources: sibling plan Appendix A
([A1-Suite-Local#100](https://github.com/SamStep74/A1-Suite-Local/pull/100)).
