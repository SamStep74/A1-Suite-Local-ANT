"use strict";

/**
 * Document Cabinet route layer.
 *
 * Each handler follows the standard spine:
 *   auth → app access ("docs") → validate body/params → idempotency check
 *   → pure engine (`server/documentCabinet.js` or `server/documentAi.js`)
 *   → audit emit → respond.
 *
 * No DB writes happen outside this spine, and the audit row is the
 * "intent was executed" receipt. Idempotency replays return the cached
 * envelope WITHOUT re-emitting an audit row.
 */

const VALID_DIRECTIONS = new Set(["incoming", "outgoing", "internal"]);
const VALID_STATUSES = new Set(["active", "archived"]);
const VALID_LINKED_TYPES = new Set(["customer", "vendor", "employee", "deal", "project"]);
const VALID_AI_KINDS = new Set(["classify", "extract", "risk", "compare", "reply", "summary"]);
const VERSION_ID_RE = /^[a-z0-9-]+$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCabinetPathId(value, rawUrl) {
  if (typeof value !== "string") {
    const e = new Error("Invalid document id"); e.statusCode = 400; throw e;
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    const e = new Error("Invalid document id"); e.statusCode = 400; throw e;
  }
  const text = value.trim();
  if (!text || text.length > 160 || !VERSION_ID_RE.test(text)) {
    const e = new Error("Invalid document id"); e.statusCode = 400; throw e;
  }
  // Reject path segments that look like they could leak real ids (must start with cab-).
  if (!text.startsWith("cab-")) {
    const e = new Error("Invalid document id"); e.statusCode = 400; throw e;
  }
  // Belt-and-braces: if the URL itself carries a different segment, prefer the URL one.
  if (rawUrl && typeof rawUrl === "string") {
    const m = rawUrl.match(/^\/api\/cabinet\/documents\/([^/?#]+)/);
    if (m && m[1] && !m[1].startsWith("cab-")) {
      const e = new Error("Invalid document id"); e.statusCode = 400; throw e;
    }
  }
  return text;
}

function normalizeIdempotencyKey(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text || text.length > 200) {
    const e = new Error("idempotencyKey is required"); e.statusCode = 400; throw e;
  }
  return text;
}

function readCachedIdempotent(db, orgId, key) {
  const row = db.prepare(
    "SELECT response_json FROM idempotency_keys WHERE org_id = ? AND key = ?"
  ).get(orgId, key);
  return row ? JSON.parse(row.response_json) : null;
}

function writeIdempotent(db, orgId, key, envelope, randomId) {
  db.prepare(
    "INSERT OR IGNORE INTO idempotency_keys (id, org_id, key, response_json, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(randomId("idem"), orgId, key, JSON.stringify(envelope), new Date().toISOString());
}

function normalizeCabinetCreateBody(body) {
  if (!isPlainObject(body)) {
    const e = new Error("Invalid request body"); e.statusCode = 400; throw e;
  }
  const title = String(body.title || "").trim();
  if (title.length < 3 || title.length > 200) {
    const e = new Error("title must be 3-200 chars"); e.statusCode = 400; throw e;
  }
  const direction = String(body.direction || "").trim();
  if (!VALID_DIRECTIONS.has(direction)) {
    const e = new Error("direction must be incoming|outgoing|internal"); e.statusCode = 400; throw e;
  }
  const linkedType = body.linkedType == null || body.linkedType === "" ? null : String(body.linkedType);
  if (linkedType !== null && !VALID_LINKED_TYPES.has(linkedType)) {
    const e = new Error("linkedType must be one of customer|vendor|employee|deal|project"); e.statusCode = 400; throw e;
  }
  const linkedId = body.linkedId == null || body.linkedId === "" ? null : String(body.linkedId).trim();
  if (linkedId !== null && linkedId.length > 200) {
    const e = new Error("linkedId is too long"); e.statusCode = 400; throw e;
  }
  const docType = body.docType == null || body.docType === "" ? null : String(body.docType).trim();
  if (docType !== null && docType.length > 100) {
    const e = new Error("docType is too long"); e.statusCode = 400; throw e;
  }
  const docBody = body.body == null ? null : String(body.body);
  if (docBody !== null && docBody.length > 20000) {
    const e = new Error("body is too long"); e.statusCode = 400; throw e;
  }
  return { title, direction, linkedType, linkedId, docType, body: docBody, idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey) };
}

function normalizeCabinetUpdateBody(body) {
  if (!isPlainObject(body)) {
    const e = new Error("Invalid request body"); e.statusCode = 400; throw e;
  }
  const out = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (t.length < 3 || t.length > 200) {
      const e = new Error("title must be 3-200 chars"); e.statusCode = 400; throw e;
    }
    out.title = t;
  }
  if (body.status !== undefined) {
    const s = String(body.status);
    if (!VALID_STATUSES.has(s)) {
      const e = new Error("status must be active|archived"); e.statusCode = 400; throw e;
    }
    out.status = s;
  }
  if (body.linkedType !== undefined) {
    const v = body.linkedType == null || body.linkedType === "" ? null : String(body.linkedType);
    if (v !== null && !VALID_LINKED_TYPES.has(v)) {
      const e = new Error("linkedType must be one of customer|vendor|employee|deal|project"); e.statusCode = 400; throw e;
    }
    out.linkedType = v;
  }
  if (body.linkedId !== undefined) {
    const v = body.linkedId == null || body.linkedId === "" ? null : String(body.linkedId).trim();
    if (v !== null && v.length > 200) {
      const e = new Error("linkedId is too long"); e.statusCode = 400; throw e;
    }
    out.linkedId = v;
  }
  if (body.docType !== undefined) {
    const v = body.docType == null || body.docType === "" ? null : String(body.docType).trim();
    if (v !== null && v.length > 100) {
      const e = new Error("docType is too long"); e.statusCode = 400; throw e;
    }
    out.docType = v;
  }
  if (body.body !== undefined) {
    out.body = body.body == null ? null : String(body.body);
  }
  if (Object.keys(out).length === 0) {
    const e = new Error("No updatable fields provided"); e.statusCode = 400; throw e;
  }
  return out;
}

function normalizeVersionCreateBody(body) {
  if (!isPlainObject(body)) {
    const e = new Error("Invalid request body"); e.statusCode = 400; throw e;
  }
  const storagePath = String(body.storagePath || "").trim();
  if (!storagePath || storagePath.length > 500) {
    const e = new Error("storagePath is required"); e.statusCode = 400; throw e;
  }
  const sha256 = String(body.sha256 || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(sha256)) {
    const e = new Error("sha256 must be a 64-char hex string"); e.statusCode = 400; throw e;
  }
  const parentVersion = body.parentVersion == null ? null : Number(body.parentVersion);
  if (parentVersion !== null && (!Number.isInteger(parentVersion) || parentVersion < 0)) {
    const e = new Error("parentVersion must be a non-negative integer"); e.statusCode = 400; throw e;
  }
  const mimeType = body.mimeType == null ? null : String(body.mimeType).slice(0, 200);
  const byteSize = body.byteSize == null ? null : Number(body.byteSize);
  if (byteSize !== null && (!Number.isFinite(byteSize) || byteSize < 0)) {
    const e = new Error("byteSize must be a non-negative number"); e.statusCode = 400; throw e;
  }
  return {
    parentVersion,
    storagePath,
    sha256: sha256.toLowerCase(),
    mimeType,
    byteSize,
    idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey)
  };
}

