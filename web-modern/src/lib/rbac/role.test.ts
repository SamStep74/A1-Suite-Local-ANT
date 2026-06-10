/**
 * role.ts — RBAC role checks used in Topbar, Audit & Governance drawer,
 * and server-side route guards.
 *
 * Role hierarchy (from ROLE_RANK):
 *   Owner 100  >  Admin 80  >  Auditor 70  >  Manager 60  >  Member 30  >  Viewer 10
 *
 * Audit-read roles: Owner, Admin, Auditor (legacy: web/src/audit-access.js).
 */
import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_READ_ROLES,
  AUDIT_ROLES,
  canReadAudit,
  hasAtLeast,
  isStaffOrAbove,
  loadAuditForRole,
} from "./role";

describe("AUDIT_ROLES", () => {
  it("lists every known role in highest-to-lowest rank order", () => {
    expect(AUDIT_ROLES).toEqual([
      "Owner",
      "Admin",
      "Auditor",
      "Manager",
      "Member",
      "Viewer",
    ]);
  });

  it("is a readonly tuple (frozen by `as const`)", () => {
    // Mutating should fail at compile time; runtime check is best-effort.
    expect(Array.isArray(AUDIT_ROLES)).toBe(true);
  });
});

describe("AUDIT_READ_ROLES", () => {
  it("contains exactly Owner, Admin, Auditor (in that order)", () => {
    expect([...AUDIT_READ_ROLES]).toEqual(["Owner", "Admin", "Auditor"]);
  });

  it("is a subset of AUDIT_ROLES", () => {
    for (const role of AUDIT_READ_ROLES) {
      expect(AUDIT_ROLES).toContain(role);
    }
  });
});

describe("canReadAudit", () => {
  it("returns true for Owner / Admin / Auditor", () => {
    expect(canReadAudit("Owner")).toBe(true);
    expect(canReadAudit("Admin")).toBe(true);
    expect(canReadAudit("Auditor")).toBe(true);
  });

  it("returns false for the lower tier (Manager / Member / Viewer)", () => {
    expect(canReadAudit("Manager")).toBe(false);
    expect(canReadAudit("Member")).toBe(false);
    expect(canReadAudit("Viewer")).toBe(false);
  });

  it("denies by default — null / undefined / empty string", () => {
    expect(canReadAudit(null)).toBe(false);
    expect(canReadAudit(undefined)).toBe(false);
    expect(canReadAudit("")).toBe(false);
  });

  it("denies unknown role strings (defense in depth against typos)", () => {
    expect(canReadAudit("superuser")).toBe(false);
    expect(canReadAudit("owner")).toBe(false); // case-sensitive
    expect(canReadAudit("OWNER")).toBe(false);
    expect(canReadAudit("Admin ")).toBe(false); // trailing space
  });
});

describe("loadAuditForRole", () => {
  it("calls the fetcher and returns its result when the role can read", async () => {
    const fetchAudit = vi.fn(async () => ({ events: [{ id: "1" }] }));
    const out = await loadAuditForRole("Owner", fetchAudit);
    expect(fetchAudit).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ events: [{ id: "1" }] });
  });

  it("works for Admin and Auditor too", async () => {
    const fetchAudit = vi.fn(async () => ({ events: [] }));
    await loadAuditForRole("Admin", fetchAudit);
    await loadAuditForRole("Auditor", fetchAudit);
    expect(fetchAudit).toHaveBeenCalledTimes(2);
  });

  it("returns { events: [] } and does NOT call the fetcher when role cannot read", async () => {
    const fetchAudit = vi.fn(async () => ({ events: [{ id: "1" }] }));
    const out = await loadAuditForRole("Viewer", fetchAudit);
    expect(fetchAudit).not.toHaveBeenCalled();
    expect(out).toEqual({ events: [] });
  });

  it("returns { events: [] } for null / undefined role without calling fetcher", async () => {
    const fetchAudit = vi.fn();
    expect(await loadAuditForRole(null, fetchAudit)).toEqual({ events: [] });
    expect(await loadAuditForRole(undefined, fetchAudit)).toEqual({ events: [] });
    expect(fetchAudit).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by the fetcher (caller decides what to do)", async () => {
    const fetchAudit = vi.fn(async () => {
      throw new Error("upstream down");
    });
    await expect(loadAuditForRole("Owner", fetchAudit)).rejects.toThrow(
      "upstream down",
    );
  });
});

