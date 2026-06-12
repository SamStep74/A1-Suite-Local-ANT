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

/** Workflow approval — for the Today feed's "Awaiting your approval" widget
 *  and the Flow workspace approvals list. Source: server/app.js:4619,
 *  getWorkflowApprovals (54621), formatWorkflowApproval (60676).
 *  Rich fields (riskLevel, createdAt, customerName, ...) are required by
 *  Flow's /api/workflow/approvals handler — kept here so the widget,
 *  Flow list, and approval drilldown all see the same shape. */
export const WorkflowApprovalSchema = z.object({
  id: z.string(),
  status: z.string(),
  ruleId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  requestedByName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  actionKey: z.string().nullable().optional(),
  riskLevel: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  payload: z.unknown().nullable().optional(),
  decidedByUserId: z.string().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
}).passthrough();
export type WorkflowApproval = z.infer<typeof WorkflowApprovalSchema>;

/** Workflow run — one execution of a rule. Source: /api/service/console#runs
 *  and /api/workflow/runs (getWorkflowRuns 61766, formatWorkflowRun 61803).
 *  Status values observed: "pending" | "running" | "completed" |
 *  "failed" | "rolled-back". */
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
}).passthrough();
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

/* ────────── Financial Statements (P&L, Balance Sheet, Cash Flow) ──────────
 * Source: server/accounting.js#financialStatements (called by
 * server/app.js at GET /api/finance/statements, line 5644). Returns
 * three reports in one envelope: incomeStatement, balanceSheet,
 * cashFlow. All amounts are integer AMD (no fractional tetri). The
 * chart-of-accounts seeded by server/db.js uses Armenian account
 * names — `name` is therefore a non-empty string in Armenian script,
 * not an enum.
 *
 * The route is /app/cfo/reports/ (CFO printable view, Phase 7). It
 * reuses the same backend as the finance module's printable view in
 * web/src/finance/print.xhtml, but renders in the modern UI.
 *
 * The accounting engine pre-sorts each section by account code and
 * strips minor-unit metadata before serializing — sections are flat
 * arrays, not {lines, total} envelopes.
 */
export const FinancialStatementLineSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    amount: z.number().int(),
  })
  .passthrough();
export type FinancialStatementLine = z.infer<typeof FinancialStatementLineSchema>;

export const IncomeStatementSchema = z
  .object({
    income: z.array(FinancialStatementLineSchema),
    expense: z.array(FinancialStatementLineSchema),
    totalIncome: z.number().int(),
    totalExpense: z.number().int(),
    netProfit: z.number().int(),
  })
  .passthrough();
export type IncomeStatement = z.infer<typeof IncomeStatementSchema>;

export const BalanceSheetSchema = z
  .object({
    assets: z.array(FinancialStatementLineSchema),
    liabilities: z.array(FinancialStatementLineSchema),
    equity: z.array(FinancialStatementLineSchema),
    totalAssets: z.number().int(),
    totalLiabilities: z.number().int(),
    totalEquity: z.number().int(),
    /** Net profit folded into equity for the balanced equation.
     *  Surfaced in the UI as a "retained earnings" line in the equity
     *  column when non-zero. */
    retainedEarnings: z.number().int(),
    /** Liabilities + equity + retainedEarnings. The accounting
     *  engine's `balanced` flag compares this to totalAssets. */
    totalEquityAndLiabilities: z.number().int(),
    /** Server-computed balance check. Independent of the helper
     *  `isBalanced()` in lib/cfo/reports.ts which re-derives it from
     *  A − (L + E) for the route. We trust neither over the other —
     *  if they disagree, the warning chip renders. */
    balanced: z.boolean(),
  })
  .passthrough();
export type BalanceSheet = z.infer<typeof BalanceSheetSchema>;

/** Cash flow is a flat summary in Phase 7, not the full operating /
 *  investing / financing breakdown. The accounting engine returns
 *  just the cash-in / cash-out totals — a full direct-method cash
 *  flow statement is a follow-up phase (CFO is the upper layer; the
 *  engine stays minimal for now). */
export const CashFlowStatementSchema = z
  .object({
    cashIn: z.number().int(),
    cashOut: z.number().int(),
    /** cashIn − cashOut. Negative = net cash bled during the period. */
    netCashChange: z.number().int(),
  })
  .passthrough();
export type CashFlowStatement = z.infer<typeof CashFlowStatementSchema>;

export const FinancialStatementsResponseSchema = z
  .object({
    incomeStatement: IncomeStatementSchema,
    balanceSheet: BalanceSheetSchema,
    cashFlow: CashFlowStatementSchema,
  })
  .passthrough();
export type FinancialStatementsResponse = z.infer<typeof FinancialStatementsResponseSchema>;

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



/* ────────── Forms schemas (Phase 4.3) ────────── */

export const FormFieldTypeSchema = z.union([
  z.enum(["text", "email", "phone", "textarea", "select", "number", "checkbox", "date"]),
  z.string(),
]);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

export const FormFieldSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    type: FormFieldTypeSchema,
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
  })
  .passthrough();
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormStatusSchema = z.union([
  z.enum(["draft", "published", "archived", "closed"]),
  z.string(),
]);
export type FormStatus = z.infer<typeof FormStatusSchema>;

export const FormSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: FormStatusSchema,
    submissionCount: z.number().int().nonnegative(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type FormSummary = z.infer<typeof FormSummarySchema>;

export const FormsListResponseSchema = z
  .object({
    forms: z.array(FormSummarySchema),
  })
  .passthrough();
export type FormsListResponse = z.infer<typeof FormsListResponseSchema>;

export const FormSubmissionSchema = z
  .object({
    id: z.string(),
    data: z.record(z.string(), z.unknown()),
    leadId: z.string().nullable().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type FormSubmission = z.infer<typeof FormSubmissionSchema>;

export const FormDetailSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    fields: z.array(FormFieldSchema),
    status: FormStatusSchema,
    submissionCount: z.number().int().nonnegative(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    submissions: z.array(FormSubmissionSchema).optional(),
  })
  .passthrough();
export type FormDetail = z.infer<typeof FormDetailSchema>;

export const FormDetailResponseSchema = z
  .object({
    form: FormDetailSchema,
  })
  .passthrough();
export type FormDetailResponse = z.infer<typeof FormDetailResponseSchema>;

/* ────────── Copilot chat schemas (Phase 4.3) ────────── */

export const CopilotIntentSchema = z.union([
  z.enum([
    "vat",
    "payroll",
    "personal-data",
    "esign",
    "month-close",
    "general",
  ]),
  z.string(),
]);
export type CopilotIntent = z.infer<typeof CopilotIntentSchema>;

export const CopilotPacketStatusSchema = z.union([
  z.enum(["draft", "blocked-missing-citation", "ready-for-review", "approved", "rejected"]),
  z.string(),
]);
export type CopilotPacketStatus = z.infer<typeof CopilotPacketStatusSchema>;

export const CopilotRiskLevelSchema = z.union([
  z.enum(["legal", "financial", "operational", "low"]),
  z.string(),
]);
export type CopilotRiskLevel = z.infer<typeof CopilotRiskLevelSchema>;

export const CopilotCitationSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
export type CopilotCitation = z.infer<typeof CopilotCitationSchema>;

export const CopilotCalculationSchema = z
  .object({
    kind: z.string(),
    outputs: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type CopilotCalculation = z.infer<typeof CopilotCalculationSchema>;

export const CopilotProposedActionSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    intent: z.string().optional(),
  })
  .passthrough();
export type CopilotProposedAction = z.infer<typeof CopilotProposedActionSchema>;

export const CopilotPacketSchema = z
  .object({
    id: z.string(),
    intent: CopilotIntentSchema,
    status: CopilotPacketStatusSchema,
    answer: z.string(),
    confidence: z.number().min(0).max(100),
    riskLevel: z.string(),
    reviewRequired: z.boolean(),
    advisoryOnly: z.boolean(),
    citations: z.array(CopilotCitationSchema),
    calculations: z.array(CopilotCalculationSchema),
    proposedActions: z.array(CopilotProposedActionSchema),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type CopilotPacket = z.infer<typeof CopilotPacketSchema>;

export const CopilotChatRoleSchema = z.union([
  z.enum(["user", "assistant", "system"]),
  z.string(),
]);
export type CopilotChatRole = z.infer<typeof CopilotChatRoleSchema>;

export const CopilotChatMessageSchema = z
  .object({
    id: z.string(),
    role: CopilotChatRoleSchema,
    content: z.string(),
    packet: CopilotPacketSchema.optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type CopilotChatMessage = z.infer<typeof CopilotChatMessageSchema>;

export const CopilotChatSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    lastMessageAt: z.string().optional(),
    messageCount: z.number().int().nonnegative().optional(),
    intent: CopilotIntentSchema.optional(),
  })
  .passthrough();
export type CopilotChatSummary = z.infer<typeof CopilotChatSummarySchema>;

export const CopilotChatsListResponseSchema = z
  .object({
    chats: z.array(CopilotChatSummarySchema),
  })
  .passthrough();
export type CopilotChatsListResponse = z.infer<typeof CopilotChatsListResponseSchema>;

export const CopilotChatDetailResponseSchema = z
  .object({
    chat: z
      .object({
        id: z.string(),
        title: z.string(),
        messages: z.array(CopilotChatMessageSchema),
        createdAt: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type CopilotChatDetailResponse = z.infer<typeof CopilotChatDetailResponseSchema>;


/* ════════════════════════════════════════════════════════════════════════
 * Campaigns — /api/campaigns/performance
 * Source: server/app.js#formatCampaignPerformance (line 45079+),
 * getCampaignPerformance (45039+). Single endpoint, no mutations on
 * the web-modern side. All amounts are integer AMD (budget / spend /
 * influencedPipeline / acceptedRevenue / paidRevenue).
 * ════════════════════════════════════════════════════════════════════════ */

export const CampaignAttributionSchema = z
  .object({
    id: z.string(),
    campaignId: z.string().optional(),
    campaignName: z.string().optional(),
    customerId: z.string().nullable().optional(),
    customerName: z.string().nullable().optional(),
    leadId: z.string().nullable().optional(),
    leadCompanyName: z.string().nullable().optional(),
    dealId: z.string().nullable().optional(),
    dealTitle: z.string().nullable().optional(),
    quoteId: z.string().nullable().optional(),
    quoteNumber: z.string().nullable().optional(),
    sourceType: z.string().optional(),
    sourceKey: z.string().optional(),
    attributionWeight: z.number().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type CampaignAttribution = z.infer<typeof CampaignAttributionSchema>;

export const CampaignPerformanceRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    channel: z.string().optional(),
    audience: z.string().optional(),
    status: z.string().optional(),
    spend: z.number().int().optional(),
    currency: z.string().optional(),
    ownerName: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    endedAt: z.string().nullable().optional(),
    leadCount: z.number().int().optional(),
    customerCount: z.number().int().optional(),
    dealCount: z.number().int().optional(),
    quoteCount: z.number().int().optional(),
    influencedPipeline: z.number().int().optional(),
    acceptedRevenue: z.number().int().optional(),
    paidRevenue: z.number().int().optional(),
    roiPercent: z.number().int().optional(),
    attributions: z.array(CampaignAttributionSchema).optional(),
  })
  .passthrough();
export type CampaignPerformanceRow = z.infer<typeof CampaignPerformanceRowSchema>;

export const CampaignPerformanceSummarySchema = z
  .object({
    campaignCount: z.number().int().optional(),
    totalSpend: z.number().int().optional(),
    leadCount: z.number().int().optional(),
    customerCount: z.number().int().optional(),
    influencedPipeline: z.number().int().optional(),
    acceptedRevenue: z.number().int().optional(),
    paidRevenue: z.number().int().optional(),
    roiPercent: z.number().int().optional(),
  })
  .passthrough();
export type CampaignPerformanceSummary = z.infer<typeof CampaignPerformanceSummarySchema>;

export const CampaignPerformanceResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    summary: CampaignPerformanceSummarySchema,
    definitions: z.record(z.string(), z.string()).optional(),
    campaigns: z.array(CampaignPerformanceRowSchema),
    attributions: z.array(CampaignAttributionSchema).optional(),
  })
  .passthrough();
export type CampaignPerformanceResponse = z.infer<typeof CampaignPerformanceResponseSchema>;

/* ════════════════════════════════════════════════════════════════════════
 * Flow / Workflow — /api/workflow/*
 * Source: server/app.js#formatAutomationRule (48830), getAutomationRules
 * (48817), formatAutomationRuleVersion (60661), getWorkflowApprovals
 * (54621), formatWorkflowApproval (60676), getWorkflowRuns (61766),
 * formatWorkflowRun (61803). All integer-AMD where amounts appear.
 * ════════════════════════════════════════════════════════════════════════ */

export const AutomationRuleLastDryRunSchema = z
  .object({
    id: z.string(),
    ruleId: z.string().optional(),
    ruleName: z.string().optional(),
    customerId: z.string().nullable().optional(),
    customerName: z.string().nullable().optional(),
    triggeredByUserId: z.string().nullable().optional(),
    triggeredByName: z.string().nullable().optional(),
    triggerKey: z.string().optional(),
    actionKey: z.string().optional(),
    status: z.string().optional(),
    riskLevel: z.string().optional(),
    approvalRequired: z.boolean().optional(),
    matchedSubjectType: z.string().nullable().optional(),
    matchedSubjectId: z.string().nullable().optional(),
    resultPreview: z.unknown().nullable().optional(),
    guardrails: z.unknown().nullable().optional(),
    checksum: z.string().optional(),
    note: z.string().optional(),
    sourceKey: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type AutomationRuleLastDryRun = z.infer<typeof AutomationRuleLastDryRunSchema>;

export const AutomationRuleLastTestEventSchema = z
  .object({
    id: z.string(),
    ruleId: z.string().optional(),
    ruleName: z.string().optional(),
    customerId: z.string().nullable().optional(),
    customerName: z.string().nullable().optional(),
    triggeredByUserId: z.string().nullable().optional(),
    triggeredByName: z.string().nullable().optional(),
    eventType: z.string().optional(),
    triggerKey: z.string().optional(),
    actionKey: z.string().optional(),
    subjectType: z.string().optional(),
    subjectId: z.string().optional(),
    status: z.string().optional(),
    evaluation: z.unknown().nullable().optional(),
    inputPayload: z.unknown().nullable().optional(),
    guardrails: z.unknown().nullable().optional(),
    checksum: z.string().optional(),
    note: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type AutomationRuleLastTestEvent = z.infer<typeof AutomationRuleLastTestEventSchema>;

export const AutomationRuleLatestVersionSchema = z
  .object({
    id: z.string(),
    ruleId: z.string().optional(),
    versionNumber: z.number().int().optional(),
    enabled: z.boolean().optional(),
    changeType: z.string().optional(),
    reason: z.string().optional(),
    checksum: z.string().optional(),
    changedByUserId: z.string().nullable().optional(),
    changedByName: z.string().nullable().optional(),
    changedAt: z.string().optional(),
  })
  .passthrough();
export type AutomationRuleLatestVersion = z.infer<typeof AutomationRuleLatestVersionSchema>;

export const AutomationRuleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    trigger: z.string().optional(),
    action: z.string().optional(),
    enabled: z.boolean().optional(),
    currentVersion: z.number().int().optional(),
    lastVersion: AutomationRuleLatestVersionSchema.nullable().optional(),
    ownerRole: z.string().optional(),
    approvalRequired: z.boolean().optional(),
    lastDryRun: AutomationRuleLastDryRunSchema.nullable().optional(),
    lastTestEvent: AutomationRuleLastTestEventSchema.nullable().optional(),
  })
  .passthrough();
export type AutomationRule = z.infer<typeof AutomationRuleSchema>;

export const AutomationRulesResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    rules: z.array(AutomationRuleSchema),
  })
  .passthrough();
export type AutomationRulesResponse = z.infer<typeof AutomationRulesResponseSchema>;

export const AutomationRuleVersionSchema = z
  .object({
    id: z.string(),
    ruleId: z.string().optional(),
    versionNumber: z.number().int().optional(),
    enabled: z.boolean().optional(),
    changeType: z.string().optional(),
    reason: z.string().optional(),
    checksum: z.string().optional(),
    changedByUserId: z.string().nullable().optional(),
    changedByName: z.string().nullable().optional(),
    changedAt: z.string().optional(),
  })
  .passthrough();
export type AutomationRuleVersion = z.infer<typeof AutomationRuleVersionSchema>;

export const AutomationRuleVersionsResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    rule: AutomationRuleSchema,
    versions: z.array(AutomationRuleVersionSchema),
  })
  .passthrough();
export type AutomationRuleVersionsResponse = z.infer<typeof AutomationRuleVersionsResponseSchema>;

export const WorkflowApprovalsResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    approvals: z.array(WorkflowApprovalSchema),
  })
  .passthrough();
export type WorkflowApprovalsResponse = z.infer<typeof WorkflowApprovalsResponseSchema>;

export const WorkflowRunsResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    runs: z.array(WorkflowRunSchema),
  })
  .passthrough();