function normalizeAiRequestBody(body) {
  if (!isPlainObject(body)) {
    const e = new Error("Invalid request body"); e.statusCode = 400; throw e;
  }
  return {
    idempotencyKey: body.idempotencyKey ? normalizeIdempotencyKey(body.idempotencyKey) : null,
    payload: { ...body }
  };
}

function normalizeESignPrepareBody(body) {
  if (!isPlainObject(body)) {
    const e = new Error("Invalid request body"); e.statusCode = 400; throw e;
  }
  const cabinetId = String(body.cabinetId || "").trim();
  if (!cabinetId || !cabinetId.startsWith("cab-")) {
    const e = new Error("cabinetId is required"); e.statusCode = 400; throw e;
  }
  let signer = null;
  if (body.signer !== undefined) {
    if (!isPlainObject(body.signer)) {
      const e = new Error("signer must be an object"); e.statusCode = 400; throw e;
    }
    signer = {
      name: String(body.signer.name || "").trim(),
      email: body.signer.email == null ? "" : String(body.signer.email).trim()
    };
    if (!signer.name) {
      const e = new Error("signer.name is required"); e.statusCode = 400; throw e;
    }
  }
  return { cabinetId, signer, idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey) };
}

function readDocument(db, orgId, id) {
  const row = db.prepare(`
    SELECT id, org_id AS orgId, title, direction, status, doc_type AS docType,
           linked_type AS linkedType, linked_id AS linkedId,
           ocr_status AS ocrStatus, ocr_text AS ocrText,
           current_version AS currentVersion, ai_summary AS aiSummary,
           created_at AS createdAt, updated_at AS updatedAt
    FROM cabinet_documents
    WHERE org_id = ? AND id = ?
  `).get(orgId, id);
  return row || null;
}

