"use strict";

/**
 * Pure engine for the Document Cabinet (Документооборот).
 *
 * No DB, no Fastify, no egress. Each function is a pure transform over
 * the normalized input and returns a deterministic envelope. The route
 * layer in `server/documentCabinetRoutes.js` is the only place that owns
 * auth, app access, idempotency, persistence, and audit emit.
 *
 * The Armenian + English keyword dictionary is intentionally small and
 * hand-curated: classify / extract / scanRisks must return a useful
 * suggestion even when AI is disabled, so the offline-deterministic path
 * produces something an Armenian operator can review.
 */

const DOC_TYPES = [
  "contract",
  "invoice",
  "act",
  "letter",
  "memo",
  "report",
  "claim",
  "order"
];

const TYPE_KEYWORDS = {
  contract: [
    "պայմանագիր", "պայման", "agreement", "contract", "կողմ", "պարտավորություն"
  ],
  invoice: [
    "ապրանքային հաշիվ", "invoice", "հաշիվ", "վճարման ենթակա", "գումար", "amd"
  ],
  act: [
    "ակտ", "ակտը", "ընդունման ակտ", "act", "կատարման ակտ"
  ],
  letter: [
    "նամակ", "դիմում", "letter", "հարցում", "պատասխան"
  ],
  memo: [
    "ծառայողական նշում", "memo", "հիշեցում", "ներքին գրություն"
  ],
  report: [
    "հաշվետվություն", "report", "ամփոփ", "ամփոփում"
  ],
  claim: [
    "բողոք", "պահանջ", "claim", "complaint", "վերադարձ"
  ],
  order: [
    "հրաման", "որոշում", "order", "directive", "կարգ"
  ]
};

const RISK_PATTERNS = [
  {
    id: "unlimited-liability",
    label: "Unlimited liability clause",
    severity: "high",
    patterns: [
      /անսահմանափակ\s+պատասխանատվություն/i,
      /unlimited\s+liability/i,
      /ամբողջ\s+ունեցվածքով\s+պատասխանատվություն/i
    ]
  },
  {
    id: "unilateral-termination",
    label: "Unilateral termination right",
    severity: "medium",
    patterns: [
      /միակողմանի\s+լուծում/i,
      /unilateral\s+termination/i,
      /միակողմանի\s+խզում/i
    ]
  },
  {
    id: "jurisdiction-waiver",
    label: "Jurisdiction waiver",
    severity: "high",
    patterns: [
      /հայցադիմում\s+չներկայացնել/i,
      /waive\s+jurisdiction/i,
      /լուծել\s+առանց\s+�ատարան/i
    ]
  },
  {
    id: "auto-renewal",
    label: "Auto-renewal without notice",
    severity: "medium",
    patterns: [
      /ինքնաշխատ\s+երկարաձգում/i,
      /automatic\s+renewal/i,
      /ավտոմատ\s+երկարաձգում/i
    ]
  },
  {
    id: "excessive-penalty",
    label: "Excessive penalty / liquidated damages",
    severity: "medium",
    patterns: [
      /տույժ.{0,30}\d+\s*%/i,
      /penalty.{0,30}\d+\s*%/i,
      /փոխհատուցում.{0,30}\d+\s*%/i
    ]
  },
  {
    id: "broad-indemnity",
    label: "Broad indemnity scope",
    severity: "high",
    patterns: [
      /ամբողջական\s+փոխհատուցում/i,
      /hold\s+harmless/i,
      /indemnify\s+from\s+any/i
    ]
  }
];

const ARMENIAN_REPLY_OPENINGS = {
  formal: "Հարգելի գործընկեր,",
  neutral: "Ողջույն,",
  friendly: "Ողջույն,"
};

function normalizeInput(text) {
  return String(text == null ? "" : text).toString();
}

function tokenizeHaystack(input) {
  return normalizeInput(input).toLowerCase();
}

function scoreType(text, keywords) {
  if (!keywords || keywords.length === 0) return 0;
  const haystack = tokenizeHaystack(text);
  let score = 0;
  for (const kw of keywords) {
    if (!kw) continue;
    if (haystack.includes(String(kw).toLowerCase())) score += 1;
  }
  return score;
}

