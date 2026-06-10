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
