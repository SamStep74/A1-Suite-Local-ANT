/**
 * Pure helpers for the Copilot workspace.
 *
 * Source of truth: server/copilot.js (buildCopilotPacket, buildAnswer,
 * confidenceForIntent) and the /api/copilot/questions route in
 * server/app.js.
 *
 * These helpers are UI-pure: no React, no I/O. They shape packets
 * (status tone, risk tone, intent labels) and small aggregations
 * over a chat history for the chat list and chat detail views.
 *
 * Public surface:
 *  - int                     → coerce a value to a non-negative integer
 *  - classifyPacketStatus    → "draft" | "blocked" | "ready" | "approved" | "rejected" | "unknown"
 *  - classifyIntent          → canonical intent name (e.g. "vat") or "unknown"
 *  - classifyRiskLevel       → "low" | "legal" | "financial" | "operational" | "unknown"
 *  - packetStatusTone        → "info" | "positive" | "negative" | "warning" | "muted"
 *  - riskTone                → "info" | "positive" | "negative" | "warning" | "muted"
 *  - sortChatsByLastActivityDesc
 *  - sortMessagesByCreatedAtAsc
 *  - countCitations / countCalculations
 *  - firstUserMessage / firstAssistantMessage
 *  - formatConfidence
 *  - formatRelativeTime (date-only YYYY-MM-DD → "x days ago")
 *  - INTENT_LABELS
 *  - RISK_LABELS
 *  - PACKET_STATUS_BADGE
 */
import type {
  CopilotChatMessage,
  CopilotChatSummary,
  CopilotIntent,
  CopilotPacket,
  CopilotRiskLevel,
} from "../api/schemas";

/* ────────── types ────────── */

export type PacketTone =
  | "info"
  | "positive"
  | "negative"
  | "warning"
  | "muted";

export type RiskTone = "info" | "positive" | "negative" | "warning" | "muted";

export const INTENTS: readonly CopilotIntent[] = [
  "vat",
  "payroll",
  "personal-data",
  "esign",
  "month-close",
  "general",
] as const;

const PACKET_TONE: Record<string, PacketTone> = {
  draft: "info",
  blocked: "negative",
  ready: "warning",
  approved: "positive",
  rejected: "muted",
};

const RISK_TONE: Record<string, RiskTone> = {
  low: "positive",
  legal: "info",
  financial: "warning",
  operational: "muted",
};

/* ────────── small utilities ────────── */

