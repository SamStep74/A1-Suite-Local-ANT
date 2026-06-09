"use strict";
const crypto = require("node:crypto");

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

function buildDeviceAuth({ db }) {
  return async function deviceAuth(request, reply) {
    const header = request.headers["x-device-token"] || "";
    const tokenHash = hashToken(header);
    if (!tokenHash || tokenHash.length !== 64) {
      const err = new Error("device token required");
      err.statusCode = 401;
      throw err;
    }
    const row = db
      .prepare("SELECT id, org_id, vehicle_id FROM fleet_device_tokens WHERE token_hash = ? AND revoked_at IS NULL")
      .get(tokenHash);
    if (!row) {
      const err = new Error("invalid device token");
      err.statusCode = 401;
      throw err;
    }
    db.prepare("UPDATE fleet_device_tokens SET last_seen_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    request.deviceContext = { tokenId: row.id, orgId: row.org_id, vehicleId: row.vehicle_id };
  };
}

module.exports = { buildDeviceAuth, hashToken };
