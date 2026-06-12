/**
 * Typed port of the Phase 9 RBAC §2.3 permission matrix.
 *
 * Mirrors the 5×N table in the contract (server/rbac.js →
 * PERMISSIONS_BY_ROLE is the runtime source of truth on the
 * server; this file is the SPA-facing source of truth). The
 * server's `ensureRbacSchema` seeds the same 29 permission codes
 * into `rbac_permissions`; this const + Zod schema lets the SPA
 * narrow an arbitrary `string` to a known permission code at the
 * type level.
 *
 * Resource surface (per contract §2.2):
 *   crm.deal | crm.contact | crm.sequence | crm.integration |
 *   crm.tube | inventory.balance | finance.report |
 *   cfo.snapshot | audit.read | org.user | org.settings
 *
 * Action surface: read | create | update | delete |
 *   approve | post | void | run | send | import | export |
 *   move_stage | enroll | enrich | access | manage
 *
 * Phase 10 (M14.1–M14.4 SMB CRM rebuild) adds a `smb_crm.*`
 * family for the new SMB CRM workspace. The 11 codes are seeded
 * by `ensureSmbCrmFoundationSchema` in server/db.js (and read
 * by server/smbCrmAuth.js — NOT by rbac.requirePermission,
 * because the static PERMISSIONS_BY_ROLE in rbac.js is
 * frozen and we may not touch it).
 */
import { z } from "zod";

/** A single permission row — the typed version of rbac_permissions. */
export interface RbacPermission {
  readonly code: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string;
}

/**
 * The 29 §2.3 permission codes, in canonical resource-major order.
 * Each entry also carries the resource + action split so the SPA
 * can render resource-grouped UIs without re-parsing the code.
 */
export const RBAC_PERMISSIONS = [
  { code: "crm.tube.access",        resource: "crm.tube",         action: "access",     description: "Open the CRM Tube workspace." },
  { code: "crm.deal.read",          resource: "crm.deal",         action: "read",       description: "View deals in the pipeline." },
  { code: "crm.deal.create",        resource: "crm.deal",         action: "create",     description: "Create a new deal." },
  { code: "crm.deal.update",        resource: "crm.deal",         action: "update",     description: "Edit an existing deal." },
  { code: "crm.deal.delete",        resource: "crm.deal",         action: "delete",     description: "Delete a deal (destructive)." },
  { code: "crm.deal.move_stage",    resource: "crm.deal",         action: "move_stage", description: "Move a deal between pipeline stages." },
  { code: "crm.contact.read",       resource: "crm.contact",      action: "read",       description: "View contacts." },
  { code: "crm.contact.create",     resource: "crm.contact",      action: "create",     description: "Create a new contact." },
  { code: "crm.contact.update",     resource: "crm.contact",      action: "update",     description: "Edit a contact." },
  { code: "crm.contact.delete",     resource: "crm.contact",      action: "delete",     description: "Delete a contact (destructive)." },
  { code: "crm.contact.enrich",     resource: "crm.contact",      action: "enrich",     description: "Trigger 3rd-party enrichment on a contact." },
  { code: "crm.sequence.read",      resource: "crm.sequence",     action: "read",       description: "View sequences." },
  { code: "crm.sequence.create",    resource: "crm.sequence",     action: "create",     description: "Create a new sequence." },
  { code: "crm.sequence.update",    resource: "crm.sequence",     action: "update",     description: "Edit a sequence." },
  { code: "crm.sequence.delete",    resource: "crm.sequence",     action: "delete",     description: "Delete a sequence." },
  { code: "crm.sequence.enroll",    resource: "crm.sequence",     action: "enroll",     description: "Enroll contacts in a sequence." },
  { code: "crm.integration.read",   resource: "crm.integration",  action: "read",       description: "View integration connections." },
  { code: "crm.integration.manage", resource: "crm.integration",  action: "manage",     description: "Configure integration connections." },
  { code: "finance.report.read",    resource: "finance.report",   action: "read",       description: "Read finance reports." },
  { code: "finance.report.create",  resource: "finance.report",   action: "create",     description: "Draft a finance report." },
  { code: "finance.report.approve", resource: "finance.report",   action: "approve",    description: "Approve a finance report for posting." },
  { code: "inventory.balance.read", resource: "inventory.balance", action: "read",       description: "View inventory balances." },
  { code: "inventory.balance.write", resource: "inventory.balance", action: "write",     description: "Adjust inventory balances." },
  { code: "cfo.snapshot.read",      resource: "cfo.snapshot",     action: "read",       description: "View CFO snapshots." },
  { code: "cfo.snapshot.approve",   resource: "cfo.snapshot",     action: "approve",    description: "Approve a CFO snapshot." },
  { code: "cfo.snapshot.run",       resource: "cfo.snapshot",     action: "run",        description: "Trigger a CFO snapshot run." },
  { code: "audit.read",             resource: "audit",            action: "read",       description: "Read the audit & governance log." },
  { code: "org.user.manage",        resource: "org.user",         action: "manage",     description: "Manage org membership + role assignments (owner-only)." },
  { code: "org.settings.manage",    resource: "org.settings",     action: "manage",     description: "Edit org-level settings." },

  /* ─── Phase 10 SMB CRM (M14.1–M14.4) ────────────────────────────────
   * The 11 smb_crm.* codes are seeded by
   * ensureSmbCrmFoundationSchema in server/db.js, NOT by
   * ensureRbacSchema. They are read by the parallel helper
   * server/smbCrmAuth.js (because the static PERMISSIONS_BY_ROLE
   * in rbac.js is frozen — we may not touch rbac.js per the
   * worker-task constraint).
   * ────────────────────────────────────────────────────────────────── */
  { code: "smb_crm.access",                resource: "smb_crm",         action: "access",     description: "Open the SMB CRM workspace (Phase 10)." },
  { code: "smb_crm.blueprint.read",        resource: "smb_crm.blueprint", action: "read",     description: "View industry templates and stored blueprints." },
  { code: "smb_crm.blueprint.generate",    resource: "smb_crm.blueprint", action: "generate", description: "Trigger the AI provider to generate a blueprint from a questionnaire." },
  { code: "smb_crm.blueprint.apply",       resource: "smb_crm.blueprint", action: "apply",    description: "Materialize a stored blueprint into modules / pipeline / fields / KPIs." },
  { code: "smb_crm.integration.read",      resource: "smb_crm.integration", action: "read",  description: "View SMB CRM integration connections." },
  { code: "smb_crm.integration.manage",    resource: "smb_crm.integration", action: "manage", description: "Configure SMB CRM integration connections." },
  { code: "smb_crm.webhook.read",          resource: "smb_crm.webhook", action: "read",       description: "View SMB CRM webhook endpoints and delivery ledger." },
  { code: "smb_crm.webhook.manage",        resource: "smb_crm.webhook", action: "manage",     description: "Configure SMB CRM webhook endpoints." },
  { code: "smb_crm.automation.read",       resource: "smb_crm.automation", action: "read",    description: "View SMB CRM automation rules." },
  { code: "smb_crm.automation.run",        resource: "smb_crm.automation", action: "run",     description: "Trigger an SMB CRM automation rule." },
  { code: "smb_crm.translate.read",        resource: "smb_crm.translate", action: "read",      description: "View SMB CRM trilingual (HY/EN/RU) translations and seed-dict." }
] as const satisfies readonly RbacPermission[];

