/**
 * Pure helpers for the Campaigns workspace.
 *
 * Source of truth: server/app.js#formatCampaignPerformance (line 45079+)
 * and getCampaignPerformance (45039+).
 *
 * These helpers are UI-pure: no React, no I/O. They re-implement
 * select small derivations the engine already produces (totals,
 * sorting, ROI tone) and add UI-specific shaping (channel label,
 * Armenian status tone) without duplicating the math.
 *
 * Public surface:
 *  - classifyCampaignStatus
 *  - channelGroupFor
 *  - compareCampaignsBySpendDesc
 *  - compareCampaignsByRoiDesc
 *  - campaignTotalSpend
 *  - campaignTotalRevenue
 *  - campaignNetRoi
 *  - attributionCount
 *  - roiTone          → "positive" | "negative" | "neutral"
 *  - formatRoiPercent
 *  - formatCurrency   (re-exported from cfo/status for AMD formatting)
 */
import type {
  CampaignAttribution,
  CampaignPerformanceRow,
  CampaignPerformanceSummary,
} from "../api/schemas";

/* ────────── types ────────── */

export type CampaignTone = "active" | "paused" | "completed" | "draft" | "archived" | "unknown";

export type ChannelGroup = "paid" | "email" | "social" | "events" | "other";

export type RoiTone = "positive" | "negative" | "neutral";

/* ────────── status classification ────────── */

const CAMPAIGN_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "paused",
  "completed",
  "draft",
  "archived",
]);

export function classifyCampaignStatus(
  campaign: { status?: string | null } | null | undefined,
): CampaignTone {
  const s = (campaign?.status ?? "").toString().toLowerCase();
  if (CAMPAIGN_STATUSES.has(s)) return s as CampaignTone;
  return "unknown";
}

/* ────────── channel grouping ────────── */

export function channelGroupFor(channel: string | null | undefined): ChannelGroup {
  const c = (channel ?? "").toString().toLowerCase();
  if (!c) return "other";
  // Order matters: social/email/event checked first so "facebook ads" → social, not paid.
  if (c.includes("email") || c.includes("mail") || c.includes("newsletter")) return "email";
  if (c.includes("social") || c.includes("facebook") || c.includes("instagram") || c.includes("linkedin")) return "social";
  if (c.includes("event") || c.includes("webinar") || c.includes("conference")) return "events";
  if (c.includes("paid") || c.includes("ads") || c.includes("ppc")) return "paid";
  return "other";
}

export function channelGroupLabel(group: ChannelGroup): string {
  switch (group) {
    case "paid":
      return "Paid ads";
    case "email":
      return "Email";
    case "social":
      return "Social";
    case "events":
      return "Events";
    default:
      return "Other";
  }
}

/* ────────── ordering ────────── */

export function compareCampaignsBySpendDesc(
  a: Pick<CampaignPerformanceRow, "spend">,
  b: Pick<CampaignPerformanceRow, "spend">,
): number {
  return (b.spend ?? 0) - (a.spend ?? 0);
}

export function compareCampaignsByRoiDesc(
  a: Pick<CampaignPerformanceRow, "roiPercent">,
  b: Pick<CampaignPerformanceRow, "roiPercent">,
): number {
  return (b.roiPercent ?? 0) - (a.roiPercent ?? 0);
}

export function compareAttributionsByCreatedDesc(
  a: Pick<CampaignAttribution, "createdAt">,
  b: Pick<CampaignAttribution, "createdAt">,
): number {
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

/* ────────── aggregates ────────── */

export function campaignTotalSpend(
  rows: ReadonlyArray<Pick<CampaignPerformanceRow, "spend">>,
): number {
  return rows.reduce((s, r) => s + (r.spend ?? 0), 0);
}

export function campaignTotalRevenue(
  rows: ReadonlyArray<Pick<CampaignPerformanceRow, "paidRevenue" | "acceptedRevenue">>,
): number {
  return rows.reduce(
    (s, r) => s + (r.paidRevenue ?? 0) + (r.acceptedRevenue ?? 0),
    0,
  );
}

export function campaignPaidRevenue(
  rows: ReadonlyArray<Pick<CampaignPerformanceRow, "paidRevenue">>,
): number {
  return rows.reduce((s, r) => s + (r.paidRevenue ?? 0), 0);
}

export function campaignAcceptedRevenue(
  rows: ReadonlyArray<Pick<CampaignPerformanceRow, "acceptedRevenue">>,
): number {
  return rows.reduce((s, r) => s + (r.acceptedRevenue ?? 0), 0);
}

export function campaignInfluencedPipeline(
  rows: ReadonlyArray<Pick<CampaignPerformanceRow, "influencedPipeline">>,
): number {
  return rows.reduce((s, r) => s + (r.influencedPipeline ?? 0), 0);
}

export function campaignLeadCount(
  rows: ReadonlyArray<Pick<CampaignPerformanceRow, "leadCount">>,
): number {
  return rows.reduce((s, r) => s + (r.leadCount ?? 0), 0);
}

export function campaignCustomerCount(
  rows: ReadonlyArray<Pick<CampaignPerformanceRow, "customerCount">>,
): number {
  return rows.reduce((s, r) => s + (r.customerCount ?? 0), 0);
}

export function campaignNetRoi(
  summary: Pick<CampaignPerformanceSummary, "paidRevenue" | "totalSpend">,
): number {
  const spend = summary.totalSpend ?? 0;
  const revenue = summary.paidRevenue ?? 0;
  if (spend === 0) return 0;
  return Math.round(((revenue - spend) / spend) * 100);
}

export function attributionCount(
  row: Pick<CampaignPerformanceRow, "attributions">,
): number {
  return row.attributions?.length ?? 0;
}

/* ────────── ROI tone ────────── */

export function roiTone(value: number | null | undefined): RoiTone {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

/* ────────── formatting ────────── */

export function formatRoiPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${value}%`;
}

export function formatAttributionCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(value);
}

// Re-export the cfo AMD currency formatter so callers have a single import path.
export { formatCurrency } from "../cfo/status";
