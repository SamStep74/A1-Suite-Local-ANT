/**
 * Login response schema — mirrors server/app.js#app.post("/api/login", ...).
 * Source: server/app.js:291-329
 */
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  org_id: z.string().optional(),
  role: z.string().optional(),
  locale: z.string().optional(),
  apps: z.array(z.string()).optional(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginResponseSchema = z.object({
  user: UserSchema,
  /**
   * Session token (sid) returned in the body. The new TanStack Start app
   * uses this for `Authorization: Bearer <sid>` because Chrome refuses to
   * store HttpOnly cookies on `credentials: "include"` CORS-mode responses
   * through the Vite dev proxy. See vite.config.ts for the bisection.
   * The legacy Vite app ignores the body field and uses the cookie.
   */
  sid: z.string().optional(),
  /** True if MFA is required; in that case the user must complete /api/login/mfa. */
  mfaRequired: z.boolean().optional(),
});

export const MfaChallengeSchema = z.object({
  challengeId: z.string(),
  method: z.enum(["totp", "email", "sms"]),
});

/* ──────────────────────────────────────────────────────────────────────
 * Service / Desk schemas — mirror server/app.js#formatServiceCase
 * (server/app.js:54425) and /api/service/console (server/app.js:4612).
 * The legacy app surfaces service-cases as "Desk tickets". We use the
 * same shape so the new app and the legacy app share one truth.
 * ──────────────────────────────────────────────────────────────────── */

export const ServiceCaseStatus = z.enum([
  "open",
  "in-progress",
  "waiting-customer",
  "escalated",
  "resolved",
  "closed",
]);
export type ServiceCaseStatus = z.infer<typeof ServiceCaseStatus>;

export const ServiceCasePriority = z.enum(["low", "medium", "high"]);
export type ServiceCasePriority = z.infer<typeof ServiceCasePriority>;

export const SlaStatus = z.enum(["on-track", "at-risk", "breached"]);
export type SlaStatus = z.infer<typeof SlaStatus>;

export const ServiceCaseSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  taxId: z.string().nullable().optional(),
  ticketId: z.string().nullable().optional(),
  caseNumber: z.string(),
  subject: z.string(),
  status: ServiceCaseStatus,
  priority: ServiceCasePriority,
  channel: z.string(),
  ownerName: z.string().nullable().optional(),
  slaDueAt: z.string().nullable().optional(),
  slaStatus: SlaStatus.nullable().optional(),
  aiSuggestion: z.string().nullable().optional(),
  knowledgeArticle: z.string().nullable().optional(),
  messageCount: z.number().optional(),
  updatedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});
export type ServiceCase = z.infer<typeof ServiceCaseSchema>;

/** Customer option (used in CreateTicketForm). Source: server/app.js:4627. */
export const CustomerOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type CustomerOption = z.infer<typeof CustomerOptionSchema>;

/** Agent (user) option (used for ticket assignment). Source: server/app.js:4628. */
export const AgentOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable().optional(),
});
export type AgentOption = z.infer<typeof AgentOptionSchema>;

/** Workflow approval — for the Today feed's "Awaiting your approval" widget.
 *  Source: server/app.js:4619. */
export const WorkflowApprovalSchema = z.object({
  id: z.string(),
  status: z.string(),
  // Loose typing: backend has rich fields (ruleId, subjectType, ...) but
  // the widget only needs id + status + a label. Tighten later if needed.
}).passthrough();
export type WorkflowApproval = z.infer<typeof WorkflowApprovalSchema>;

/** Workflow run — one execution of a rule. Source: /api/service/console#runs.
 *  Status values observed: "pending" | "completed" | "failed". */
