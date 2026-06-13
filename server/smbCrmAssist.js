"use strict";

/**
 * A1 SMB CRM — AI Assist engine (Track 3: M14.11–M14.14).
 *
 * Pattern A: pure functions, no Fastify imports, no `node:sqlite`
 * imports, no `process.env` reads. Every function takes `db` as
 * its first argument; the route layer in `server/app.js` owns the
 * Fastify surface, auth, app-access, validation, idempotency, and
 * audit. Mirrors `server/smbCrmRecords.js`.
 *
 * Three assist flavors + a feedback surface, all backed by the
 * `smb_crm_assist_runs` (audit log of every AI call) and
 * `smb_crm_feedback` (thumbs-up/down per run) tables that the
 * assist worker adds in `server/db.js#ensureSmbCrmAssistSchema`.
 *
 *   salesAssist      → next-best-action for a deal
 *   messageAssist    → drafted outbound message to a customer
 *   customerSummary  → LLM-generated summary of a customer history
 *   recordFeedback   → thumbs-up/down on a previous assist run
 *   listFeedback     → read feedback rows for a run
 *
 * Each assist function:
 *   1. Reads source data from the records tables (customers /
 *      deals / activities) — org-scoped via `inOrg` helper.
 *   2. Builds a (systemPrompt, userPrompt) pair via the matching
 *      `build*Prompt` helper.
 *   3. Calls `provider.generateStructured({...})` and parses the
 *      JSON envelope via the matching `parse*Response` helper.
 *   4. Persists an `smb_crm_assist_runs` audit row carrying the
 *      request, response, provider name, and the evidence envelope
 *      (URL/method/requestHash/responseHash/at). The run row is
 *      the key `feedback` references by id.
 *   5. Returns a camelCase view via the matching `to*View` adapter.
 *
 * Cross-tenant safety: every read+write function takes `orgId` as
 * a positional argument; the route layer MUST scope by `user.org_id`.
 * A foreign `dealId` / `customerId` returns `null` (the engine
 * refuses to assemble a prompt for a row it cannot see), which the
 * route layer turns into 404.
 *
 * The `*View` helpers reshape the snake_case SQLite row to the
 * camelCase JSON the SPA consumes. Mirrors `toCustomerView` in
 * `server/smbCrmRecords.js`.
 */

const crypto = require("node:crypto");

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() { return new Date().toISOString(); }

function safeJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function safeNumber(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

// ─── Errors ──────────────────────────────────────────────────────────────

class AssistError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "AssistError";
    this.code = code;
    this.statusCode = statusCode || 400;
  }
}

class AssistProviderError extends AssistError {
  constructor(message, evidence) {
    super("PROVIDER_FAILED", message || "AI provider call failed", 502);
    this.name = "AssistProviderError";
    this.evidence = evidence || null;
  }
}

class AssistNotFoundError extends AssistError {
  constructor(message) { super("NOT_FOUND", message, 404); this.name = "AssistNotFoundError"; }
}

class AssistOrgMismatchError extends AssistError {
  constructor(message) { super("ORG_MISMATCH", message, 403); this.name = "AssistOrgMismatchError"; }
}

// ─── Org-scope guard ─────────────────────────────────────────────────────

function assertOrgScope(orgId) {
  if (!orgId || typeof orgId !== "string") {
    throw new AssistError("MISSING_ORG_ID", "orgId is required");
  }
}

