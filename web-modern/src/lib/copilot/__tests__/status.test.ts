/**
 * status.test.ts — unit tests for the Copilot pure helpers.
 *
 * Mirrors web-modern/src/lib/cfo/__tests__/status.test.ts pattern.
 */
import { describe, it, expect } from "vitest";
import {
  int,
  classifyPacketStatus,
  classifyIntent,
  classifyRiskLevel,
  packetStatusTone,
  riskTone,
  sortChatsByLastActivityDesc,
  sortMessagesByCreatedAtAsc,
  countCitations,
  countCalculations,
  totalMessageCount,
  messageCount,
  firstUserMessage,
  firstAssistantMessage,
  formatConfidence,
  formatRelativeTime,
  intentLabel,
  riskLabel,
  packetStatusLabel,
  INTENT_LABELS,
  RISK_LABELS,
  PACKET_STATUS_BADGE,
  INTENTS,
  type PacketTone,
  type RiskTone,
} from "../status";

/* ────────── fixtures ────────── */

const CHATS = [
  { id: "c1", title: "VAT Q2", lastMessageAt: "2026-06-10T10:00:00Z", messageCount: 4, intent: "vat" },
  { id: "c2", title: "Payroll June", lastMessageAt: "2026-06-15T10:00:00Z", messageCount: 2, intent: "payroll" },
  { id: "c3", title: "Old", lastMessageAt: "2026-05-01T10:00:00Z", messageCount: 1, intent: "general" },
];

const MESSAGES: ReadonlyArray<{
  id: string;
  role: string;
  content: string;
  packet?: { id: string };
  createdAt?: string;
}> = [
  { id: "m1", role: "user", content: "What is the VAT rate?", createdAt: "2026-06-10T10:00:00Z" },
  { id: "m2", role: "assistant", content: "The rate is 20%.", packet: { id: "p1" }, createdAt: "2026-06-10T10:01:00Z" },
  { id: "m3", role: "user", content: "And reduced rate?", createdAt: "2026-06-10T10:02:00Z" },
  { id: "m4", role: "assistant", content: "0% for some goods.", packet: { id: "p2" }, createdAt: "2026-06-10T10:03:00Z" },
];

const PACKETS = {
  draft: { id: "p1", intent: "vat", status: "draft", answer: "x", confidence: 82, riskLevel: "legal", reviewRequired: true, advisoryOnly: true, citations: [], calculations: [], proposedActions: [] },
  blocked: { id: "p2", intent: "vat", status: "blocked-missing-citation", answer: "y", confidence: 50, riskLevel: "legal", reviewRequired: true, advisoryOnly: true, citations: [], calculations: [], proposedActions: [] },
  ready: { id: "p3", intent: "payroll", status: "ready-for-review", answer: "z", confidence: 88, riskLevel: "financial", reviewRequired: true, advisoryOnly: true, citations: [], calculations: [], proposedActions: [] },
  approved: { id: "p4", intent: "personal-data", status: "approved", answer: "ok", confidence: 90, riskLevel: "low", reviewRequired: false, advisoryOnly: true, citations: [], calculations: [], proposedActions: [] },
  rejected: { id: "p5", intent: "esign", status: "rejected", answer: "no", confidence: 70, riskLevel: "legal", reviewRequired: false, advisoryOnly: true, citations: [], calculations: [], proposedActions: [] },
  garbage: { id: "p6", intent: "wat", status: "GARBAGE", answer: "?", confidence: 0, riskLevel: "wat", reviewRequired: false, advisoryOnly: true, citations: [], calculations: [], proposedActions: [] },
};

/* ────────── int ────────── */

describe("int", () => {
  it("truncates a finite number", () => {
    expect(int(4.9)).toBe(4);
  });
  it("parses numeric strings", () => {
    expect(int("12")).toBe(12);
  });
  it("returns 0 for invalid / null / undefined / NaN", () => {
    expect(int("abc")).toBe(0);
    expect(int(null)).toBe(0);
    expect(int(NaN)).toBe(0);
  });
});

/* ────────── classifyPacketStatus ────────── */

describe("classifyPacketStatus", () => {
  it("maps known statuses", () => {
    expect(classifyPacketStatus(PACKETS.draft)).toBe("draft");
    expect(classifyPacketStatus(PACKETS.blocked)).toBe("blocked");
    expect(classifyPacketStatus(PACKETS.ready)).toBe("ready");
    expect(classifyPacketStatus(PACKETS.approved)).toBe("approved");
    expect(classifyPacketStatus(PACKETS.rejected)).toBe("rejected");
  });
  it("falls back to 'unknown' for unrecognized values", () => {
    expect(classifyPacketStatus(PACKETS.garbage)).toBe("unknown");
    expect(classifyPacketStatus(null)).toBe("unknown");
  });
});