export const WorkflowRunStatus = z.enum(["pending", "running", "completed", "failed", "rolled-back"]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const WorkflowRunSchema = z.object({
  id: z.string(),
  approvalId: z.string().nullable().optional(),
  ruleId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  actionKey: z.string(),
  status: WorkflowRunStatus,
  resultType: z.string().nullable().optional(),
  resultId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

/** Automation rule — the deterministic side of the agentic workspace.
 *  Source: /api/service/console#rules. */
export const WorkflowRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: z.string(),
  action: z.string(),
  enabled: z.boolean(),
  currentVersion: z.number().optional(),
  lastVersion: z.record(z.string(), z.unknown()).nullable().optional(),
  ownerRole: z.string().nullable().optional(),
  approvalRequired: z.boolean().optional(),
  lastDryRun: z.record(z.string(), z.unknown()).nullable().optional(),
  lastTestEvent: z.record(z.string(), z.unknown()).nullable().optional(),
}).passthrough();
export type WorkflowRule = z.infer<typeof WorkflowRuleSchema>;

/** Top-level /api/service/console response — feeds the Today page and
 *  the Desk list/detail. Source: server/app.js:4612. */
export const ServiceConsoleSchema = z.object({
  cases: z.array(ServiceCaseSchema),
  queue: z.array(z.unknown()),
  escalations: z.array(z.unknown()),
  resolutions: z.array(z.unknown()),
  approvals: z.array(WorkflowApprovalSchema),
  runs: z.array(WorkflowRunSchema),
  rules: z.array(WorkflowRuleSchema),
  dryRuns: z.array(z.unknown()),
  testEvents: z.array(z.unknown()),
  ticketSummaries: z.array(z.unknown()).optional(),
  workflowBuilderSuggestions: z.array(z.unknown()).optional(),
  knowledge: z.array(z.unknown()).optional(),
  customers: z.array(CustomerOptionSchema),
  agents: z.array(AgentOptionSchema),
});
export type ServiceConsole = z.infer<typeof ServiceConsoleSchema>;

/** /api/service/cases POST response — wraps the new case + recent events.
 *  Source: server/app.js:4689. */
export const CreateServiceCaseResponseSchema = z.object({
  ok: z.literal(true),
  case: ServiceCaseSchema,
  events: z.array(z.unknown()),
});
export type CreateServiceCaseResponse = z.infer<typeof CreateServiceCaseResponseSchema>;

/** PATCH /api/service/cases/:id response — wraps the updated case.
 *  Source: server/app.js:4786. */
export const UpdateServiceCaseResponseSchema = z.object({
  ok: z.literal(true),
  case: ServiceCaseSchema,
});
export type UpdateServiceCaseResponse = z.infer<typeof UpdateServiceCaseResponseSchema>;

/** Inputs for create / update. Mirrors the legacy FormData shape so the
 *  legacy `desk.jsx` create form can be ported verbatim. */
export const CreateServiceCaseInputSchema = z.object({
  customerId: z.string().min(1, "Pick a customer"),
  subject: z.string().min(4, "Subject must be at least 4 characters"),
  priority: ServiceCasePriority.default("medium"),
  channel: z.string().default("Manual"),
});
export type CreateServiceCaseInput = z.infer<typeof CreateServiceCaseInputSchema>;

export const UpdateServiceCaseInputSchema = z
  .object({
    status: ServiceCaseStatus.optional(),
    priority: ServiceCasePriority.optional(),
    ownerUserId: z.string().optional(),
  })
  .strict();
export type UpdateServiceCaseInput = z.infer<typeof UpdateServiceCaseInputSchema>;

/* ──────────────────────────────────────────────────────────────────────
 * CRM schemas — mirror server/app.js#getQuotes / #getCrmLeads /
 * #getCrmForecastSummary / #getCrmActivities (server/app.js:2709-2720,
 * 2737-2746, 2716, 2857-2872). The legacy CRM module (web/src/crm.jsx)
 * reads these envelopes; the new app uses the same shapes.
 * ──────────────────────────────────────────────────────────────────── */

/** Quote line item — pricing-evidence chip source.
 *  Source: server/app.js#getQuoteLines (used inside #getQuotes). */
export const CrmQuoteLineSchema = z.object({
  id: z.string(),
  catalogItemId: z.string().nullable().optional(),
  catalogItemVariantId: z.string().nullable().optional(),
  catalogPriceListId: z.string().nullable().optional(),
  catalogPriceListCode: z.string().nullable().optional(),
  pricingSource: z.string().nullable().optional(),
  pricingCustomerSegment: z.string().nullable().optional(),
  discountAmount: z.number().nullable().optional(),
  marginStatus: z.string().nullable().optional(),
  marginRuleCode: z.string().nullable().optional(),
  marginRuleMinimumPercent: z.number().nullable().optional(),
  marginRuleTargetPercent: z.number().nullable().optional(),
  catalogSku: z.string().nullable().optional(),
  catalogName: z.string().nullable().optional(),
  variantSku: z.string().nullable().optional(),
  variantName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  vatMode: z.string().nullable().optional(),
  fiscalReceiptRequired: z.boolean().optional(),
  position: z.number().optional(),
}).passthrough();
export type CrmQuoteLine = z.infer<typeof CrmQuoteLineSchema>;

/** Quote — the document Armosphera calls a "quote" (also used for
 *  invoices, acceptances, public tokens). Source: server/app.js#getQuotes. */
export const CrmQuoteStatus = z.enum(["draft", "sent", "accepted", "declined", "expired"]);
export type CrmQuoteStatus = z.infer<typeof CrmQuoteStatus>;

export const CrmQuoteSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  taxId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  dealTitle: z.string().nullable().optional(),
  dealStage: z.string().nullable().optional(),
  number: z.string().nullable().optional(),
  title: z.string(),
  status: CrmQuoteStatus,
  subtotal: z.number().nullable().optional(),
  vat: z.number().nullable().optional(),
  total: z.number(),
  currency: z.string().optional(),
  validUntil: z.string().nullable().optional(),
  publicToken: z.string().nullable().optional(),
  acceptanceUrl: z.string().nullable().optional(),
  sentAt: z.string().nullable().optional(),
  acceptedAt: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  lines: z.array(CrmQuoteLineSchema).optional(),
}).passthrough();
export type CrmQuote = z.infer<typeof CrmQuoteSchema>;

export const CrmQuotesResponseSchema = z.object({
  quotes: z.array(CrmQuoteSchema),
});
export type CrmQuotesResponse = z.infer<typeof CrmQuotesResponseSchema>;

/** Activity — one event in the CRM timeline. Source: /api/crm/activities. */
export const CrmActivityKind = z.enum([
  "conversion",
  "quote_sent",
  "quote_accepted",
  "quote_declined",
  "note",
  "call",
  "email",
  "task_completed",
]);
export type CrmActivityKind = z.infer<typeof CrmActivityKind>;

