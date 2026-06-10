# Phase 2 — CRM + Inventory + Pre-Built Agents

**Date:** 2026-06-10
**Status:** Approved (user proceeded with recommended defaults after AskUserQuestion tool errored)
**Plan reference:** `~/.claude/plans/the-user-interface-the-tidy-island.md` §8 Phase 2

## 1. Context

Phase 1 (committed in 746ab23, 8f6df2d, 8ed1daa, 46411a7) shipped the **agentic shell**: Today feed as `/app` home, Agent Mission Control at `/app/copilot`, the AI Action Panel and Decision Card primitives, and the Desk module (list + detail + Zoho patterns + ⌘K shortcuts). All running on TanStack Start 1.168 + React 19 + Zod 4 + TanStack Query v5.

Phase 2 brings the **two flagship revenue modules** (CRM, Inventory) into the new shell, and ships the **first two pre-built agents** (Sales Quote Agent, Inventory Risk Agent). After this, users on the new app see Today + Mission Control + Desk + CRM + Inventory, with agentic suggestions on the right rail of every record detail page.

## 2. Backend (no changes)

All endpoints already exist in `server/app.js`:

**CRM:**
- `GET /api/crm/quotes?customerId=…` → `{ quotes: Quote[] }`
- `GET /api/crm/activities` → `{ activities: Activity[] }`
- `GET /api/crm/leads?status=…` → `{ leads, summary }`
- `GET /api/crm/forecast` → `ForecastSummary` (deal stage totals, weighted pipeline)
- `POST /api/crm/quotes` → creates a draft quote
- `POST /api/crm/quotes/:id/request-approval` → submits for release

**Catalog / Inventory:**
- `GET /api/catalog/items?…` → `{ items, categories, unitsOfMeasure, marginRules, priceLists }`
- `GET /api/catalog/items/:id` → `{ item }`
- `GET /api/catalog/categories` → `{ categories, unitsOfMeasure, marginRules, priceLists }`
- `GET /api/catalog/price-lists` → `{ priceLists }`
- `GET /api/catalog/margin-rules` → `{ marginRules }`
- `GET /api/inventory/stock?…` → `{ stock, locations }`
- `GET /api/inventory/moves?…` → `{ moves }`
- `GET /api/inventory/locations` → `{ locations }`
- `POST /api/inventory/moves` → posts a stock move, returns updated stock for the item

## 3. Routes to add

```
web-modern/src/routes/app/
├── crm/
│   ├── index.tsx              # /app/crm — list view of quotes + activities sidebar
│   ├── kanban.tsx             # /app/crm/kanban — deals-by-stage board
│   ├── leads.tsx              # /app/crm/leads — lead capture + status tabs
│   ├── $quoteId.tsx           # /app/crm/$quoteId — quote detail + AI Action Panel
│   └── new.tsx                # /app/crm/new — create quote (inline form)
└── inventory/
    ├── index.tsx              # /app/inventory — list view of catalog items
    ├── stock.tsx              # /app/inventory/stock — stock balances per location
    ├── moves.tsx              # /app/inventory/moves — recent moves + new-move form
    └── $itemId.tsx            # /app/inventory/$itemId — item detail + AI Action Panel
```

The view-switcher lives at the top of `/app/crm` (List | Kanban) and `/app/inventory` (Catalog | Stock | Moves) — uses `?view=…` URL state via `nuqs` (or TanStack Router `validateSearch`).

## 4. Components to add

```
web-modern/src/components/
├── kanban/
│   └── KanbanBoard.tsx         # generic column board, drag-to-reorder (HTML5 DnD)
│       # — re-usable for projects/people in later phases
├── view-switcher/
│   └── ViewSwitcher.tsx        # tab bar that writes ?view= to URL
├── pricing/
│   └── PricingEvidence.tsx     # the quote-line chip with margin-status badge
├── stock-move/
│   └── StockMoveForm.tsx       # inline form for POST /api/inventory/moves
├── lead/
│   └── LeadCaptureForm.tsx     # inline form for POST /api/crm/leads
└── forecast/
    └── ForecastSummaryCard.tsx # weighted pipeline by stage
```