export type WorkflowRunsResponse = z.infer<typeof WorkflowRunsResponseSchema>;



/* ────────── Projects (Phase 4.2) ────────── */

export const ProjectStatusSchema = z.enum([
  "planning",
  "active",
  "on-hold",
  "completed",
  "cancelled",
]).or(z.string());
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const TaskStatusSchema = z.enum(["todo", "in-progress", "done"]).or(z.string());
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ProjectTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: TaskStatusSchema,
    assigneeEmployeeId: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;

export const ProjectMilestoneSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    dueDate: z.string().nullable().optional(),
    reached: z.number().int(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type ProjectMilestone = z.infer<typeof ProjectMilestoneSchema>;

export const ProjectListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: ProjectStatusSchema,
    customerId: z.string().nullable().optional(),
    dealId: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    updatedAt: z.string().optional(),
    taskTotal: z.number().int().optional(),
    taskDone: z.number().int().optional(),
    milestoneTotal: z.number().int().optional(),
    milestoneReached: z.number().int().optional(),
    totalMinutes: z.number().int().optional(),
  })
  .passthrough();
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const ProjectsListResponseSchema = z
  .object({
    projects: z.array(ProjectListItemSchema),
  })
  .passthrough();
export type ProjectsListResponse = z.infer<typeof ProjectsListResponseSchema>;

export const ProjectDetailSchema = ProjectListItemSchema.extend({
  description: z.string().optional(),
  createdAt: z.string().optional(),
  tasks: z.array(ProjectTaskSchema).optional(),
  milestones: z.array(ProjectMilestoneSchema).optional(),
  timeEntryCount: z.number().int().optional(),
}).passthrough();
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProjectDetailResponseSchema = z
  .object({
    project: ProjectDetailSchema,
  })
  .passthrough();
export type ProjectDetailResponse = z.infer<typeof ProjectDetailResponseSchema>;

export const ProjectBillingPreviewSchema = z
  .object({
    projectId: z.string(),
    customerId: z.string().nullable().optional(),
    unbilledMinutes: z.number().int(),
    unbilledEntries: z.number().int(),
    hours: z.number(),
    hourlyRate: z.number(),
    subtotal: z.number(),
    vat: z.number(),
    total: z.number(),
    vatRate: z.number(),
    currency: z.string(),
  })
  .passthrough();
export type ProjectBillingPreview = z.infer<typeof ProjectBillingPreviewSchema>;

export const ProjectBillingPreviewResponseSchema = z
  .object({
    preview: ProjectBillingPreviewSchema,
  })
  .passthrough();
export type ProjectBillingPreviewResponse = z.infer<typeof ProjectBillingPreviewResponseSchema>;

/* ────────── Analytics (Phase 4.2) ────────── */

export const AgingBucketSchema = z
  .object({
    key: z.string(),
    label: z.string().optional(),
    total: z.number(),
    invoiceCount: z.number().int(),
    customerCount: z.number().int().optional(),
    invoices: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type AgingBucket = z.infer<typeof AgingBucketSchema>;

export const ReceivablesAgingSummarySchema = z
  .object({
    totalOpen: z.number(),
    overdue: z.number(),
    current: z.number(),
    invoiceCount: z.number().int(),
    overdueInvoiceCount: z.number().int(),
    customerCount: z.number().int().optional(),
  })
  .passthrough();
export type ReceivablesAgingSummary = z.infer<typeof ReceivablesAgingSummarySchema>;

export const ReceivablesAgingResponseSchema = z
  .object({
    currency: z.string().optional(),
    reportDate: z.string().optional(),
    summary: ReceivablesAgingSummarySchema,
    buckets: z.array(AgingBucketSchema).optional(),
    invoices: z.array(z.unknown()).optional(),
    definitions: z.record(z.string(), z.string()).optional(),
    invoiceOverdueExplanations: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type ReceivablesAgingResponse = z.infer<typeof ReceivablesAgingResponseSchema>;

export const SemanticMetricSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    value: z.number(),
    unit: z.string(),
    formula: z.string().optional(),
    definition: z.string().optional(),
    sourceApps: z.array(z.string()).optional(),
    refreshCadence: z.string().optional(),
    ownerRole: z.string().optional(),
    recordCount: z.number().int().optional(),
    drilldownUrl: z.string().optional(),
  })
  .passthrough();
export type SemanticMetric = z.infer<typeof SemanticMetricSchema>;

export const SemanticMetricsResponseSchema = z
  .object({
    semanticLayerVersion: z.string().optional(),
    reportDate: z.string().optional(),
    generatedAt: z.string().optional(),
    metrics: z.array(SemanticMetricSchema),
  })
  .passthrough();
export type SemanticMetricsResponse = z.infer<typeof SemanticMetricsResponseSchema>;

export const SemanticMetricDrilldownResponseSchema = z
  .object({
    semanticLayerVersion: z.string().optional(),
    reportDate: z.string().optional(),
    metric: SemanticMetricSchema,
    totals: z
      .object({
        recordCount: z.number().int(),
        amdTotal: z.number(),
      })
      .passthrough()
      .optional(),
    records: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type SemanticMetricDrilldownResponse = z.infer<typeof SemanticMetricDrilldownResponseSchema>;

export const RoleDashboardAppSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    category: z.string().optional(),
  })
  .passthrough();
export type RoleDashboardApp = z.infer<typeof RoleDashboardAppSchema>;

export const RoleDashboardMetricCardSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    value: z.number(),
    unit: z.string(),
    recordCount: z.number().int().optional(),
    sourceApps: z.array(z.string()).optional(),
    formula: z.string().optional(),
    definition: z.string().optional(),
    drilldownUrl: z.string().optional(),
    ownerRole: z.string().optional(),
  })
  .passthrough();
export type RoleDashboardMetricCard = z.infer<typeof RoleDashboardMetricCardSchema>;

export const RoleDashboardNextActionSchema = z
  .object({
    actionKey: z.string(),
    label: z.string(),
    description: z.string().optional(),
  })
  .passthrough();
export type RoleDashboardNextAction = z.infer<typeof RoleDashboardNextActionSchema>;

export const RoleDashboardResponseSchema = z
  .object({
    role: z.string(),
    dashboardId: z.string().optional(),
    title: z.string().optional(),
    generatedAt: z.string().optional(),
    apps: z.array(RoleDashboardAppSchema).optional(),
    semanticLayerVersion: z.string().optional(),
    primaryMetricIds: z.array(z.string()).optional(),
    summaryCards: z.array(RoleDashboardMetricCardSchema).optional(),
    snapshots: z.array(z.unknown()).optional(),
    reports: z.array(z.unknown()).optional(),
    permissions: z.record(z.string(), z.unknown()).optional(),
    nextActions: z.array(RoleDashboardNextActionSchema).optional(),
  })
  .passthrough();
export type RoleDashboardResponse = z.infer<typeof RoleDashboardResponseSchema>;

export const SemanticSnapshotPointSchema = z
  .object({
    reportDate: z.string(),
    value: z.number(),
    recordCount: z.number().int().optional(),
    checksum: z.string().optional(),
    capturedAt: z.string().optional(),
  })
  .passthrough();
export type SemanticSnapshotPoint = z.infer<typeof SemanticSnapshotPointSchema>;

export const SemanticSnapshotSeriesSchema = z
  .object({
    metricId: z.string(),
    label: z.string().optional(),
    unit: z.string().optional(),
    sourceApps: z.array(z.string()).optional(),
    points: z.array(SemanticSnapshotPointSchema),
  })
  .passthrough();
export type SemanticSnapshotSeries = z.infer<typeof SemanticSnapshotSeriesSchema>;