export const CrmActivitySchema = z.object({
  id: z.string(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  dealTitle: z.string().nullable().optional(),
  kind: CrmActivityKind.or(z.string()),
  title: z.string(),
  body: z.string().nullable().optional(),
  forecastCategory: z.string().nullable().optional(),
  actorName: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
}).passthrough();
export type CrmActivity = z.infer<typeof CrmActivitySchema>;

export const CrmActivitiesResponseSchema = z.object({
  activities: z.array(CrmActivitySchema),
});
export type CrmActivitiesResponse = z.infer<typeof CrmActivitiesResponseSchema>;

/** Lead — pre-conversion contact. Source: /api/crm/leads. */
export const CrmLeadStatus = z.enum(["new", "qualifying", "qualified", "converted", "rejected"]);
export type CrmLeadStatus = z.infer<typeof CrmLeadStatus>;

export const CrmLeadSchema = z.object({
  id: z.string(),
  companyName: z.string(),
  contactName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  segment: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
  interest: z.string().nullable().optional(),
  estimatedValue: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  consentStatus: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  rating: z.string().nullable().optional(),
  status: CrmLeadStatus,
  routedToUserId: z.string().nullable().optional(),
  routedToName: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  convertedCustomerId: z.string().nullable().optional(),
  convertedCustomerName: z.string().nullable().optional(),
  convertedDealId: z.string().nullable().optional(),
  convertedDealTitle: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  convertedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type CrmLead = z.infer<typeof CrmLeadSchema>;

export const CrmLeadSummarySchema = z.object({
  total: z.number(),
  qualifiedPipeline: z.number().optional(),
  converted: z.number().optional(),
  hot: z.number().optional(),
  byStatus: z.array(z.object({
    status: z.string(),
    count: z.number(),
    value: z.number().optional(),
  })).optional(),
}).passthrough();
export type CrmLeadSummary = z.infer<typeof CrmLeadSummarySchema>;

export const CrmLeadsResponseSchema = z.object({
  leads: z.array(CrmLeadSchema),
  summary: CrmLeadSummarySchema.optional(),
});
export type CrmLeadsResponse = z.infer<typeof CrmLeadsResponseSchema>;

/** Lead capture input. */
export const CreateCrmLeadInputSchema = z.object({
  companyName: z.string().min(2, "Company name required"),
  contactName: z.string().min(2, "Contact name required"),
  email: z.string().email("Valid email required"),
  phone: z.string().min(4, "Phone required"),
  interest: z.string().min(4, "Describe the interest"),
  segment: z.string().optional(),
  source: z.string().optional(),
  channel: z.string().optional(),
  estimatedValue: z.number().optional(),
  currency: z.string().default("AMD"),
});
export type CreateCrmLeadInput = z.infer<typeof CreateCrmLeadInputSchema>;

/** Forecast — deal-stage weighted pipeline. Source: /api/crm/forecast. */
export const CrmForecastStage = z.enum(["Discovery", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
export type CrmForecastStage = z.infer<typeof CrmForecastStage>;

export const CrmForecastDealSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  title: z.string(),
  stage: CrmForecastStage.or(z.string()),
  value: z.number(),
  currency: z.string().optional(),
  probability: z.number().nullable().optional(),
  nextStep: z.string().nullable().optional(),
  forecastId: z.string().nullable().optional(),
  forecastCategory: z.string().nullable().optional(),
  closeDate: z.string().nullable().optional(),
  weightedValue: z.number().nullable().optional(),
  healthScore: z.number().nullable().optional(),
  healthStatus: z.string().nullable().optional(),
  healthReasons: z.array(z.string()).optional(),
  managerNote: z.string().nullable().optional(),
  forecastUpdatedAt: z.string().nullable().optional(),
}).passthrough();
export type CrmForecastDeal = z.infer<typeof CrmForecastDealSchema>;

export const CrmForecastSchema = z.object({
  categories: z.array(z.object({
    forecastCategory: z.string(),
    count: z.number(),
    value: z.number(),
    weightedValue: z.number().optional(),
  }).passthrough()),
  deals: z.array(CrmForecastDealSchema),
  dealRiskBriefs: z.array(z.unknown()),
  totals: z.object({
    value: z.number(),
    weightedValue: z.number().optional(),
    atRisk: z.number().optional(),
    unreviewed: z.number().optional(),
  }).passthrough(),
}).passthrough();
export type CrmForecast = z.infer<typeof CrmForecastSchema>;

/* ──────────────────────────────────────────────────────────────────────
 * Catalog & Inventory schemas — mirror server/app.js#registerApi at
 * /api/catalog/{items,categories,price-lists,margin-rules} and
 * /api/inventory/{stock,moves,locations} (server/app.js:454-545, 521-545).
 * All have rich fields the legacy uses; the new app reads a small subset
 * and is permissive for the rest.
 * ──────────────────────────────────────────────────────────────────── */

export const CatalogItemType = z.enum(["stockable", "service", "bundle"]);
export type CatalogItemType = z.infer<typeof CatalogItemType>;

export const CatalogItemStatus = z.enum(["active", "archived", "draft"]);
export type CatalogItemStatus = z.infer<typeof CatalogItemStatus>;

export const CatalogVariantSchema = z.object({
  id: z.string(),
  catalogItemId: z.string(),
  sku: z.string(),
  name: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  unitOfMeasure: z.string().optional(),
  listPrice: z.number().optional(),
  standardCost: z.number().optional(),
  marginAmount: z.number().optional(),
  marginPercent: z.number().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type CatalogVariant = z.infer<typeof CatalogVariantSchema>;

export const CatalogItemSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  itemType: CatalogItemType.or(z.string()),
  status: CatalogItemStatus.or(z.string()),
  unitOfMeasure: z.string().optional(),
  listPrice: z.number().optional(),
  standardCost: z.number().optional(),
  marginAmount: z.number().optional(),
  marginPercent: z.number().optional(),
  currency: z.string().optional(),
  vatMode: z.string().optional(),
  trackStock: z.boolean().optional(),
  trackLots: z.boolean().optional(),
  fiscalReceiptRequired: z.boolean().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  variants: z.array(CatalogVariantSchema).optional(),
  variantCount: z.number().optional(),
}).passthrough();
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const CatalogCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable().optional(),
  parentCategoryId: z.string().nullable().optional(),
  status: z.string().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

export const MarginRuleSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  scopeType: z.string(),
  scopeValue: z.string().nullable().optional(),
  minimumMarginPercent: z.number().optional(),
  targetMarginPercent: z.number().optional(),
  status: z.string().optional(),
}).passthrough();
export type MarginRule = z.infer<typeof MarginRuleSchema>;

export const PriceListItemSchema = z.object({
  id: z.string(),
  priceListId: z.string(),
  catalogItemId: z.string(),
  catalogSku: z.string().optional(),
  catalogName: z.string().optional(),
  catalogItemVariantId: z.string().nullable().optional(),
  variantSku: z.string().optional(),
  variantName: z.string().optional(),
  minQuantity: z.number().optional(),
  listPrice: z.number().optional(),
  discountPercent: z.number().optional(),
  discountAmount: z.number().optional(),
  netPrice: z.number().optional(),
  standardCost: z.number().optional(),
  marginAmount: z.number().optional(),
  marginPercent: z.number().optional(),
  marginRuleCode: z.string().optional(),
  minimumMarginPercent: z.number().optional(),
  targetMarginPercent: z.number().optional(),
  marginStatus: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
}).passthrough();
export type PriceListItem = z.infer<typeof PriceListItemSchema>;

export const PriceListSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  customerSegment: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  items: z.array(PriceListItemSchema).optional(),
}).passthrough();
export type PriceList = z.infer<typeof PriceListSchema>;