## 5. Pre-built agents (the new primitive)

The agent registry is a thin, typed module:

```
web-modern/src/lib/agents/
├── registry.ts                 # Agent[] — name, role, description, tools[], triggers[]
├── sales-quote.ts              # SalesQuoteAgent — proposes quote from deal + catalog
├── inventory-risk.ts           # InventoryRiskAgent — flags low-stock, suggests reorder
└── types.ts                    # Agent, AgentContext, AgentSuggestion, AgentAction
```

**Agent types:**
```ts
export interface AgentSuggestion {
  id: string;
  agentId: string;
  contextType: "crm.deal" | "crm.quote" | "catalog.item" | "inventory.balance";
  contextId: string;
  title: string;
  rationale: string;             // maps to WHY slot
  sourceRecords: string[];        // maps to SOURCE slot
  confidence: number;             // 0..1, maps to CONFIDENCE slot
  previewDiff: Record<string, unknown>;  // maps to WHAT WILL CHANGE slot
  risk: "low" | "medium" | "high";       // maps to RISK slot
  proposedAction: AgentAction;
}

export interface AgentAction {
  method: "POST" | "PATCH";
  path: string;                   // e.g. "/api/crm/quotes"
  body: Record<string, unknown>;
}
```

**How agents run in Phase 2 (no LLM dependency for V1):**
- Each agent has a **pure-function `evaluate(context)`** that returns `AgentSuggestion[]`
- Logic lives in TypeScript, not a prompt. E.g. InventoryRiskAgent's evaluate:
  - For each stock balance where `availableQuantity < reorderPoint`
  - Look up the item's `averageCost` and `leadTimeDays`
  - Suggest: `{ method: "POST", path: "/api/inventory/moves", body: { moveType: "receipt", catalogItemId, quantity: suggestedQty, unitCost: averageCost } }`
- Future phases swap the pure function for an LLM call (Vercel AI SDK v3) without changing the Decision Card contract

**Sales Quote Agent V1 logic:**
- For a deal with `customerId` and a list of `lines: { catalogItemId, quantity }`
- Calls `GET /api/catalog/pricing/resolve` for each line to get `unitPrice`, `discountPercent`, `marginStatus`
- Returns a `createQuote` suggestion with all lines pre-filled and margin alerts flagged

**Inventory Risk Agent V1 logic:**
- For each catalog item with `trackStock === true`
- Reads its stock balances across locations
- If `totalAvailable < reorderPoint` (a new field on the catalog item, default = `reorderPoint = 10`), propose a receipt
- If any `marginStatus === "below_minimum"` in the item's price-list entries, flag as "below-minimum margin"

## 6. How agents surface in the UI

**Right rail (AI Action Panel, Zoho pattern):**
- On `/app/crm/$quoteId` — runs Sales Quote Agent for that quote, shows 0-2 suggestions in the AI Action Panel as Decision Cards
- On `/app/inventory/$itemId` — runs Inventory Risk Agent for that item, shows suggestions

**Mission Control widget (Phase 1 already shows approval queue + recent runs):**
- Add a third widget: **"Top 5 inventory risks"** — flat list of `{ sku, name, available, reorderPoint, status: "low"|"out"|"healthy" }`
- Each row links to `/app/inventory/$itemId`

**Today feed (Phase 1 already shows exceptions):**
- Add a 4th widget: **"Draft quotes awaiting release"** — count of `quotes.filter(status === "draft")`, top 3 with link to `/app/crm`

## 7. Decision Card → approval flow

Phase 1 already has `ReplyDecisionCard` that POSTs to `/api/service/cases/:id/replies`. For Phase 2 the same Decision Card component is reused, but the action body is the agent's `proposedAction`. The flow:

1. AI Action Panel renders `DecisionCard` for each suggestion
2. User clicks **Approve** → calls `api(proposedAction.method, proposedAction.path, proposedAction.body)`
3. On success: `queryClient.invalidateQueries(...)` for the relevant query keys
4. On failure: show the error in the card, keep it open