/**
 * The Zod enum schema for a permission code. Accepts only the
 * 29 known codes; rejects arbitrary strings at parse time. The
 * inferred type (`z.infer<typeof RbacPermissionCodeSchema>`) is
 * the union of the 29 string literals — exactly what the SPA
 * components need for type-narrowing.
 */
export const RbacPermissionCodeSchema = z.enum(
  RBAC_PERMISSIONS.map(p => p.code) as [string, ...string[]]
);
export type RbacPermissionCode = z.infer<typeof RbacPermissionCodeSchema>;

/**
 * The 5 §2.1 role codes (lowercase). Distinct from the legacy
 * AUDIT_ROLES in rbac/role.ts (which is the upper-case role
 * string on the user record, e.g. "Owner" / "Admin" — used by
 * the topbar + audit drawer; this enum is the Phase 9 RBAC
 * role set, used by `rbac_user_roles.role_id` lookups).
 */
export const RBAC_ROLES = ["owner", "admin", "accountant", "operator", "viewer"] as const;
export type RbacRoleCode = (typeof RBAC_ROLES)[number];

/**
 * Lookup a permission entry by its code. Returns undefined for
 * unknown codes so callers can do feature-detection without
 * try/catch.
 */
export function findRbacPermission(code: string): RbacPermission | undefined {
  return RBAC_PERMISSIONS.find(p => p.code === code);
}

/** Group permissions by resource for resource-grouped UI rendering. */
export function groupRbacPermissionsByResource(): Record<string, readonly RbacPermission[]> {
  const out: Record<string, RbacPermission[]> = {};
  for (const p of RBAC_PERMISSIONS) {
    if (!out[p.resource]) out[p.resource] = [];
    out[p.resource].push(p);
  }
  return out;
}

/**
 * The 11 Phase 10 smb_crm.* codes, in code order. Mirrors the
 * 11 entries appended to RBAC_PERMISSIONS above. Useful for
 * feature-detection in the SPA (e.g. show the SMB CRM nav item
 * only if the user holds any of these) without having to filter
 * the full array on every render.
 */
export const SMB_CRM_PERMISSION_CODES = [
  "smb_crm.access",
  "smb_crm.blueprint.read",
  "smb_crm.blueprint.generate",
  "smb_crm.blueprint.apply",
  "smb_crm.integration.read",
  "smb_crm.integration.manage",
  "smb_crm.webhook.read",
  "smb_crm.webhook.manage",
  "smb_crm.automation.read",
  "smb_crm.automation.run",
  "smb_crm.translate.read"
] as const satisfies readonly string[];
export type SmbCrmPermissionCode = (typeof SMB_CRM_PERMISSION_CODES)[number];

/** Returns true if the given code is one of the 11 smb_crm.* codes. */
export function isSmbCrmPermissionCode(code: string): code is SmbCrmPermissionCode {
  return (SMB_CRM_PERMISSION_CODES as readonly string[]).includes(code);
}