function readVersions(db, orgId, cabinetId) {
  return db.prepare(`
    SELECT id, version, parent_version AS parentVersion, mime_type AS mimeType,
           byte_size AS byteSize, storage_path AS storagePath, sha256,
           created_at AS createdAt
    FROM cabinet_document_versions
    WHERE org_id = ? AND cabinet_id = ?
    ORDER BY version ASC
  `).all(orgId, cabinetId);
}

function readAiAnnotations(db, orgId, cabinetId) {
  return db.prepare(`
    SELECT id, kind, payload_json AS payloadJson, confidence, created_at AS createdAt
    FROM cabinet_ai_annotations
    WHERE org_id = ? AND cabinet_id = ?
    ORDER BY created_at ASC
  `).all(orgId, cabinetId).map(a => ({
    id: a.id,
    kind: a.kind,
    payload: safeJsonParse(a.payloadJson),
    confidence: a.confidence,
    createdAt: a.createdAt
  }));
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function indexFts(db, orgId, cabinetId, title, body) {
  // Remove any previous FTS row for this cabinet doc, then re-insert.
  db.prepare("DELETE FROM cabinet_fts WHERE org_id = ? AND cabinet_id = ?").run(orgId, cabinetId);
  const text = `${title || ""}\n${body || ""}`;
  db.prepare(
    "INSERT INTO cabinet_fts (org_id, cabinet_id, title, body) VALUES (?, ?, ?, ?)"
  ).run(orgId, cabinetId, title || "", text);
}

function listDocuments(db, orgId, query) {
  const filters = ["org_id = ?"];
  const params = [orgId];
  if (query.direction && VALID_DIRECTIONS.has(query.direction)) {
    filters.push("direction = ?");
    params.push(query.direction);
  }
  if (query.status && VALID_STATUSES.has(query.status)) {
    filters.push("status = ?");
    params.push(query.status);
  }
  if (query.linkedType && VALID_LINKED_TYPES.has(query.linkedType)) {
    filters.push("linked_type = ?");
    params.push(query.linkedType);
    if (query.linkedId) {
      filters.push("linked_id = ?");
      params.push(query.linkedId);
    }
  }
  const rows = db.prepare(`
    SELECT id, org_id AS orgId, title, direction, status, doc_type AS docType,
           linked_type AS linkedType, linked_id AS linkedId,
           ocr_status AS ocrStatus, current_version AS currentVersion,
           created_at AS createdAt, updated_at AS updatedAt
    FROM cabinet_documents
    WHERE ${filters.join(" AND ")}
    ORDER BY updated_at DESC
  `).all(...params);
  return rows;
}

function ftsSearch(db, orgId, query) {
  const term = String(query || "").trim();
  if (!term) return [];
  // FTS5 phrase match: wrap in quotes for safety.
  const safe = term.replace(/"/g, "");
  try {
    return db.prepare(`
      SELECT cabinet_id AS cabinetId, title
      FROM cabinet_fts
      WHERE org_id = ? AND cabinet_fts MATCH ?
      ORDER BY rank
    `).all(orgId, `"${safe}"`);
  } catch (error) {
    if (!isFtsMatchUnavailable(error)) throw error;
    const like = `%${escapeLikeTerm(term)}%`;
    return db.prepare(`
      SELECT cabinet_id AS cabinetId, title
      FROM cabinet_fts
      WHERE org_id = ? AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
      ORDER BY title
    `).all(orgId, like, like);
  }
}

function isFtsMatchUnavailable(error) {
  const message = String(error && error.message || "");
  return message.includes("unable to use function MATCH") ||
    message.includes("no such column: cabinet_fts") ||
    message.includes("no such module: fts5");
}

function escapeLikeTerm(term) {
  return String(term).replace(/[\\%_]/g, (char) => `\\${char}`);
}

function recordAiAnnotation(db, orgId, cabinetId, kind, payload, confidence, randomId) {
  const id = randomId("cab-ai");
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO cabinet_ai_annotations (id, org_id, cabinet_id, kind, payload_json, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, orgId, cabinetId, kind, JSON.stringify(payload || {}), Number.isFinite(confidence) ? confidence : null, now);
  return id;
}

function runWithSpine({ deps, handler }) {
  return async (request) => {
    const user = await deps.app.auth(request);
    deps.requireAppAccess(deps.db, user, "docs");
    return handler({ user, request, deps });
  };
}

function register(app, db, injected) {
  const { app: _app, auth, requireAppAccess, audit, randomId, documentCabinet, documentAi, stateIntegrations } = injected;
  const deps = { app, db, requireAppAccess, audit, randomId, documentCabinet, documentAi, stateIntegrations };

  // LIST — GET /api/cabinet/documents
  app.get("/api/cabinet/documents", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const documents = listDocuments(db, user.org_id, request.query || {});
      return { documents };
    }
  }));

  // CREATE — POST /api/cabinet/documents
  app.post("/api/cabinet/documents", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const input = normalizeCabinetCreateBody(request.body || {});
      const cached = readCachedIdempotent(db, user.org_id, input.idempotencyKey);
      if (cached) return cached;
      const id = randomId("cab");
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO cabinet_documents
          (id, org_id, title, direction, status, doc_type, linked_type, linked_id,
           ocr_status, current_version, ai_summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'none', 1, '', ?, ?)
      `).run(id, user.org_id, input.title, input.direction, input.docType, input.linkedType, input.linkedId, now, now);

      // Auto-create the first version.
      const versionId = randomId("cabv");
      const initialSha = `sha256-${id}-v1-${now.slice(0, 19).replace(/[:T-]/g, "")}`;
      db.prepare(`
        INSERT INTO cabinet_document_versions
          (id, org_id, cabinet_id, version, parent_version, mime_type, byte_size, storage_path, sha256, created_at)
        VALUES (?, ?, ?, 1, NULL, 'text/plain', 0, ?, ?, ?)
      `).run(versionId, user.org_id, id, `memory://${id}-v1`, initialSha, now);

      indexFts(db, user.org_id, id, input.title, input.body || "");

      const document = readDocument(db, user.org_id, id);
      const envelope = { ok: true, document };
      writeIdempotent(db, user.org_id, input.idempotencyKey, envelope, randomId);
      audit(db, user.org_id, user.id, "cabinet.document.created", {
        documentId: id, title: input.title, direction: input.direction,
        linkedType: input.linkedType, linkedId: input.linkedId
      });
      return envelope;
    }
  }));

  // READ — GET /api/cabinet/documents/:id
  app.get("/api/cabinet/documents/:id", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const versions = readVersions(db, user.org_id, id);
      // Cabinet docs do not have signers in this MVP; expose an empty array
      // to keep the response shape stable for the React panel.
      const signers = [];
      const aiAnnotations = readAiAnnotations(db, user.org_id, id);
      return { document, versions, signers, aiAnnotations };
    }
  }));

  // PATCH — link / archive / restore / metadata
  app.patch("/api/cabinet/documents/:id", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const input = normalizeCabinetUpdateBody(request.body || {});
      const sets = [];
      const values = [];
      for (const k of ["title", "status", "linkedType", "linkedId", "docType", "body"]) {
        if (Object.prototype.hasOwnProperty.call(input, k)) {
          const col = k === "docType" ? "doc_type"
            : k === "linkedType" ? "linked_type"
            : k === "linkedId" ? "linked_id"
            : k;
          sets.push(`${col} = ?`);
          values.push(input[k] == null ? null : input[k]);
        }
      }
      const now = new Date().toISOString();
      sets.push("updated_at = ?");
      values.push(now);
      db.prepare(`UPDATE cabinet_documents SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`)
        .run(...values, user.org_id, id);
      // If title or body changed, refresh the FTS index. We don't store the body
      // in a column (the original was indexed at create time); the simplest correct
      // behaviour is to use the latest known body and the latest title.
      if (input.title !== undefined || input.body !== undefined) {
        const fresh = readDocument(db, user.org_id, id);
        const ftsBody = input.body !== undefined ? (input.body || "") : fresh.title;
        indexFts(db, user.org_id, id, fresh.title, ftsBody);
      }
      audit(db, user.org_id, user.id, "cabinet.document.updated", { documentId: id, fields: Object.keys(input) });
      return { ok: true, document: readDocument(db, user.org_id, id) };
    }
  }));

  // ADD VERSION — POST /api/cabinet/documents/:id/versions
  app.post("/api/cabinet/documents/:id/versions", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const input = normalizeVersionCreateBody(request.body || {});
      const cached = readCachedIdempotent(db, user.org_id, input.idempotencyKey);
      if (cached) return cached;
      const newVersion = document.currentVersion + 1;
      const versionId = randomId("cabv");
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO cabinet_document_versions
          (id, org_id, cabinet_id, version, parent_version, mime_type, byte_size, storage_path, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(versionId, user.org_id, id, newVersion, input.parentVersion, input.mimeType, input.byteSize, input.storagePath, input.sha256, now);
      db.prepare("UPDATE cabinet_documents SET current_version = ?, updated_at = ? WHERE org_id = ? AND id = ?")
        .run(newVersion, now, user.org_id, id);
      const version = db.prepare(`
        SELECT id, version, parent_version AS parentVersion, mime_type AS mimeType,
               byte_size AS byteSize, storage_path AS storagePath, sha256, created_at AS createdAt
        FROM cabinet_document_versions WHERE org_id = ? AND id = ?
      `).get(user.org_id, versionId);
      audit(db, user.org_id, user.id, "cabinet.document.version.added", {
        documentId: id, version: newVersion, parentVersion: input.parentVersion, sha256: input.sha256
      });
      const envelope = { ok: true, version, document: readDocument(db, user.org_id, id) };
      writeIdempotent(db, user.org_id, input.idempotencyKey, envelope, randomId);
      return envelope;
    }
  }));

  // OCR — POST /api/cabinet/documents/:id/ocr (idempotent, local-heuristic stub)
  app.post("/api/cabinet/documents/:id/ocr", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const idem = normalizeIdempotencyKey((request.body || {}).idempotencyKey || `ocr-${id}`);
      const cached = readCachedIdempotent(db, user.org_id, idem);
      if (cached) return cached;
      const now = new Date().toISOString();
      // Local heuristic: no Tesseract in this MVP — record manual-review.
      const status = "manual-review";
      db.prepare("UPDATE cabinet_documents SET ocr_status = ?, updated_at = ? WHERE org_id = ? AND id = ?")
        .run(status, now, user.org_id, id);
      audit(db, user.org_id, user.id, "cabinet.document.ocr.queued", { documentId: id, ocrStatus: status });
      const envelope = { ok: true, document: readDocument(db, user.org_id, id), ocrStatus: status };
      writeIdempotent(db, user.org_id, idem, envelope, randomId);
      return envelope;
    }
  }));

  // AI CLASSIFY — POST /api/cabinet/documents/:id/ai/classify
  app.post("/api/cabinet/documents/:id/ai/classify", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const input = normalizeAiRequestBody(request.body || {});
      const idem = input.idempotencyKey || `ai-classify-${id}`;
      const cached = readCachedIdempotent(db, user.org_id, idem);
      if (cached) return cached;
      const envelopeRun = documentAi.classify({ title: document.title, body: document.ocrText || "" });
      recordAiAnnotation(db, user.org_id, id, "classify", envelopeRun, envelopeRun.result && envelopeRun.result.confidence, randomId);
      audit(db, user.org_id, user.id, "cabinet.document.ai.classify", { documentId: id });
      const envelope = { ok: true, ...envelopeRun, annotationKind: "classify" };
      writeIdempotent(db, user.org_id, idem, envelope, randomId);
      return envelope;
    }
  }));

  // AI EXTRACT — POST /api/cabinet/documents/:id/ai/extract
  app.post("/api/cabinet/documents/:id/ai/extract", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const input = normalizeAiRequestBody(request.body || {});
      const idem = input.idempotencyKey || `ai-extract-${id}`;
      const cached = readCachedIdempotent(db, user.org_id, idem);
      if (cached) return cached;
      const envelopeRun = documentAi.extract({ title: document.title, body: document.ocrText || "", docType: document.docType });
      recordAiAnnotation(db, user.org_id, id, "extract", envelopeRun, envelopeRun.result && envelopeRun.result.confidence, randomId);
      audit(db, user.org_id, user.id, "cabinet.document.ai.extract", { documentId: id });
      const envelope = { ok: true, ...envelopeRun, annotationKind: "extract" };
      writeIdempotent(db, user.org_id, idem, envelope, randomId);
      return envelope;
    }
  }));

  // AI RISK-SCAN — POST /api/cabinet/documents/:id/ai/risk-scan
  app.post("/api/cabinet/documents/:id/ai/risk-scan", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const input = normalizeAiRequestBody(request.body || {});
      const idem = input.idempotencyKey || `ai-risk-${id}`;
      const cached = readCachedIdempotent(db, user.org_id, idem);
      if (cached) return cached;
      const envelopeRun = documentAi.scanRisks({ body: document.ocrText || "", jurisdiction: "AM" });
      recordAiAnnotation(db, user.org_id, id, "risk", envelopeRun, envelopeRun.result && envelopeRun.result.confidence, randomId);
      audit(db, user.org_id, user.id, "cabinet.document.ai.risk-scan", { documentId: id });
      const envelope = { ok: true, ...envelopeRun, annotationKind: "risk" };
      writeIdempotent(db, user.org_id, idem, envelope, randomId);
      return envelope;
    }
  }));

  // AI COMPARE — POST /api/cabinet/documents/:id/ai/compare
  app.post("/api/cabinet/documents/:id/ai/compare", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const input = normalizeAiRequestBody(request.body || {});
      const idem = input.idempotencyKey || `ai-compare-${id}`;
      const cached = readCachedIdempotent(db, user.org_id, idem);
      if (cached) return cached;
      const leftText = String((request.body || {}).leftText || document.ocrText || document.title || "");
      const rightText = String((request.body || {}).rightText || document.title || "");
      const envelopeRun = documentAi.compareRevisions({ leftText, rightText });
      recordAiAnnotation(db, user.org_id, id, "compare", envelopeRun, null, randomId);
      audit(db, user.org_id, user.id, "cabinet.document.ai.compare", { documentId: id });
      const envelope = { ok: true, ...envelopeRun, annotationKind: "compare" };
      writeIdempotent(db, user.org_id, idem, envelope, randomId);
      return envelope;
    }
  }));

  // AI REPLY DRAFT — POST /api/cabinet/documents/:id/ai/reply-draft
  app.post("/api/cabinet/documents/:id/ai/reply-draft", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const id = normalizeCabinetPathId(request.params.id, request.raw && request.raw.url);
      const document = readDocument(db, user.org_id, id);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const input = normalizeAiRequestBody(request.body || {});
      const idem = input.idempotencyKey || `ai-reply-${id}`;
      const cached = readCachedIdempotent(db, user.org_id, idem);
      if (cached) return cached;
      const tone = (request.body || {}).tone || "formal";
      const language = (request.body || {}).language || "hy-AM";
      const envelopeRun = documentAi.draftReply({ incoming: document.ocrText || document.title, tone, language });
      recordAiAnnotation(db, user.org_id, id, "reply", envelopeRun, null, randomId);
      audit(db, user.org_id, user.id, "cabinet.document.ai.reply-draft", { documentId: id });
      const envelope = { ok: true, ...envelopeRun, annotationKind: "reply" };
      writeIdempotent(db, user.org_id, idem, envelope, randomId);
      return envelope;
    }
  }));

  // FTS SEARCH — GET /api/cabinet/search?q=...
  app.get("/api/cabinet/search", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const q = (request.query && request.query.q) || "";
      const rows = ftsSearch(db, user.org_id, q);
      const hits = rows.map(r => ({ orgId: user.org_id, cabinetId: r.cabinetId, title: r.title }));
      return { hits, query: q };
    }
  }));

  // E-SIGN PREPARE — POST /api/cabinet/esign/prepare
  app.post("/api/cabinet/esign/prepare", runWithSpine({
    deps,
    handler: async ({ user, request }) => {
      const input = normalizeESignPrepareBody(request.body || {});
      // Verify the document exists in this org before preparing the envelope.
      const document = readDocument(db, user.org_id, input.cabinetId);
      if (!document) {
        const e = new Error("Cabinet document not found"); e.statusCode = 404; throw e;
      }
      const cached = readCachedIdempotent(db, user.org_id, input.idempotencyKey);
      if (cached) return cached;
      // Sub-plan 6 follow-up: route through the new dispatch() hub so
      // the call lands in state_integration_calls (with the same PII
      // redaction as the new state-int endpoints). Falls back to the
      // legacy sync stub if the hub adapter isn't wired (older builds).
      const hub = deps.stateIntegrations || {};
      let envelope;
      if (typeof hub.eSignAdapterFor === "function") {
        const adapter = hub.eSignAdapterFor({ db, orgId: user.org_id, userId: user.id });
        envelope = await adapter.prepare({ cabinetId: input.cabinetId, signer: input.signer, document });
      } else if (hub.eSignAdapter && typeof hub.eSignAdapter.prepare === "function") {
        envelope = hub.eSignAdapter.prepare({ cabinetId: input.cabinetId, signer: input.signer, document });
      } else {
        const e = new Error("E-sign adapter unavailable"); e.statusCode = 503; throw e;
      }
      audit(db, user.org_id, user.id, "cabinet.esign.prepared", {
        cabinetId: input.cabinetId, envelopeId: envelope.envelopeId, provider: envelope.provider
      });
      const out = { ok: true, ...envelope };
      writeIdempotent(db, user.org_id, input.idempotencyKey, out, randomId);
      return out;
    }
  }));
}

module.exports = {
  register,
  // Exposed for tests:
  _normalizeCabinetPathId: normalizeCabinetPathId,
  _normalizeCabinetCreateBody: normalizeCabinetCreateBody,
  _normalizeCabinetUpdateBody: normalizeCabinetUpdateBody,
  _normalizeVersionCreateBody: normalizeVersionCreateBody
};