export const SemanticSnapshotSchema = z
  .object({
    id: z.string(),
    metricId: z.string(),
    label: z.string().optional(),
    unit: z.string().optional(),
    value: z.number(),
    recordCount: z.number().int().optional(),
    reportDate: z.string(),
    semanticLayerVersion: z.string().optional(),
    sourceApps: z.array(z.string()).optional(),
    formula: z.string().optional(),
    definition: z.string().optional(),
    checksum: z.string().optional(),
    note: z.string().nullable().optional(),
    capturedByUserId: z.string().optional(),
    capturedByName: z.string().optional(),
    capturedAt: z.string().optional(),
  })
  .passthrough();
export type SemanticSnapshot = z.infer<typeof SemanticSnapshotSchema>;

export const SemanticSnapshotsResponseSchema = z
  .object({
    semanticLayerVersion: z.string().optional(),
    snapshots: z.array(SemanticSnapshotSchema).optional(),
    series: z.array(SemanticSnapshotSeriesSchema).optional(),
  })
  .passthrough();
export type SemanticSnapshotsResponse = z.infer<typeof SemanticSnapshotsResponseSchema>;

export const AnalyticsReportSchema = z
  .object({
    id: z.string(),
    reportType: z.string(),
    periodKey: z.string().optional(),
    format: z.string().optional(),
    status: z.string().optional(),
    metricCount: z.number().int().optional(),
    snapshotCount: z.number().int().optional(),
    checksum: z.string().optional(),
    contentType: z.string().optional(),
    fileName: z.string().optional(),
    note: z.string().nullable().optional(),
    createdByUserId: z.string().optional(),
    createdByName: z.string().optional(),
    createdAt: z.string().optional(),
    payload: z.unknown().optional(),
    exportContent: z.string().optional(),
  })
  .passthrough();
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>;

export const AnalyticsReportsListResponseSchema = z
  .object({
    reports: z.array(AnalyticsReportSchema),
  })
  .passthrough();
export type AnalyticsReportsListResponse = z.infer<typeof AnalyticsReportsListResponseSchema>;

export const AnalyticsReportResponseSchema = z
  .object({
    report: AnalyticsReportSchema,
  })
  .passthrough();
export type AnalyticsReportResponse = z.infer<typeof AnalyticsReportResponseSchema>;

/* ────────── Healthcheck ping (POST /api/healthcheck/ping) ────────── */

export const HealthcheckPingRequestSchema = z.object({
  message: z.string().min(1).max(200),
  idempotencyKey: z.string().optional(),
});
export type HealthcheckPingRequest = z.infer<typeof HealthcheckPingRequestSchema>;

export const HealthcheckPingResponseSchema = z.object({
  ok: z.literal(true),
  healthcheck: z.object({
    message: z.string(),
    respondedAt: z.string(),
  }),
});
export type HealthcheckPingResponse = z.infer<typeof HealthcheckPingResponseSchema>;

/* ────────── document cabinet (Phase 8.2) ────────── */

export const CabinetDirectionSchema = z.enum(["incoming", "outgoing", "internal"]);
export type CabinetDirection = z.infer<typeof CabinetDirectionSchema>;

export const CabinetStatusSchema = z.enum(["active", "archived"]);
export type CabinetStatus = z.infer<typeof CabinetStatusSchema>;

export const CabinetLinkedTypeSchema = z.enum([
  "customer",
  "vendor",
  "employee",
  "deal",
  "project",
]);
export type CabinetLinkedType = z.infer<typeof CabinetLinkedTypeSchema>;

export const CabinetOcrStatusSchema = z
  .enum(["pending", "queued", "running", "done", "failed"])
  .nullable();
export type CabinetOcrStatus = z.infer<typeof CabinetOcrStatusSchema>;

export const CabinetDocumentSchema = z.object({
  id: z.string().regex(/^cab-[a-z0-9-]+$/),
  title: z.string().min(3).max(200),
  direction: CabinetDirectionSchema,
  status: CabinetStatusSchema,
  docType: z.string().nullable().optional(),
  currentVersion: z.number().int().min(1),
  linkedType: CabinetLinkedTypeSchema.nullable().optional(),
  linkedId: z.string().nullable().optional(),
  ocrStatus: CabinetOcrStatusSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CabinetDocument = z.infer<typeof CabinetDocumentSchema>;

export const CabinetListResponseSchema = z.object({
  documents: z.array(CabinetDocumentSchema),
  total: z.number().int().min(0).optional(),
});
export type CabinetListResponse = z.infer<typeof CabinetListResponseSchema>;

export const CabinetCreateRequestSchema = z.object({
  title: z.string().min(3).max(200),
  direction: CabinetDirectionSchema,
  docType: z.string().min(1).max(40).optional(),
  linkedType: CabinetLinkedTypeSchema.optional(),
  linkedId: z.string().min(1).max(80).optional(),
  body: z.string().max(20000).optional(),
  idempotencyKey: z.string().min(1).max(200),
});
export type CabinetCreateRequest = z.infer<typeof CabinetCreateRequestSchema>;

export const CabinetCreateResponseSchema = z.object({
  document: CabinetDocumentSchema,
  idempotencyKey: z.string().min(1).max(200),
});
export type CabinetCreateResponse = z.infer<typeof CabinetCreateResponseSchema>;

export const CabinetPatchRequestSchema = z
  .object({
    status: CabinetStatusSchema.optional(),
    docType: z.string().min(1).max(40).nullable().optional(),
    linkedType: CabinetLinkedTypeSchema.nullable().optional(),
    linkedId: z.string().min(1).max(80).nullable().optional(),
    title: z.string().min(3).max(200).optional(),
    idempotencyKey: z.string().min(1).max(200),
  })
  .refine(
    (v) => Object.keys(v).filter((k) => k !== "idempotencyKey").length > 0,
    { message: "patch must change at least one field" },
  );
export type CabinetPatchRequest = z.infer<typeof CabinetPatchRequestSchema>;

export const CabinetFiltersSchema = z.object({
  direction: CabinetDirectionSchema.optional(),
  status: CabinetStatusSchema.optional(),
  q: z.string().max(120).optional(),
});
export type CabinetFilters = z.infer<typeof CabinetFiltersSchema>;

/**
 * A1 CRM Tube (Phase 8.13) — Zod schemas for the /api/crm/tube/* surface.
 * Source: docs/phase8-tube/design.md section 2.1.
 */

export const TubeStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number().int(),
  probability: z.number().int().min(0).max(100),
  is_won: z.number().int(),
  is_lost: z.number().int(),
  color: z.string().nullable(),
});
export type TubeStage = z.infer<typeof TubeStageSchema>;

export const TubeTubeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_default: z.number().int(),
  position: z.number().int(),
  stages: z.array(TubeStageSchema),
});
export type TubeTube = z.infer<typeof TubeTubeSchema>;

