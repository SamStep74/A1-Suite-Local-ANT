/**
 * Schemas test — verify the Zod schemas accept the real /api/service/console
 * response shape and reject malformed payloads. This is the contract
 * between the new app and the Fastify backend; if a schema drifts from
 * the wire shape, the new app will see a schema_mismatch ApiError
 * instead of silently rendering garbage.
 */
import { describe, expect, it } from "vitest";
import {
  CreateServiceCaseInputSchema,
  ServiceCaseSchema,
  ServiceConsoleSchema,
  ServiceCaseStatus,
  ServiceCasePriority,
  SlaStatus,
  WorkflowApprovalSchema,
  WorkflowRunSchema,
  WorkflowRunStatus,
  WorkflowRuleSchema,
  CrmQuoteSchema,
  CrmQuotesResponseSchema,
  CrmActivitySchema,
  CrmActivitiesResponseSchema,
  CrmLeadSchema,
  CreateCrmLeadInputSchema,
  CrmForecastSchema,
  CatalogItemSchema,
  CatalogItemsResponseSchema,
  CatalogCategorySchema,
  MarginRuleSchema,
  PriceListSchema,
  PosPricePreviewSchema,
  StockBalanceSchema,
  StockLocationSchema,
  StockResponseSchema,
  StockMoveSchema,
  StockMovesResponseSchema,
  CreateStockMoveInputSchema,
  ProjectTaskSchema,
  ProjectDetailResponseSchema,
} from "./schemas";

const VALID_CASE = {
  id: "case-1",
  customerId: "cust-1",
  customerName: "Ani Beauty",
  taxId: null,
  ticketId: null,
  caseNumber: "AO-CASE-1001",
  subject: "VAT wording",
  status: "open" as const,
  priority: "medium" as const,
  channel: "Manual",
  ownerName: null,
  slaDueAt: null,
  slaStatus: null,
  aiSuggestion: null,
  knowledgeArticle: null,
  messageCount: 0,
  updatedAt: "2026-06-09T00:00:00.000Z",
  createdAt: "2026-06-09T00:00:00.000Z",
};