function classifyDocument({ title, body } = {}) {
  const text = [normalizeInput(title), normalizeInput(body)].filter(Boolean).join("\n");
  if (!text.trim()) {
    return {
      suggestedType: "memo",
      confidence: 30,
      reason: "No content; defaulted to memo"
    };
  }
  let bestType = "memo";
  let bestScore = 0;
  const scores = {};
  for (const type of DOC_TYPES) {
    const s = scoreType(text, TYPE_KEYWORDS[type] || []);
    scores[type] = s;
    if (s > bestScore) {
      bestScore = s;
      bestType = type;
    }
  }
  const total = Object.values(scores).reduce((sum, n) => sum + n, 0) || 1;
  const confidence = Math.min(95, Math.round((bestScore / total) * 100) + 40);
  const reason = bestScore > 0
    ? `Matched ${bestScore} keyword(s) for "${bestType}"`
    : "No strong keyword match; defaulted to memo";
  return { suggestedType: bestType, confidence, reason, scores };
}

const AMOUNT_REGEX = /(\d{1,3}(?:[  .,]\d{3})+|\d+)(?:\s*(?:amd|֏|usd|eur|rub|դրամ|dram))?/iu;
const DATE_REGEX = /(\d{4}-\d{2}-\d{2}|\d{2}[./-]\d{2}[./-]\d{4})/u;
const COUNTERPARTY_REGEX = /(?:«[^»]+»|"[^"]+"|«[^»]+»|ռ[^.\n]{2,80})/u;

function extractAttributes({ title, body, docType } = {}) {
  const text = [normalizeInput(title), normalizeInput(body)].filter(Boolean).join("\n");
  const attributes = {};
  const amountMatch = text.match(AMOUNT_REGEX);
  if (amountMatch) {
    const raw = amountMatch[1];
    const cleaned = raw.replace(/[  .,]/g, "");
    const value = Number(cleaned);
    if (Number.isFinite(value) && value > 0) {
      attributes.amount = value;
      const currencyMatch = text.match(/(amd|usd|eur|rub|դրամ|dram|֏)/iu);
      if (currencyMatch) {
        const c = currencyMatch[1].toLowerCase();
        attributes.currency = c === "դրամ" || c === "dram" || c === "֏" ? "AMD" : c.toUpperCase();
      } else {
        attributes.currency = "AMD";
      }
    }
  }
  const dateMatch = text.match(DATE_REGEX);
  if (dateMatch) {
    const raw = dateMatch[1];
    if (raw.includes("-")) {
      attributes.date = raw;
    } else {
      const parts = raw.split(/[./-]/);
      if (parts.length === 3) {
        const [a, b, c] = parts;
        const year = c.length === 4 ? c : (b.length === 4 ? b : a);
        const month = a.length === 4 ? b : a;
        const day = a.length === 4 ? c : b;
        if (year.length === 4 && month.length === 2 && day.length === 2) {
          attributes.date = `${year}-${month}-${day}`;
        }
      }
    }
  }
  const cpMatch = text.match(COUNTERPARTY_REGEX);
  if (cpMatch) {
    attributes.counterparty = cpMatch[0].replace(/^[«"”]+|[»"”]+$/g, "").trim();
  }
  const dueMatch = text.match(/(?:due|վճարման\s+ժամկետ|վերջնաժամկետ)[^\n]{0,30}?(\d{4}-\d{2}-\d{2}|\d{2}[./-]\d{2}[./-]\d{4})/iu);
  if (dueMatch) {
    const raw = dueMatch[1];
    if (raw.includes("-")) {
      attributes.dueDate = raw;
    } else {
      const parts = raw.split(/[./-]/);
      if (parts.length === 3) {
        const [a, b, c] = parts;
        const year = c.length === 4 ? c : (b.length === 4 ? b : a);
        const month = a.length === 4 ? b : a;
        const day = a.length === 4 ? c : b;
        if (year.length === 4 && month.length === 2 && day.length === 2) {
          attributes.dueDate = `${year}-${month}-${day}`;
        }
      }
    }
  }
  const filled = Object.keys(attributes).length;
  const total = 5;
  const confidence = Math.min(95, 30 + Math.round((filled / total) * 60));
  return {
    attributes: { docType: docType || null, ...attributes },
    confidence,
    matchedKeys: Object.keys(attributes)
  };
}