describe("hasAtLeast — role hierarchy", () => {
  it("a role is always >= itself", () => {
    for (const role of AUDIT_ROLES) {
      expect(hasAtLeast(role, role)).toBe(true);
    }
  });

  it("Owner (rank 100) is >= every required level", () => {
    for (const required of AUDIT_ROLES) {
      expect(hasAtLeast("Owner", required)).toBe(true);
    }
  });

  it("Viewer (rank 10) is only >= Viewer, not any higher tier", () => {
    expect(hasAtLeast("Viewer", "Viewer")).toBe(true);
    expect(hasAtLeast("Viewer", "Member")).toBe(false);
    expect(hasAtLeast("Viewer", "Manager")).toBe(false);
    expect(hasAtLeast("Viewer", "Auditor")).toBe(false);
    expect(hasAtLeast("Viewer", "Admin")).toBe(false);
    expect(hasAtLeast("Viewer", "Owner")).toBe(false);
  });

  it("Manager (rank 60) is >= Manager/Member/Viewer but not Auditor/Admin/Owner", () => {
    expect(hasAtLeast("Manager", "Manager")).toBe(true);
    expect(hasAtLeast("Manager", "Member")).toBe(true);
    expect(hasAtLeast("Manager", "Viewer")).toBe(true);
    expect(hasAtLeast("Manager", "Auditor")).toBe(false);
    expect(hasAtLeast("Manager", "Admin")).toBe(false);
    expect(hasAtLeast("Manager", "Owner")).toBe(false);
  });

  it("Admin (rank 80) is >= Admin/Auditor/Manager/Member/Viewer but not Owner", () => {
    const lower: Array<typeof AUDIT_ROLES[number]> = [
      "Admin",
      "Auditor",
      "Manager",
      "Member",
      "Viewer",
    ];
    for (const required of lower) {
      expect(hasAtLeast("Admin", required)).toBe(true);
    }
    expect(hasAtLeast("Admin", "Owner")).toBe(false);
  });

  it("Member (rank 30) is NOT >= Manager despite being above it on the org chart", () => {
    // Documents the actual rank gap (30 -> 60); Manager is *not* a tier above Member.
    expect(hasAtLeast("Member", "Manager")).toBe(false);
    expect(hasAtLeast("Member", "Member")).toBe(true);
    expect(hasAtLeast("Member", "Viewer")).toBe(true);
  });

  it("undefined role ranks below every required level (rank 0)", () => {
    for (const required of AUDIT_ROLES) {
      expect(hasAtLeast(undefined, required)).toBe(false);
    }
  });

  it("unknown role string ranks below every required level (rank 0)", () => {
    for (const required of AUDIT_ROLES) {
      expect(hasAtLeast("Superuser", required)).toBe(false);
      expect(hasAtLeast("owner", required)).toBe(false); // case-sensitive
    }
  });
});

describe("isStaffOrAbove", () => {
  it("is true for Member and the four higher tiers", () => {
    expect(isStaffOrAbove("Member")).toBe(true);
    expect(isStaffOrAbove("Manager")).toBe(true);
    expect(isStaffOrAbove("Auditor")).toBe(true);
    expect(isStaffOrAbove("Admin")).toBe(true);
    expect(isStaffOrAbove("Owner")).toBe(true);
  });

  it("is false for Viewer (the only role below 'Member')", () => {
    expect(isStaffOrAbove("Viewer")).toBe(false);
  });

  it("is false for undefined / unknown role (rank 0 < Member rank 30)", () => {
    expect(isStaffOrAbove(undefined)).toBe(false);
    expect(isStaffOrAbove("Superuser")).toBe(false);
    expect(isStaffOrAbove("")).toBe(false);
  });
});