describe("packetStatusTone", () => {
  it("returns info for draft", () => {
    expect(packetStatusTone(PACKETS.draft)).toBe<PacketTone>("info");
  });
  it("returns negative for blocked", () => {
    expect(packetStatusTone(PACKETS.blocked)).toBe<PacketTone>("negative");
  });
  it("returns warning for ready-for-review", () => {
    expect(packetStatusTone(PACKETS.ready)).toBe<PacketTone>("warning");
  });
  it("returns positive for approved", () => {
    expect(packetStatusTone(PACKETS.approved)).toBe<PacketTone>("positive");
  });
  it("returns muted for rejected", () => {
    expect(packetStatusTone(PACKETS.rejected)).toBe<PacketTone>("muted");
  });
  it("returns muted for unknown", () => {
    expect(packetStatusTone(PACKETS.garbage)).toBe<PacketTone>("muted");
  });
});

/* ────────── classifyIntent ────────── */

describe("classifyIntent", () => {
  it("maps known intents", () => {
    expect(classifyIntent({ intent: "vat" })).toBe("vat");
    expect(classifyIntent({ intent: "payroll" })).toBe("payroll");
    expect(classifyIntent({ intent: "personal-data" })).toBe("personal-data");
    expect(classifyIntent({ intent: "esign" })).toBe("esign");
    expect(classifyIntent({ intent: "month-close" })).toBe("month-close");
    expect(classifyIntent({ intent: "general" })).toBe("general");
  });
  it("falls back to 'unknown' for unrecognized values", () => {
    expect(classifyIntent({ intent: "wat" })).toBe("unknown");
    expect(classifyIntent(null)).toBe("unknown");
  });
});

describe("classifyRiskLevel", () => {
  it("maps known risk levels", () => {
    expect(classifyRiskLevel({ riskLevel: "low" })).toBe("low");
    expect(classifyRiskLevel({ riskLevel: "legal" })).toBe("legal");
    expect(classifyRiskLevel({ riskLevel: "financial" })).toBe("financial");
    expect(classifyRiskLevel({ riskLevel: "operational" })).toBe("operational");
  });
  it("falls back to 'unknown' for unrecognized values", () => {
    expect(classifyRiskLevel({ riskLevel: "catastrophic" })).toBe("unknown");
  });
});

describe("riskTone", () => {
  it("returns positive for low", () => {
    expect(riskTone({ riskLevel: "low" })).toBe<RiskTone>("positive");
  });
  it("returns info for legal", () => {
    expect(riskTone({ riskLevel: "legal" })).toBe<RiskTone>("info");
  });
  it("returns warning for financial", () => {
    expect(riskTone({ riskLevel: "financial" })).toBe<RiskTone>("warning");
  });
  it("returns muted for operational", () => {
    expect(riskTone({ riskLevel: "operational" })).toBe<RiskTone>("muted");
  });
  it("returns muted for unknown", () => {
    expect(riskTone({ riskLevel: "wat" })).toBe<RiskTone>("muted");
  });
});

/* ────────── ordering ────────── */

describe("sortChatsByLastActivityDesc", () => {
  it("sorts chats by lastMessageAt descending", () => {
    const out = CHATS.slice().sort(sortChatsByLastActivityDesc).map((c) => c.id);
    expect(out).toEqual(["c2", "c1", "c3"]);
  });
});

describe("sortMessagesByCreatedAtAsc", () => {
  it("sorts messages by createdAt ascending", () => {
    const out = MESSAGES.slice().sort(sortMessagesByCreatedAtAsc).map((m) => m.id);
    expect(out).toEqual(["m1", "m2", "m3", "m4"]);
  });
});

/* ────────── aggregates ────────── */

describe("countCitations", () => {
  it("returns the citation array length", () => {
    expect(countCitations({ citations: [{ id: "c1" }, { id: "c2" }] })).toBe(2);
  });
  it("returns 0 when missing", () => {
    expect(countCitations({ citations: [] })).toBe(0);
  });
});

describe("countCalculations", () => {
  it("returns the calculation array length", () => {
    expect(countCalculations({ calculations: [{ kind: "k1" }] })).toBe(1);
  });
});

describe("totalMessageCount", () => {
  it("sums messageCount across chats", () => {
    expect(totalMessageCount(CHATS)).toBe(4 + 2 + 1);
  });
  it("returns 0 for an empty list", () => {
    expect(totalMessageCount([])).toBe(0);
  });
});

describe("messageCount", () => {
  it("returns the array length when present", () => {
    expect(messageCount(MESSAGES)).toBe(4);
  });
  it("returns 0 for null / undefined / empty", () => {
    expect(messageCount(null)).toBe(0);
    expect(messageCount(undefined)).toBe(0);
    expect(messageCount([])).toBe(0);
  });
});

/* ────────── firstUserMessage / firstAssistantMessage ────────── */

describe("firstUserMessage", () => {
  it("returns the first user message", () => {
    const m = firstUserMessage(MESSAGES);
    expect(m?.id).toBe("m1");
  });
  it("returns null when no user message exists", () => {
    expect(firstUserMessage(MESSAGES.filter((m) => m.role === "assistant"))).toBeNull();
  });
  it("returns null for null / undefined", () => {
    expect(firstUserMessage(null)).toBeNull();
    expect(firstUserMessage(undefined)).toBeNull();
  });
});

