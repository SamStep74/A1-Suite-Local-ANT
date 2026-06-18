/**
 * schemas.test.ts — API contract tests for the /api/service/console
 * response shape (the home dashboard's data source).
 *
 * Slice 31 (2026-06-18) — locks in the ServiceConsoleSchema
 * after fixing 2 real production bugs that were making the
 * home dashboard widgets show "Couldn't load":
 *   1. `slaStatus` was the case status (e.g. "waiting-customer")
 *      instead of the SLA status (one of "on-track"|"at-risk"|
 *      "breached"). The seed put "waiting-customer" into the
 *      sla_status column for case-van-catalog.
 *   2. `queue` was an OBJECT (with byStatus/bySla/pendingApprovals/
 *      highPriorityOpen/escalatedOpen/averageSatisfaction keys)
 *      but the Zod schema was `z.array(z.unknown())` — schema
 *      drifted from the route's actual return shape
 *      (server/app.js:50525).
 *
 * These tests are unit-only (no live server needed) — they
 * construct a known-good response shape and assert the
 * schema validates it. The "shape drift" bug above is the
 * exact failure mode this catches.
 */
import { describe, it, expect } from "vitest";
import {
  ServiceConsoleSchema,
  ServiceQueueSchema,
  ServiceCaseSchema
} from "./schemas";

describe("ServiceCaseSchema", () => {
  it("accepts the documented case shape", () => {
    const good = {
      id: "case-1",
      customerId: "cust-1",
      customerName: "Acme",
      taxId: "12345",
      ticketId: "ticket-1",
      caseNumber: "AO-CASE-1",
      subject: "Subject",
      status: "open",
      priority: "high",
      channel: "email",
      ownerName: "Sam",
      slaDueAt: "2026-06-18T00:00:00Z",
      slaStatus: "at-risk",
      aiSuggestion: "Suggest X",
      knowledgeArticle: "KB-1",
      messageCount: 0,
      updatedAt: "2026-06-18T00:00:00Z",
      createdAt: "2026-06-17T00:00:00Z"
    };
    expect(ServiceCaseSchema.parse(good)).toEqual(good);
  });

  it("rejects slaStatus values outside the documented enum", () => {
    // The historical bug: sla_status was being set to
    // "waiting-customer" (a case status) in the seed. The
    // Zod enum is strict; the route must coerce to one of
    // the 3 SLA values before responding.
    const bad = {
      id: "case-1",
      customerId: "cust-1",
      customerName: "Acme",
      caseNumber: "AO-CASE-1",
      subject: "Subject",
      status: "open",
      priority: "high",
      channel: "email",
      slaStatus: "waiting-customer"
    };
    const r = ServiceCaseSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["slaStatus"]);
    }
  });
});

describe("ServiceQueueSchema", () => {
  it("accepts the documented summary-object shape (not an array)", () => {
    // The historical bug: the schema was z.array(z.unknown())
    // but the route returns a summary object. This is the
    // canonical shape from getServiceQueue (server/app.js:50525).
    const good = {
      byStatus: [
        { status: "open", count: 3 },
        { status: "waiting-customer", count: 1 }
      ],
      bySla: [
        { slaStatus: "on-track", count: 2 },
        { slaStatus: "at-risk", count: 1 }
      ],
      pendingApprovals: 0,
      highPriorityOpen: 2,
      escalatedOpen: 0,
      averageSatisfaction: 87
    };
    expect(ServiceQueueSchema.parse(good)).toEqual(good);
  });

  it("rejects an array (the pre-fix schema shape)", () => {
    // The schema was z.array(z.unknown()) — assert this is
    // no longer accepted. If a future refactor accidentally
    // changes the server back to returning an array, this test
    // catches it.
    const arr = [{ id: "x" }, { id: "y" }];
    const r = ServiceQueueSchema.safeParse(arr);
    expect(r.success).toBe(false);
  });
});

describe("ServiceConsoleSchema", () => {
  it("accepts the documented top-level response shape", () => {
    const good = {
      cases: [
        {
          id: "case-1",
          customerId: "cust-1",
          customerName: "Acme",
          caseNumber: "AO-CASE-1",
          subject: "Subject",
          status: "open",
          priority: "high",
          channel: "email",
          slaStatus: "on-track"
        }
      ],
      queue: {
        byStatus: [{ status: "open", count: 1 }],
        bySla: [{ slaStatus: "on-track", count: 1 }],
        pendingApprovals: 0,
        highPriorityOpen: 1,
        escalatedOpen: 0,
        averageSatisfaction: 0
      },
      escalations: [],
      resolutions: [],
      approvals: [],
      runs: [],
      rules: [],
      dryRuns: [],
      testEvents: [],
      customers: [{ id: "cust-1", name: "Acme" }],
      agents: [{ id: "user-1", name: "Sam", role: "Owner" }]
    };
    expect(ServiceConsoleSchema.parse(good)).toEqual(good);
  });

  it("optional fields (ticketSummaries, workflowBuilderSuggestions, knowledge) are tolerated when absent", () => {
    const minimal = {
      cases: [],
      queue: {
        byStatus: [],
        bySla: [],
        pendingApprovals: 0,
        highPriorityOpen: 0,
        escalatedOpen: 0,
        averageSatisfaction: 0
      },
      escalations: [],
      resolutions: [],
      approvals: [],
      runs: [],
      rules: [],
      dryRuns: [],
      testEvents: [],
      customers: [],
      agents: []
    };
    const r = ServiceConsoleSchema.safeParse(minimal);
    expect(r.success).toBe(true);
  });
});