export const TubeDealSchema = z.object({
  id: z.string(),
  title: z.string(),
  value: z.number(),
  currency: z.string(),
  status: z.enum(["open", "won", "lost"]),
  stage_id: z.string(),
  tube_id: z.string(),
  contact_id: z.string().nullable(),
  organization_id: z.string().nullable(),
  owner_user_id: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  organization_name: z.string().nullable(),
  stage_name: z.string().nullable(),
  stage_probability: z.number().int().nullable(),
  expected_close_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TubeDeal = z.infer<typeof TubeDealSchema>;

export const TubeContactSchema = z.object({
  id: z.string(),
  organization_id: z.string().nullable(),
  full_name: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  lead_score: z.number().int().nullable(),
  status: z.string(),
  organization_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TubeContact = z.infer<typeof TubeContactSchema>;

export const TubeSequenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  integration_key: z.string().nullable(),
  external_id: z.string().nullable(),
  step_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TubeSequence = z.infer<typeof TubeSequenceSchema>;

export const TubeSequenceDetailSchema = TubeSequenceSchema.extend({
  steps: z.array(z.unknown()),
});
export type TubeSequenceDetail = z.infer<typeof TubeSequenceDetailSchema>;

export const TubeIntegrationSchema = z.object({
  id: z.string(),
  connector_key: z.string(),
  display_name: z.string(),
  status: z.enum(["planned", "connected", "paused", "error"]),
  environment: z.enum(["sandbox", "production", "test"]),
  auth_type: z.string(),
  last_health_status: z.string().nullable(),
  last_health_at: z.string().nullable(),
  last_health_latency: z.number().int().nullable(),
  last_sync_at: z.string().nullable(),
});
export type TubeIntegration = z.infer<typeof TubeIntegrationSchema>;

export const TubeInboxItemSchema = z.object({
  kind: z.enum(["activity", "conversation"]),
  id: z.string(),
  contact_id: z.string().nullable(),
  contact_name: z.string().nullable(),
  channel: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  occurred_at: z.string(),
  created_at: z.string(),
});
export type TubeInboxItem = z.infer<typeof TubeInboxItemSchema>;

// Envelope shapes the SPA will type its fetches against.
export const TubeListResponseSchema = z.object({
  tubes: z.array(TubeTubeSchema).optional(),
  deals: z.array(TubeDealSchema).optional(),
  contacts: z.array(TubeContactSchema).optional(),
  organizations: z.array(z.unknown()).optional(),
  activities: z.array(z.unknown()).optional(),
  conversations: z.array(z.unknown()).optional(),
  integrations: z.array(TubeIntegrationSchema).optional(),
  sequences: z.array(TubeSequenceSchema).optional(),
  items: z.array(TubeInboxItemSchema).optional(),
});

/* ────────── AI onboarding (Phase 8.11) ────────── */

export const AiModelSchema = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();
export type AiModel = z.infer<typeof AiModelSchema>;

export const AiModelsResponseSchema = z.object({
  provider: z.literal("openrouter"),
  online: z.boolean(),
  source: z.enum(["live", "offline-fallback"]),
  reason: z.string().nullable(),
  egressAllowed: z.boolean(),
  openrouterHost: z.string(),
  models: z.array(AiModelSchema),
});
export type AiModelsResponse = z.infer<typeof AiModelsResponseSchema>;

export const AI_MODEL_KEYS = ["default", "copilot", "transform", "finance", "crm", "docs"] as const;
export type AiModelKey = typeof AI_MODEL_KEYS[number];

export const AiSettingsModelsSchema = z.object({
  default: z.string().default(""),
  copilot: z.string().default(""),
  transform: z.string().default(""),
  finance: z.string().default(""),
  crm: z.string().default(""),
  docs: z.string().default(""),
});
export type AiSettingsModels = z.infer<typeof AiSettingsModelsSchema>;

export const AiSettingsOpenNotebookSchema = z.object({
  apiKeySet: z.boolean(),
  enabled: z.boolean(),
  baseUrl: z.string(),
});
export type AiSettingsOpenNotebook = z.infer<typeof AiSettingsOpenNotebookSchema>;

export const AiSettingsResponseSchema = z.object({
  provider: z.literal("openrouter"),
  egressAllowed: z.boolean(),
  openrouterHost: z.string(),
  settings: z.object({
    openrouterApiKeySet: z.boolean(),
    openNotebook: AiSettingsOpenNotebookSchema,
    models: AiSettingsModelsSchema,
  }),
});
export type AiSettingsResponse = z.infer<typeof AiSettingsResponseSchema>;

export const AiSettingsPutRequestSchema = z.object({
  openrouterApiKey: z.string().min(1).max(500).optional(),
  models: AiSettingsModelsSchema.partial().optional(),
  openNotebook: AiSettingsOpenNotebookSchema.partial().extend({
    apiKey: z.string().min(1).max(500).optional(),
  }).optional(),
});
export type AiSettingsPutRequest = z.infer<typeof AiSettingsPutRequestSchema>;

export const AiSettingsPutResponseSchema = z.object({
  ok: z.literal(true),
  settings: AiSettingsResponseSchema.shape.settings,
});
export type AiSettingsPutResponse = z.infer<typeof AiSettingsPutResponseSchema>;

/* ════════════════════════════════════════════════════════════════════════
 * Warehouse (Phase 8.3) — Zod schemas for the /api/warehouse/* surface.
 * Source: server/app.js#warehouse (lines 548-798) and server/warehouse.js
 * (FEFO ordering, ABC classification, turnover days, restock forecast,
 * cold-storage reading normalization, AI restock assist). All lot /
 * serial / cold-storage PKs are SQLite integer IDs — the legacy web app
 * renders them via `Number(...).toLocaleString("hy-AM")` which is
 * tolerant of either string or number, so we keep `z.number()` to
 * match the wire format from better-sqlite3.
 *
 * The route that consumes these schemas lives at
 * /app/inventory/warehouse and surfaces 4 tabs: lots, serials,
 * cold storage, and analytics (ABC + turnover + forecast). The forecast
 * tab is the warehouse-restock AI assist (Phase 8.3 layer 2).
 * ════════════════════════════════════════════════════════════════════════ */

/** Lot — a single production / harvest batch. FEFO-ordered by expiry.
 *  Source: GET/POST /api/warehouse/lots. */
export const WarehouseLotSchema = z
  .object({
    id: z.number().int(),
    productId: z.string(),
    lotCode: z.string(),
    mfgDate: z.string().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
    harvestDate: z.string().nullable().optional(),
    sourceVendorId: z.string().nullable().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type WarehouseLot = z.infer<typeof WarehouseLotSchema>;

/** Serial — a tracked serial-numbered stock unit (instruments, equipment).
 *  Source: GET/POST /api/warehouse/serials. */
export const WarehouseSerialSchema = z
  .object({
    id: z.number().int(),
    productId: z.string(),
    serial: z.string(),
    status: z.string(),
    currentLocationId: z.string().nullable().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type WarehouseSerial = z.infer<typeof WarehouseSerialSchema>;

/** Cold-storage reading — one sensor sample (temperature + humidity).
 *  Source: GET/POST /api/warehouse/cold-storage/readings. */
export const WarehouseColdStorageReadingSchema = z
  .object({
    id: z.number().int(),
    locationId: z.string(),
    recordedAt: z.string(),
    tempC: z.number(),
    humidity: z.number().nullable().optional(),
    sensorId: z.string().nullable().optional(),
  })
  .passthrough();
export type WarehouseColdStorageReading = z.infer<
  typeof WarehouseColdStorageReadingSchema
>;

/** ABC classification row — one product's revenue share + bucket.
 *  Source: GET /api/warehouse/analytics/abc. */
export const WarehouseAbcRowSchema = z
  .object({
    productId: z.string(),
    bucket: z.enum(["A", "B", "C"]),
    /** 0..1 — product's share of period revenue. */
    revenueShare: z.number().min(0).max(1),
    /** 0..1 — cumulative revenue share when sorted by revenue desc. */
    cumulativeShare: z.number().min(0).max(1),
  })
  .passthrough();
export type WarehouseAbcRow = z.infer<typeof WarehouseAbcRowSchema>;

/** Turnover row — days of inventory on hand for one product.
 *  Source: GET /api/warehouse/analytics/turnover. */
export const WarehouseTurnoverRowSchema = z
  .object({
    productId: z.string(),
    turnoverDays: z.number().nonnegative(),
  })
  .passthrough();
export type WarehouseTurnoverRow = z.infer<typeof WarehouseTurnoverRowSchema>;

/** AI-assist metadata for a forecast run. The server's `maybeAiRestockAssist`
 *  returns `{ source, text }` (OpenRouter echo), but the route's helper
 *  contract is `{ provider, model, usedFallback }`. The Zod schema is
 *  permissive (`passthrough()`) so the route can derive a stable shape
 *  from either source. */
export const WarehouseAiAssistSchema = z
  .object({
    provider: z.string().optional(),
    model: z.string().optional(),
    usedFallback: z.boolean().optional(),
  })
  .passthrough();
export type WarehouseAiAssist = z.infer<typeof WarehouseAiAssistSchema>;

/** Restock forecast — one product's suggested reorder quantity.
 *  Source: POST /api/warehouse/forecast/restock. */
export const WarehouseForecastSchema = z
  .object({
    suggestedQuantity: z.number().int().nonnegative(),
    source: z.string(),
    reasoning: z.array(z.string()),
    aiAssist: z
      .union([WarehouseAiAssistSchema, z.null()])
      .optional(),
  })
  .passthrough();
export type WarehouseForecast = z.infer<typeof WarehouseForecastSchema>;

/** Trace node — one upstream (vendor) or downstream (move) link in a
 *  lot's provenance chain. The server's `traceLot` returns a flat list
 *  rather than a strict tree, so the schema is a single permissive
 *  object. Discriminate on shape: upstream nodes have `vendorId` +
 *  `vendorName`; downstream nodes have `moveId` + `customerLocationId`.
 *  Source: GET /api/warehouse/traceability/:lotId. */
export const WarehouseTraceNodeSchema = z
  .object({
    vendorId: z.string().optional(),
    vendorName: z.string().optional(),
    receivedAt: z.string().optional(),
    moveId: z.number().int().optional(),
    customerLocationId: z.string().optional(),
    quantity: z.number().optional(),
    movedAt: z.string().optional(),
  })
  .passthrough();
export type WarehouseTraceNode = z.infer<typeof WarehouseTraceNodeSchema>;

/** Trace envelope — the lot at the center of the chain plus its
 *  upstream (vendor) and downstream (customer moves) nodes. */
export const WarehouseTraceSchema = z
  .object({
    lotId: z.number().int(),
    lotCode: z.string(),
    upstream: z.array(WarehouseTraceNodeSchema),
    downstream: z.array(WarehouseTraceNodeSchema),
  })
  .passthrough();
export type WarehouseTrace = z.infer<typeof WarehouseTraceSchema>;

/** Request body for POST /api/warehouse/lots. Validation mirrors
 *  server/warehouse.js#validateLotCode + #validateExpiry. The server
 *  rejects `expiryDate < mfgDate` and requires `lotCode` to match
 *  /^[A-Z0-9][A-Z0-9_-]{1,31}$/. */
export const WarehouseLotCreateRequestSchema = z.object({
  productId: z.string().min(3).max(80),
  lotCode: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, {
    message: "lotCode must match /^[A-Z0-9][A-Z0-9_-]{1,31}$/",
  }),
  mfgDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  harvestDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  sourceVendorId: z.string().min(1).max(80).nullable().optional(),
});
export type WarehouseLotCreateRequest = z.infer<
  typeof WarehouseLotCreateRequestSchema
>;

/** Request body for POST /api/warehouse/serials. Mirrors
 *  server/warehouse.js#validateSerial. */
export const WarehouseSerialCreateRequestSchema = z.object({
  productId: z.string().min(3).max(80),
  serial: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,63}$/, {
    message: "serial must match /^[A-Z0-9][A-Z0-9_-]{1,63}$/",
  }),
  currentLocationId: z.string().min(1).max(80).nullable().optional(),
});
export type WarehouseSerialCreateRequest = z.infer<
  typeof WarehouseSerialCreateRequestSchema
>;

/** Request body for POST /api/warehouse/cold-storage/readings. Mirrors
 *  server/warehouse.js#recordColdStorageReading (tempC in [-80, 80],
 *  humidity in [0, 100] or null). */
export const WarehouseColdStorageReadingCreateRequestSchema = z.object({
  locationId: z.string().min(3).max(80),
  recordedAt: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    { message: "recordedAt must be ISO-8601 with milliseconds and Z" },
  ),
  tempC: z.number().min(-80).max(80),
  humidity: z.number().min(0).max(100).nullable().optional(),
  sensorId: z.string().max(80).nullable().optional(),
});
export type WarehouseColdStorageReadingCreateRequest = z.infer<
  typeof WarehouseColdStorageReadingCreateRequestSchema
>;

/** Request body for POST /api/warehouse/forecast/restock. The server
 *  clamps `horizonDays` to [1, 180] and refuses any `intent` other than
 *  "warehouse-restock" (returns 400). The literal locks the type. */
export const WarehouseForecastRequestSchema = z.object({
  productId: z.string().min(3).max(80),
  horizonDays: z.number().int().min(1).max(180),
  intent: z.literal("warehouse-restock"),
});
export type WarehouseForecastRequest = z.infer<
  typeof WarehouseForecastRequestSchema
>;

/* ────────── response envelopes ────────── */

export const WarehouseLotCreateResponseSchema = z.object({
  ok: z.literal(true),
  lot: WarehouseLotSchema,
});
export type WarehouseLotCreateResponse = z.infer<
  typeof WarehouseLotCreateResponseSchema
>;

export const WarehouseLotsResponseSchema = z.object({
  lots: z.array(WarehouseLotSchema),
});
export type WarehouseLotsResponse = z.infer<typeof WarehouseLotsResponseSchema>;

export const WarehouseSerialCreateResponseSchema = z.object({
  ok: z.literal(true),
  serial: WarehouseSerialSchema,
});
export type WarehouseSerialCreateResponse = z.infer<
  typeof WarehouseSerialCreateResponseSchema
>;

export const WarehouseColdStorageReadingCreateResponseSchema = z.object({
  ok: z.literal(true),
  reading: WarehouseColdStorageReadingSchema,
});
export type WarehouseColdStorageReadingCreateResponse = z.infer<
  typeof WarehouseColdStorageReadingCreateResponseSchema
>;

export const WarehouseColdStorageReadingsResponseSchema = z.object({
  readings: z.array(WarehouseColdStorageReadingSchema),
});
export type WarehouseColdStorageReadingsResponse = z.infer<
  typeof WarehouseColdStorageReadingsResponseSchema
>;

export const WarehouseAbcResponseSchema = z.object({
  ok: z.literal(true),
  periodKey: z.string().max(20),
  abc: z.array(WarehouseAbcRowSchema),
});
export type WarehouseAbcResponse = z.infer<typeof WarehouseAbcResponseSchema>;

export const WarehouseTurnoverResponseSchema = z.object({
  ok: z.literal(true),
  periodKey: z.string().max(20),
  turnover: z.array(WarehouseTurnoverRowSchema),
});
export type WarehouseTurnoverResponse = z.infer<
  typeof WarehouseTurnoverResponseSchema
>;

export const WarehouseForecastResponseSchema = z.object({
  ok: z.literal(true),
  forecast: WarehouseForecastSchema,
});
export type WarehouseForecastResponse = z.infer<
  typeof WarehouseForecastResponseSchema
>;

export const WarehouseTraceabilityResponseSchema = z.object({
  ok: z.literal(true),
  trace: WarehouseTraceSchema,
});
export type WarehouseTraceabilityResponse = z.infer<
  typeof WarehouseTraceabilityResponseSchema
>;

/* ────────── procurement extension (Phase 8.4) ──────────
 *
 * The 5-tab procurement surface on top of the existing `purchase` app
 * spine. Endpoints are wired in server/app.js 860-998 (the
 * `procurement.*` engine in server/procurement.js does the work). The
 * modern route lives at /app/purchase/procurement and re-uses
 * `requirePurchaseWriter(user)` on the server.
 *
 * Every write endpoint requires an `idempotencyKey` (1..200 chars). The
 * server caches the response envelope in `idempotency_keys` and
 * returns the cached envelope on a duplicate, so the client may safely
 * retry without bouncing a 400.
 */

/* ── enums ── */

export const ProcurementLandedCostKindSchema = z.enum([
  "freight",
  "duty",
  "insurance",
  "other",
]);
export type ProcurementLandedCostKind = z.infer<
  typeof ProcurementLandedCostKindSchema
>;

export const ProcurementAllocationMethodSchema = z.enum([
  "value",
  "quantity",
  "weight",
]);
export type ProcurementAllocationMethod = z.infer<
  typeof ProcurementAllocationMethodSchema
>;

export const ProcurementRequisitionStatusSchema = z.enum([
  "open",
  "rfq",
  "closed",
  "cancelled",
]);
export type ProcurementRequisitionStatus = z.infer<
  typeof ProcurementRequisitionStatusSchema
>;

/* ── requisitions ── */

export const ProcurementRequisitionLineSchema = z.object({
  catalogItemId: z.string().min(1).max(80),
  quantity: z.number().int().positive(),
  uom: z.string().min(1).max(20),
});
export type ProcurementRequisitionLine = z.infer<
  typeof ProcurementRequisitionLineSchema
>;

export const ProcurementRequisitionSchema = z.object({
  id: z.string(),
  neededBy: z.string(),
  justification: z.string().nullable(),
  lines: z.array(ProcurementRequisitionLineSchema),
  createdAt: z.string(),
  status: ProcurementRequisitionStatusSchema,
});
export type ProcurementRequisition = z.infer<
  typeof ProcurementRequisitionSchema
>;

/* ── RFQ ── */

export const ProcurementRfqShortlistedVendorSchema = z.object({
  vendorId: z.string(),
  name: z.string(),
  score: z.number(),
  avgPrice: z.number(),
});
export type ProcurementRfqShortlistedVendor = z.infer<
  typeof ProcurementRfqShortlistedVendorSchema
>;

export const ProcurementRfqSchema = z.object({
  id: z.string(),
  requisitionId: z.string(),
  shortlistedVendors: z.array(ProcurementRfqShortlistedVendorSchema),
  quotes: z.array(z.unknown()),
  award: z.unknown().nullable(),
  createdAt: z.string(),
});
export type ProcurementRfq = z.infer<typeof ProcurementRfqSchema>;

/* ── blanket orders ── */

export const ProcurementBlanketOrderSchema = z.object({
  id: z.string(),
  vendorId: z.string(),
  catalogItemId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  committedQty: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  createdAt: z.string(),
});
export type ProcurementBlanketOrder = z.infer<
  typeof ProcurementBlanketOrderSchema
>;

export const ProcurementCoverageSchema = z.object({
  committedQty: z.number().nonnegative(),
  openPoQty: z.number().nonnegative(),
  blanketOrders: z.array(ProcurementBlanketOrderSchema),
});
export type ProcurementCoverage = z.infer<
  typeof ProcurementCoverageSchema
>;

/* ── landed costs ── */

export const ProcurementLandedCostAllocationSchema = z.object({
  lineId: z.string(),
  amount: z.number().nonnegative(),
});
export type ProcurementLandedCostAllocation = z.infer<
  typeof ProcurementLandedCostAllocationSchema
>;

export const ProcurementLandedCostSchema = z.object({
  id: z.string(),
  poId: z.string(),
  kind: ProcurementLandedCostKindSchema,
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  allocationMethod: ProcurementAllocationMethodSchema,
  allocated: z.array(ProcurementLandedCostAllocationSchema),
});
export type ProcurementLandedCost = z.infer<
  typeof ProcurementLandedCostSchema
>;

/* ── credit notes ── */

export const ProcurementCreditNoteSchema = z.object({
  id: z.string(),
  poId: z.string(),
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  createdAt: z.string(),
});
export type ProcurementCreditNote = z.infer<
  typeof ProcurementCreditNoteSchema
>;

/* ── AI / analytics ── */

export const ProcurementAiVendorSelectionSchema = z.object({
  vendorId: z.string(),
  name: z.string(),
  score: z.number(),
  reasoning: z.array(z.string()),
});
export type ProcurementAiVendorSelection = z.infer<
  typeof ProcurementAiVendorSelectionSchema
>;

export const ProcurementAiPriceAnomalySchema = z.object({
  isAnomaly: z.boolean(),
  zScore: z.number(),
  expectedRange: z.object({
    low: z.number(),
    high: z.number(),
  }),
});
export type ProcurementAiPriceAnomaly = z.infer<
  typeof ProcurementAiPriceAnomalySchema
>;

export const ProcurementReplenishmentSuggestionSchema = z.object({
  catalogItemId: z.string(),
  suggestedQty: z.number().nonnegative(),
  onHand: z.number().nonnegative(),
  inTransit: z.number().nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
});
export type ProcurementReplenishmentSuggestion = z.infer<
  typeof ProcurementReplenishmentSuggestionSchema
>;

/* ── request payloads (5 create endpoints — all with idempotencyKey) ── */

const ProcurementIdempotencyKeySchema = z.string().min(1).max(200);

export const ProcurementRequisitionCreateRequestSchema = z.object({
  neededBy: z.string().min(1),
  justification: z.string().max(500).optional(),
  lines: z.array(ProcurementRequisitionLineSchema).optional(),
  idempotencyKey: ProcurementIdempotencyKeySchema,
});
export type ProcurementRequisitionCreateRequest = z.infer<
  typeof ProcurementRequisitionCreateRequestSchema
>;

export const ProcurementRfqConvertRequestSchema = z.object({
  neededBy: z.string().min(1),
  justification: z.string().max(500).optional(),
  idempotencyKey: ProcurementIdempotencyKeySchema,
});
export type ProcurementRfqConvertRequest = z.infer<
  typeof ProcurementRfqConvertRequestSchema
>;

export const ProcurementBlanketOrderCreateRequestSchema = z.object({
  vendorId: z.string().min(1),
  catalogItemId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  committedQty: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  idempotencyKey: ProcurementIdempotencyKeySchema,
});
export type ProcurementBlanketOrderCreateRequest = z.infer<
  typeof ProcurementBlanketOrderCreateRequestSchema
>;

export const ProcurementLandedCostCreateRequestSchema = z.object({
  poId: z.string().min(1),
  kind: ProcurementLandedCostKindSchema,
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  allocationMethod: ProcurementAllocationMethodSchema,
  idempotencyKey: ProcurementIdempotencyKeySchema,
});
export type ProcurementLandedCostCreateRequest = z.infer<
  typeof ProcurementLandedCostCreateRequestSchema
>;

export const ProcurementCreditNoteCreateRequestSchema = z.object({
  poId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  idempotencyKey: ProcurementIdempotencyKeySchema,
});
export type ProcurementCreditNoteCreateRequest = z.infer<
  typeof ProcurementCreditNoteCreateRequestSchema
>;

/* ── response envelopes ── */

export const ProcurementRequisitionCreateResponseSchema = z.object({
  ok: z.literal(true),
  requisition: ProcurementRequisitionSchema,
});
export type ProcurementRequisitionCreateResponse = z.infer<
  typeof ProcurementRequisitionCreateResponseSchema
>;

export const ProcurementRfqConvertResponseSchema = z.object({
  ok: z.literal(true),
  rfq: ProcurementRfqSchema,
});
export type ProcurementRfqConvertResponse = z.infer<
  typeof ProcurementRfqConvertResponseSchema
>;

export const ProcurementBlanketOrderCreateResponseSchema = z.object({
  ok: z.literal(true),
  blanket: ProcurementBlanketOrderSchema,
});
export type ProcurementBlanketOrderCreateResponse = z.infer<
  typeof ProcurementBlanketOrderCreateResponseSchema
>;

export const ProcurementCoverageResponseSchema = z.object({
  ok: z.literal(true),
  coverage: ProcurementCoverageSchema,
});
export type ProcurementCoverageResponse = z.infer<
  typeof ProcurementCoverageResponseSchema
>;

export const ProcurementLandedCostCreateResponseSchema = z.object({
  ok: z.literal(true),
  landed: ProcurementLandedCostSchema,
});
export type ProcurementLandedCostCreateResponse = z.infer<
  typeof ProcurementLandedCostCreateResponseSchema
>;

export const ProcurementCreditNoteCreateResponseSchema = z.object({
  ok: z.literal(true),
  credit: ProcurementCreditNoteSchema,
});
export type ProcurementCreditNoteCreateResponse = z.infer<
  typeof ProcurementCreditNoteCreateResponseSchema
>;

export const ProcurementAiVendorSelectionResponseSchema = z.object({
  ok: z.literal(true),
  selected: ProcurementAiVendorSelectionSchema,
  reasoning: z.array(z.string()),
});
export type ProcurementAiVendorSelectionResponse = z.infer<
  typeof ProcurementAiVendorSelectionResponseSchema
>;

export const ProcurementAiPriceAnomalyResponseSchema = z.object({
  ok: z.literal(true),
  anomaly: ProcurementAiPriceAnomalySchema,
});
export type ProcurementAiPriceAnomalyResponse = z.infer<
  typeof ProcurementAiPriceAnomalyResponseSchema
>;

export const ProcurementReplenishmentResponseSchema = z.object({
  ok: z.literal(true),
  suggestions: z.array(ProcurementReplenishmentSuggestionSchema),
});
export type ProcurementReplenishmentResponse = z.infer<
  typeof ProcurementReplenishmentResponseSchema
>;

/* ════════════════════════════════════════════════════════════════════════
 * Assets (Phase 8.5) — Zod schemas for the /api/assets/* surface.
 * Source: server/app.js lines 3602-3851 (categories, registry, depreciation,
 * maintenance-history, post-depreciation, assign, return, write-off, value
 * rollup) and server/assets.js#buildSchedule / #rollUpValueByCategory.
 *
 * The Assets workspace in web-modern renders 4 tabs: Registry, Depreciation,
 * Maintenance, Assignment. All integer-AMD where amounts appear. Maintenance
 * log `performed_at` is YYYY-MM-DD; the depreciation schedule is
 * `{periodIndex, depreciationAmd, accumulatedAmd, netBookValueAmd}` per
 * line; the value rollup is a per-category aggregate.
 * ════════════════════════════════════════════════════════════════════════ */

/** One row of the registry tab — a (category, count, totals) aggregate.
 *  Source: server/app.js#rollUpValueByCategory (line 197). */
export const AssetsValueRollupRowSchema = z.object({
  categoryId: z.string(),
  count: z.number().int().nonnegative(),
  totalCostAmd: z.number().int(),
  totalNbvAmd: z.number().int(),
});
export type AssetsValueRollupRow = z.infer<typeof AssetsValueRollupRowSchema>;

export const AssetsValueRollupResponseSchema = z.object({
  ok: z.literal(true),
  rollup: z.array(AssetsValueRollupRowSchema),
});
export type AssetsValueRollupResponse = z.infer<
  typeof AssetsValueRollupResponseSchema
>;

/** One period in a depreciation schedule.
 *  Source: server/assets.js#depreciateStraightLine / #depreciateReducingBalance
 *  (lines 129-167). The `accumulatedAmd` field is surfaced in the response
 *  even though the legacy UI only reads `depreciationAmd` and `netBookValueAmd`
 *  — keeping it here for parity with the wire format. */
export const AssetsDepreciationLineSchema = z.object({
  periodIndex: z.number().int().nonnegative(),
  depreciationAmd: z.number().int(),
  accumulatedAmd: z.number().int(),
  netBookValueAmd: z.number().int(),
});
export type AssetsDepreciationLine = z.infer<
  typeof AssetsDepreciationLineSchema
>;

export const AssetsDepreciationResponseSchema = z.object({
  ok: z.literal(true),
  assetId: z.string(),
  schedule: z.array(AssetsDepreciationLineSchema),
});
export type AssetsDepreciationResponse = z.infer<
  typeof AssetsDepreciationResponseSchema
>;

/** Body for POST /api/assets/:id/post-depreciation. Mirrors the validator
 *  in server/app.js (line 3692: `periodKey must be YYYY-MM`,
 *  `monthIndex` clamped into `[0, schedule.length-1]`). `monthIndex: 0` is
 *  always sent from the legacy UI (line 49 of web/src/assets.jsx). */
export const AssetsPostDepreciationRequestSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, "periodKey must be YYYY-MM"),
  monthIndex: z.number().int().nonnegative().default(0),
  idempotencyKey: z.string().min(1).max(200),
});
export type AssetsPostDepreciationRequest = z.infer<
  typeof AssetsPostDepreciationRequestSchema
>;

export const AssetsPostDepreciationResponseSchema = z.object({
  ok: z.literal(true),
  period: z
    .object({
      id: z.string(),
      asset_id: z.string().optional(),
      period_key: z.string().optional(),
      depreciation_amd: z.number().int().optional(),
      accumulated_amd: z.number().int().optional(),
      net_book_value_amd: z.number().int().optional(),
      status: z.string().optional(),
      posted_at: z.string().optional(),
    })
    .passthrough(),
});
export type AssetsPostDepreciationResponse = z.infer<
  typeof AssetsPostDepreciationResponseSchema
>;

/** One maintenance log entry.
 *  Source: server/db.js asset_maintenance_logs (line 8394) and
 *  server/app.js GET /api/assets/:id/maintenance-history (3724).
 *  The legacy UI renders `performed_at` (YYYY-MM-DD), `kind`, and
 *  `cost_amd`; we expose the full row plus optional vendor / notes / next-due
 *  fields for parity. */
export const AssetsMaintenanceLogSchema = z.object({
  id: z.string(),
  asset_id: z.string().optional(),
  performed_at: z.string(),
  kind: z.string(),
  cost_amd: z.number().int().nonnegative(),
  vendor_id: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  file_id: z.string().nullable().optional(),
  next_due_at: z.string().nullable().optional(),
});
export type AssetsMaintenanceLog = z.infer<typeof AssetsMaintenanceLogSchema>;

export const AssetsMaintenanceResponseSchema = z.object({
  ok: z.literal(true),
  assetId: z.string(),
  logs: z.array(AssetsMaintenanceLogSchema),
});
export type AssetsMaintenanceResponse = z.infer<
  typeof AssetsMaintenanceResponseSchema
>;

/** Body for POST /api/assets/:id/assign. Mirrors the validator in
 *  server/app.js (line 3783-3785: both `assigneeType` and `assigneeId`
 *  required, non-empty after trim). */
export const AssetsAssignRequestSchema = z.object({
  assigneeType: z.string().min(1).max(60),
  assigneeId: z.string().min(1).max(80),
  idempotencyKey: z.string().min(1).max(200),
});
export type AssetsAssignRequest = z.infer<typeof AssetsAssignRequestSchema>;

export const AssetsAssignmentSchema = z
  .object({
    id: z.string(),
    asset_id: z.string().optional(),
    assignee_type: z.string().optional(),
    assignee_id: z.string().optional(),
    assigned_at: z.string().optional(),
    returned_at: z.string().nullable().optional(),
    signature_doc_id: z.string().nullable().optional(),
  })
  .passthrough();
export type AssetsAssignment = z.infer<typeof AssetsAssignmentSchema>;

export const AssetsAssignResponseSchema = z.object({
  ok: z.literal(true),
  assignment: AssetsAssignmentSchema,
});
export type AssetsAssignResponse = z.infer<typeof AssetsAssignResponseSchema>;

/* ════════════════════════════════════════════════════════════════════════
 * Fleet (Phase 8.6) — Zod schemas for the /api/fleet/* surface.
 * Source: server/app.js lines 3697-3930 (the 9 list / POST / PATCH / analytics
 * endpoints plus the cold-chain compliance report), and server/fleet.js
 * (the trip status state machine).
 *
 * The Fleet workspace in web-modern renders 7 tabs: Vehicles, Drivers,
 * Trips, Fuel, Repairs, Tires, ColdChain. Each tab has its own GET
 * envelope below. Two analytics GETs (`/analytics/fuel-efficiency` and
 * `/analytics/maintenance-backlog`) plus one derived response
 * (`/vehicles/:id/cold-chain-compliance`) round out the surface. The
 * two IoT device-batch POSTs are server-side only — not surfaced.
 *
 * Every write endpoint carries an `idempotencyKey: z.string().min(1).max(200)`
 * (server stores the response envelope in `idempotency_keys` so safe
 * retries return the cached envelope). Trip status PATCH is the only
 * non-CRUD write — see `FleetTripStatusPatchRequestSchema` below.
 * ════════════════════════════════════════════════════════════════════════ */

/* ── shared enum constants ── */

export const FleetTripStateSchema = z.enum([
  "planned",
  "in_transit",
  "arrived",
  "cancelled",
]);
export type FleetTripState = z.infer<typeof FleetTripStateSchema>;

export const FleetTripActionSchema = z.enum([
  "departed",
  "arrived",
  "cancelled",
]);
export type FleetTripAction = z.infer<typeof FleetTripActionSchema>;

export const FleetColdChainCategorySchema = z.enum([
  "dairy",
  "frozen",
  "produce",
  "meat",
  "default",
]);
export type FleetColdChainCategory = z.infer<
  typeof FleetColdChainCategorySchema
>;

/* ── entities ── */

export const FleetVehicleSchema = z.object({
  id: z.string(),
  plate: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int().nullable(),
  kind: z.string(),
});
export type FleetVehicle = z.infer<typeof FleetVehicleSchema>;

export const FleetDriverSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  licenseNumber: z.string(),
});
export type FleetDriver = z.infer<typeof FleetDriverSchema>;