function scanRisks({ body, jurisdiction = "AM" } = {}) {
  const text = normalizeInput(body);
  const risks = [];
  for (const rule of RISK_PATTERNS) {
    for (const pattern of rule.patterns) {
      const m = text.match(pattern);
      if (m) {
        risks.push({
          id: rule.id,
          label: rule.label,
          severity: rule.severity,
          excerpt: m[0],
          jurisdiction
        });
        break;
      }
    }
  }
  const confidence = risks.length === 0
    ? 70
    : Math.min(95, 60 + Math.min(risks.length, 5) * 6);
  return { risks, confidence, jurisdiction };
}

function splitLines(text) {
  return String(text == null ? "" : text).split(/\r?\n/);
}

function compareRevisions({ leftText, rightText } = {}) {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  const leftSet = new Map();
  for (const line of left) {
    const key = line.trim();
    if (!key) continue;
    leftSet.set(key, (leftSet.get(key) || 0) + 1);
  }
  const rightSet = new Map();
  for (const line of right) {
    const key = line.trim();
    if (!key) continue;
    rightSet.set(key, (rightSet.get(key) || 0) + 1);
  }
  const diffs = [];
  for (const [key, count] of rightSet.entries()) {
    const leftCount = leftSet.get(key) || 0;
    if (leftCount === 0) {
      diffs.push({ kind: "added", text: key });
    } else if (leftCount < count) {
      diffs.push({ kind: "added", text: key });
    } else if (leftCount > count) {
      diffs.push({ kind: "changed", text: key, after: key });
    }
  }
  for (const [key, count] of leftSet.entries()) {
    const rightCount = rightSet.get(key) || 0;
    if (rightCount === 0) {
      diffs.push({ kind: "removed", text: key, before: key });
    } else if (count > rightCount) {
      diffs.push({ kind: "changed", text: key, before: key });
    }
  }
  return { diffs, summary: { added: diffs.filter(d => d.kind === "added").length, removed: diffs.filter(d => d.kind === "removed").length, changed: diffs.filter(d => d.kind === "changed").length } };
}

function draftReply({ incoming, tone, language } = {}) {
  const text = normalizeInput(incoming).trim();
  const lang = String(language || "hy-AM").toLowerCase();
  const t = String(tone || "formal").toLowerCase();
  const opening = ARMENIAN_REPLY_OPENINGS[t] || ARMENIAN_REPLY_OPENINGS.formal;
  const summary = text
    ? text.split(/\r?\n/).filter(Boolean).slice(0, 2).join(" ")
    : "";
  const armenianBody = [
    opening,
    summary ? `Ստացել ենք Ձեր ${summary.length > 80 ? summary.slice(0, 80) + "..." : summary}:` : "Ստացել ենք Ձեր ուղերձը:",
    "Մենք կուսումնասիրենք այն եւ կվերադառնանք պատասխանով առավելագույնս երկու աշխատանքային օրվա ընթացքում:",
    "Հարգանքով,",
    "Armosphera One թիմ"
  ].join("\n");
  const body = lang === "en-us" || lang === "en" ? armenianBody : armenianBody;
  return { body, citationIds: [], tone: t, language: lang, advisoryOnly: true };
}

function prepareESign({ cabinetId, signer } = {}) {
  const safeId = String(cabinetId || "").trim();
  if (!safeId) {
    const err = new Error("cabinetId is required");
    err.statusCode = 400;
    throw err;
  }
  const signerName = signer && typeof signer === "object" ? String(signer.name || "").trim() : "";
  const envelopeId = `env-test-${safeId}-${Date.now().toString(36)}`;
  return {
    envelopeId,
    status: "prepared",
    provider: "test-stub",
    cabinetId: safeId,
    signer: signerName ? { name: signerName } : null,
    preparedAt: new Date().toISOString(),
    advisoryOnly: true
  };
}

module.exports = {
  classifyDocument,
  extractAttributes,
  scanRisks,
  compareRevisions,
  draftReply,
  prepareESign,
  // Exposed for tests / callers that want to reason about the keyword dictionary.
  __internals: {
    DOC_TYPES,
    TYPE_KEYWORDS,
    RISK_PATTERNS
  }
};