export const CatalogItemsResponseSchema = z.object({
  items: z.array(CatalogItemSchema),
  categories: z.array(CatalogCategorySchema).optional(),
  unitsOfMeasure: z.array(z.unknown()).optional(),
  marginRules: z.array(MarginRuleSchema).optional(),
  priceLists: z.array(PriceListSchema).optional(),
});
export type CatalogItemsResponse = z.infer<typeof CatalogItemsResponseSchema>;

/** Stock balance — a (catalogItemId, locationId) row.
 *  Source: /api/inventory/stock. */
export const StockBalanceSchema = z.object({
  id: z.string(),
  catalogItemId: z.string(),
  catalogSku: z.string().nullable().optional(),
  catalogName: z.string().nullable().optional(),
  locationId: z.string(),
  locationCode: z.string().optional(),
  locationName: z.string().nullable().optional(),
  locationType: z.string().optional(),
  quantity: z.number(),
  reservedQuantity: z.number().optional(),
  availableQuantity: z.number(),
  averageCost: z.number().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type StockBalance = z.infer<typeof StockBalanceSchema>;

/** Stock location — WH/STOCK, CUSTOMERS, SCRAP, etc.
 *  Source: /api/inventory/locations. */
export const StockLocationSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  locationType: z.string(),
  status: z.string().optional(),
  parentLocationId: z.string().nullable().optional(),
}).passthrough();
export type StockLocation = z.infer<typeof StockLocationSchema>;

export const StockResponseSchema = z.object({
  stock: z.array(StockBalanceSchema),
  locations: z.array(StockLocationSchema).optional(),
});
export type StockResponse = z.infer<typeof StockResponseSchema>;

/** Stock move — one transfer / receipt / delivery / adjustment / scrap event.
 *  Source: /api/inventory/moves. */
export const StockMoveType = z.enum(["transfer", "receipt", "delivery", "adjustment", "scrap"]);
export type StockMoveType = z.infer<typeof StockMoveType>;

export const StockMoveSchema = z.object({
  id: z.string(),
  catalogItemId: z.string(),
  catalogSku: z.string().nullable().optional(),
  catalogName: z.string().nullable().optional(),
  sourceLocationId: z.string().nullable().optional(),
  sourceLocationCode: z.string().nullable().optional(),
  sourceLocationName: z.string().nullable().optional(),
  sourceLocationType: z.string().nullable().optional(),
  destinationLocationId: z.string().nullable().optional(),
  destinationLocationCode: z.string().nullable().optional(),
  destinationLocationName: z.string().nullable().optional(),
  destinationLocationType: z.string().nullable().optional(),
  moveType: StockMoveType.or(z.string()),
  quantity: z.number(),
  unitCost: z.number().optional(),
  totalCost: z.number().optional(),
  status: z.string().optional(),
  reason: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
}).passthrough();
export type StockMove = z.infer<typeof StockMoveSchema>;

export const StockMovesResponseSchema = z.object({
  moves: z.array(StockMoveSchema),
});
export type StockMovesResponse = z.infer<typeof StockMovesResponseSchema>;

