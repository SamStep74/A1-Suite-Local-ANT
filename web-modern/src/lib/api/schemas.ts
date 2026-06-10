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