We do **not** introduce a new `POST /api/agents/:id/execute` endpoint. The agent is a **client-side suggester**; the action is a **normal API call** the user could have made manually. This keeps the audit trail simple (the mutation lands in the same Fastify route as before) and means the agent never bypasses RBAC.

## 8. File-by-file plan (ordered for incremental verification)

| # | File | Action | Verifies |
|---|---|---|---|
| 2.1 | `web-modern/src/lib/api/schemas.ts` | Add Zod schemas: `CrmQuoteSchema`, `CrmActivitySchema`, `CrmLeadSchema`, `CrmForecastSchema`, `CatalogItemSchema`, `CatalogCategorySchema`, `PriceListSchema`, `MarginRuleSchema`, `StockBalanceSchema`, `StockMoveSchema`, `StockLocationSchema` | types |
| 2.2 | `web-modern/src/lib/api/schemas.test.ts` | +10 tests for new schemas (one accept + one reject each) | unit |
| 2.3 | `web-modern/src/lib/agents/types.ts` | New | types |
| 2.4 | `web-modern/src/lib/agents/sales-quote.ts` | New: `evaluate(deal): AgentSuggestion[]` | unit |
| 2.5 | `web-modern/src/lib/agents/inventory-risk.ts` | New: `evaluate(balances, items): AgentSuggestion[]` | unit |
| 2.6 | `web-modern/src/lib/agents/sales-quote.test.ts` | New: 3 tests | unit |
| 2.7 | `web-modern/src/lib/agents/inventory-risk.test.ts` | New: 4 tests (healthy/low/out/below-minimum) | unit |
| 2.8 | `web-modern/src/components/view-switcher/ViewSwitcher.tsx` | New: tab bar with `?view=` URL state | types |
| 2.9 | `web-modern/src/components/kanban/KanbanBoard.tsx` | New: generic column board with HTML5 DnD | types |
| 2.10 | `web-modern/src/components/pricing/PricingEvidence.tsx` | New: quote-line chip | types |
| 2.11 | `web-modern/src/components/stock-move/StockMoveForm.tsx` | New: inline form for POST moves | types |
| 2.12 | `web-modern/src/components/lead/LeadCaptureForm.tsx` | New: inline form for POST leads | types |
| 2.13 | `web-modern/src/components/forecast/ForecastSummaryCard.tsx` | New: weighted pipeline | types |
| 2.14 | `web-modern/src/routes/app/crm/index.tsx` | New: list view (Quotes + Activities sidebar) | E2E |
| 2.15 | `web-modern/src/routes/app/crm/kanban.tsx` | New: deals-by-stage board | E2E |
| 2.16 | `web-modern/src/routes/app/crm/leads.tsx` | New: lead capture + status tabs | E2E |
| 2.17 | `web-modern/src/routes/app/crm/$quoteId.tsx` | New: quote detail + AI Action Panel w/ SalesQuoteAgent | E2E |
| 2.18 | `web-modern/src/routes/app/crm/new.tsx` | New: create-quote sheet | E2E |
| 2.19 | `web-modern/src/routes/app/inventory/index.tsx` | New: catalog list view | E2E |
| 2.20 | `web-modern/src/routes/app/inventory/stock.tsx` | New: stock balances by location | E2E |
| 2.21 | `web-modern/src/routes/app/inventory/moves.tsx` | New: recent moves + StockMoveForm | E2E |
| 2.22 | `web-modern/src/routes/app/inventory/$itemId.tsx` | New: item detail + AI Action Panel w/ InventoryRiskAgent | E2E |
| 2.23 | `web-modern/src/routes/app/copilot.tsx` | Modify: add "Top 5 inventory risks" widget, "Draft quotes awaiting release" widget | E2E |
| 2.24 | `web-modern/src/routes/app/index.tsx` | Modify: add the two widgets above to the Today feed | E2E |
| 2.25 | `web-modern/src/components/command/AskCommandPalette.tsx` | Modify: add "Go to CRM" / "Go to Inventory" / "Reorder draft X" smart shortcuts | E2E |
| 2.26 | `web-modern/src/components/ui/HybridBadge.test.tsx` | +2 tests for the new "rule" colors | unit |
| 2.27 | `web-modern/src/lib/agents/sales-quote.test.ts` | +2 tests (no lines → empty; pricing missing → fallback) | unit |
| 2.28 | `web-modern/src/lib/agents/inventory-risk.test.ts` | +2 tests (multiple locations aggregated, zero stock out) | unit |
| 2.29 | full Playwright smoke | log in → /app/crm → click quote → see Decision Card → approve → see status change → /app/inventory/$itemId → see risk | E2E |
| 2.30 | `git add` + 3-4 commits (one per logical group: schemas, agents, routes+ui, command+widgets) | commit | merge |

