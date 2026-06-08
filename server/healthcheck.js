"use strict";

/**
 * Pure engine for the Pattern A healthcheck example.
 *
 * No DB, no Fastify — just a pure function over a string. The route
 * in server/app.js is the only place auth, app access, validation,
 * audit, and idempotency live.
 */
function buildPing({ message, now } = {}) {
  const text = String(message == null ? "" : message).trim();
  if (text.length < 1 || text.length > 200) {
    const err = new Error("message must be 1-200 chars");
    err.statusCode = 400;
    throw err;
  }
  return {
    message: text,
    respondedAt: now || new Date().toISOString()
  };
}

module.exports = { buildPing };