function inOrg(db, table, orgId, id) {
  if (!id) return null;
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND org_id = ?`)
    .get(id, orgId);
  return row || null;
}

function nonEmptyString(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new AssistError("MISSING_FIELD", `${field} is required`);
  }
  return String(value).trim();
}

// ─── Source-row loaders ──────────────────────────────────────────────────

const CHANNELS = ["whatsapp", "email", "sms", "phone", "telegram", "viber"];
const INTENTS  = ["follow-up", "reminder", "thank-you", "intro", "win-back", "quote", "check-in", "support"];
const RISK_LEVELS = ["low", "medium", "high"];

function loadCustomer(db, orgId, customerId) {
  return inOrg(db, "smb_crm_customers", orgId, customerId);
}

function loadDeal(db, orgId, dealId) {
  return inOrg(db, "smb_crm_deals", orgId, dealId);
}

function loadRecentActivities(db, orgId, dealId, customerId, limit) {
  const lim = Math.max(1, Math.min(20, Number(limit) || 5));
  if (dealId) {
    return db.prepare(`
      SELECT id, type, subject, body, customer_id, deal_id, activity_at
        FROM smb_crm_activities
       WHERE org_id = ? AND deal_id = ?
       ORDER BY activity_at DESC
       LIMIT ?
    `).all(orgId, dealId, lim);
  }
  if (customerId) {
    return db.prepare(`
      SELECT id, type, subject, body, customer_id, deal_id, activity_at
        FROM smb_crm_activities
       WHERE org_id = ? AND customer_id = ?
       ORDER BY activity_at DESC
       LIMIT ?
    `).all(orgId, customerId, lim);
  }
  return [];
}

function loadDealsForCustomer(db, orgId, customerId) {
  return db.prepare(`
    SELECT id, title, value, currency, stage_id, status, expected_close_date
      FROM smb_crm_deals
     WHERE org_id = ? AND customer_id = ?
     ORDER BY updated_at DESC
     LIMIT 25
  `).all(orgId, customerId);
}

function loadNotesForCustomer(db, orgId, customerId) {
  // Activities of type "note" act as the customer's note log.
  return db.prepare(`
    SELECT id, subject, body, activity_at
      FROM smb_crm_activities
     WHERE org_id = ? AND customer_id = ? AND type = 'note'
     ORDER BY activity_at DESC
     LIMIT 25
  `).all(orgId, customerId);
}

function lastContactAt(activities) {
  if (!activities || activities.length === 0) return null;
  return activities[0].activity_at || null;
}

// ─── Prompt builders ─────────────────────────────────────────────────────

/**
 * Sales-assist: next-best-action for a deal.
 *
 * The system prompt carries the JSON schema (response_format is
 * `json_object`, not `json_schema`, so we cannot use a structured
 * schema hint). The user prompt carries the deal + customer +
 * recent activity context.
 */
function buildSalesAssistPrompt(deal, customer, recentActivities) {
  const d = deal || {};
  const c = customer || {};
  const acts = Array.isArray(recentActivities) ? recentActivities : [];

  const systemPrompt = [
    "You are a sales coach for Armenian SMB CRM users.",
    "Given a deal, a customer profile, and the most recent activity log, return a JSON object with the EXACT shape:",
    JSON.stringify({
      suggestedAction: "<short imperative sentence — what the rep should do next>",
      reasoning: "<1–3 sentences citing specific deal/customer/activity facts>",
      confidence: 0.0,
      sourceRecords: [
        { type: "deal|customer|activity", id: "<string>", label: "<human readable reference>" }
      ],
      riskLevel: "low|medium|high"
    }),
    "Confidence MUST be a number between 0 and 1.",
    "RiskLevel MUST be one of low|medium|high.",
    "Cite at least one sourceRecord from the deal or activity log.",
    "Return ONLY the JSON object. No commentary."
  ].join("\n");

  const userPrompt = JSON.stringify({
    deal: {
      id: d.id || null,
      title: d.title || null,
      value: safeNumber(d.value, 0),
      currency: d.currency || "AMD",
      stageId: d.stage_id || d.stageId || null,
      probability: safeNumber(d.probability, 0),
      expectedCloseDate: d.expected_close_date || d.expectedCloseDate || null,
      status: d.status || "open"
    },
    customer: {
      id: c.id || null,
      fullName: c.full_name || c.fullName || null,
      email: c.email || null,
      phone: c.phone || null,
      companyName: c.company_name || c.companyName || null,
      status: c.status || "active",
      locale: c.locale || "en"
    },
    recentActivities: acts.map(a => ({
      id: a.id,
      type: a.type,
      subject: a.subject || null,
      body: a.body || null,
      activityAt: a.activity_at || a.activityAt || null
    }))
  }, null, 2);

  return { systemPrompt, userPrompt };
}

function parseSalesAssistResponse(rawJson) {
  const obj = (rawJson && typeof rawJson === "object") ? rawJson : {};
  const suggestedAction = String(obj.suggestedAction || "").trim() || "Follow up with the customer to keep the deal moving.";
  const reasoning = String(obj.reasoning || "").trim();
  const confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0));
  const riskLevel = RISK_LEVELS.includes(obj.riskLevel) ? obj.riskLevel : "medium";
  const sourceRecords = Array.isArray(obj.sourceRecords) ? obj.sourceRecords.map(s => ({
    type: ["deal", "customer", "activity"].includes(s.type) ? s.type : "deal",
    id: String(s.id || "").trim(),
    label: String(s.label || "").trim()
  })).filter(s => s.id) : [];
  return { suggestedAction, reasoning, confidence, sourceRecords, riskLevel };
}

/**
 * Message-assist: draft an outbound message to a customer on a
 * given channel, with an intent (follow-up, thank-you, etc).
 */
function buildMessageAssistPrompt(customer, channel, intent, history) {
  const c = customer || {};
  const hist = Array.isArray(history) ? history : [];
  const ch = CHANNELS.includes(channel) ? channel : "email";
  const it = INTENTS.includes(intent) ? intent : "follow-up";

  const systemPrompt = [
    "You are a copywriting assistant for Armenian SMB CRM users.",
    "Given a customer profile, a target channel, an intent, and the most recent message history, draft a short message.",
    "Return a JSON object with the EXACT shape:",
    JSON.stringify({
      body: "<the message body, in the customer's preferred locale>",
      channel: "whatsapp|email|sms|phone|telegram|viber",
      language: "hy|en|ru",
      followups: [
        "<optional shorter variant for SMS>",
        "<optional alternative opening line>"
      ]
    }),
    "Keep the body under 320 characters for SMS/WhatsApp, 1200 characters for email.",
    "For 'whatsapp' / 'sms', write like a real human (no greeting formality, no signature).",
    "For 'email', include a short subject line in the body preceded by 'Subject: ' on the first line.",
    "Return ONLY the JSON object. No commentary."
  ].join("\n");

  const userPrompt = JSON.stringify({
    channel: ch,
    intent: it,
    customer: {
      fullName: c.full_name || c.fullName || null,
      companyName: c.company_name || c.companyName || null,
      locale: c.locale || "en"
    },
    history: hist.slice(0, 8).map(h => ({
      channel: h.channel || null,
      direction: h.direction || "outbound",
      body: h.body || null,
      sentAt: h.sent_at || h.sentAt || null
    }))
  }, null, 2);

  return { systemPrompt, userPrompt };
}

function parseMessageAssistResponse(rawJson, channel) {
  const obj = (rawJson && typeof rawJson === "object") ? rawJson : {};
  const ch = CHANNELS.includes(obj.channel) ? obj.channel : (CHANNELS.includes(channel) ? channel : "email");
  const body = String(obj.body || "").trim() || "Hello — just checking in. Let me know if you have any questions.";
  const language = ["hy", "en", "ru"].includes(obj.language) ? obj.language : "en";
  const followups = Array.isArray(obj.followups) ? obj.followups.map(s => String(s || "").trim()).filter(Boolean) : [];
  return { body, channel: ch, language, followups };
}

/**
 * Customer-summary: a short, structured summary of a customer's
 * full history. The user prompt carries the customer + deals +
 * activities + notes; the system prompt carries the JSON shape.
 */
function buildCustomerSummaryPrompt(customer, deals, activities, notes) {
  const c = customer || {};
  const ds = Array.isArray(deals) ? deals : [];
  const acts = Array.isArray(activities) ? activities : [];
  const ns = Array.isArray(notes) ? notes : [];

  const systemPrompt = [
    "You are a customer-360 summarizer for Armenian SMB CRM users.",
    "Given a customer profile, recent deals, recent activities, and notes, write a concise summary.",
    "Return a JSON object with the EXACT shape:",
    JSON.stringify({
      summaryText: "<2–4 sentences, plain prose>",
      keyInsights: [
        "<one-line observation 1>",
        "<one-line observation 2>"
      ]
    }),
    "summaryText MUST reference specific facts (deal titles, activity types, dates) from the input — no generic filler.",
    "keyInsights MUST be 2–5 short bullets.",
    "Return ONLY the JSON object. No commentary."
  ].join("\n");

  const userPrompt = JSON.stringify({
    customer: {
      id: c.id || null,
      fullName: c.full_name || c.fullName || null,
      email: c.email || null,
      phone: c.phone || null,
      companyName: c.company_name || c.companyName || null,
      status: c.status || "active",
      locale: c.locale || "en"
    },
    deals: ds.map(d => ({
      id: d.id,
      title: d.title,
      value: safeNumber(d.value, 0),
      currency: d.currency || "AMD",
      stageId: d.stage_id || d.stageId || null,
      status: d.status || "open",
      expectedCloseDate: d.expected_close_date || d.expectedCloseDate || null
    })),
    activities: acts.map(a => ({
      id: a.id,
      type: a.type,
      subject: a.subject || null,
      body: a.body || null,
      activityAt: a.activity_at || a.activityAt || null
    })),
    notes: ns.map(n => ({
      id: n.id,
      subject: n.subject || null,
      body: n.body || null,
      activityAt: n.activity_at || n.activityAt || null
    }))
  }, null, 2);

  return { systemPrompt, userPrompt };
}

function parseCustomerSummaryResponse(rawJson) {
  const obj = (rawJson && typeof rawJson === "object") ? rawJson : {};
  const summaryText = String(obj.summaryText || "").trim() ||
    "No recent activity on file. Reach out to keep the relationship warm.";
  const keyInsights = Array.isArray(obj.keyInsights)
    ? obj.keyInsights.map(s => String(s || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  return { summaryText, keyInsights };
}

// ─── Provider call wrapper ───────────────────────────────────────────────

function callProvider(provider, systemPrompt, userPrompt) {
  if (!provider || typeof provider.generateStructured !== "function") {
    throw new AssistProviderError("Provider missing or not generateStructured-capable", null);
  }
  return provider.generateStructured({ systemPrompt, userPrompt });
}

function extractProviderResult(res) {
  // The smbCrmAiProvider envelope is { ok, data, warnings, evidence }.
  // A non-ok envelope means the AI failed (offline / parse error).
  if (!res || res.ok !== true) {
    const warnings = (res && Array.isArray(res.warnings)) ? res.warnings : ["AI provider unavailable"];
    return { ok: false, data: null, warnings, evidence: (res && res.evidence) || null };
  }
  return { ok: true, data: res.data, warnings: res.warnings || [], evidence: res.evidence || null };
}

// ─── Run-row persistence ─────────────────────────────────────────────────

function persistAssistRun(db, orgId, runType, entityId, request, response, parsed, provider, evidence, createdBy) {
  const id = randomId("asrun");
  const now = nowIso();
  const warnings = (response && response.warnings) || [];
  db.prepare(`
    INSERT INTO smb_crm_assist_runs (
      id, org_id, run_type, entity_id, request_json, response_json,
      parsed_json, provider, evidence_json, warnings_json,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, runType, entityId || null,
    JSON.stringify(request || {}),
    JSON.stringify(response || {}),
    JSON.stringify(parsed || {}),
    provider || "unknown",
    evidence ? JSON.stringify(evidence) : null,
    JSON.stringify(warnings),
    createdBy || null,
    now
  );
  return getAssistRun(db, orgId, id);
}