describe("firstAssistantMessage", () => {
  it("returns the first assistant message", () => {
    const m = firstAssistantMessage(MESSAGES);
    expect(m?.id).toBe("m2");
  });
  it("returns null when no assistant message exists", () => {
    expect(firstAssistantMessage(MESSAGES.filter((m) => m.role === "user"))).toBeNull();
  });
});

/* ────────── formatting ────────── */

describe("formatConfidence", () => {
  it("rounds and appends %", () => {
    expect(formatConfidence(82.6)).toBe("83%");
    expect(formatConfidence(95)).toBe("95%");
  });
  it("returns '—' for null / undefined / non-finite", () => {
    expect(formatConfidence(null)).toBe("—");
    expect(formatConfidence(undefined)).toBe("—");
    expect(formatConfidence(NaN)).toBe("—");
  });
});

describe("formatRelativeTime", () => {
  it("returns 'today' for today's date (or 1 day ago in TZ-skewed cases)", () => {
    // TZ-agnostic: today in UTC vs today in local time may differ by
    // a day at the boundaries; accept either.
    const today = new Date().toISOString().split("T")[0]!;
    const out = formatRelativeTime(today);
    expect(out).toMatch(/^(today|1 days? ago)$/);
  });
  it("returns 'N days ago' for a recent past date (tolerant of TZ)", () => {
    const out = formatRelativeTime(
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!,
    );
    // TZ-agnostic: 1..3 days ago, or 1 week ago
    expect(out).toMatch(/^([1-3] days? ago|1 weeks? ago)$/);
  });
  it("returns a non-empty relative phrase for ~10 days back", () => {
    const out = formatRelativeTime(
      new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!,
    );
    // TZ-agnostic: between 8..15 days or 1..2 weeks
    expect(out).toMatch(/^([8-9]|[1][0-5]) days? ago|[12] weeks? ago$/);
  });
  it("returns '—' for missing / invalid values", () => {
    expect(formatRelativeTime(null)).toBe("—");
    expect(formatRelativeTime("garbage")).toBe("—");
  });
});

/* ────────── intent / risk / status labels ────────── */

describe("intentLabel", () => {
  it("returns Armenian label for vat", () => {
    expect(intentLabel({ intent: "vat" })).toBe("ԱԱՀ");
  });
  it("returns Armenian label for payroll", () => {
    expect(intentLabel({ intent: "payroll" })).toBe("Աշխատավարձ");
  });
  it("returns Armenian label for personal-data", () => {
    expect(intentLabel({ intent: "personal-data" })).toBe("Անձնական տվյալներ");
  });
  it("returns 'Այլ' for unknown", () => {
    expect(intentLabel({ intent: "wat" })).toBe("Այլ");
  });
});

describe("riskLabel", () => {
  it("returns Armenian label for legal", () => {
    expect(riskLabel({ riskLevel: "legal" })).toBe("Իրավական");
  });
  it("returns Armenian label for financial", () => {
    expect(riskLabel({ riskLevel: "financial" })).toBe("Ֆինանսական");
  });
  it("returns 'Անորոշ' for unknown", () => {
    expect(riskLabel({ riskLevel: "wat" })).toBe("Անորոշ");
  });
});

describe("packetStatusLabel", () => {
  it("returns Armenian label for draft", () => {
    expect(packetStatusLabel(PACKETS.draft)).toBe("Սևագիր");
  });
  it("returns Armenian label for blocked", () => {
    expect(packetStatusLabel(PACKETS.blocked)).toBe("Փակված");
  });
  it("returns Armenian label for ready", () => {
    expect(packetStatusLabel(PACKETS.ready)).toBe("Վերանայման");
  });
  it("returns Armenian label for approved", () => {
    expect(packetStatusLabel(PACKETS.approved)).toBe("Հաստատված");
  });
  it("returns 'Անորոշ' for unknown", () => {
    expect(packetStatusLabel(PACKETS.garbage)).toBe("Անորոշ");
  });
});

/* ────────── constants ────────── */

describe("INTENT_LABELS", () => {
  it("includes the 6 canonical intents", () => {
    expect(Object.keys(INTENT_LABELS)).toEqual(
      expect.arrayContaining(["vat", "payroll", "personal-data", "esign", "month-close", "general"]),
    );
  });
});

describe("RISK_LABELS", () => {
  it("includes 4 risk buckets", () => {
    expect(Object.keys(RISK_LABELS)).toEqual(
      expect.arrayContaining(["low", "legal", "financial", "operational"]),
    );
  });
});

describe("PACKET_STATUS_BADGE", () => {
  it("includes 5 status buckets", () => {
    expect(Object.keys(PACKET_STATUS_BADGE)).toEqual(
      expect.arrayContaining(["draft", "blocked", "ready", "approved", "rejected"]),
    );
  });
});

describe("INTENTS", () => {
  it("has 6 entries", () => {
    expect(INTENTS).toHaveLength(6);
  });
});