**Commits (predicted, 4 total):**
1. `feat(api-schemas): add CRM + catalog + inventory Zod schemas` (1 file, 2-3 tests)
2. `feat(agents): Sales Quote + Inventory Risk agents (registry, types, logic, tests)` (5 files, 9 tests)
3. `feat(routes): CRM + Inventory pages with kanban, view-switcher, AI Action Panel` (10 files)
4. `feat(agentic-ui): extend Mission Control + Today feed + Ask command with Phase 2 widgets` (3 files)

## 9. Reuse from Phase 1

- `QueryClient` (singleton, `staleTime: 30s`) — every new route uses it
- `HybridBadge` — already covers `kind: "rule"` (deterministic) and `kind: "agent"` badges
- `DecisionCard` — reused as-is; agent suggestions pass the same `proposedAction` shape
- `AIActionPanel` — reused as-is; just feed it agent suggestions
- Zod body-cast pattern: `as unknown as Parameters<typeof api>[2]` — used everywhere we POST
- `validateSearch` for `?view=…` / `?status=…` URL state — same pattern as Phase 1 desk
- `?createTicket=1` auto-open form pattern — same for `?createQuote=1` / `?createMove=1`

## 10. Test strategy

**Unit (Vitest, node env):**
- All new Zod schemas: one accept + one reject per shape
- Agent logic: 9 tests covering happy path + edge cases (no lines, missing pricing, multiple locations, zero stock)

**E2E (Playwright, jsdom env):**
- New smoke journey: login → /app → click "Draft quotes" widget → /app/crm/$quoteId → see Sales Quote Agent suggestion → Approve → see toast → /app/inventory → click low-stock row → /app/inventory/$itemId → see Inventory Risk Agent suggestion

**Coverage target:** ≥80% on `web-modern/src/lib/agents/**` and new Zod schemas (per `~/.claude/rules/common/testing.md`).

## 11. Out of scope for Phase 2

- Real LLM calls in agents (V1 uses pure functions; V2 swaps in Vercel AI SDK v3)
- Calendar view (deferred to Phase 4)
- Drag-to-reorder in the deals kanban (rows show, but reordering uses a server PATCH not yet built — fine for V1)
- Workflow Builder (Phase 4)
- Russian localization for CRM/Inventory copy (English-only copy from legacy for V1)
- Bulk-edit on the inventory list

## 12. Verification (Definition of Done)

- [ ] All 6 todos (2.0 through 2.5) completed and committed
- [ ] `tsc --noEmit` exits 0 in `web-modern/`
- [ ] `npm test` passes with ≥80% coverage on agents and schemas
- [ ] Playwright smoke journey passes
- [ ] `git log` shows 4 clean commits, no `Co-Authored-By` trailers (per `~/.claude/rules/common/git-workflow.md`)
- [ ] `/app/crm` + `/app/inventory` reachable from the left rail and the ⌘K palette
- [ ] Both agents surface at least 1 Decision Card on a real `/api/crm/$id` and `/api/inventory/$id`
- [ ] Decision Card Approve → action executes → list refreshes
- [ ] Old Vite app at `web/` still untouched