export const FleetTripSchema = z.object({
  id: z.string(),
  status: FleetTripStateSchema,
  origin: z.string(),
  destination: z.string(),
  scheduledDeparture: z.string(),
  actualDeparture: z.string().nullable(),
  actualArrival: z.string().nullable(),
  vehicleId: z.string(),
  driverId: z.string(),
  createdAt: z.string(),
});
export type FleetTrip = z.infer<typeof FleetTripSchema>;

export const FleetFuelLogSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  liters: z.number().nonnegative(),
  odometerKm: z.number().nonnegative(),
  fuelCostPerL: z.number().nonnegative(),
  occurredAt: z.string(),
});
export type FleetFuelLog = z.infer<typeof FleetFuelLogSchema>;

export const FleetRepairSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  kind: z.string(),
  odometerKm: z.number().nonnegative(),
  cost: z.number().nonnegative(),
  performedAt: z.string(),
  nextDueAt: z.string().nullable(),
});
export type FleetRepair = z.infer<typeof FleetRepairSchema>;

export const FleetTireSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  position: z.string(),
  brand: z.string().nullable(),
  installedAt: z.string(),
  odometerAtInstall: z.number().int().nullable(),
  expectedLifeKm: z.number().int().nullable(),
});
export type FleetTire = z.infer<typeof FleetTireSchema>;