/** Input for POST /api/inventory/moves. The backend tolerates extra fields. */
export const CreateStockMoveInputSchema = z.object({
  catalogItemId: z.string().min(1),
  sourceLocationId: z.string().optional(),
  destinationLocationId: z.string().optional(),
  moveType: StockMoveType,
  quantity: z.number().min(1),
  unitCost: z.number().min(0).optional(),
  reason: z.string().optional(),
  reference: z.string().optional(),
});
export type CreateStockMoveInput = z.infer<typeof CreateStockMoveInputSchema>;

export const CreateStockMoveResponseSchema = z.object({
  ok: z.literal(true),
  move: StockMoveSchema,
  stock: z.array(StockBalanceSchema).optional(),
});
export type CreateStockMoveResponse = z.infer<typeof CreateStockMoveResponseSchema>;

/* ──────────────────────────────────────────────────────────────────────
 * Finance schemas — mirror server/app.js#getFinancePeriods /
 * #getFinanceDraftInvoices / #getFinancePayments /
 * #formatFinanceDraftInvoice / #formatFinancePayment.
 * (server/app.js:61305, 61418, 61590, 61451, 61650)
 *
 * The new TanStack-Start Finance workspace surfaces invoices, periods,
 * and payments. Trial-balance, statements, VAT-returns, expenses, bills,
 * payables, and the chart-of-accounts live in the legacy web/src/finance.jsx
 * for now (Phase 4 follow-up).
 * ──────────────────────────────────────────────────────────────────── */

/** Finance period — a month-closeable accounting bucket. Status values:
 *  'open' (still mutable) or 'closed' (locked). Source: #formatFinancePeriod. */
export const FinancePeriodStatus = z.enum(["open", "closed"]);
export type FinancePeriodStatus = z.infer<typeof FinancePeriodStatus>;

export const FinancePeriodSchema = z.object({
  id: z.string(),
  periodKey: z.string(),
  startsOn: z.string().nullable().optional(),
  endsOn: z.string().nullable().optional(),
  status: FinancePeriodStatus.or(z.string()),
  closedAt: z.string().nullable().optional(),
  closedByUserId: z.string().nullable().optional(),
  closedByName: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type FinancePeriod = z.infer<typeof FinancePeriodSchema>;

export const FinancePeriodsResponseSchema = z.object({
  periods: z.array(FinancePeriodSchema),
});
export type FinancePeriodsResponse = z.infer<typeof FinancePeriodsResponseSchema>;

/** Draft invoice — pre-posting sales document. Source: #formatFinanceDraftInvoice. */
export const FinanceDraftInvoiceStatus = z.enum(["draft", "posted", "cancelled"]);
export type FinanceDraftInvoiceStatus = z.infer<typeof FinanceDraftInvoiceStatus>;

export const FinanceDraftInvoiceSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  dealId: z.string().nullable().optional(),
  dealTitle: z.string().nullable().optional(),
  number: z.string().nullable().optional(),
  status: FinanceDraftInvoiceStatus.or(z.string()),
  subtotal: z.number().nullable().optional(),
  vat: z.number().nullable().optional(),
  total: z.number(),
  currency: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  periodKey: z.string().nullable().optional(),
  sourceKey: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type FinanceDraftInvoice = z.infer<typeof FinanceDraftInvoiceSchema>;

export const FinanceDraftInvoicesResponseSchema = z.object({
  draftInvoices: z.array(FinanceDraftInvoiceSchema),
});
export type FinanceDraftInvoicesResponse = z.infer<typeof FinanceDraftInvoicesResponseSchema>;

/** Payment — a settlement against an invoice. Source: #formatFinancePayment. */
export const FinancePaymentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  invoiceId: z.string(),
  invoiceNumber: z.string().nullable().optional(),
  amount: z.number(),
  currency: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  periodKey: z.string().nullable().optional(),
  sourceKey: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
}).passthrough();
export type FinancePayment = z.infer<typeof FinancePaymentSchema>;

export const FinancePaymentsResponseSchema = z.object({
  payments: z.array(FinancePaymentSchema),
});
export type FinancePaymentsResponse = z.infer<typeof FinancePaymentsResponseSchema>;

/** Tax rate — kind, effective date, numeric rate. Source: /api/finance/tax-rates. */
export const FinanceTaxRateSchema = z.object({
  kind: z.string(),
  effectiveDate: z.string().nullable().optional(),
  rate: z.number().nullable().optional(),
  note: z.string().nullable().optional(),
}).passthrough();
export type FinanceTaxRate = z.infer<typeof FinanceTaxRateSchema>;

export const FinanceTaxRatesResponseSchema = z.object({
  taxRates: z.array(FinanceTaxRateSchema),
});
export type FinanceTaxRatesResponse = z.infer<typeof FinanceTaxRatesResponseSchema>;

/** A line in the trial balance or chart of accounts. Source: /api/finance/chart-of-accounts. */
export const FinanceChartAccountSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  normalSide: z.string().nullable().optional(),
}).passthrough();
export type FinanceChartAccount = z.infer<typeof FinanceChartAccountSchema>;

export const FinanceChartOfAccountsResponseSchema = z.object({
  accounts: z.array(FinanceChartAccountSchema),
});
export type FinanceChartOfAccountsResponse = z.infer<typeof FinanceChartOfAccountsResponseSchema>;

/* ──────────────────────────────────────────────────────────────────────
 * People / HR schemas — mirror server/app.js lines 5939-5978.
 * The People workspace in Phase 3 is the employee registry + payroll
 * history. The deeper HR sub-modules (contracts, leave, trips,
 * timesheets, KPIs, equipment, recruitment, orders, AI) land in
 * Phase 4 — we model only the read+run payroll surface here.
 * ──────────────────────────────────────────────────────────────────── */

