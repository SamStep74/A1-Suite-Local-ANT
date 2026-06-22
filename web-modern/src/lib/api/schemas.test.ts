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
  ServiceFieldVisitSchema,
  ServiceFieldVisitTechnicianStatus,
  ServiceFieldVisitsResponseSchema,
  ServiceSlaPoliciesResponseSchema,
  ServiceSlaPolicySchema,
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
  PosCashSessionSchema,
  PosWorkspaceResponseSchema,
  PosOpenCashSessionRequestSchema,
  PosCloseCashSessionRequestSchema,
  PosOpenCashSessionResponseSchema,
  PosCloseCashSessionResponseSchema,
  PosCreateSaleRequestSchema,
  PosCreateSaleResponseSchema,
  PosReceiptPacketRequestSchema,
  PosReceiptPacketResponseSchema,
  PosRefundRequestSchema,
  PosRefundResponseSchema,
  PosPricePreviewSchema,
  StockBalanceSchema,
  StockLocationSchema,
  StockResponseSchema,
  StockMoveSchema,
  StockMovesResponseSchema,
  CreateStockMoveInputSchema,
  ProjectTaskSchema,
  ProjectDetailResponseSchema,
  ProjectProfitabilityResponseSchema,
  ProjectRecurringTaskSchema,
  ProjectRecurringTasksResponseSchema,
  ProjectTemplateResponseSchema,
  ProjectTemplatesResponseSchema,
  ProcurementBlanketOrderCreateResponseSchema,
  ProcurementCoverageResponseSchema,
  ProcurementRequisitionCreateRequestSchema,
  ProcurementRequisitionCreateResponseSchema,
  ProcurementRfqAwardRequestSchema,
  ProcurementRfqAwardResponseSchema,
  ProcurementRfqConvertRequestSchema,
  ProcurementRfqConvertResponseSchema,
  ProcurementRfqQuoteCreateRequestSchema,
  ProcurementRfqQuoteCreateResponseSchema,
  ProcurementReplenishmentResponseSchema,
  PurchaseAnalyticsResponseSchema,
  PurchaseAnalyticsSummarySchema,
  PurchaseCreditNoteSchema,
  PurchaseLandedCostSchema,
  PurchaseOrderSchema,
  PurchaseVendorSchema,
  ServiceDispatchAlertAckResponseSchema,
  ServiceDispatchAlertsResponseSchema,
  ServiceDispatchAlertSchema,
  UpdateServiceFieldVisitTechnicianLocationInputSchema,
  UpdateServiceFieldVisitTechnicianLocationResponseSchema,
  UpdateServiceFieldVisitTechnicianStatusInputSchema,
  UpdateServiceFieldVisitTechnicianStatusResponseSchema,
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

const VALID_SLA_POLICY = {
  id: "sla-1",
  name: "High priority email",
  priority: "high",
  channel: "Email",
  responseMinutes: 15,
  resolutionMinutes: 240,
  active: true,
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-11T00:00:00.000Z",
};

const VALID_FIELD_VISIT = {
  id: "visit-1",
  caseId: "case-1",
  customerId: "cust-1",
  projectId: "p-1",
  assignedUserId: "user-1",
  scheduledStartAt: "2026-06-22T09:00:00.000Z",
  scheduledEndAt: "2026-06-22T10:00:00.000Z",
  status: "scheduled",
  location: "Yerevan service desk",
  worksheetSummary: "Inspect fiscal printer and attach signed checklist.",
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-21T00:00:00.000Z",
  caseNumber: "AO-CASE-1001",
  subject: "Fiscal printer field check",
  customerName: "Ani Beauty",
  assignedUserName: "Samvel",
};

const VALID_DISPATCH_ALERT = {
  id: "svc-dispatch-alert-due-soon-v99a0d78feb35-visit-1",
  dedupeKey: "service-field-visit:visit-1:due-soon:2026-06-22T08:05:00.000Z",
  kind: "due-soon",
  severity: "high",
  visitId: "visit-1",
  caseNumber: "AO-CASE-1001",
  customerName: "Ani Beauty",
  location: "Ani Beauty, Yerevan",
  status: "scheduled",
  scheduledStartAt: "2026-06-22T10:00:00.000Z",
  scheduledEndAt: "2026-06-22T11:00:00.000Z",
  title: "Visit moved",
  body: "Customer requested a later arrival window.",
  notify: true,
  createdAt: "2026-06-22T08:00:00.000Z",
  referenceAt: "2026-06-22T08:05:00.000Z",
  acknowledgedAt: null,
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

describe("Purchase credit-note schemas", () => {
  const creditNote = {
    id: "cn-1",
    poId: "ord-1",
    billId: "bill-1",
    returnId: "ret-1",
    amount: 15_000,
    currency: "AMD",
    status: "posted",
    postedAt: "2026-06-22T09:30:00.000Z",
    note: "Returned damaged billed goods.",
    ledgerPostingIds: ["le-1", "le-2"],
    createdByName: "Anna Hovhannisyan",
    createdAt: "2026-06-22T09:29:00.000Z",
  };
  const landedCost = {
    id: "lca-1",
    poId: "ord-1",
    kind: "freight",
    amount: 50_000,
    currency: "AMD",
    fxRate: 1,
    allocationMethod: "value",
    baseTotal: 1_000_000,
    totalAllocated: 50_000,
    allocated: [
      {
        id: "lcl-1",
        landedCostId: "lca-1",
        purchaseOrderLineId: "line-1",
        lineId: "line-1",
        amount: 50_000,
        allocated: 50_000,
        basis: 1_000_000,
        quantity: 10,
        subtotal: 1_000_000,
        unitCostDelta: 5_000,
        unitCostAdjustment: 5_000,
      },
    ],
    createdByName: "Anna Hovhannisyan",
    createdAt: "2026-06-22T09:40:00.000Z",
  };

  it("accepts billed-return credit-note evidence", () => {
    const r = PurchaseCreditNoteSchema.safeParse(creditNote);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.billId).toBe("bill-1");
      expect(r.data.returnId).toBe("ret-1");
      expect(r.data.ledgerPostingIds).toEqual(["le-1", "le-2"]);
    }
  });

  it("accepts purchase orders with return credit notes", () => {
    const r = PurchaseOrderSchema.safeParse({
      id: "ord-1",
      vendorId: "ven-1",
      vendorName: "Alpha Wholesale",
      orderNumber: "PO-0001",
      supplier: "Alpha Wholesale",
      status: "billed",
      subtotal: 100_000,
      vat: 20_000,
      total: 120_000,
      currency: "AMD",
      orderDate: "2026-06-01",
      billId: "bill-1",
      lines: [],
      creditNotes: [creditNote],
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.creditNotes?.[0]?.amount).toBe(15_000);
    }
  });

  it("accepts purchase landed-cost evidence", () => {
    const r = PurchaseLandedCostSchema.safeParse(landedCost);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.allocated?.[0]?.landedCostId).toBe("lca-1");
      expect(r.data.allocated?.[0]?.unitCostDelta).toBe(5_000);
    }
  });

  it("accepts purchase orders with landed costs on order and line payloads", () => {
    const r = PurchaseOrderSchema.safeParse({
      id: "ord-1",
      vendorId: "ven-1",
      vendorName: "Alpha Wholesale",
      orderNumber: "PO-0001",
      supplier: "Alpha Wholesale",
      status: "confirmed",
      subtotal: 1_000_000,
      vat: 200_000,
      total: 1_200_000,
      currency: "AMD",
      orderDate: "2026-06-01",
      lines: [
        {
          id: "line-1",
          purchaseOrderId: "ord-1",
          catalogItemId: "ci-1",
          quantity: 10,
          receivedQuantity: 0,
          returnedQuantity: 0,
          remainingQuantity: 10,
          unitCost: 100_000,
          landedCostAmount: 50_000,
          landedUnitCostDelta: 5_000,
          effectiveUnitCost: 105_000,
          subtotal: 1_000_000,
          vat: 200_000,
          total: 1_200_000,
          landedCosts: landedCost.allocated,
        },
      ],
      landedCostCount: 1,
      landedCostAmount: 50_000,
      landedCosts: [landedCost],
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.lines?.[0]?.effectiveUnitCost).toBe(105_000);
      expect(r.data.landedCosts?.[0]?.totalAllocated).toBe(50_000);
    }
  });

  it("accepts analytics summary return-credit totals", () => {
    const r = PurchaseAnalyticsSummarySchema.safeParse({
      orderCount: 3,
      vendorCount: 2,
      activeVendorCount: 2,
      openValue: 120_000,
      billedValue: 36_000,
      returnCreditNoteCount: 2,
      returnCreditNoteAmount: 18_500,
      landedCostCount: 1,
      landedCostAmount: 50_000,
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.returnCreditNoteCount).toBe(2);
      expect(r.data.returnCreditNoteAmount).toBe(18_500);
      expect(r.data.landedCostCount).toBe(1);
      expect(r.data.landedCostAmount).toBe(50_000);
    }
  });
});

