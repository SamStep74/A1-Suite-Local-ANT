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