export const PeopleEmploymentStatus = z.enum([
  "active",
  "on-leave",
  "terminated",
]);
export type PeopleEmploymentStatus = z.infer<typeof PeopleEmploymentStatus>;

export const PeopleEmployeeSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  taxId: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  grossSalary: z.number().nullable().optional(),
  employmentStatus: PeopleEmploymentStatus.or(z.string()),
  hireDate: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type PeopleEmployee = z.infer<typeof PeopleEmployeeSchema>;

export const PeopleEmployeesResponseSchema = z.object({
  employees: z.array(PeopleEmployeeSchema),
});
export type PeopleEmployeesResponse = z.infer<typeof PeopleEmployeesResponseSchema>;

/** A single payroll run against one employee. Source: #formatPeoplePayrollRun. */
export const PeoplePayrollRunSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string().nullable().optional(),
  gross: z.number(),
  incomeTax: z.number(),
  pension: z.number(),
  stampDuty: z.number(),
  totalDeductions: z.number(),
  net: z.number(),
  runDate: z.string().nullable().optional(),
  periodKey: z.string().nullable().optional(),
}).passthrough();
export type PeoplePayrollRun = z.infer<typeof PeoplePayrollRunSchema>;

export const PeoplePayrollRunsResponseSchema = z.object({
  runs: z.array(PeoplePayrollRunSchema),
});
export type PeoplePayrollRunsResponse = z.infer<typeof PeoplePayrollRunsResponseSchema>;

/* ──────────────────────────────────────────────────────────────────────
 * Purchase schemas — mirror server/app.js lines 51670-52144.
 * The Purchase workspace in Phase 3 is the vendor registry + purchase
 * orders + analytics overview. The deeper procurement sub-module
 * (requisitions, RFQs, quotes, awards, receipts) lands in Phase 4.
 * ──────────────────────────────────────────────────────────────────── */

export const PurchaseVendorStatus = z.enum(["active", "inactive", "blocked"]);
export type PurchaseVendorStatus = z.infer<typeof PurchaseVendorStatus>;

export const PurchaseVendorPriceSchema = z.object({
  id: z.string(),
  vendorId: z.string(),
  catalogItemId: z.string(),
  catalogSku: z.string().nullable().optional(),
  catalogName: z.string().nullable().optional(),
  unitOfMeasure: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  unitCost: z.number().nullable().optional(),
  minQuantity: z.number().nullable().optional(),
  leadTimeDays: z.number().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();
export type PurchaseVendorPrice = z.infer<typeof PurchaseVendorPriceSchema>;

export const PurchaseVendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  taxId: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  status: PurchaseVendorStatus.or(z.string()),
  paymentTermsDays: z.number().nullable().optional(),
  leadTimeDays: z.number().nullable().optional(),
  note: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  prices: z.array(PurchaseVendorPriceSchema).optional(),
}).passthrough();
export type PurchaseVendor = z.infer<typeof PurchaseVendorSchema>;

export const PurchaseVendorsResponseSchema = z.object({
  vendors: z.array(PurchaseVendorSchema),
});
export type PurchaseVendorsResponse = z.infer<typeof PurchaseVendorsResponseSchema>;

/** A purchase order line. Source: #formatPurchaseOrderLine. */
export const PurchaseOrderLineSchema = z.object({
  id: z.string(),
  purchaseOrderId: z.string(),
  catalogItemId: z.string().nullable().optional(),
  vendorPriceId: z.string().nullable().optional(),
  catalogSku: z.string().nullable().optional(),
  catalogName: z.string().nullable().optional(),
  unitOfMeasure: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  quantity: z.number(),
  receivedQuantity: z.number().nullable().optional(),
  returnedQuantity: z.number().nullable().optional(),
  remainingQuantity: z.number().nullable().optional(),
  unitCost: z.number().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  vat: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
}).passthrough();
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