export const FleetColdChainLogSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  tempC: z.number(),
  humidity: z.number().nullable(),
  recordedAt: z.string(),
});
export type FleetColdChainLog = z.infer<typeof FleetColdChainLogSchema>;

/* ── analytics + compliance ── */

export const FleetColdChainComplianceBreachSchema = z.object({
  startedAt: z.string(),
  endedAt: z.string(),
  minutes: z.number().nonnegative(),
});
export type FleetColdChainComplianceBreach = z.infer<
  typeof FleetColdChainComplianceBreachSchema
>;

export const FleetColdChainComplianceReportSchema = z.object({
  worstTempC: z.number(),
  sustainedMinutes: z.number().nonnegative(),
  breaches: z.array(FleetColdChainComplianceBreachSchema),
});
export type FleetColdChainComplianceReport = z.infer<
  typeof FleetColdChainComplianceReportSchema
>;

export const FleetColdChainComplianceResponseSchema = z.object({
  category: FleetColdChainCategorySchema,
  report: FleetColdChainComplianceReportSchema,
});
export type FleetColdChainComplianceResponse = z.infer<
  typeof FleetColdChainComplianceResponseSchema
>;

export const FleetFuelEfficiencyRowSchema = z.object({
  vehicleId: z.string(),
  liters: z.number().nonnegative(),
  km: z.number().nonnegative(),
  lPer100km: z.number().nonnegative(),
  kmPerL: z.number().nullable(),
});
export type FleetFuelEfficiencyRow = z.infer<
  typeof FleetFuelEfficiencyRowSchema
>;

export const FleetMaintenanceBacklogRowSchema = z.object({
  vehicleId: z.string(),
  kind: z.string(),
  overdueDays: z.number().int().nonnegative(),
});
export type FleetMaintenanceBacklogRow = z.infer<
  typeof FleetMaintenanceBacklogRowSchema
>;

/* ── list envelopes (one per tab) ── */

export const FleetVehiclesResponseSchema = z.object({
  vehicles: z.array(FleetVehicleSchema),
});
export type FleetVehiclesResponse = z.infer<typeof FleetVehiclesResponseSchema>;

export const FleetDriversResponseSchema = z.object({
  drivers: z.array(FleetDriverSchema),
});
export type FleetDriversResponse = z.infer<typeof FleetDriversResponseSchema>;

export const FleetTripsResponseSchema = z.object({
  trips: z.array(FleetTripSchema),
});
export type FleetTripsResponse = z.infer<typeof FleetTripsResponseSchema>;

export const FleetFuelLogsResponseSchema = z.object({
  fuelLogs: z.array(FleetFuelLogSchema),
});
export type FleetFuelLogsResponse = z.infer<typeof FleetFuelLogsResponseSchema>;

export const FleetRepairsResponseSchema = z.object({
  repairs: z.array(FleetRepairSchema),
});
export type FleetRepairsResponse = z.infer<typeof FleetRepairsResponseSchema>;

export const FleetTiresResponseSchema = z.object({
  tires: z.array(FleetTireSchema),
});
export type FleetTiresResponse = z.infer<typeof FleetTiresResponseSchema>;

export const FleetColdChainLogsResponseSchema = z.object({
  logs: z.array(FleetColdChainLogSchema),
});
export type FleetColdChainLogsResponse = z.infer<
  typeof FleetColdChainLogsResponseSchema
>;

export const FleetFuelEfficiencyResponseSchema = z.object({
  efficiency: z.array(FleetFuelEfficiencyRowSchema),
});
export type FleetFuelEfficiencyResponse = z.infer<
  typeof FleetFuelEfficiencyResponseSchema
>;

export const FleetMaintenanceBacklogResponseSchema = z.object({
  backlog: z.array(FleetMaintenanceBacklogRowSchema),
});
export type FleetMaintenanceBacklogResponse = z.infer<
  typeof FleetMaintenanceBacklogResponseSchema
>;

/* ── request payloads (one per writer endpoint) ── */

const FleetIdempotencyKeySchema = z.string().min(1).max(200);

export const FleetVehicleCreateRequestSchema = z.object({
  plate: z.string().min(1).max(40),
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  kind: z.string().min(1).max(40).default("truck"),
  idempotencyKey: FleetIdempotencyKeySchema,
});
export type FleetVehicleCreateRequest = z.infer<
  typeof FleetVehicleCreateRequestSchema
>;

export const FleetDriverCreateRequestSchema = z.object({
  fullName: z.string().min(1).max(120),
  phone: z.string().min(1).max(40).nullable().optional(),
  licenseNumber: z.string().min(1).max(40),
  idempotencyKey: FleetIdempotencyKeySchema,
});
export type FleetDriverCreateRequest = z.infer<
  typeof FleetDriverCreateRequestSchema
>;

export const FleetTripCreateRequestSchema = z.object({
  vehicleId: z.string().min(1),
  driverId: z.string().min(1),
  origin: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  scheduledDeparture: z.string().min(1),
  idempotencyKey: FleetIdempotencyKeySchema,
});
export type FleetTripCreateRequest = z.infer<
  typeof FleetTripCreateRequestSchema
>;

export const FleetTripStatusPatchRequestSchema = z.object({
  action: FleetTripActionSchema,
  idempotencyKey: FleetIdempotencyKeySchema,
});
export type FleetTripStatusPatchRequest = z.infer<
  typeof FleetTripStatusPatchRequestSchema
>;

export const FleetFuelLogCreateRequestSchema = z.object({
  vehicleId: z.string().min(1),
  liters: z.number().nonnegative(),
  odometerKm: z.number().nonnegative(),
  fuelCostPerL: z.number().nonnegative(),
  idempotencyKey: FleetIdempotencyKeySchema,
});
export type FleetFuelLogCreateRequest = z.infer<
  typeof FleetFuelLogCreateRequestSchema
>;

export const FleetRepairCreateRequestSchema = z.object({
  vehicleId: z.string().min(1),
  kind: z.string().min(1).max(60),
  odometerKm: z.number().nonnegative(),
  cost: z.number().nonnegative(),
  nextDueAt: z.string().nullable().optional(),
  idempotencyKey: FleetIdempotencyKeySchema,
});
export type FleetRepairCreateRequest = z.infer<
  typeof FleetRepairCreateRequestSchema
>;

export const FleetTireInstallRequestSchema = z.object({
  vehicleId: z.string().min(1),
  position: z.string().min(1).max(20),
  brand: z.string().min(1).max(60).nullable().optional(),
  installedAt: z.string().min(1),
  odometerAtInstall: z.number().int().nonnegative().nullable().optional(),
  expectedLifeKm: z.number().int().nonnegative().nullable().optional(),
  idempotencyKey: FleetIdempotencyKeySchema,
});
export type FleetTireInstallRequest = z.infer<
  typeof FleetTireInstallRequestSchema
>;

/* ── write response envelopes ── */

export const FleetVehicleCreateResponseSchema = z.object({
  ok: z.literal(true),
  vehicle: FleetVehicleSchema,
});
export type FleetVehicleCreateResponse = z.infer<
  typeof FleetVehicleCreateResponseSchema
>;

export const FleetDriverCreateResponseSchema = z.object({
  ok: z.literal(true),
  driver: FleetDriverSchema,
});
export type FleetDriverCreateResponse = z.infer<
  typeof FleetDriverCreateResponseSchema
>;

export const FleetTripCreateResponseSchema = z.object({
  ok: z.literal(true),
  trip: FleetTripSchema,
});
export type FleetTripCreateResponse = z.infer<
  typeof FleetTripCreateResponseSchema
>;

export const FleetTripStatusPatchResponseSchema = z.object({
  ok: z.literal(true),
  trip: FleetTripSchema,
});
export type FleetTripStatusPatchResponse = z.infer<
  typeof FleetTripStatusPatchResponseSchema
>;

export const FleetFuelLogCreateResponseSchema = z.object({
  ok: z.literal(true),
  log: FleetFuelLogSchema,
});
export type FleetFuelLogCreateResponse = z.infer<
  typeof FleetFuelLogCreateResponseSchema
>;

