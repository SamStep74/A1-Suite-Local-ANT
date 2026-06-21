"use strict";

const AUDIT_READ_ROLES = new Set(["Owner", "Admin", "Auditor"]);

function canReadAudit(role) {
  return AUDIT_READ_ROLES.has(role);
}

async function loadAuditForRole(role, fetchAudit) {
  if (!canReadAudit(role)) return { events: [] };
  return fetchAudit();
}

exports.canReadAudit = canReadAudit;
exports.loadAuditForRole = loadAuditForRole;