export const PurchaseOrderStatus = z.enum([
  "draft",
  "confirmed",
  "partial",
  "received",
  "billed",
  "cancelled",
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatus>;

export const PurchaseOrderSchema = z.object({
  id: z.string(),
  vendorId: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  orderNumber: z.string().nullable().optional(),
  supplier: z.string().nullable().optional(),
  status: PurchaseOrderStatus.or(z.string()),
  subtotal: z.number().nullable().optional(),
  vat: z.number().nullable().optional(),
  total: z.number(),
  currency: z.string().nullable().optional(),
  orderDate: z.string().nullable().optional(),
  expectedDate: z.string().nullable().optional(),
  confirmedAt: z.string().nullable().optional(),
  receivedAt: z.string().nullable().optional(),
  billId: z.string().nullable().optional(),
  billStatus: z.string().nullable().optional(),
  orderedQuantity: z.number().nullable().optional(),
  receivedQuantity: z.number().nullable().optional(),
  remainingQuantity: z.number().nullable().optional(),
  note: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  lines: z.array(PurchaseOrderLineSchema).optional(),
}).passthrough();
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export const PurchaseOrdersResponseSchema = z.object({
  orders: z.array(PurchaseOrderSchema),
});
export type PurchaseOrdersResponse = z.infer<typeof PurchaseOrdersResponseSchema>;

/** Analytics summary — exposed by /api/purchase/analytics. */
export const PurchaseAnalyticsSummarySchema = z.object({
  orderCount: z.number(),
  vendorCount: z.number(),
  activeVendorCount: z.number(),
  openValue: z.number(),
  billedValue: z.number(),
  receiptProgressPercent: z.number().nullable().optional(),
  returnedQuantity: z.number().nullable().optional(),
  remainingQuantity: z.number().nullable().optional(),
  vendorPricedLineCount: z.number().nullable().optional(),
  lineCount: z.number().nullable().optional(),
  vendorPriceCoveragePercent: z.number().nullable().optional(),
  pricedOrderLinePercent: z.number().nullable().optional(),
  activePriceCount: z.number().nullable().optional(),
  stockableCatalogItemCount: z.number().nullable().optional(),
}).passthrough();
export type PurchaseAnalyticsSummary = z.infer<typeof PurchaseAnalyticsSummarySchema>;

export const PurchaseAnalyticsResponseSchema = z.object({
  summary: PurchaseAnalyticsSummarySchema,
  receiptBacklog: z.array(z.unknown()),
  vendorPerformance: z.array(z.unknown()),
  priceCoverage: z.unknown(),
}).passthrough();
export type PurchaseAnalyticsResponse = z.infer<typeof PurchaseAnalyticsResponseSchema>;

/* ──────────────────────────────────────────────────────────────────────
 * Docs & Sign schemas — mirror server/app.js (getDocument, getSignaturePackets,
 * /api/docs/templates). State machine: draft → out-for-signature → signed
 * (terminal) | voided (terminal).
 * ──────────────────────────────────────────────────────────────────── */

export const DocsDocumentStatus = z.enum([
  "draft",
  "out-for-signature",
  "signed",
  "voided",
]);
export type DocsDocumentStatus = z.infer<typeof DocsDocumentStatus>;

export const DocsSignerStatus = z.enum([
  "pending",
  "signed",
  "declined",
  "voided",
]);
export type DocsSignerStatus = z.infer<typeof DocsSignerStatus>;

export const DocsSignerSchema = z.object({
  id: z.string(),
  signerName: z.string(),
  signerEmail: z.string().nullable().optional(),
  signerUserId: z.string().nullable().optional(),
  signOrder: z.number(),
  status: DocsSignerStatus.or(z.string()),
  signedAt: z.string().nullable().optional(),
  checksum: z.string().nullable().optional(),
}).passthrough();
export type DocsSigner = z.infer<typeof DocsSignerSchema>;

export const DocsDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  docType: z.string(),
  status: DocsDocumentStatus.or(z.string()),
  customerId: z.string().nullable().optional(),
  sealedChecksum: z.string().nullable().optional(),
  sealedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  signers: z.array(DocsSignerSchema).optional(),
}).passthrough();
export type DocsDocument = z.infer<typeof DocsDocumentSchema>;

export const DocsDocumentsResponseSchema = z.object({
  documents: z.array(DocsDocumentSchema),
});
export type DocsDocumentsResponse = z.infer<typeof DocsDocumentsResponseSchema>;

export const DocsDocumentEnvelopeSchema = z.object({
  document: DocsDocumentSchema,
});
export type DocsDocumentEnvelope = z.infer<typeof DocsDocumentEnvelopeSchema>;

/** Signature packet — a quote-backed e-signature flow. */
export const DocsSignaturePacketStatus = z.enum([
  "draft",
  "sent",
  "signed",
  "voided",
  "expired",
]);
export type DocsSignaturePacketStatus = z.infer<typeof DocsSignaturePacketStatus>;

export const DocsSignaturePacketSchema = z.object({
  id: z.string(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  quoteId: z.string().nullable().optional(),
  quoteNumber: z.string().nullable().optional(),
  acceptanceId: z.string().nullable().optional(),
  legalSourceId: z.string().nullable().optional(),
  status: DocsSignaturePacketStatus.or(z.string()),
  checksum: z.string().nullable().optional(),
  payload: z.unknown().nullable().optional(),
  note: z.string().nullable().optional(),
  sourceKey: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  createdByName: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
}).passthrough();
export type DocsSignaturePacket = z.infer<typeof DocsSignaturePacketSchema>;

export const DocsSignaturePacketsResponseSchema = z.object({
  packets: z.array(DocsSignaturePacketSchema),
});
export type DocsSignaturePacketsResponse = z.infer<typeof DocsSignaturePacketsResponseSchema>;

/** Template — drives generate → draft document. */
export const DocsTemplateVariableSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  required: z.boolean().optional(),
});
export type DocsTemplateVariable = z.infer<typeof DocsTemplateVariableSchema>;

export const DocsTemplateSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  docType: z.string(),
  titleTemplate: z.string(),
  bodyTemplate: z.string(),
  variables: z.array(DocsTemplateVariableSchema).optional(),
}).passthrough();
export type DocsTemplate = z.infer<typeof DocsTemplateSchema>;

export const DocsTemplatesResponseSchema = z.object({
  templates: z.array(DocsTemplateSchema),
});
export type DocsTemplatesResponse = z.infer<typeof DocsTemplatesResponseSchema>;

/* ────────── CFO ────────── */

export const CfoCashFlowWeekSchema = z
  .object({
    weekKey: z.string(),
    inflow: z.number().int().nonnegative(),
    outflow: z.number().int().nonnegative(),
    net: z.number().int(),
    closing: z.number().int(),
  })
  .passthrough();