function getAssistRun(db, orgId, runId) {
  return inOrg(db, "smb_crm_assist_runs", orgId, runId);
}

function listAssistRuns(db, orgId, filters) {
  filters = filters || {};
  const where = ["org_id = ?"];
  const params = [orgId];
  if (filters.runType) { where.push("run_type = ?"); params.push(String(filters.runType).trim()); }
  if (filters.entityId) { where.push("entity_id = ?"); params.push(String(filters.entityId).trim()); }
  return db.prepare(`
    SELECT * FROM smb_crm_assist_runs
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Number(filters.limit) || 100)));
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC FUNCTIONS
// ════════════════════════════════════════════════════════════════════════

/**
 * Sales-assist: next-best-action for a deal.
 *
 *   salesAssist(db, orgId, dealId, customerId, provider, { createdBy }?)
 *   → { run, suggestedAction, reasoning, confidence, sourceRecords, riskLevel, warnings }
 */
async function salesAssist(db, orgId, dealId, customerId, provider, opts) {
  assertOrgScope(orgId);
  if (!provider) throw new AssistError("MISSING_PROVIDER", "provider is required");
  const deal = loadDeal(db, orgId, dealId);
  if (!deal) throw new AssistNotFoundError(`deal ${dealId} not found`);
  // customerId is optional; if supplied, must be in the same org.
  let customer = null;
  if (customerId) {
    customer = loadCustomer(db, orgId, customerId);
    if (!customer) throw new AssistNotFoundError(`customer ${customerId} not found`);
  }
  // Prefer activities for the deal; fall back to customer.
  const recent = loadRecentActivities(db, orgId, dealId, customerId, 5);
  const prompts = buildSalesAssistPrompt(deal, customer, recent);
  const t0 = Date.now();
  const raw = await callProvider(provider, prompts.systemPrompt, prompts.userPrompt);
  const t1 = Date.now();
  const result = extractProviderResult(raw);
  if (!result.ok) {
    // Persist the failed call (audit hook) but throw so the route
    // layer can decide whether to 502 or surface a soft warning.
    const failParsed = { suggestedAction: "", reasoning: "", confidence: 0, sourceRecords: [], riskLevel: "medium" };
    persistAssistRun(db, orgId, "sales-assist", dealId,
      { dealId, customerId, latencyMs: t1 - t0 },
      { ok: false, warnings: result.warnings, evidence: result.evidence },
      failParsed, provider && provider.name, result.evidence,
      (opts && opts.createdBy) || null);
    throw new AssistProviderError(result.warnings[0] || "AI provider failed", result.evidence);
  }
  const parsed = parseSalesAssistResponse(result.data);
  const run = persistAssistRun(db, orgId, "sales-assist", dealId,
    { dealId, customerId, latencyMs: t1 - t0 },
    { ok: true, data: result.data, warnings: result.warnings, evidence: result.evidence },
    parsed, provider && provider.name, result.evidence,
    (opts && opts.createdBy) || null);
  return {
    run: toAssistRunView(run),
    suggestedAction: parsed.suggestedAction,
    reasoning: parsed.reasoning,
    confidence: parsed.confidence,
    sourceRecords: parsed.sourceRecords,
    riskLevel: parsed.riskLevel,
    warnings: result.warnings
  };
}

/**
 * Message-assist: draft an outbound message to a customer.
 *
 *   messageAssist(db, orgId, customerId, channel, intent, provider, { history?, createdBy? }?)
 *   → { run, body, channel, language, followups, warnings }
 */
async function messageAssist(db, orgId, customerId, channel, intent, provider, opts) {
  assertOrgScope(orgId);
  if (!provider) throw new AssistError("MISSING_PROVIDER", "provider is required");
  const ch = String(channel || "").trim().toLowerCase();
  if (!CHANNELS.includes(ch)) {
    throw new AssistError("INVALID_CHANNEL", `channel must be one of ${CHANNELS.join("|")}`);
  }
  const it = String(intent || "").trim().toLowerCase();
  if (!INTENTS.includes(it)) {
    throw new AssistError("INVALID_INTENT", `intent must be one of ${INTENTS.join("|")}`);
  }
  const customer = loadCustomer(db, orgId, customerId);
  if (!customer) throw new AssistNotFoundError(`customer ${customerId} not found`);
  const history = (opts && Array.isArray(opts.history)) ? opts.history : [];
  const prompts = buildMessageAssistPrompt(customer, ch, it, history);
  const t0 = Date.now();
  const raw = await callProvider(provider, prompts.systemPrompt, prompts.userPrompt);
  const t1 = Date.now();
  const result = extractProviderResult(raw);
  if (!result.ok) {
    const failParsed = { body: "", channel: ch, language: customer.locale || "en", followups: [] };
    persistAssistRun(db, orgId, "message-assist", customerId,
      { customerId, channel: ch, intent: it, latencyMs: t1 - t0 },
      { ok: false, warnings: result.warnings, evidence: result.evidence },
      failParsed, provider && provider.name, result.evidence,
      (opts && opts.createdBy) || null);
    throw new AssistProviderError(result.warnings[0] || "AI provider failed", result.evidence);
  }
  const parsed = parseMessageAssistResponse(result.data, ch);
  const run = persistAssistRun(db, orgId, "message-assist", customerId,
    { customerId, channel: ch, intent: it, latencyMs: t1 - t0 },
    { ok: true, data: result.data, warnings: result.warnings, evidence: result.evidence },
    parsed, provider && provider.name, result.evidence,
    (opts && opts.createdBy) || null);
  return {
    run: toAssistRunView(run),
    body: parsed.body,
    channel: parsed.channel,
    language: parsed.language,
    followups: parsed.followups,
    warnings: result.warnings
  };
}

/**
 * Customer-summary: LLM-generated summary of a customer's history.
 *
 *   customerSummary(db, orgId, customerId, provider, { createdBy? }?)
 *   → { run, summaryText, keyInsights, lastContactAt, warnings }
 */
async function customerSummary(db, orgId, customerId, provider, opts) {
  assertOrgScope(orgId);
  if (!provider) throw new AssistError("MISSING_PROVIDER", "provider is required");
  const customer = loadCustomer(db, orgId, customerId);
  if (!customer) throw new AssistNotFoundError(`customer ${customerId} not found`);
  const deals = loadDealsForCustomer(db, orgId, customerId);
  const activities = loadRecentActivities(db, orgId, null, customerId, 10);
  const notes = loadNotesForCustomer(db, orgId, customerId);
  const prompts = buildCustomerSummaryPrompt(customer, deals, activities, notes);
  const t0 = Date.now();
  const raw = await callProvider(provider, prompts.systemPrompt, prompts.userPrompt);
  const t1 = Date.now();
  const result = extractProviderResult(raw);
  if (!result.ok) {
    const failParsed = { summaryText: "", keyInsights: [] };
    persistAssistRun(db, orgId, "customer-summary", customerId,
      { customerId, latencyMs: t1 - t0 },
      { ok: false, warnings: result.warnings, evidence: result.evidence },
      failParsed, provider && provider.name, result.evidence,
      (opts && opts.createdBy) || null);
    throw new AssistProviderError(result.warnings[0] || "AI provider failed", result.evidence);
  }
  const parsed = parseCustomerSummaryResponse(result.data);
  const run = persistAssistRun(db, orgId, "customer-summary", customerId,
    { customerId, latencyMs: t1 - t0 },
    { ok: true, data: result.data, warnings: result.warnings, evidence: result.evidence },
    parsed, provider && provider.name, result.evidence,
    (opts && opts.createdBy) || null);
  return {
    run: toAssistRunView(run),
    summaryText: parsed.summaryText,
    keyInsights: parsed.keyInsights,
    lastContactAt: lastContactAt(activities),
    warnings: result.warnings
  };
}

/**
 * Feedback: thumbs-up/down on a previous assist run.
 * Always scoped to the org; a foreign runId is rejected with
 * AssistNotFoundError so the caller cannot learn whether the run
 * exists in another org.
 */
function recordFeedback(db, orgId, runId, userId, rating, comment) {
  assertOrgScope(orgId);
  nonEmptyString(runId, "runId");
  nonEmptyString(userId, "userId");
  const r = String(rating || "").trim().toLowerCase();
  if (!["up", "down"].includes(r)) {
    throw new AssistError("INVALID_RATING", `rating must be "up" or "down"`);
  }
  const run = inOrg(db, "smb_crm_assist_runs", orgId, runId);
  if (!run) throw new AssistNotFoundError(`assist run ${runId} not found`);
  const id = randomId("asfb");
  const now = nowIso();
  const safeComment = (comment === null || comment === undefined) ? null : String(comment);
  db.prepare(`
    INSERT INTO smb_crm_feedback (
      id, org_id, run_id, user_id, rating, comment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, runId, userId, r, safeComment, now);
  return toFeedbackView(getFeedback(db, orgId, id));
}

function getFeedback(db, orgId, feedbackId) {
  return inOrg(db, "smb_crm_feedback", orgId, feedbackId);
}

function listFeedback(db, orgId, runId) {
  assertOrgScope(orgId);
  nonEmptyString(runId, "runId");
  // Org-scope guard: refuse if the run itself isn't in this org.
  const run = inOrg(db, "smb_crm_assist_runs", orgId, runId);
  if (!run) throw new AssistNotFoundError(`assist run ${runId} not found`);
  return db.prepare(`
    SELECT * FROM smb_crm_feedback
     WHERE org_id = ? AND run_id = ?
     ORDER BY created_at DESC
  `).all(orgId, runId).map(toFeedbackView);
}

// ─── View adapters ───────────────────────────────────────────────────────

function toAssistRunView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    runType: row.run_type,
    entityId: row.entity_id || null,
    request: safeJson(row.request_json, {}),
    response: safeJson(row.response_json, {}),
    parsed: safeJson(row.parsed_json, {}),
    provider: row.provider || null,
    evidence: safeJson(row.evidence_json, null),
    warnings: safeJson(row.warnings_json, []),
    createdBy: row.created_by || null,
    createdAt: row.created_at
  };
}

function toFeedbackView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    userId: row.user_id,
    rating: row.rating,
    comment: row.comment || null,
    createdAt: row.created_at
  };
}

module.exports = {
  // errors
  AssistError,
  AssistProviderError,
  AssistNotFoundError,
  AssistOrgMismatchError,
  // prompt builders
  buildSalesAssistPrompt,
  buildMessageAssistPrompt,
  buildCustomerSummaryPrompt,
  // response parsers
  parseSalesAssistResponse,
  parseMessageAssistResponse,
  parseCustomerSummaryResponse,
  // entry points
  salesAssist,
  messageAssist,
  customerSummary,
  recordFeedback,
  listFeedback,
  // run + feedback queries (used by routes and tests)
  getAssistRun,
  listAssistRuns,
  getFeedback,
  // view adapters
  toAssistRunView,
  toFeedbackView,
  // exposed enums (route layer + Zod use these)
  CHANNELS,
  INTENTS,
  RISK_LEVELS
};