describe("ServiceCaseSchema", () => {
  it("accepts a full case record", () => {
    const r = ServiceCaseSchema.safeParse(VALID_CASE);
    expect(r.success).toBe(true);
  });

  it("rejects an unknown status", () => {
    const r = ServiceCaseSchema.safeParse({ ...VALID_CASE, status: "unknown" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown priority", () => {
    const r = ServiceCaseSchema.safeParse({ ...VALID_CASE, priority: "critical" });
    expect(r.success).toBe(false);
  });

  it("accepts all six ServiceCaseStatus values", () => {
    for (const s of ServiceCaseStatus.options) {
      const r = ServiceCaseSchema.safeParse({ ...VALID_CASE, status: s });
      expect(r.success, `status ${s}`).toBe(true);
    }
  });

  it("accepts all three ServiceCasePriority values", () => {
    for (const p of ServiceCasePriority.options) {
      const r = ServiceCaseSchema.safeParse({ ...VALID_CASE, priority: p });
      expect(r.success, `priority ${p}`).toBe(true);
    }
  });

  it("accepts all three SlaStatus values", () => {
    for (const s of SlaStatus.options) {
      const r = ServiceCaseSchema.safeParse({ ...VALID_CASE, slaStatus: s });
      expect(r.success, `sla ${s}`).toBe(true);
    }
  });
});

describe("ServiceConsoleSchema", () => {
  it("accepts the real console envelope (cases + approvals + runs + rules)", () => {
    const envelope = {
      cases: [VALID_CASE],
      queue: [],
      escalations: [],
      resolutions: [],
      approvals: [
        {
          id: "approval-1",
          ruleId: "rule-1",
          status: "pending",
          title: "Create draft invoice",
          actionKey: "finance.invoice.propose",
        },
      ],
      runs: [
        {
          id: "run-1",
          ruleId: "rule-1",
          customerId: "cust-1",
          customerName: "Ani Beauty",
          actionKey: "finance.invoice.propose",
          status: "completed" as const,
          startedAt: "2026-06-09T00:00:00.000Z",
          completedAt: "2026-06-09T00:00:01.000Z",
        },
      ],
      rules: [
        {
          id: "rule-1",
          name: "Deal won → invoice",
          trigger: "deal.stage_changed:won",
          action: "finance.invoice.propose",
          enabled: true,
        },
      ],
      dryRuns: [],
      testEvents: [],
      customers: [{ id: "cust-1", name: "Ani Beauty" }],
      agents: [{ id: "user-1", name: "Samvel", role: "Owner" }],
    };
    const r = ServiceConsoleSchema.safeParse(envelope);
    expect(r.success).toBe(true);
  });

  it("rejects when cases is missing", () => {
    const r = ServiceConsoleSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("CreateServiceCaseInputSchema", () => {
  it("accepts a minimal valid create", () => {
    const r = CreateServiceCaseInputSchema.safeParse({
      customerId: "cust-1",
      subject: "VAT wording check",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when subject is too short", () => {
    const r = CreateServiceCaseInputSchema.safeParse({
      customerId: "cust-1",
      subject: "ab",
    });
    expect(r.success).toBe(false);
  });

  it("rejects when customerId is empty", () => {
    const r = CreateServiceCaseInputSchema.safeParse({
      customerId: "",
      subject: "VAT wording check",
    });
    expect(r.success).toBe(false);
  });

  it("defaults priority to medium when omitted", () => {
    const r = CreateServiceCaseInputSchema.parse({
      customerId: "cust-1",
      subject: "VAT wording check",
    });
    expect(r.priority).toBe("medium");
  });

  it("defaults channel to Manual when omitted", () => {
    const r = CreateServiceCaseInputSchema.parse({
      customerId: "cust-1",
      subject: "VAT wording check",
    });
    expect(r.channel).toBe("Manual");
  });
});

describe("WorkflowApprovalSchema / WorkflowRunSchema / WorkflowRuleSchema", () => {
  it("approves a minimal approval", () => {
    const r = WorkflowApprovalSchema.safeParse({ id: "a-1", status: "pending" });
    expect(r.success).toBe(true);
  });

  it("approves a run with all five statuses", () => {
    for (const status of WorkflowRunStatus.options) {
      const r = WorkflowRunSchema.safeParse({ id: "r-1", actionKey: "x", status });
      expect(r.success, `status ${status}`).toBe(true);
    }
  });

  it("approves a rule with extra passthrough fields", () => {
    const r = WorkflowRuleSchema.safeParse({
      id: "rule-1",
      name: "Test",
      trigger: "x",
      action: "y",
      enabled: true,
      someExtra: "ignored-but-kept",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as { someExtra?: string }).someExtra).toBe("ignored-but-kept");
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * Phase 2 — CRM + Catalog + Inventory schemas
 *
 * Each pair: one "accepts the real wire shape" + one "rejects a known-bad
 * mutation". Wire shapes come from the live Fastify routes
 * (server/app.js#/api/crm/*, /api/catalog/*, /api/inventory/*); they are
 * permissive because of passthrough() but the enums and required fields
 * are strict. These tests pin the contract so a server-side drift shows
 * up as a CI failure, not a runtime blank screen.
 * ──────────────────────────────────────────────────────────────────── */

const VALID_QUOTE = {
  id: "quote-1",
  customerId: "cust-1",
  customerName: "Ani Beauty",
  taxId: null,
  dealId: "deal-1",
  dealTitle: "Q3 expansion",
  dealStage: "Proposal",
  number: "Q-2026-0042",
  title: "Equipment for new clinic",
  status: "draft" as const,
  subtotal: 1000000,
  vat: 200000,
  total: 1200000,
  currency: "AMD",
  validUntil: "2026-07-10",
  publicToken: null,
  acceptanceUrl: null,
  sentAt: null,
  acceptedAt: null,
  createdByName: "Owner",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-05T00:00:00.000Z",
  lines: [
    {
      id: "ql-1",
      catalogItemId: "ci-1",
      catalogItemVariantId: null,
      catalogPriceListId: "pl-1",
      catalogPriceListCode: "STANDARD",
      pricingSource: "list",
      pricingCustomerSegment: "retail",
      discountAmount: 0,
      marginStatus: "ok",
      marginRuleCode: "STD-20",
      marginRuleMinimumPercent: 20,
      marginRuleTargetPercent: 25,
      catalogSku: "EQ-CHAIR",
      catalogName: "Treatment chair",
      variantSku: null,
      variantName: null,
      description: "Hydraulic treatment chair",
      quantity: 2,
      unitPrice: 500000,
      total: 1000000,
      vatMode: "inclusive",
      fiscalReceiptRequired: false,
      position: 1,
    },
  ],
};

const VALID_LEAD = {
  id: "lead-1",
  companyName: "New Clinic LLC",
  contactName: "Anna Petrosyan",
  email: "anna@newclinic.am",
  phone: "+37499123456",
  taxId: null,
  segment: "retail",
  source: "Website",
  channel: "Organic",
  interest: "Aesthetic laser",
  estimatedValue: 5000000,
  currency: "AMD",
  consentStatus: "granted",
  score: 75,
  rating: "warm",
  status: "qualifying" as const,
  routedToUserId: null,
  routedToName: null,
  nextAction: "Call back",
  convertedCustomerId: null,
  convertedCustomerName: null,
  convertedDealId: null,
  convertedDealTitle: null,
  createdByName: "Web form",
  convertedAt: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const VALID_FORECAST = {
  categories: [
    { forecastCategory: "Commit", count: 2, value: 3000000, weightedValue: 3000000 },
    { forecastCategory: "Best Case", count: 3, value: 8000000, weightedValue: 4000000 },
  ],
  deals: [
    {
      id: "deal-1",
      customerId: "cust-1",
      customerName: "Ani Beauty",
      title: "Q3 expansion",
      stage: "Proposal",
      value: 2000000,
      currency: "AMD",
      probability: 60,
      nextStep: "Send proposal",
      forecastId: null,
      forecastCategory: "Best Case",
      closeDate: "2026-08-15",
      weightedValue: 1200000,
      healthScore: 72,
      healthStatus: "on-track",
      healthReasons: ["Active contact in last 7 days"],
      managerNote: null,
      forecastUpdatedAt: "2026-06-09T00:00:00.000Z",
    },
  ],
  dealRiskBriefs: [],
  totals: {
    value: 11000000,
    weightedValue: 7000000,
    atRisk: 1,
    unreviewed: 0,
  },
};

const VALID_CATALOG_ITEM = {
  id: "ci-1",
  categoryId: "cat-1",
  categoryName: "Equipment",
  sku: "EQ-CHAIR",
  name: "Treatment chair",
  description: "Hydraulic treatment chair",
  itemType: "stockable" as const,
  status: "active" as const,
  unitOfMeasure: "pc",
  listPrice: 600000,
  standardCost: 400000,
  marginAmount: 200000,
  marginPercent: 33.3,
  currency: "AMD",
  vatMode: "inclusive",
  trackStock: true,
  trackLots: false,
  fiscalReceiptRequired: false,
  variants: [],
  variantCount: 0,
};

const VALID_STOCK_BALANCE = {
  id: "sb-1",
  catalogItemId: "ci-1",
  catalogSku: "EQ-CHAIR",
  catalogName: "Treatment chair",
  locationId: "loc-1",
  locationCode: "WH/STOCK",
  locationName: "Main Warehouse",
  locationType: "internal",
  quantity: 8,
  reservedQuantity: 0,
  availableQuantity: 8,
  averageCost: 400000,
  updatedAt: "2026-06-09T00:00:00.000Z",
};

const VALID_STOCK_MOVE = {
  id: "sm-1",
  catalogItemId: "ci-1",
  catalogSku: "EQ-CHAIR",
  catalogName: "Treatment chair",
  sourceLocationId: null,
  sourceLocationCode: null,
  sourceLocationName: null,
  sourceLocationType: null,
  destinationLocationId: "loc-1",
  destinationLocationCode: "WH/STOCK",
  destinationLocationName: "Main Warehouse",
  destinationLocationType: "internal",
  moveType: "receipt" as const,
  quantity: 5,
  unitCost: 400000,
  totalCost: 2000000,
  status: "completed",
  reason: "Vendor delivery",
  reference: "PO-2026-007",
  createdByName: "Owner",
  createdAt: "2026-06-09T00:00:00.000Z",
};

describe("CrmQuoteSchema", () => {
  it("accepts a real /api/crm/quotes payload with lines", () => {
    const r = CrmQuoteSchema.safeParse(VALID_QUOTE);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lines).toHaveLength(1);
      expect(r.data.lines![0]!.marginStatus).toBe("ok");
    }
  });

  it("rejects a missing total (required field)", () => {
    const { total: _total, ...rest } = VALID_QUOTE;
    void _total;
    const r = CrmQuoteSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("wraps in a /quotes response envelope", () => {
    const r = CrmQuotesResponseSchema.safeParse({ quotes: [VALID_QUOTE] });
    expect(r.success).toBe(true);
  });
});

describe("CrmActivitySchema", () => {
  it("accepts a real /api/crm/activities row", () => {
    const r = CrmActivitySchema.safeParse({
      id: "a-1",
      customerId: "cust-1",
      customerName: "Ani Beauty",
      dealId: "deal-1",
      dealTitle: "Q3 expansion",
      kind: "quote_sent",
      title: "Sent quote Q-2026-0042",
      body: null,
      actorName: "Owner",
      occurredAt: "2026-06-09T00:00:00.000Z",
      createdAt: "2026-06-09T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown kind and still accepts any string fallback", () => {
    // Server may emit new kinds we haven't enumerated yet — the
    // `.or(z.string())` fallback should accept it.
    const r = CrmActivitySchema.safeParse({
      id: "a-2",
      kind: "future_kind_we_dont_know_yet",
      title: "x",
    });
    expect(r.success).toBe(true);
  });

  it("wraps in /activities response envelope", () => {
    const r = CrmActivitiesResponseSchema.safeParse({ activities: [] });
    expect(r.success).toBe(true);
  });
});

describe("CrmLeadSchema", () => {
  it("accepts a real /api/crm/leads payload", () => {
    const r = CrmLeadSchema.safeParse(VALID_LEAD);
    expect(r.success).toBe(true);
  });

  it("rejects a missing required companyName", () => {
    const { companyName: _companyName, ...rest } = VALID_LEAD;
    void _companyName;
    const r = CrmLeadSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});

describe("CreateCrmLeadInputSchema", () => {
  it("accepts a minimal lead capture form", () => {
    const r = CreateCrmLeadInputSchema.safeParse({
      companyName: "Acme LLC",
      contactName: "John Doe",
      email: "john@acme.am",
      phone: "+37499000000",
      interest: "Need 5 treatment chairs",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.currency).toBe("AMD"); // default
    }
  });

  it("rejects an invalid email", () => {
    const r = CreateCrmLeadInputSchema.safeParse({
      companyName: "Acme LLC",
      contactName: "John Doe",
      email: "not-an-email",
      phone: "+37499000000",
      interest: "Need 5 treatment chairs",
    });
    expect(r.success).toBe(false);
  });
});

describe("CrmForecastSchema", () => {
  it("accepts a /api/crm/forecast payload with weighted pipeline", () => {
    const r = CrmForecastSchema.safeParse(VALID_FORECAST);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.deals).toHaveLength(1);
      expect(r.data.totals.weightedValue).toBe(7000000);
    }
  });

  it("rejects a missing totals object", () => {
    const r = CrmForecastSchema.safeParse({
      categories: [],
      deals: [],
      dealRiskBriefs: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("CatalogItemSchema", () => {
  it("accepts a real /api/catalog/items row", () => {
    const r = CatalogItemSchema.safeParse(VALID_CATALOG_ITEM);
    expect(r.success).toBe(true);
  });

  it("rejects a missing required sku", () => {
    const { sku: _sku, ...rest } = VALID_CATALOG_ITEM;
    void _sku;
    const r = CatalogItemSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("wraps in /items response envelope with categories + priceLists", () => {
    const r = CatalogItemsResponseSchema.safeParse({
      items: [VALID_CATALOG_ITEM],
      categories: [CatalogCategorySchema.parse({ id: "cat-1", name: "Equipment" })],
      unitsOfMeasure: [],
      marginRules: [
        MarginRuleSchema.parse({
          id: "mr-1",
          code: "STD-20",
          name: "Standard 20% minimum",
          scopeType: "category",
          minimumMarginPercent: 20,
          targetMarginPercent: 25,
        }),
      ],
      priceLists: [
        PriceListSchema.parse({
          id: "pl-1",
          code: "STANDARD",
          name: "Standard Price List",
          items: [],
        }),
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("PosPricePreviewSchema", () => {
  it("accepts /api/pos/workspace price previews with no variant selected", () => {
    const r = PosPricePreviewSchema.safeParse({
      catalogItemId: "catitem-pos-scanner",
      catalogItemVariantId: null,
      requestedCustomerSegment: "standard",
      quantity: 1,
      priceListId: "pl-standard",
      priceListCode: "STANDARD-SALES",
      priceListName: "Standard Sales",
      customerSegment: "standard",
      variantFallback: false,
      itemType: "stockable",
      catalogSku: "POS-SCANNER",
      catalogName: "POS barcode scanner",
      variantSku: null,
      variantName: null,
      minQuantity: 1,
      listPrice: 25000,
      discountPercent: 0,
      discountAmount: 0,
      netPrice: 25000,
      standardCost: 16000,
      marginAmount: 9000,
      marginPercent: 36,
      marginRuleCode: "HARDWARE-MIN-25",
      minimumMarginPercent: 25,
      targetMarginPercent: 35,
      marginStatus: "ok",
      currency: "AMD",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.catalogItemVariantId).toBeNull();
    }
  });

  it("rejects price previews without a catalog item id", () => {
    const r = PosPricePreviewSchema.safeParse({
      catalogItemVariantId: null,
      netPrice: 25000,
    });
    expect(r.success).toBe(false);
  });
});

describe("Inventory schemas", () => {
  it("StockBalanceSchema accepts a /api/inventory/stock row", () => {
    const r = StockBalanceSchema.safeParse(VALID_STOCK_BALANCE);
    expect(r.success).toBe(true);
  });

  it("StockLocationSchema accepts a /api/inventory/locations row", () => {
    const r = StockLocationSchema.safeParse({
      id: "loc-1",
      code: "WH/STOCK",
      name: "Main Warehouse",
      locationType: "internal",
      status: "active",
    });
    expect(r.success).toBe(true);
  });

  it("StockResponseSchema accepts the full stock envelope", () => {
    const r = StockResponseSchema.safeParse({
      stock: [VALID_STOCK_BALANCE],
      locations: [
        { id: "loc-1", code: "WH/STOCK", name: "Main Warehouse", locationType: "internal" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("StockMoveSchema accepts a /api/inventory/moves row", () => {
    const r = StockMoveSchema.safeParse(VALID_STOCK_MOVE);
    expect(r.success).toBe(true);
  });

  it("StockMovesResponseSchema accepts the moves envelope", () => {
    const r = StockMovesResponseSchema.safeParse({ moves: [VALID_STOCK_MOVE] });
    expect(r.success).toBe(true);
  });

  it("CreateStockMoveInputSchema requires catalogItemId and moveType", () => {
    const r = CreateStockMoveInputSchema.safeParse({
      catalogItemId: "ci-1",
      moveType: "receipt",
      quantity: 5,
    });
    expect(r.success).toBe(true);
  });

  it("CreateStockMoveInputSchema rejects a missing moveType", () => {
    const r = CreateStockMoveInputSchema.safeParse({
      catalogItemId: "ci-1",
      quantity: 5,
    });
    expect(r.success).toBe(false);
  });
});

describe("Project task dependency schemas", () => {
  it("accepts blockedBy and blocking task refs on project tasks", () => {
    const r = ProjectTaskSchema.safeParse({
      id: "t-2",
      title: "Finalize implementation",
      status: "in-progress",
      assigneeEmployeeId: null,
      dueDate: "2026-06-30",
      updatedAt: "2026-06-20T10:00:00.000Z",
      parentTaskId: "t-1",
      parentTask: { id: "t-1", title: "Approve scope", status: "done" },
      subtasks: [{ id: "t-4", title: "QA checklist", status: "todo" }],
      blockedBy: [{ id: "t-1", title: "Approve scope", status: "done" }],
      blocking: [{ id: "t-3", title: "Deploy handoff", status: "todo" }],
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.parentTask?.title).toBe("Approve scope");
      expect(r.data.parentTaskId).toBe("t-1");
      expect(r.data.subtasks?.[0]?.title).toBe("QA checklist");
      expect(r.data.blockedBy?.[0]?.title).toBe("Approve scope");
      expect(r.data.blocking?.[0]?.status).toBe("todo");
    }
  });

  it("parses project detail task dependency data", () => {
    const r = ProjectDetailResponseSchema.safeParse({
      project: {
        id: "p-1",
        name: "Alpha",
        status: "active",
        customerId: "c-1",
        dealId: null,
        startDate: "2026-01-01",
        dueDate: "2026-06-30",
        updatedAt: "2026-06-09T10:00:00Z",
        taskTotal: 1,
        taskDone: 0,
        milestoneTotal: 0,
        milestoneReached: 0,
        totalMinutes: 0,
        tasks: [
          {
            id: "t-2",
            title: "Finalize implementation",
            status: "in-progress",
            parentTaskId: "t-1",
            parentTask: { id: "t-1", title: "Approve scope", status: "done" },
            subtasks: [{ id: "t-3", title: "Deploy handoff", status: "todo" }],
            blockedBy: [{ id: "t-1", title: "Approve scope", status: "done" }],
            blocking: [],
          },
        ],
        milestones: [],
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.project.tasks?.[0]?.parentTask?.id).toBe("t-1");
      expect(r.data.project.tasks?.[0]?.subtasks?.[0]?.status).toBe("todo");
      expect(r.data.project.tasks?.[0]?.blockedBy?.[0]?.id).toBe("t-1");
    }
  });
});
