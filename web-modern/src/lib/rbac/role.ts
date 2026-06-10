/**
 * Typed port of web/src/audit-access.js (12 lines, no types).
 *
 * RBAC role checks — used in Topbar to gate "Owner / Admin" UI, in the
 * Audit & Governance Drawer, and in server-side route guards.
 * The legacy app uses string `role`; we keep the string for backend
 * compatibility but type it on the client.
 *
 * Audit-read roles: Owner, Admin, Auditor (legacy: web/src/audit-access.js:2).
 */

export const AUDIT_ROLES = ["Owner", "Admin", "Auditor", "Manager", "Member", "Viewer"] as const;
export type AuditRole = (typeof AUDIT_ROLES)[number];

export const AUDIT_READ_ROLES: readonly AuditRole[] = ["Owner", "Admin", "Auditor"] as const;

const ROLE_RANK: Record<AuditRole, number> = {
  Owner: 100,
  Admin: 80,
  Auditor: 70,
  Manager: 60,
  Member: 30,
  Viewer: 10,
};

export function canReadAudit(role: string | null | undefined): boolean {
  if (!role) return false;
  return (AUDIT_READ_ROLES as readonly string[]).includes(role);
}

export async function loadAuditForRole<T>(
  role: string | null | undefined,
  fetchAudit: () => Promise<T>,
): Promise<T | { events: [] }> {
  if (!canReadAudit(role)) return { events: [] };
  return fetchAudit();
}

export function hasAtLeast(role: string | undefined, required: AuditRole): boolean {
  const r = (role ?? "") as AuditRole;
  return (ROLE_RANK[r] ?? 0) >= ROLE_RANK[required];
}

export function isStaffOrAbove(role: string | undefined): boolean {
  return hasAtLeast(role, "Member");
}