export const FleetRepairCreateResponseSchema = z.object({
  ok: z.literal(true),
  repair: FleetRepairSchema,
});
export type FleetRepairCreateResponse = z.infer<
  typeof FleetRepairCreateResponseSchema
>;

export const FleetTireInstallResponseSchema = z.object({
  ok: z.literal(true),
  tire: FleetTireSchema,
});
export type FleetTireInstallResponse = z.infer<
  typeof FleetTireInstallResponseSchema
>;

/* ════════════════════════════════════════════════════════════════════════
 * Greenhouse (Phase 8.7) — Zod schemas for the /api/greenhouse/* surface.
 * Source: server/app.js (the greenhouse block — 7 tabs + 1 AI endpoint).
 * The 7 tabs are House, Zone, Crop, Climate (GDD), Energy, Bioprotection,
 * and Harvest. State flows: houseId → zoneId → cropId — the legacy panel
 * holds these in local component state and exposes them as "ID" pills
 * (web/src/greenhouse.jsx lines 65/73/81). The legacy render reuses
 * `harvestedAt` for `appliedAt` in the bioprotection POST (line 105-106),
 * which is intentional: both are date-of-action fields.
 *
 * Every write endpoint carries an `idempotencyKey: z.string().min(1).max(200)`
 * (server stores the response envelope in `idempotency_keys` so safe
 * retries return the cached envelope).
 * ════════════════════════════════════════════════════════════════════════ */

/* ── enum constants ── */

export const GreenhouseGlazingKindSchema = z.enum(["glass", "poly", "film"]);
export type GreenhouseGlazingKind = z.infer<typeof GreenhouseGlazingKindSchema>;

export const GreenhouseHeatingKindSchema = z.enum([
  "gas",
  "electric",
  "biomass",
  "geothermal",
]);
export type GreenhouseHeatingKind = z.infer<typeof GreenhouseHeatingKindSchema>;

export const GreenhouseIrrigationKindSchema = z.enum([
  "drip",
  "sprinkler",
  "flood",
  "manual",
]);
export type GreenhouseIrrigationKind = z.infer<
  typeof GreenhouseIrrigationKindSchema
>;

export const GreenhouseCropKindSchema = z.enum([
  "tomato",
  "cucumber",
  "pepper",
  "lettuce",
  "strawberry",
  "herb",
]);
export type GreenhouseCropKind = z.infer<typeof GreenhouseCropKindSchema>;

export const GreenhouseCropStatusSchema = z.enum([
  "growing",
  "harvested",
  "lost",
  "terminated",
]);
export type GreenhouseCropStatus = z.infer<typeof GreenhouseCropStatusSchema>;

export const GreenhouseQualityGradeSchema = z.enum(["A", "B", "C"]);
export type GreenhouseQualityGrade = z.infer<typeof GreenhouseQualityGradeSchema>;

export const GreenhouseAiIntentSchema = z.enum([
  "yield-forecast",
  "climate-anomaly",
  "pest-risk",
]);
export type GreenhouseAiIntent = z.infer<typeof GreenhouseAiIntentSchema>;

/* ── entities ── */

export const GreenhouseHouseSchema = z.object({
  id: z.string(),
  name: z.string(),
  areaM2: z.number(),
  glazingKind: GreenhouseGlazingKindSchema,
  heatingKind: GreenhouseHeatingKindSchema,
  createdAt: z.string(),
});
export type GreenhouseHouse = z.infer<typeof GreenhouseHouseSchema>;

export const GreenhouseZoneSchema = z.object({
  id: z.string(),
  greenhouseId: z.string(),
  name: z.string(),
  areaM2: z.number(),
  irrigationKind: GreenhouseIrrigationKindSchema,
  createdAt: z.string(),
});
export type GreenhouseZone = z.infer<typeof GreenhouseZoneSchema>;

export const GreenhouseCropSchema = z.object({
  id: z.string(),
  zoneId: z.string(),
  cropKind: GreenhouseCropKindSchema,
  plantedAt: z.string(),
  expectedHarvestAt: z.string(),
  expectedYieldKg: z.number(),
  seedSource: z.string(),
  status: GreenhouseCropStatusSchema,
  createdAt: z.string(),
});
export type GreenhouseCrop = z.infer<typeof GreenhouseCropSchema>;

export const GreenhouseBioprotectionSchema = z.object({
  id: z.string(),
  zoneId: z.string(),
  appliedAt: z.string(),
  agentKind: z.string(),
  dose: z.string(),
  targetPest: z.string(),
  withdrawalPeriodDays: z.number().int().nonnegative(),
  recordedBy: z.string(),
  createdAt: z.string(),
});
export type GreenhouseBioprotection = z.infer<
  typeof GreenhouseBioprotectionSchema
>;

export const GreenhouseHarvestSchema = z.object({
  id: z.string(),
  cropId: z.string(),
  harvestedAt: z.string(),
  quantityKg: z.number(),
  qualityGrade: GreenhouseQualityGradeSchema,
  lotId: z.string(),
  createdAt: z.string(),
});
export type GreenhouseHarvest = z.infer<typeof GreenhouseHarvestSchema>;

/* ── analytics rows / packets ── */

export const GreenhouseYieldRowSchema = z.object({
  cropId: z.string(),
  cropKind: GreenhouseCropKindSchema,
  expectedKg: z.number(),
  actualKg: z.number().nullable(),
  pctOfForecast: z.number().nullable(),
});
export type GreenhouseYieldRow = z.infer<typeof GreenhouseYieldRowSchema>;

export const GreenhouseEnergySchema = z.object({
  totalKwh: z.number(),
  totalGasM3: z.number(),
  totalKg: z.number(),
  kwhPerKg: z.number(),
  gasM3PerKg: z.number(),
});
export type GreenhouseEnergy = z.infer<typeof GreenhouseEnergySchema>;

export const GreenhouseGddSchema = z.object({
  baseTempC: z.number(),
  growingDegreeDays: z.number(),
  sampleSize: z.number(),
});
export type GreenhouseGdd = z.infer<typeof GreenhouseGddSchema>;

export const GreenhouseAiForecastPacketSchema = z.object({
  intent: GreenhouseAiIntentSchema,
  aiSource: z.string(),
  answer: z.string(),
  confidence: z.number(),
  riskLevel: z.string(),
});
export type GreenhouseAiForecastPacket = z.infer<
  typeof GreenhouseAiForecastPacketSchema
>;

/* ── analytics response envelopes (per legacy GET) ── */

export const GreenhouseYieldResponseSchema = z.object({
  rows: z.array(GreenhouseYieldRowSchema),
});
export type GreenhouseYieldResponse = z.infer<
  typeof GreenhouseYieldResponseSchema
>;

export const GreenhouseEnergyResponseSchema = z.object({
  energy: GreenhouseEnergySchema,
});
export type GreenhouseEnergyResponse = z.infer<
  typeof GreenhouseEnergyResponseSchema
>;

export const GreenhouseGddResponseSchema = z.object({
  baseTempC: z.number(),
  growingDegreeDays: z.number(),
  sampleSize: z.number(),
});
export type GreenhouseGddResponse = z.infer<typeof GreenhouseGddResponseSchema>;

/* ── request payloads (6 create endpoints — all with idempotencyKey) ── */

const GreenhouseIdempotencyKeySchema = z.string().min(1).max(200);

export const GreenhouseHouseCreateRequestSchema = z.object({
  name: z.string().min(1).max(120),
  areaM2: z.number().positive(),
  glazingKind: GreenhouseGlazingKindSchema,
  heatingKind: GreenhouseHeatingKindSchema,
  idempotencyKey: GreenhouseIdempotencyKeySchema,
});
export type GreenhouseHouseCreateRequest = z.infer<
  typeof GreenhouseHouseCreateRequestSchema
>;

export const GreenhouseZoneCreateRequestSchema = z.object({
  greenhouseId: z.string().min(1),
  name: z.string().min(1).max(120),
  areaM2: z.number().positive(),
  irrigationKind: GreenhouseIrrigationKindSchema,
  idempotencyKey: GreenhouseIdempotencyKeySchema,
});
export type GreenhouseZoneCreateRequest = z.infer<
  typeof GreenhouseZoneCreateRequestSchema
>;

export const GreenhouseCropCreateRequestSchema = z.object({
  zoneId: z.string().min(1),
  cropKind: GreenhouseCropKindSchema,
  plantedAt: z.string().min(1),
  expectedHarvestAt: z.string().min(1),
  expectedYieldKg: z.number().nonnegative(),
  seedSource: z.string().min(1).max(120),
  idempotencyKey: GreenhouseIdempotencyKeySchema,
});
export type GreenhouseCropCreateRequest = z.infer<
  typeof GreenhouseCropCreateRequestSchema
>;

export const GreenhouseBioprotectionCreateRequestSchema = z.object({
  zoneId: z.string().min(1),
  appliedAt: z.string().min(1),
  agentKind: z.string().min(1).max(120),
  dose: z.string().min(1).max(60),
  targetPest: z.string().min(1).max(120),
  withdrawalPeriodDays: z.number().int().nonnegative(),
  recordedBy: z.string().min(1).max(120),
  idempotencyKey: GreenhouseIdempotencyKeySchema,
});
export type GreenhouseBioprotectionCreateRequest = z.infer<
  typeof GreenhouseBioprotectionCreateRequestSchema
>;

export const GreenhouseHarvestCreateRequestSchema = z.object({
  cropId: z.string().min(1),
  harvestedAt: z.string().min(1),
  quantityKg: z.number().nonnegative(),
  qualityGrade: GreenhouseQualityGradeSchema,
  idempotencyKey: GreenhouseIdempotencyKeySchema,
});
export type GreenhouseHarvestCreateRequest = z.infer<
  typeof GreenhouseHarvestCreateRequestSchema
>;

export const GreenhouseAiForecastRequestSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/),
  question: z.string().min(1).max(500),
  idempotencyKey: GreenhouseIdempotencyKeySchema,
});
export type GreenhouseAiForecastRequest = z.infer<
  typeof GreenhouseAiForecastRequestSchema
>;

/* ── write response envelopes ── */

export const GreenhouseHouseCreateResponseSchema = z.object({
  ok: z.literal(true),
  greenhouse: GreenhouseHouseSchema,
});
export type GreenhouseHouseCreateResponse = z.infer<
  typeof GreenhouseHouseCreateResponseSchema
>;

export const GreenhouseZoneCreateResponseSchema = z.object({
  ok: z.literal(true),
  zone: GreenhouseZoneSchema,
});
export type GreenhouseZoneCreateResponse = z.infer<
  typeof GreenhouseZoneCreateResponseSchema
>;

export const GreenhouseCropCreateResponseSchema = z.object({
  ok: z.literal(true),
  crop: GreenhouseCropSchema,
});
export type GreenhouseCropCreateResponse = z.infer<
  typeof GreenhouseCropCreateResponseSchema
>;

export const GreenhouseBioprotectionCreateResponseSchema = z.object({
  ok: z.literal(true),
  bioprotection: GreenhouseBioprotectionSchema,
});
export type GreenhouseBioprotectionCreateResponse = z.infer<
  typeof GreenhouseBioprotectionCreateResponseSchema
>;

export const GreenhouseHarvestCreateResponseSchema = z.object({
  ok: z.literal(true),
  harvest: GreenhouseHarvestSchema,
});
export type GreenhouseHarvestCreateResponse = z.infer<
  typeof GreenhouseHarvestCreateResponseSchema
>;

export const GreenhouseAiForecastResponseSchema = z.object({
  ok: z.literal(true),
  packet: GreenhouseAiForecastPacketSchema,
});
export type GreenhouseAiForecastResponse = z.infer<
  typeof GreenhouseAiForecastResponseSchema
>;

/* ════════════════════════════════════════════════════════════════════════
   State Integrations (Phase 8.8)

   Mirrors server/app.js#app.post("/api/state-int/:adapter/:operation", ...),
   app.get("/api/state-int/:adapter/:operation/:requestId/status", ...) and
   app.get("/api/state-int/audit", ...). The dispatch request body uses
   .passthrough() so the per-adapter payload (period/taxId/phone/...) is
   accepted unchanged — the server uses req.body spread to the per-adapter
   adapter module.

   Audit row keys are snake_case to match the SELECT projection verbatim:
     SELECT id, adapter, operation, request_id, status, latency_ms, called_at
   The legacy web/ panel and the audit export CSV both read these as-is, so
   the TypeScript shape has to use the same casing.
   ─────────────────────────────────────────────────────────────────────── */