describe("Purchase vendor lifecycle schemas", () => {
  it("accepts vendor price lifecycle risk details", () => {
    const r = PurchaseVendorSchema.safeParse({
      id: "ven-1",
      name: "Alpha Wholesale",
      status: "active",
      priceLifecycle: {
        totalPrices: 6,
        usablePriceCount: 3,
        expiredPriceCount: 1,
        futurePriceCount: 1,
        archivedPriceCount: 1,
        expiringSoonCount: 2,
        nextExpiryDate: "2026-06-30",
        daysToNextExpiry: 8,
        riskLevel: "watch",
        riskReasons: ["2 prices expire soon", "1 expired price"],
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.priceLifecycle?.riskLevel).toBe("watch");
      expect(r.data.priceLifecycle?.expiringSoonCount).toBe(2);
    }
  });

  it("accepts purchase analytics vendor lifecycle summary", () => {
    const r = PurchaseAnalyticsResponseSchema.safeParse({
      summary: {
        orderCount: 3,
        vendorCount: 2,
        activeVendorCount: 1,
        openValue: 120_000,
        billedValue: 36_000,
      },
      receiptBacklog: [],
      vendorPerformance: [],
      priceCoverage: null,
      vendorLifecycle: {
        activeVendorCount: 1,
        blockedVendorCount: 1,
        inactiveVendorCount: 0,
        vendorRiskCount: 1,
        expiringSoonPriceCount: 2,
        expiredPriceCount: 1,
        futurePriceCount: 1,
        archivedPriceCount: 0,
        atRiskVendors: [
          {
            vendorId: "ven-1",
            vendorName: "Alpha Wholesale",
            riskLevel: "blocked",
            riskReasons: ["No usable prices"],
            expiredPriceCount: 3,
            expiringSoonCount: 0,
          },
        ],
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.vendorLifecycle?.vendorRiskCount).toBe(1);
      expect(r.data.vendorLifecycle?.atRiskVendors[0]?.vendorName).toBe(
        "Alpha Wholesale",
      );
    }
  });
});

describe("Purchase replenishment schemas", () => {
  const suggestion = {
    catalogItemId: "catitem-pos-barcode-scanner",
    sku: "POS-SCAN-001",
    name: "POS barcode scanner",
    unitOfMeasure: "հատ",
    onHand: 0,
    onHandGross: 0,
    reservedQuantity: 0,
    availableStock: 0,
    openDemand: 10,
    openPoQty: 10,
    openPurchaseQty: 10,
    salesQuoteDemand: 40,
    salesDemandQty: 40,
    quoteCount: 1,
    recentCustomerIssueQty: 0,
    leadTimeDemandQty: 0,
    netAvailableQty: -30,
    safetyStockQty: 10,
    suggestedQty: 40,
    recommendedVendorId: "vendor-yerevan-hardware-supply",
    recommendedVendorName: "Yerevan Hardware Supply",
    recommendedUnitCost: 60_000,
    recommendedCurrency: "AMD",
    leadTimeDays: 2,
    source: "sales-quotes",
    recommendedAction: "create-purchase-order",
    demandSources: {
      stockMoves: 0,
      salesQuotes: 40,
      openPurchaseOrders: 10,
    },
    recommendedVendor: {
      vendorId: "vendor-yerevan-hardware-supply",
      vendorName: "Yerevan Hardware Supply",
      unitCost: 60_000,
      currency: "AMD",
      leadTimeDays: 2,
    },
    reasoning: ["available 0", "open PO 10", "sales demand 40", "target 50"],
    drivers: ["stockout", "sales-demand", "open-purchase-gap"],
  };

  it("accepts procurement replenishment response rows with sales-demand evidence", () => {
    const r = ProcurementReplenishmentResponseSchema.safeParse({
      ok: true,
      summary: {
        suggestionCount: 1,
        suggestedQty: 40,
        salesDemandQty: 40,
        openPurchaseQty: 10,
        stockoutCount: 1,
      },
      suggestions: [suggestion],
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.suggestions[0]?.salesQuoteDemand).toBe(40);
      expect(r.data.suggestions[0]?.recommendedVendor?.vendorName).toBe(
        "Yerevan Hardware Supply",
      );
    }
  });

  it("accepts purchase analytics with replenishment summary and queue", () => {
    const r = PurchaseAnalyticsResponseSchema.safeParse({
      summary: {
        orderCount: 3,
        vendorCount: 2,
        activeVendorCount: 2,
        openValue: 120_000,
        billedValue: 36_000,
        replenishmentSuggestionCount: 1,
        replenishmentSuggestedQty: 40,
        replenishmentSalesDemandQty: 40,
      },
      receiptBacklog: [],
      vendorPerformance: [],
      priceCoverage: null,
      replenishment: {
        summary: {
          suggestionCount: 1,
          suggestedQty: 40,
          salesDemandQty: 40,
          openPurchaseQty: 10,
          stockoutCount: 1,
        },
        suggestions: [suggestion],
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.replenishment?.summary.suggestedQty).toBe(40);
      expect(r.data.summary.replenishmentSuggestionCount).toBe(1);
    }
  });
});

describe("Procurement blanket-order schemas", () => {
  const blanket = {
    id: "bo-yerevan-scanners",
    status: "open",
    vendorId: "vendor-yerevan-hardware-supply",
    vendorName: "Yerevan Hardware Supply",
    catalogItemId: "catitem-pos-barcode-scanner",
    sku: "POS-SCAN-001",
    name: "POS barcode scanner",
    startDate: "2026-06-01",
    endDate: "2026-12-31",
    committedQty: 100,
    consumedQty: 10,
    remainingQty: 90,
    unitPrice: 80_000,
    currency: "AMD",
    uom: "հատ",
    note: "Scanner annual agreement",
    createdAt: "2026-06-22T08:00:00.000Z",
  };

  it("accepts blanket create responses with legacy and canonical aliases", () => {
    const r = ProcurementBlanketOrderCreateResponseSchema.safeParse({
      ok: true,
      blanket,
      blanketOrder: blanket,
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.blanket.remainingQty).toBe(90);
      expect(r.data.blanketOrder?.vendorName).toBe("Yerevan Hardware Supply");
    }
  });

  it("accepts blanket coverage rows with consumed and remaining evidence", () => {
    const r = ProcurementCoverageResponseSchema.safeParse({
      ok: true,
      coverage: {
        committedQty: 100,
        openPoQty: 10,
        remainingQty: 90,
        uncoveredOpenPoQty: 0,
        blanketOrderCount: 1,
        blanketOrders: [blanket],
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.coverage.blanketOrders[0]?.consumedQty).toBe(10);
      expect(r.data.coverage.remainingQty).toBe(90);
    }
  });
});

describe("Procurement RFQ tender schemas", () => {
  const requisitionLine = {
    id: "prl-scanner-001",
    catalogItemId: "catitem-pos-barcode-scanner",
    quantity: 5,
    uom: "հատ",
    estUnitPrice: 95_000,
    suggestedVendorId: "vendor-yerevan-hardware-supply",
  };

  it("requires non-empty requisition create lines with estimated pricing", () => {
    const valid = ProcurementRequisitionCreateRequestSchema.safeParse({
      neededBy: "2026-07-01",
      justification: "Restock warehouse",
      lines: [
        {
          catalogItemId: "catitem-pos-barcode-scanner",
          quantity: 5,
          uom: "հատ",
          estUnitPrice: 95_000,
          suggestedVendorId: "vendor-yerevan-hardware-supply",
        },
      ],
      idempotencyKey: "requisition-ui-test",
    });
    const empty = ProcurementRequisitionCreateRequestSchema.safeParse({
      neededBy: "2026-07-01",
      lines: [],
      idempotencyKey: "requisition-ui-test-empty",
    });

    expect(valid.success).toBe(true);
    expect(empty.success).toBe(false);
  });

  it("accepts backend requisition responses with line ids and optional uom", () => {
    const r = ProcurementRequisitionCreateResponseSchema.safeParse({
      ok: true,
      requisition: {
        id: "pr-scanner-001",
        status: "open",
        neededBy: "2026-07-01",
        justification: "",
        requesterId: "user-1",
        lines: [{ ...requisitionLine, uom: undefined }],
        createdAt: "2026-06-22T08:00:00.000Z",
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.requisition.lines[0]?.id).toBe("prl-scanner-001");
      expect(r.data.requisition.lines[0]?.estUnitPrice).toBe(95_000);
    }
  });

  it("accepts RFQ conversion requests and backend RFQ shapes", () => {
    const request = ProcurementRfqConvertRequestSchema.safeParse({
      dueAt: "2026-07-15",
      idempotencyKey: "rfq-ui-test",
    });
    const response = ProcurementRfqConvertResponseSchema.safeParse({
      ok: true,
      rfq: {
        id: "rfq-scanner-001",
        requisitionId: "pr-scanner-001",
        sentAt: "2026-06-22T08:00:00.000Z",
        dueAt: "2026-07-15",
        status: "open",
        shortlistedVendors: [
          {
            vendorId: "vendor-yerevan-hardware-supply",
            name: "Yerevan Hardware Supply",
            score: 1,
            avgPrice: 90_000,
            leadTimeDays: 0,
          },
        ],
        quotes: null,
        award: null,
      },
    });

    expect(request.success).toBe(true);
    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.data.rfq.shortlistedVendors[0]?.vendorId).toBe(
        "vendor-yerevan-hardware-supply",
      );
    }
  });

  it("accepts nested quote and award envelopes", () => {
    const quoteRequest = ProcurementRfqQuoteCreateRequestSchema.safeParse({
      vendorId: "vendor-yerevan-hardware-supply",
      requisitionLineId: "prl-scanner-001",
      unitPrice: 90_000,
      currency: "AMD",
      validUntil: "2026-06-30",
      idempotencyKey: "quote-ui-test",
    });
    const quoteResponse = ProcurementRfqQuoteCreateResponseSchema.safeParse({
      ok: true,
      quote: {
        id: "rfqq-scanner-001",
        rfqId: "rfq-scanner-001",
        vendorId: "vendor-yerevan-hardware-supply",
        requisitionLineId: "prl-scanner-001",
        unitPrice: 90_000,
        currency: "AMD",
        validUntil: "2026-06-30",
        createdAt: "2026-06-22T08:00:00.000Z",
      },
    });
    const awardResponse = ProcurementRfqAwardResponseSchema.safeParse({
      ok: true,
      purchaseOrder: {
        id: "po-scanner-001",
        orderNumber: "PO-RFQ-ER-001",
        status: "rfq",
        vendorId: "vendor-yerevan-hardware-supply",
        total: 0,
      },
    });
    const awardRequest = ProcurementRfqAwardRequestSchema.safeParse({
      vendorId: "vendor-yerevan-hardware-supply",
      idempotencyKey: "award-ui-test",
    });

    expect(quoteRequest.success).toBe(true);
    expect(quoteResponse.success).toBe(true);
    expect(awardRequest.success).toBe(true);
    expect(awardResponse.success).toBe(true);
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
      slaPolicies: [VALID_SLA_POLICY],
      fieldVisits: [VALID_FIELD_VISIT],
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

describe("ServiceSlaPolicySchema", () => {
  it("accepts the service SLA policy wire shape", () => {
    const r = ServiceSlaPolicySchema.safeParse(VALID_SLA_POLICY);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.responseMinutes).toBe(15);
      expect(r.data.resolutionMinutes).toBe(240);
      expect(r.data.active).toBe(true);
    }
  });

  it("accepts numeric active from service SLA endpoints", () => {
    const r = ServiceSlaPolicySchema.safeParse({
      ...VALID_SLA_POLICY,
      id: "sla-2",
      active: 1,
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.active).toBe(1);
    }
  });

  it("accepts standalone SLA policy envelopes and empty policy lists", () => {
    const withPolicies = ServiceSlaPoliciesResponseSchema.parse({
      policies: [VALID_SLA_POLICY],
    });
    const withSlaPolicies = ServiceSlaPoliciesResponseSchema.parse({
      slaPolicies: [{ ...VALID_SLA_POLICY, id: "sla-2", active: 0 }],
    });
    const empty = ServiceSlaPoliciesResponseSchema.parse({ policies: [] });

    expect(withPolicies.policies).toHaveLength(1);
    expect(withSlaPolicies.policies[0]?.active).toBe(0);
    expect(empty.policies).toEqual([]);
  });
});

describe("ServiceFieldVisitSchema", () => {
  it("accepts the field visit wire shape with joined display fields", () => {
    const r = ServiceFieldVisitSchema.safeParse(VALID_FIELD_VISIT);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.caseNumber).toBe("AO-CASE-1001");
      expect(r.data.customerName).toBe("Ani Beauty");
      expect(r.data.projectId).toBe("p-1");
      expect(r.data.assignedUserName).toBe("Samvel");
    }
  });

  it("accepts field visit payloads without optional joined display fields", () => {
    const visit: Record<string, unknown> = { ...VALID_FIELD_VISIT, assignedUserId: null };
    delete visit.caseNumber;
    delete visit.subject;
    delete visit.customerName;
    delete visit.assignedUserName;
    const r = ServiceFieldVisitSchema.safeParse(visit);

    expect(r.success).toBe(true);
  });

  it("accepts optional dispatch navigation map and directions fields", () => {
    const r = ServiceFieldVisitSchema.safeParse({
      ...VALID_FIELD_VISIT,
      dispatchNavigation: {
        address: "Ani Beauty, Yerevan",
        mapQuery: "Ani Beauty, Yerevan, AO-CASE-1001",
        mapUrl: "https://www.google.com/maps/search/?api=1&query=Ani%20Beauty%2C%20Yerevan",
        directionsUrl: "https://www.google.com/maps/dir/?api=1&destination=Ani%20Beauty%2C%20Yerevan",
        provider: "google-maps",
        source: "service_field_visits.location",
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dispatchNavigation?.address).toBe("Ani Beauty, Yerevan");
      expect(r.data.dispatchNavigation?.mapQuery).toContain("AO-CASE-1001");
      expect(r.data.dispatchNavigation?.mapUrl).toContain("www.google.com/maps/search");
      expect(r.data.dispatchNavigation?.directionsUrl).toContain("www.google.com/maps/dir");
      expect(r.data.dispatchNavigation?.provider).toBe("google-maps");
    }
  });

  it("accepts route optimization evidence on dispatch navigation", () => {
    const r = ServiceFieldVisitSchema.safeParse({
      ...VALID_FIELD_VISIT,
      dispatchNavigation: {
        address: "Ani Beauty, Yerevan",
        routeLine: "Warehouse -> Ani Beauty",
        routeOptimization: {
          stopNumber: 1,
          totalStops: 3,
          strategy: "nearest-open-window",
          summary: "Front-load urgent visits near Kentron.",
          estimatedTravelMinutes: 12,
          estimatedDistanceKm: 4.8,
          savingsMinutes: 8,
          provider: "maps-router",
          source: "field-service-route-optimizer",
          limitations: ["traffic is estimated"],
          evidence: { scoredAt: "2026-06-22T08:00:00.000Z" },
          traceId: "route-plan-1",
        },
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dispatchNavigation?.routeOptimization?.stopNumber).toBe(1);
      expect(r.data.dispatchNavigation?.routeOptimization?.totalStops).toBe(3);
      expect(r.data.dispatchNavigation?.routeOptimization?.strategy).toBe("nearest-open-window");
      expect(r.data.dispatchNavigation?.routeOptimization?.estimatedTravelMinutes).toBe(12);
      expect(r.data.dispatchNavigation?.routeOptimization?.savingsMinutes).toBe(8);
      expect(r.data.dispatchNavigation?.routeOptimization?.provider).toBe("maps-router");
      expect(r.data.dispatchNavigation?.routeOptimization?.source).toBe("field-service-route-optimizer");
      expect(r.data.dispatchNavigation?.routeOptimization?.limitations).toEqual(["traffic is estimated"]);
      expect(r.data.dispatchNavigation?.routeOptimization?.evidence).toEqual({
        scoredAt: "2026-06-22T08:00:00.000Z",
      });
      expect((r.data.dispatchNavigation?.routeOptimization as { traceId?: string }).traceId).toBe("route-plan-1");
    }
  });

  it("rejects impossible route optimization stop numbers", () => {
    const r = ServiceFieldVisitSchema.safeParse({
      ...VALID_FIELD_VISIT,
      dispatchNavigation: {
        routeOptimization: {
          stopNumber: 0,
          totalStops: 3,
          estimatedTravelMinutes: 12,
          savingsMinutes: 8,
        },
      },
    });

    expect(r.success).toBe(false);
  });

  it("accepts field-service cost allocation evidence with passthrough ledger mappings", () => {
    const r = ServiceFieldVisitSchema.safeParse({
      ...VALID_FIELD_VISIT,
      costAllocation: {
        strategy: "scheduled-window-cost-basis-v1",
        status: "estimate",
        currency: "AMD",
        scheduledMinutes: 60,
        laborMinutes: 60,
        laborCost: 0,
        travelCost: 0,
        materialCost: 0,
        totalCost: 0,
        source: "service_field_visits.scheduled_start_at/service_field_visits.scheduled_end_at",
        computedAt: "2026-06-22T08:00:00.000Z",
        materialEvidence: [
          {
            stockMoveId: "stockmove-1",
            catalogSku: "HW-BARCODE-SCANNER",
            totalCost: 62000,
          },
        ],
        ledgerMappings: [
          {
            bucket: "labor",
            managementAccount: "8112",
            recognitionAccount: "7113",
            status: "not-posted",
          },
          {
            bucket: "materials",
            basis: "stock-move-valuation-journal",
            amount: 62000,
            postedAmount: 62000,
            status: "posted",
          },
        ],
        limitations: ["labor-rate-not-configured"],
        evidence: { traceId: "cost-basis-1" },
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.costAllocation?.scheduledMinutes).toBe(60);
      expect(r.data.costAllocation?.laborMinutes).toBe(60);
      expect(r.data.costAllocation?.totalCost).toBe(0);
      expect(r.data.costAllocation?.materialEvidence?.[0]?.stockMoveId).toBe("stockmove-1");
      expect(r.data.costAllocation?.ledgerMappings).toEqual([
        {
          bucket: "labor",
          managementAccount: "8112",
          recognitionAccount: "7113",
          status: "not-posted",
        },
        {
          bucket: "materials",
          basis: "stock-move-valuation-journal",
          amount: 62000,
          postedAmount: 62000,
          status: "posted",
        },
      ]);
    }
  });

  it("rejects impossible field-service cost allocation minutes", () => {
    const r = ServiceFieldVisitSchema.safeParse({
      ...VALID_FIELD_VISIT,
      costAllocation: {
        scheduledMinutes: 20_000,
        laborMinutes: 60,
      },
    });

    expect(r.success).toBe(false);
  });

  it("accepts optional technician GPS location evidence", () => {
    const r = ServiceFieldVisitSchema.safeParse({
      ...VALID_FIELD_VISIT,
      technicianLocation: {
        latitude: 40.179186,
        longitude: 44.499103,
        accuracyMeters: 14.6,
        capturedAt: "2026-06-22T08:30:00.000Z",
        capturedByUserId: "user-1",
        capturedByUserName: "Samvel",
        source: "browser-geolocation",
        mapUrl: "https://www.google.com/maps/search/?api=1&query=40.179186%2C44.499103",
        provider: { name: "browser" },
        evidence: { idempotencyKey: "gps-key-1" },
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.technicianLocation?.latitude).toBe(40.179186);
      expect(r.data.technicianLocation?.longitude).toBe(44.499103);
      expect(r.data.technicianLocation?.accuracyMeters).toBe(14.6);
      expect(r.data.technicianLocation?.source).toBe("browser-geolocation");
    }
  });

  it("accepts standalone field visit response envelopes", () => {
    const response = ServiceFieldVisitsResponseSchema.parse({
      visits: [VALID_FIELD_VISIT],
    });

    expect(response.visits).toHaveLength(1);
    expect(response.visits[0]?.status).toBe("scheduled");
  });

  it("keeps field visit wire status open for server-side additions", () => {
    const r = ServiceFieldVisitSchema.safeParse({
      ...VALID_FIELD_VISIT,
      status: "needs-parts",
    });

    expect(r.success).toBe(true);
  });
});

describe("UpdateServiceFieldVisitTechnicianLocationSchema", () => {
  it("accepts browser geolocation capture payloads", () => {
    const r = UpdateServiceFieldVisitTechnicianLocationInputSchema.safeParse({
      latitude: 40.179186,
      longitude: 44.499103,
      accuracyMeters: 9.4,
      capturedAt: "2026-06-22T08:30:00.000Z",
      source: "browser-geolocation",
      idempotencyKey: "desk-visit:visit-1:technician-location:key",
    });

    expect(r.success).toBe(true);
  });

  it("rejects non-browser geolocation sources", () => {
    const r = UpdateServiceFieldVisitTechnicianLocationInputSchema.safeParse({
      latitude: 40.179186,
      longitude: 44.499103,
      source: "manual",
    });

    expect(r.success).toBe(false);
  });

  it("accepts technician location response sync evidence when present", () => {
    const r = UpdateServiceFieldVisitTechnicianLocationResponseSchema.safeParse({
      ok: true,
      visit: {
        ...VALID_FIELD_VISIT,
        technicianLocation: {
          latitude: 40.179186,
          longitude: 44.499103,
          capturedAt: "2026-06-22T08:30:00.000Z",
          source: "browser-geolocation",
        },
      },
      idempotent: true,
      locationSync: {
        idempotencyKey: "desk-visit:visit-1:technician-location:key",
        replayedAt: "2026-06-22T08:31:00.000Z",
      },
    });

    expect(r.success).toBe(true);
  });
});

describe("UpdateServiceFieldVisitTechnicianStatusInputSchema", () => {
  it("accepts technician status transitions for the POST body", () => {
    for (const status of ServiceFieldVisitTechnicianStatus.options) {
      const r = UpdateServiceFieldVisitTechnicianStatusInputSchema.safeParse({
        status,
        worksheetSummary: "Checklist signed on site.",
        idempotencyKey: `desk-visit-visit-1-${status}`,
      });
      expect(r.success, `status ${status}`).toBe(true);
    }
  });

  it("rejects empty idempotency keys for the POST body", () => {
    const r = UpdateServiceFieldVisitTechnicianStatusInputSchema.safeParse({
      status: "en-route",
      idempotencyKey: "",
    });

    expect(r.success).toBe(false);
  });

  it("rejects non-technician statuses for the POST body", () => {
    const r = UpdateServiceFieldVisitTechnicianStatusInputSchema.safeParse({
      status: "scheduled",
      worksheetSummary: "Not a technician transition.",
    });

    expect(r.success).toBe(false);
  });

  it("accepts technician status response idempotency evidence when present", () => {
    const r = UpdateServiceFieldVisitTechnicianStatusResponseSchema.safeParse({
      ok: true,
      visit: { ...VALID_FIELD_VISIT, status: "en-route" },
      idempotent: true,
      dispatchSync: {
        idempotencyKey: "desk-visit-visit-1-en-route",
        replayedAt: "2026-06-22T08:00:00.000Z",
      },
    });

    expect(r.success).toBe(true);
  });
});

describe("ServiceDispatchAlertSchema", () => {
  it("accepts the technician dispatch alert wire shape", () => {
    const r = ServiceDispatchAlertSchema.safeParse(VALID_DISPATCH_ALERT);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dedupeKey).toBe("service-field-visit:visit-1:due-soon:2026-06-22T08:05:00.000Z");
      expect(r.data.notify).toBe(true);
      expect(r.data.acknowledged).toBeUndefined();
      expect(r.data.acknowledgedAt).toBeNull();
    }
  });

  it("accepts dispatch alert feed envelopes with passthrough metadata", () => {
    const response = ServiceDispatchAlertsResponseSchema.parse({
      alerts: [
        VALID_DISPATCH_ALERT,
        {
          ...VALID_DISPATCH_ALERT,
          id: "svc-dispatch-alert-gps-missing-vdaec69700c50-visit-1",
          notify: false,
          severity: "low",
          acknowledged: true,
          acknowledgedAt: "2026-06-22T08:10:00.000Z",
          extraBackendField: { source: "worker" },
        },
      ],
      generatedAt: "2026-06-22T08:11:00.000Z",
    });

    expect(response.alerts).toHaveLength(2);
    expect(response.alerts[1]?.notify).toBe(false);
    expect(response.alerts[1]?.acknowledged).toBe(true);
    expect((response.alerts[1] as { extraBackendField?: unknown }).extraBackendField).toEqual({
      source: "worker",
    });
  });

  it("rejects dispatch alert feed envelopes without alerts", () => {
    const r = ServiceDispatchAlertsResponseSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("requires ack responses to report ok true", () => {
    const withAlert = ServiceDispatchAlertAckResponseSchema.parse({
      ok: true,
      alert: {
        ...VALID_DISPATCH_ALERT,
        acknowledgedAt: "2026-06-22T08:12:00.000Z",
      },
      idempotent: true,
    });
    const minimal = ServiceDispatchAlertAckResponseSchema.parse({ ok: true });

    expect(withAlert.alert?.acknowledgedAt).toBe("2026-06-22T08:12:00.000Z");
    expect(minimal.ok).toBe(true);
    expect(ServiceDispatchAlertAckResponseSchema.safeParse({ ok: false }).success).toBe(false);
    expect(ServiceDispatchAlertAckResponseSchema.safeParse({}).success).toBe(false);
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
  serviceFieldVisitId: null,
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

const VALID_POS_CASH_SESSION = {
  id: "pos-session-1",
  status: "open",
  cashierUserId: "user-1",
  cashierName: "Ani Petrosyan",
  stockLocationId: "loc-pos-1",
  stockLocationName: "Retail counter",
  openingCash: 50000,
  expectedCash: 50000,
  countedCash: null,
  cashDifference: null,
  currency: "AMD",
  openedAt: "2026-06-22T08:00:00.000Z",
  closedAt: null,
  fiscalDeviceId: null,
  zReportNumber: null,
  receiptRangeStart: null,
  receiptRangeEnd: null,
  closeNote: null,
  createdAt: "2026-06-22T08:00:00.000Z",
  updatedAt: "2026-06-22T08:00:00.000Z",
};

describe("POS cash-session schemas", () => {
  it("accepts an open POS cash session with empty closeout evidence", () => {
    const r = PosCashSessionSchema.safeParse(VALID_POS_CASH_SESSION);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("open");
      expect(r.data.currency).toBe("AMD");
      expect(r.data.countedCash).toBeNull();
    }
  });

  it("rejects non-AMD cash sessions", () => {
    const r = PosCashSessionSchema.safeParse({
      ...VALID_POS_CASH_SESSION,
      currency: "USD",
    });

    expect(r.success).toBe(false);
  });

  it("accepts the /api/pos/workspace envelope", () => {
    const closedSession = {
      ...VALID_POS_CASH_SESSION,
      id: "pos-session-closed",
      status: "closed",
      expectedCash: 75000,
      countedCash: 74000,
      cashDifference: -1000,
      closedAt: "2026-06-22T18:00:00.000Z",
      fiscalDeviceId: "FISCAL-01",
      zReportNumber: "ZR-2026-0001",
      receiptRangeStart: "10001",
      receiptRangeEnd: "10075",
      closeNote: "Short by 1000 AMD after count.",
      updatedAt: "2026-06-22T18:00:00.000Z",
    };

    const r = PosWorkspaceResponseSchema.safeParse({
      openSession: VALID_POS_CASH_SESSION,
      sessions: [VALID_POS_CASH_SESSION, closedSession],
      catalogItems: [
        {
          id: "catitem-pos-scanner",
          categoryId: "catcat-hardware",
          categoryName: "POS hardware",
          sku: "POS-SCANNER",
          name: "POS barcode scanner",
          itemType: "stockable",
          status: "active",
          unitOfMeasure: "pc",
          listPrice: 25000,
          standardCost: 16000,
          fiscalReceiptRequired: true,
        },
      ],
      stockLocations: [
        {
          id: "loc-pos-1",
          code: "STORE/POS",
          name: "Retail counter",
          locationType: "retail",
          status: "active",
        },
      ],
      fiscalCloseoutLabels: {
        fiscalDeviceId: "Fiscal device",
        zReportNumber: "Z-report number",
        receiptRange: "Receipt range",
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sessions).toHaveLength(2);
      expect(r.data.catalogItems[0]?.fiscalReceiptRequired).toBe(true);
      expect(r.data.stockLocations[0]?.name).toBe("Retail counter");
    }
  });

  it("validates the open-session POST body", () => {
    const r = PosOpenCashSessionRequestSchema.safeParse({
      stockLocationId: "loc-pos-1",
      registerCode: "POS-01",
      openingCash: 50000,
      openedAt: "2026-06-22T08:00",
    });

    expect(r.success).toBe(true);
  });

  it("rejects a negative opening cash amount", () => {
    const r = PosOpenCashSessionRequestSchema.safeParse({
      stockLocationId: "loc-pos-1",
      openingCash: -1,
    });

    expect(r.success).toBe(false);
  });

  it("validates the close-session POST body", () => {
    const r = PosCloseCashSessionRequestSchema.safeParse({
      countedCash: 74000,
      fiscalDeviceId: "FISCAL-01",
      zReportNumber: "ZR-2026-0001",
      receiptRangeStart: "10001",
      receiptRangeEnd: "10075",
      closeNote: "Short by 1000 AMD after count.",
    });

    expect(r.success).toBe(true);
  });

  it("normalizes POS write responses from session and cashSession envelopes", () => {
    const opened = PosOpenCashSessionResponseSchema.safeParse({
      session: VALID_POS_CASH_SESSION,
    });
    const closed = PosCloseCashSessionResponseSchema.safeParse({
      cashSession: {
        ...VALID_POS_CASH_SESSION,
        status: "closed",
        countedCash: 50000,
        cashDifference: 0,
        closedAt: "2026-06-22T18:00:00.000Z",
      },
    });

    expect(opened.success).toBe(true);
    expect(closed.success).toBe(true);
    if (closed.success) {
      expect(closed.data.session.status).toBe("closed");
    }
  });

  it("validates the sale POST body", () => {
    const r = PosCreateSaleRequestSchema.safeParse({
      receiptNumber: "R-2026-0001",
      paymentMethod: "card",
      soldAt: "2026-06-22T09:30",
      idempotencyKey: "pos-sale-ui-1782113400000",
      lines: [
        {
          catalogItemId: "catitem-pos-scanner",
          catalogItemVariantId: null,
          quantity: 2,
        },
      ],
    });

    expect(r.success).toBe(true);
  });

  it("rejects a non-positive sale quantity", () => {
    const r = PosCreateSaleRequestSchema.safeParse({
      receiptNumber: "R-2026-0001",
      paymentMethod: "cash",
      idempotencyKey: "pos-sale-ui-1782113400000",
      lines: [
        {
          catalogItemId: "catitem-pos-scanner",
          quantity: 0,
        },
      ],
    });

    expect(r.success).toBe(false);
  });

  it("accepts the sale POST response envelope", () => {
    const r = PosCreateSaleResponseSchema.safeParse({
      ok: true,
      sale: {
        id: "pos-sale-1",
        cashSessionId: "pos-session-1",
        receiptNumber: "R-2026-0001",
        status: "posted",
        paymentMethod: "card",
        currency: "AMD",
        subtotal: 50000,
        vat: 10000,
        total: 60000,
        lineCount: 1,
        soldAt: "2026-06-22T09:30:00.000Z",
        cashierUserId: "user-1",
        stockLocationId: "loc-pos-1",
        postings: {
          salePosting: "posted",
          inventoryPosting: "posted",
          ledgerPosting: "not-posted",
        },
        lines: [
          {
            id: "pos-sale-line-1",
            catalogItemId: "catitem-pos-scanner",
            catalogItemVariantId: null,
            sku: "POS-SCANNER",
            name: "POS barcode scanner",
            quantity: 2,
            unitPrice: 25000,
            subtotal: 50000,
            vat: 10000,
            total: 60000,
            vatMode: "standard",
            fiscalReceiptRequired: true,
            stockMoveId: "stock-move-1",
          },
        ],
        createdAt: "2026-06-22T09:30:01.000Z",
      },
      session: {
        ...VALID_POS_CASH_SESSION,
        expectedCash: 110000,
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sale.status).toBe("posted");
      expect(r.data.sale.lines[0]?.catalogItemVariantId).toBeNull();
      expect(r.data.session.expectedCash).toBe(110000);
    }
  });

  it("validates the receipt-packet POST body", () => {
    const r = PosReceiptPacketRequestSchema.safeParse({
      fiscalDeviceId: "FISCAL-01",
    });

    expect(r.success).toBe(true);
  });

  it("accepts the receipt-packet POST response envelope", () => {
    const sale = {
      id: "pos-sale-1",
      cashSessionId: "pos-session-1",
      receiptNumber: "R-2026-0001",
      status: "posted",
      paymentMethod: "card",
      currency: "AMD",
      subtotal: 50000,
      vat: 10000,
      total: 60000,
      lineCount: 1,
      soldAt: "2026-06-22T09:30:00.000Z",
      cashierUserId: "user-1",
      stockLocationId: "loc-pos-1",
      postings: {
        salePosting: "posted",
        inventoryPosting: "posted",
        ledgerPosting: "not-posted",
      },
      lines: [
        {
          id: "pos-sale-line-1",
          catalogItemId: "catitem-pos-scanner",
          catalogItemVariantId: null,
          sku: "POS-SCANNER",
          name: "POS barcode scanner",
          quantity: 2,
          unitPrice: 25000,
          subtotal: 50000,
          vat: 10000,
          total: 60000,
          vatMode: "standard",
          fiscalReceiptRequired: true,
          stockMoveId: "stock-move-1",
        },
      ],
      createdAt: "2026-06-22T09:30:01.000Z",
    };

    const r = PosReceiptPacketResponseSchema.safeParse({
      ok: true,
      receiptPacket: {
        id: "pos-receipt-packet-1",
        saleId: "pos-sale-1",
        cashSessionId: "pos-session-1",
        receiptNumber: "R-2026-0001",
        fiscalDeviceId: "FISCAL-01",
        status: "prepared",
        checksum: "a1fiscalchecksum",
        payload: { saleId: "pos-sale-1" },
        createdAt: "2026-06-22T09:31:00.000Z",
      },
      sale,
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.receiptPacket.status).toBe("prepared");
      expect(r.data.receiptPacket.checksum).toBe("a1fiscalchecksum");
      expect(r.data.sale.id).toBe("pos-sale-1");
    }
  });

  it("validates the refund evidence POST body", () => {
    const r = PosRefundRequestSchema.safeParse({
      idempotencyKey: "pos-refund-ui-pos-sale-1-1782113400000",
      refundReference: "RF-CASH-001",
      refundMethod: "cash",
      reason: "Customer returned sealed scanner.",
    });

    expect(r.success).toBe(true);
  });

  it("rejects refund evidence metadata that the backend safe guards reject", () => {
    expect(
      PosRefundRequestSchema.safeParse({
        idempotencyKey: "not safe",
        refundReference: "RF-CASH-001",
        refundMethod: "cash",
        reason: "Customer returned sealed scanner.",
      }).success,
    ).toBe(false);
    expect(
      PosRefundRequestSchema.safeParse({
        idempotencyKey: "pos-refund-ui-pos-sale-1-1782113400000",
        refundReference: " RF-CASH-001 ",
        refundMethod: "cash",
        reason: "Customer returned sealed scanner.",
      }).success,
    ).toBe(false);
    expect(
      PosRefundRequestSchema.safeParse({
        idempotencyKey: "pos-refund-ui-pos-sale-1-1782113400000",
        refundReference: "RF-CASH-001",
        refundMethod: "cash",
        reason: "unsafe\u0000reason",
      }).success,
    ).toBe(false);
  });

  it("accepts the refund evidence response envelope", () => {
    const sale = {
      id: "pos-sale-1",
      cashSessionId: "pos-session-1",
      receiptNumber: "R-2026-0001",
      status: "refunded_full",
      paymentMethod: "cash",
      currency: "AMD",
      subtotal: 50000,
      vat: 10000,
      total: 60000,
      paidCash: 60000,
      lineCount: 1,
      soldAt: "2026-06-22T09:30:00.000Z",
      cashierUserId: "user-1",
      stockLocationId: "loc-pos-1",
      postings: {
        salePosting: "posted",
        inventoryPosting: "posted",
        ledgerPosting: "not-posted",
      },
      lines: [
        {
          id: "pos-sale-line-1",
          catalogItemId: "catitem-pos-scanner",
          catalogItemVariantId: null,
          sku: "POS-SCANNER",
          name: "POS barcode scanner",
          quantity: 2,
          unitPrice: 25000,
          subtotal: 50000,
          vat: 10000,
          total: 60000,
          vatMode: "standard",
          fiscalReceiptRequired: true,
          stockMoveId: "stock-move-1",
        },
      ],
      createdAt: "2026-06-22T09:30:01.000Z",
    };

    const r = PosRefundResponseSchema.safeParse({
      ok: true,
      idempotent: false,
      refund: {
        id: "pos-sale-refund-1",
        saleId: "pos-sale-1",
        cashSessionId: "pos-session-1",
        refundReference: "RF-CASH-001",
        sourceKey: "pos-refund-ui-pos-sale-1-1782113400000",
        reason: "Customer returned sealed scanner.",
        refundMethod: "cash",
        refundedTotal: 60000,
        cashAdjustment: 60000,
        status: "posted",
        inventoryPostingStatus: "posted",
        ledgerPostingStatus: "not-posted",
        postings: {
          refundPosting: "posted",
          inventoryPosting: "posted",
          ledgerPosting: "not-posted",
        },
        refundedAt: "2026-06-22T10:00:00.000Z",
        lineCount: 1,
        lines: [
          {
            id: "pos-sale-refund-line-1",
            saleLineId: "pos-sale-line-1",
            catalogItemId: "catitem-pos-scanner",
            catalogItemVariantId: null,
            sku: "POS-SCANNER",
            name: "POS barcode scanner",
            description: "",
            quantity: 2,
            unitPrice: 25000,
            subtotal: 50000,
            vat: 10000,
            total: 60000,
            vatMode: "standard",
            fiscalReceiptRequired: true,
            sourceStockMoveId: "stock-move-1",
            returnStockMoveId: "stock-move-return-1",
            createdAt: "2026-06-22T10:00:01.000Z",
          },
        ],
        createdByUserId: "user-1",
        createdByName: "Ani Petrosyan",
        createdAt: "2026-06-22T10:00:01.000Z",
      },
      sale,
      session: {
        ...VALID_POS_CASH_SESSION,
        expectedCash: -10000,
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sale.status).toBe("refunded_full");
      expect(r.data.refund.inventoryPostingStatus).toBe("posted");
      expect(r.data.refund.ledgerPostingStatus).toBe("not-posted");
      expect(r.data.refund.lines[0]?.sourceStockMoveId).toBe("stock-move-1");
      expect(r.data.refund.lines[0]?.returnStockMoveId).toBe("stock-move-return-1");
      expect(r.data.session?.expectedCash).toBe(-10000);
    }
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
      moveType: "outbound",
      quantity: 5,
      serviceFieldVisitId: "visit-1",
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

describe("Project profitability schemas", () => {
  const profitability = {
    projectId: "p-1",
    customerId: "c-1",
    currency: "AMD",
    hourlyRate: 25000,
    billedMinutes: 360,
    billedEntries: 3,
    unbilledMinutes: 240,
    unbilledEntries: 4,
    totalMinutes: 600,
    totalEntries: 7,
    billedRevenue: 150000,
    unbilledRevenue: 100000,
    totalRevenue: 250000,
    costTotal: 143750,
    grossProfit: 106250,
    grossMarginPct: 42,
    invoiceCount: 1,
    invoices: [
      {
        id: "inv-1",
        number: "INV-2026-001",
        status: "issued",
        total: 150000,
        subtotal: 125000,
        vat: 25000,
        issueDate: "2026-06-10",
        dueDate: "2026-06-25",
      },
    ],
  };

  it("accepts task and product cost-basis evidence", () => {
    const r = ProjectProfitabilityResponseSchema.safeParse({
      profitability: {
        ...profitability,
        costRate: 8750,
        laborCostTotal: 87500,
        productCostTotal: 56250,
        taskProfitability: [
          {
            taskId: "task-1",
            taskTitle: "Implementation",
            taskStatus: "in-progress",
            billedMinutes: 180,
            unbilledMinutes: 60,
            totalMinutes: 240,
            entries: 3,
            revenue: 100000,
            laborCost: 35000,
            grossProfit: 65000,
            grossMarginPct: 65,
          },
          {
            taskId: null,
            taskTitle: "Unassigned time",
            taskStatus: null,
            billedMinutes: 180,
            unbilledMinutes: 180,
            totalMinutes: 360,
            entries: 4,
            revenue: 150000,
            laborCost: 52500,
            grossProfit: 97500,
            grossMarginPct: null,
          },
        ],
        productCostEvidence: [
          {
            quoteId: "quote-1",
            quoteNumber: "Q-2026-007",
            quoteStatus: "accepted",
            catalogItemId: "cat-1",
            catalogSku: "IMPL-BASE",
            catalogName: "Implementation pack",
            catalogItemVariantId: "variant-1",
            variantSku: "IMPL-BASE-PRO",
            quantity: 2,
            revenue: 120000,
            unitCost: 18000,
            cost: 36000,
            grossProfit: 84000,
            grossMarginPct: 70,
          },
        ],
        fieldVisitCostTotal: 0,
        fieldVisitCount: 1,
        fieldVisitCostEvidence: [
          {
            visitId: "visit-1",
            caseId: "case-1",
            caseNumber: "AO-CASE-1001",
            subject: "Fiscal printer field check",
            assignedUserId: "user-1",
            assignedUserName: "Samvel",
            scheduledStartAt: "2026-06-22T09:00:00.000Z",
            scheduledEndAt: "2026-06-22T10:15:00.000Z",
            scheduledMinutes: 75,
            laborMinutes: 75,
            laborCost: 0,
            travelCost: 0,
            materialCost: 0,
            totalCost: 0,
            source: "service_field_visits.scheduled_start_at/service_field_visits.scheduled_end_at",
            materialEvidence: [
              {
                serviceFieldVisitId: "visit-1",
                stockMoveId: "stockmove-1",
                catalogSku: "HW-BARCODE-SCANNER",
                totalCost: 62000,
              },
            ],
            limitations: [
              "labor-rate-not-configured",
              "travel-rate-not-configured",
              "inventory-consumption-not-linked",
              "not-posted-to-ledger",
            ],
            ledgerMappings: [
              {
                bucket: "labor",
                managementAccount: "8112",
                recognitionAccount: "7113",
                status: "not-posted",
              },
              {
                bucket: "travel",
                expenseAccount: "713",
                status: "not-posted",
              },
              {
                bucket: "materials",
                basis: "linked-stock-moves",
                amount: 62000,
                postedAmount: 31000,
                unpostedAmount: 31000,
                status: "partial",
              },
            ],
          },
        ],
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.profitability.costRate).toBe(8750);
      expect(r.data.profitability.laborCostTotal).toBe(87500);
      expect(r.data.profitability.productCostTotal).toBe(56250);
      expect(r.data.profitability.fieldVisitCostTotal).toBe(0);
      expect(r.data.profitability.fieldVisitCount).toBe(1);
      expect(r.data.profitability.taskProfitability?.[0]?.taskTitle).toBe("Implementation");
      expect(r.data.profitability.taskProfitability?.[1]?.taskId).toBeNull();
      expect(r.data.profitability.productCostEvidence?.[0]?.variantSku).toBe("IMPL-BASE-PRO");
      expect(r.data.profitability.fieldVisitCostEvidence?.[0]?.scheduledMinutes).toBe(75);
      expect(r.data.profitability.fieldVisitCostEvidence?.[0]?.ledgerMappings?.[0]?.status).toBe("not-posted");
      expect(r.data.profitability.fieldVisitCostEvidence?.[0]?.ledgerMappings?.find(mapping => mapping.bucket === "materials")?.status).toBe("partial");
      expect(r.data.profitability.fieldVisitCostEvidence?.[0]?.materialEvidence?.[0]?.stockMoveId).toBe("stockmove-1");
    }
  });

  it("continues to accept profitability payloads without cost-basis evidence", () => {
    const r = ProjectProfitabilityResponseSchema.safeParse({ profitability });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.profitability.taskProfitability).toBeUndefined();
      expect(r.data.profitability.productCostEvidence).toBeUndefined();
    }
  });
});

describe("Project recurring task schemas", () => {
  const recurringTask = {
    id: "rt-1",
    projectId: "p-1",
    title: "Weekly client check-in",
    status: "todo",
    intervalUnit: "weekly",
    intervalEvery: 1,
    nextDueDate: "2026-06-29",
    active: 1,
    lastCreatedTaskId: "task-99",
    updatedAt: "2026-06-22T08:00:00.000Z",
  };

  it("accepts the recurring task wire shape", () => {
    const r = ProjectRecurringTaskSchema.safeParse(recurringTask);

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.intervalUnit).toBe("weekly");
      expect(r.data.active).toBe(1);
      expect(r.data.lastCreatedTaskId).toBe("task-99");
    }
  });

  it("accepts nullable/optional recurrence evidence and boolean active", () => {
    const r = ProjectRecurringTaskSchema.safeParse({
      id: "rt-2",
      title: "Monthly steering pack",
      status: "scheduled",
      intervalUnit: "monthly",
      intervalEvery: 2,
      nextDueDate: null,
      active: true,
      lastCreatedTaskId: null,
    });

    expect(r.success).toBe(true);
  });

  it("accepts custom interval units from the backend", () => {
    const r = ProjectRecurringTaskSchema.safeParse({
      id: "rt-3",
      title: "Quarterly audit",
      status: "planned",
      intervalUnit: "quarterly",
      intervalEvery: 1,
      active: false,
    });

    expect(r.success).toBe(true);
  });

  it("accepts the recurring tasks envelope", () => {
    const r = ProjectRecurringTasksResponseSchema.safeParse({
      recurringTasks: [recurringTask],
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.recurringTasks).toHaveLength(1);
    }
  });

  it("accepts recurringTasks on project detail", () => {
    const r = ProjectDetailResponseSchema.safeParse({
      project: {
        id: "p-1",
        name: "Alpha",
        status: "active",
        updatedAt: "2026-06-09T10:00:00Z",
        recurringTasks: [recurringTask],
      },
    });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.project.recurringTasks?.[0]?.title).toBe("Weekly client check-in");
    }
  });

  it("rejects a recurring task missing intervalEvery", () => {
    const r = ProjectRecurringTaskSchema.safeParse({
      ...recurringTask,
      intervalEvery: undefined,
    });

    expect(r.success).toBe(false);
  });
});

describe("Project template schemas", () => {
  const template = {
    id: "tpl-1",
    name: "ERP rollout",
    description: "Default implementation plan",
    status: "active",
    taskCount: 3,
    milestoneCount: 2,
    updatedAt: "2026-06-22T08:00:00.000Z",
    tasks: [
      {
        id: "tt-1",
        title: "Discovery",
        status: "done",
        dueOffsetDays: 0,
        sortOrder: 1,
        subtasks: [{ id: "tt-2", title: "Stakeholder map", status: "todo" }],
      },
      {
        id: "tt-2",
        title: "Stakeholder map",
        status: "todo",
        parentTaskId: "tt-1",
        parentTask: { id: "tt-1", title: "Discovery", status: "done" },
        dueOffsetDays: null,
        sortOrder: 2,
      },
    ],
    milestones: [
      { id: "tm-1", title: "Kickoff", dueOffsetDays: 0, sortOrder: 1 },
      { id: "tm-2", title: "Go live", dueOffsetDays: 30, sortOrder: 2 },
    ],
  };

  it("accepts the project templates list envelope", () => {
    const r = ProjectTemplatesResponseSchema.safeParse({ templates: [template] });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.templates[0]?.taskCount).toBe(3);
      expect(r.data.templates[0]?.tasks[1]?.parentTask?.title).toBe("Discovery");
      expect(r.data.templates[0]?.tasks[0]?.subtasks?.[0]?.title).toBe("Stakeholder map");
      expect(r.data.templates[0]?.milestones[1]?.dueOffsetDays).toBe(30);
    }
  });

  it("accepts the project template detail envelope", () => {
    const r = ProjectTemplateResponseSchema.safeParse({ template });

    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.template.id).toBe("tpl-1");
      expect(r.data.template.milestoneCount).toBe(2);
    }
  });

  it("rejects a template missing tasks", () => {
    const r = ProjectTemplatesResponseSchema.safeParse({
      templates: [{ ...template, tasks: undefined }],
    });

    expect(r.success).toBe(false);
  });
});