export type CfoCashFlowWeek = z.infer<typeof CfoCashFlowWeekSchema>;

export const CfoCashFlowSchema = z
  .object({
    openingAmd: z.number().int(),
    closingAmd: z.number().int(),
    weekly: z.array(CfoCashFlowWeekSchema),
  })
  .passthrough();
export type CfoCashFlow = z.infer<typeof CfoCashFlowSchema>;

export const CfoCashFlowResponseSchema = z
  .object({
    ok: z.boolean(),
    cashFlow: CfoCashFlowSchema,
  })
  .passthrough();
export type CfoCashFlowResponse = z.infer<typeof CfoCashFlowResponseSchema>;

export const CfoBudgetStatus = z.enum(["active", "draft", "closed", "archived"]);
export type CfoBudgetStatus = z.infer<typeof CfoBudgetStatus>;

export const CfoBudgetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    periodKey: z.string(),
    currency: z.string(),
    status: CfoBudgetStatus.or(z.string()),
    createdAt: z.string().nullable().optional(),
  })
  .passthrough();
export type CfoBudget = z.infer<typeof CfoBudgetSchema>;

export const CfoBudgetResponseSchema = z
  .object({
    ok: z.boolean(),
    budget: CfoBudgetSchema,
  })
  .passthrough();
export type CfoBudgetResponse = z.infer<typeof CfoBudgetResponseSchema>;

export const CfoBudgetVarianceLineSchema = z
  .object({
    accountId: z.string(),
    planned: z.number().int(),
    actual: z.number().int(),
    variance: z.number().int(),
    utilizationPct: z.number(),
  })
  .passthrough();
export type CfoBudgetVarianceLine = z.infer<typeof CfoBudgetVarianceLineSchema>;

export const CfoBudgetVarianceSchema = z
  .object({
    lines: z.array(CfoBudgetVarianceLineSchema),
    totalPlanned: z.number().int(),
    totalActual: z.number().int(),
    totalVariance: z.number().int(),
  })
  .passthrough();
export type CfoBudgetVariance = z.infer<typeof CfoBudgetVarianceSchema>;

export const CfoBudgetVarianceResponseSchema = z
  .object({
    ok: z.boolean(),
    variance: CfoBudgetVarianceSchema,
  })
  .passthrough();
export type CfoBudgetVarianceResponse = z.infer<typeof CfoBudgetVarianceResponseSchema>;

export const CfoTreasuryPositionSchema = z
  .object({
    currency: z.string(),
    balance: z.number().int(),
    accountCount: z.number().int(),
  })
  .passthrough();
export type CfoTreasuryPosition = z.infer<typeof CfoTreasuryPositionSchema>;

export const CfoTreasuryResponseSchema = z
  .object({
    ok: z.boolean(),
    treasury: z.array(CfoTreasuryPositionSchema),
  })
  .passthrough();
export type CfoTreasuryResponse = z.infer<typeof CfoTreasuryResponseSchema>;

export const CfoPaymentCalendarEntrySchema = z
  .object({
    date: z.string(),
    amount: z.number().int(),
    kind: z.enum(["ar", "ap", "loan"]).or(z.string()),
    source: z.string().optional().nullable(),
  })
  .passthrough();
export type CfoPaymentCalendarEntry = z.infer<typeof CfoPaymentCalendarEntrySchema>;

export const CfoPaymentCalendarSchema = z
  .object({
    entries: z.array(CfoPaymentCalendarEntrySchema),
    totalAmd: z.number().int(),
  })
  .passthrough();
export type CfoPaymentCalendar = z.infer<typeof CfoPaymentCalendarSchema>;

export const CfoPaymentCalendarResponseSchema = z
  .object({
    ok: z.boolean(),
    calendar: CfoPaymentCalendarSchema,
  })
  .passthrough();
export type CfoPaymentCalendarResponse = z.infer<typeof CfoPaymentCalendarResponseSchema>;

export const CfoFxExposureRowSchema = z
  .object({
    currency: z.string(),
    net: z.number().int(),
    netAmd: z.number().int(),
  })
  .passthrough();
export type CfoFxExposureRow = z.infer<typeof CfoFxExposureRowSchema>;

export const CfoFxExposureSchema = z
  .object({
    byCurrency: z.array(CfoFxExposureRowSchema),
    hedgeSuggestion: z.string().nullable().optional(),
  })
  .passthrough();
export type CfoFxExposure = z.infer<typeof CfoFxExposureSchema>;

export const CfoFxExposureResponseSchema = z
  .object({
    ok: z.boolean(),
    exposure: CfoFxExposureSchema,
  })
  .passthrough();
export type CfoFxExposureResponse = z.infer<typeof CfoFxExposureResponseSchema>;

export const CfoLoanScheduleRowSchema = z
  .object({
    periodKey: z.string(),
    principalDue: z.number().int(),
    interestDue: z.number().int(),
    balanceAfter: z.number().int(),
  })
  .passthrough();
export type CfoLoanScheduleRow = z.infer<typeof CfoLoanScheduleRowSchema>;

export const CfoLoanScheduleResponseSchema = z
  .object({
    ok: z.boolean(),
    loanId: z.string(),
    schedule: z.array(CfoLoanScheduleRowSchema),
  })
  .passthrough();
export type CfoLoanScheduleResponse = z.infer<typeof CfoLoanScheduleResponseSchema>;