/* ── enum constants ── */

export const StateIntAdapterIdSchema = z.enum([
  "src",
  "eregister",
  "egov",
  "idcard",
  "mobileid",
  "customs",
]);
export type StateIntAdapterId = z.infer<typeof StateIntAdapterIdSchema>;

export const StateIntOperationSchema = z.enum([
  "submitVat",
  "lookup",
  "sign",
  "verify",
  "challenge",
  "declare",
]);
export type StateIntOperation = z.infer<typeof StateIntOperationSchema>;

export const StateIntStatusSchema = z.enum(["ok", "deferred", "advisory", "failed"]);
export type StateIntStatus = z.infer<typeof StateIntStatusSchema>;

/* ── request / response envelopes ── */

export const StateIntDispatchRequestSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
  })
  .passthrough();
export type StateIntDispatchRequest = z.infer<
  typeof StateIntDispatchRequestSchema
>;

export const StateIntDispatchResponseSchema = z.object({
  requestId: z.string().min(1),
  status: StateIntStatusSchema,
  providerRef: z.string().optional(),
  signatureB64: z.string().optional(),
  certificateThumbprint: z.string().optional(),
  advisoryOnly: z.boolean().optional(),
});
export type StateIntDispatchResponse = z.infer<
  typeof StateIntDispatchResponseSchema
>;

export const StateIntStatusEnvelopeSchema = z.object({
  adapter: StateIntAdapterIdSchema,
  operation: StateIntOperationSchema,
  requestId: z.string().min(1),
  status: StateIntStatusSchema,
  calledAt: z.string().min(1),
  response: z.unknown(),
});
export type StateIntStatusEnvelope = z.infer<
  typeof StateIntStatusEnvelopeSchema
>;

/* ── audit list ── */

export const StateIntAuditRowSchema = z.object({
  id: z.string().min(1),
  adapter: StateIntAdapterIdSchema,
  operation: StateIntOperationSchema,
  request_id: z.string().min(1),
  status: StateIntStatusSchema,
  latency_ms: z.number().int().nonnegative(),
  called_at: z.string().min(1),
});
export type StateIntAuditRow = z.infer<typeof StateIntAuditRowSchema>;

export const StateIntAuditResponseSchema = z.object({
  audit: z.array(StateIntAuditRowSchema),
});
export type StateIntAuditResponse = z.infer<
  typeof StateIntAuditResponseSchema
>;

/* ── export-docs (Phase 8.9) ── */

/** Closed enum of template kinds the wizard exposes. Mirrors
 *  server/app.js EXPORT_DOCS_SUPPORTED_KINDS and the legacy
 *  web/src/exportDocs.jsx TEMPLATE_LABELS. */
export const ExportDocTemplateKindSchema = z.enum([
  "invoice",
  "packing",
  "cmr",
  "tir",
  "coo",
  "phyto",
  "vet",
  "declaration",
]);
export type ExportDocTemplateKind = z.infer<typeof ExportDocTemplateKindSchema>;

/** Closed enum of destination codes the wizard exposes in Step 1.
 *  Matches web/src/exportDocs.jsx line 89 (`["RU","EAEU","EU","AE","HK","PH"]`). */
export const ExportDocDestinationSchema = z.enum([
  "RU",
  "EAEU",
  "EU",
  "AE",
  "HK",
  "PH",
]);
export type ExportDocDestination = z.infer<typeof ExportDocDestinationSchema>;

/** Single line in the hardcoded demo sales-order the wizard POSTs to
 *  /api/export-docs/ai/auto-fill. Field shape mirrors server/app.js. */
export const ExportDocSalesOrderLineSchema = z.object({
  productId: z.string().min(1),
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  uom: z.string().min(1),
});
export type ExportDocSalesOrderLine = z.infer<
  typeof ExportDocSalesOrderLineSchema
>;

/** Sales-order envelope: destination + incoterm + currency + lines. */
export const ExportDocSalesOrderSchema = z.object({
  destinationCountry: ExportDocDestinationSchema,
  incoterm: z.string().min(1),
  currency: z.string().min(1),
  lines: z.array(ExportDocSalesOrderLineSchema).min(1),
});
export type ExportDocSalesOrder = z.infer<typeof ExportDocSalesOrderSchema>;

/** Product master entry — id + name + hsCode + uom. */
export const ExportDocProductMasterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hsCode: z.string().min(1),
  uom: z.string().min(1),
});
export type ExportDocProductMaster = z.infer<
  typeof ExportDocProductMasterSchema
>;

/** One auto-filled line (server response). Same shape as a sales-order
 *  line, but the wizard does not need `unitPrice` in the preview. */
export const ExportDocAutoFillDraftLineSchema = z.object({
  description: z.string().min(1),
  hsCode: z.string().min(1),
  quantity: z.number().int().positive(),
  uom: z.string().min(1),
});
export type ExportDocAutoFillDraftLine = z.infer<
  typeof ExportDocAutoFillDraftLineSchema
>;

export const ExportDocAutoFillDraftSchema = z.object({
  destinationCountry: ExportDocDestinationSchema,
  incoterm: z.string().min(1),
  currency: z.string().min(1),
  lines: z.array(ExportDocAutoFillDraftLineSchema),
});
export type ExportDocAutoFillDraft = z.infer<
  typeof ExportDocAutoFillDraftSchema
>;

/** Request body for POST /api/export-docs/ai/auto-fill. */
export const ExportDocAutoFillRequestSchema = z.object({
  destinationCountry: ExportDocDestinationSchema,
  salesOrder: ExportDocSalesOrderSchema,
  productMaster: z.array(ExportDocProductMasterSchema).min(1),
});
export type ExportDocAutoFillRequest = z.infer<
  typeof ExportDocAutoFillRequestSchema
>;

/** A single package the country-check returned. `requiredCertificates`
 *  is open-ended: the server returns arbitrary cert names, so we use
 *  `z.array(z.string())` rather than a closed enum. */
export const ExportDocCountryCheckPackSchema = z.object({
  requiredCertificates: z.array(z.string()),
});
export type ExportDocCountryCheckPack = z.infer<
  typeof ExportDocCountryCheckPackSchema
>;

/** Response body for GET /api/export-docs/ai/country-check?country=.
 *  `hsNote` is a free-form Armenian note the server may attach. */
export const ExportDocCountryCheckResponseSchema = z.object({
  destinationCountry: ExportDocDestinationSchema,
  pack: ExportDocCountryCheckPackSchema,
  hsNote: z.string().optional(),
});
export type ExportDocCountryCheckResponse = z.infer<
  typeof ExportDocCountryCheckResponseSchema
>;

/** Status enum for an ExportDoc. The wizard only surfaces `draft` and
 *  `finalized`; `void` is reserved for the future sign/void flow. */
export const ExportDocStatusSchema = z.enum([
  "draft",
  "finalized",
  "void",
]);
export type ExportDocStatus = z.infer<typeof ExportDocStatusSchema>;

/** An export-doc as the server returns it. */
export const ExportDocSchema = z.object({
  id: z.string().min(1),
  kind: ExportDocTemplateKindSchema,
  destinationCountry: ExportDocDestinationSchema,
  status: ExportDocStatusSchema,
  lines: z.array(ExportDocAutoFillDraftLineSchema).min(1),
  createdAt: z.string().min(1),
  finalizedAt: z.string().optional(),
});
export type ExportDoc = z.infer<typeof ExportDocSchema>;

/** Request body for POST /api/export-docs (create). */
export const ExportDocCreateRequestSchema = z.object({
  kind: ExportDocTemplateKindSchema,
  destinationCountry: ExportDocDestinationSchema,
  incoterm: z.string().min(1),
  currency: z.string().min(1),
  lines: z.array(ExportDocAutoFillDraftLineSchema).min(1),
  idempotencyKey: z.string().min(1).max(200),
});
export type ExportDocCreateRequest = z.infer<
  typeof ExportDocCreateRequestSchema
>;

/** Request body for POST /api/export-docs/:id/finalize. */
export const ExportDocFinalizeRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
});
export type ExportDocFinalizeRequest = z.infer<
  typeof ExportDocFinalizeRequestSchema
>;

/** Common server envelope: `{ ok, exportDoc }`. */
export const ExportDocEnvelopeSchema = z.object({
  ok: z.boolean(),
  exportDoc: ExportDocSchema,
});
export type ExportDocEnvelope = z.infer<typeof ExportDocEnvelopeSchema>;

/** Response body for POST /api/export-docs/ai/auto-fill. */
export const ExportDocAutoFillResponseSchema = z.object({
  ok: z.boolean(),
  draft: ExportDocAutoFillDraftSchema,
});
export type ExportDocAutoFillResponse = z.infer<
  typeof ExportDocAutoFillResponseSchema
>;

/* ── compliance / production-readiness (Phase 8.10) ── */

/** Closed enum of the production-readiness status the server reports.
 *  Mirrors server/app.js getProductionReadiness (`status` is `"ready"`
 *  when there are zero blockers, else `"blocked"`). Note: NOT `"review"` —
 *  the plan.md v1 was wrong; the wire value is `ready | blocked` and
 *  `reviewRequired` is a separate boolean. */
export const ProductionReadinessStatusSchema = z.enum(["ready", "blocked"]);
export type ProductionReadinessStatus = z.infer<
  typeof ProductionReadinessStatusSchema
>;

/** Closed enum of gate domains the server emits.
 *
 *  IMPORTANT: the server uses `"tax-rate"` for the VAT rate gate
 *  (server/app.js#buildVatRateReadinessGate, line ~49654) — NOT
 *  `"vat-rate"` as the plan.md v1 said. The "payroll-rate" gate is
 *  a separate domain. We model what the server actually emits, not
 *  what the plan claimed, so the type contract does not reject
 *  valid responses. */
export const ProductionReadinessGateDomainSchema = z.enum([
  "legal-source",
  "tax-rate",
  "payroll-rate",
]);
export type ProductionReadinessGateDomain = z.infer<
  typeof ProductionReadinessGateDomainSchema
>;

/** Single gate row as the server returns it from
 *  GET /api/compliance/production-readiness.
 *
 *  - `effectiveDate` and `sourceUrl` are non-null on the wire: the
 *    server fills them with `""` when the underlying row is missing
 *    (rather than `null`), so we accept the empty string instead of
 *    `string | null` and let the UI helper render a localized
 *    "առանց ամսաթվի" placeholder.
 *  - `rate` is `number | null`: legal-source gates have no rate, so
 *    the server emits `null` for them. */
export const ProductionReadinessGateSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  domain: ProductionReadinessGateDomainSchema,
  ownerRole: z.string().min(1),
  reviewerRoles: z.array(z.string()),
  pass: z.boolean(),
  status: z.string(),
  requiredStatus: z.string(),
  effectiveDate: z.string(),
  sourceUrl: z.string(),
  rate: z.number().nullable(),
  nextAction: z.string(),
});
export type ProductionReadinessGate = z.infer<typeof ProductionReadinessGateSchema>;

/** Aggregate counts at the top of the readiness payload. */
export const ProductionReadinessSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type ProductionReadinessSummary = z.infer<
  typeof ProductionReadinessSummarySchema
>;

/** The readiness object as the server returns it.
 *  - `asOf` is a strict YYYY-MM-DD; the server validates the query
 *    param via `isExactIsoDate` (server/app.js), so anything else
 *    on the wire is a bug, not a real value.
 *  - `generatedAt` is an ISO datetime; we just require non-empty
 *    since the exact format isn't load-bearing for the UI.
 *  - `blockers` is a server-side filter (`!pass`) so it always
 *    equals `gates.filter(g => !g.pass)`. We still validate the
 *    shape — defensive against server regressions. */
export const ProductionReadinessReadinessSchema = z.object({
  status: ProductionReadinessStatusSchema,
  reviewRequired: z.boolean(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  generatedAt: z.string().min(1),
  summary: ProductionReadinessSummarySchema,
  gates: z.array(ProductionReadinessGateSchema),
  blockers: z.array(ProductionReadinessGateSchema),
});
export type ProductionReadinessReadiness = z.infer<
  typeof ProductionReadinessReadinessSchema
>;

/** Response body for
 *  `GET /api/compliance/production-readiness?asOf=YYYY-MM-DD`. */
export const ProductionReadinessResponseSchema = z.object({
  readiness: ProductionReadinessReadinessSchema,
});
export type ProductionReadinessResponse = z.infer<
  typeof ProductionReadinessResponseSchema
>;