export function int(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

/* ────────── classification ────────── */

export function classifyPacketStatus(
  packet: { status?: string | null } | null | undefined,
): string {
  const s = (packet?.status ?? "").toString().toLowerCase();
  if (s === "draft") return "draft";
  if (s === "blocked-missing-citation") return "blocked";
  if (s === "ready-for-review") return "ready";
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "unknown";
}

export function classifyIntent(
  source: { intent?: string | null } | null | undefined,
): CopilotIntent | "unknown" {
  const i = (source?.intent ?? "").toString().toLowerCase();
  if ((INTENTS as readonly string[]).includes(i)) return i as CopilotIntent;
  return "unknown";
}

export function classifyRiskLevel(
  source: { riskLevel?: string | null } | null | undefined,
): CopilotRiskLevel | "unknown" {
  const r = (source?.riskLevel ?? "").toString().toLowerCase();
  if (r === "low" || r === "legal" || r === "financial" || r === "operational") {
    return r as CopilotRiskLevel;
  }
  return "unknown";
}

export function packetStatusTone(
  packet: { status?: string | null } | null | undefined,
): PacketTone {
  const s = classifyPacketStatus(packet);
  return PACKET_TONE[s] ?? "muted";
}

export function riskTone(
  source: { riskLevel?: string | null } | null | undefined,
): RiskTone {
  const r = classifyRiskLevel(source);
  return RISK_TONE[r] ?? "muted";
}

/* ────────── ordering ────────── */

export function sortChatsByLastActivityDesc(
  a: Pick<CopilotChatSummary, "lastMessageAt">,
  b: Pick<CopilotChatSummary, "lastMessageAt">,
): number {
  const av = a.lastMessageAt ?? "";
  const bv = b.lastMessageAt ?? "";
  if (av === bv) return 0;
  return bv.localeCompare(av);
}

export function sortMessagesByCreatedAtAsc(
  a: Pick<CopilotChatMessage, "createdAt">,
  b: Pick<CopilotChatMessage, "createdAt">,
): number {
  const av = a.createdAt ?? "";
  const bv = b.createdAt ?? "";
  if (av === bv) return 0;
  return av.localeCompare(bv);
}

/* ────────── aggregates ────────── */

export function countCitations(packet: Pick<CopilotPacket, "citations">): number {
  return packet.citations?.length ?? 0;
}

export function countCalculations(packet: Pick<CopilotPacket, "calculations">): number {
  return packet.calculations?.length ?? 0;
}

export function totalMessageCount(
  chats: ReadonlyArray<Pick<CopilotChatSummary, "messageCount">>,
): number {
  return chats.reduce((s, c) => s + int(c.messageCount), 0);
}

export function messageCount(
  messages: ReadonlyArray<unknown> | null | undefined,
): number {
  return messages?.length ?? 0;
}

export function firstUserMessage<T extends { role?: string | null }>(
  messages: ReadonlyArray<T> | null | undefined,
): T | null {
  if (!messages) return null;
  return messages.find((m) => (m.role ?? "").toString().toLowerCase() === "user") ?? null;
}

export function firstAssistantMessage<T extends { role?: string | null }>(
  messages: ReadonlyArray<T> | null | undefined,
): T | null {
  if (!messages) return null;
  return (
    messages.find((m) => (m.role ?? "").toString().toLowerCase() === "assistant") ?? null
  );
}

/* ────────── formatting ────────── */

export function formatConfidence(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (n == null) return "—";
  return `${Math.round(n)}%`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const datePart = iso.split("T")[0] ?? "";
  if (datePart.length < 10) return "—";
  const then = new Date(`${datePart}T00:00:00Z`).getTime();
  if (!Number.isFinite(then)) return "—";
  const now = Date.now();
  const diffDays = Math.round((now - then) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.round(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.round(diffDays / 30)} months ago`;
  return `${Math.round(diffDays / 365)} years ago`;
}

/* ────────── display labels (Armenian-first) ────────── */

export const INTENT_LABELS: Record<string, string> = {
  vat: "ԱԱՀ",
  payroll: "Աշխատավարձ",
  "personal-data": "Անձնական տվյալներ",
  esign: "Էլեկտրոնային ստորագրություն",
  "month-close": "Ամսվա փակում",
  general: "Ընդհանուր",
  unknown: "Այլ",
};

export const RISK_LABELS: Record<string, string> = {
  low: "Ցածր",
  legal: "Իրավական",
  financial: "Ֆինանսական",
  operational: "Գործառնական",
  unknown: "Անորոշ",
};

export const PACKET_STATUS_BADGE: Record<string, string> = {
  draft: "Սևագիր",
  blocked: "Փակված",
  ready: "Վերանայման",
  approved: "Հաստատված",
  rejected: "Մերժված",
  unknown: "Անորոշ",
};

export function intentLabel(source: { intent?: string | null } | null | undefined): string {
  return INTENT_LABELS[classifyIntent(source)] ?? INTENT_LABELS.unknown;
}

export function riskLabel(source: { riskLevel?: string | null } | null | undefined): string {
  return RISK_LABELS[classifyRiskLevel(source)] ?? RISK_LABELS.unknown;
}

export function packetStatusLabel(
  packet: { status?: string | null } | null | undefined,
): string {
  return PACKET_STATUS_BADGE[classifyPacketStatus(packet)] ?? PACKET_STATUS_BADGE.unknown;
}
