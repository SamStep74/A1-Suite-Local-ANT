/**
 * status.test.ts — unit tests for the Campaigns pure helpers.
 *
 * Mirrors web-modern/src/lib/cfo/__tests__/status.test.ts pattern.
 * All amounts are integer AMD.
 */
import { describe, it, expect } from "vitest";
import {
  classifyCampaignStatus,
  channelGroupFor,
  channelGroupLabel,
  compareCampaignsBySpendDesc,
  compareCampaignsByRoiDesc,
  compareAttributionsByCreatedDesc,
  campaignTotalSpend,
  campaignTotalRevenue,
  campaignPaidRevenue,
  campaignAcceptedRevenue,
  campaignInfluencedPipeline,
  campaignLeadCount,
  campaignCustomerCount,
  campaignNetRoi,
  attributionCount,
  roiTone,
  formatRoiPercent,
  formatAttributionCount,
  formatCurrency,
  type CampaignTone,
  type ChannelGroup,
  type RoiTone as _RoiTone,
} from "../status";

/* ────────── fixtures ────────── */

const CAMPAIGNS = [
  {
    id: "cmp-1",
    name: "Summer push",
    channel: "paid-ads",
    status: "active",
    spend: 1_000_000,
    paidRevenue: 3_500_000,
    acceptedRevenue: 500_000,
    influencedPipeline: 2_000_000,
    leadCount: 42,
    customerCount: 12,
    roiPercent: 250,
    attributions: [
      { id: "a1", campaignId: "cmp-1", createdAt: "2026-06-02T10:00:00Z" },
      { id: "a2", campaignId: "cmp-1", createdAt: "2026-06-08T11:00:00Z" },
    ],
  },
  {
    id: "cmp-2",
    name: "Newsletter",
    channel: "email",
    status: "paused",
    spend: 200_000,
    paidRevenue: 150_000,
    acceptedRevenue: 50_000,
    influencedPipeline: 300_000,
    leadCount: 10,
    customerCount: 4,
    roiPercent: -25,
    attributions: [{ id: "a3", campaignId: "cmp-2", createdAt: "2026-06-01T09:00:00Z" }],
  },
  {
    id: "cmp-3",
    name: "LinkedIn",
    channel: "social",
    status: "active",
    spend: 500_000,
    paidRevenue: 0,
    acceptedRevenue: 0,
    influencedPipeline: 800_000,
    leadCount: 18,
    customerCount: 3,
    roiPercent: -100,
    attributions: [],
  },
];

/* ────────── classifyCampaignStatus ────────── */

describe("classifyCampaignStatus", () => {
  it("maps known statuses", () => {
    expect(classifyCampaignStatus({ status: "active" })).toBe<CampaignTone>("active");
    expect(classifyCampaignStatus({ status: "paused" })).toBe<CampaignTone>("paused");
    expect(classifyCampaignStatus({ status: "completed" })).toBe<CampaignTone>("completed");
    expect(classifyCampaignStatus({ status: "draft" })).toBe<CampaignTone>("draft");
    expect(classifyCampaignStatus({ status: "archived" })).toBe<CampaignTone>("archived");
  });
  it("falls back to unknown for unrecognized values", () => {
    expect(classifyCampaignStatus({ status: "exploded" })).toBe<CampaignTone>("unknown");
    expect(classifyCampaignStatus({ status: null as unknown as string })).toBe<CampaignTone>("unknown");
    expect(classifyCampaignStatus(null)).toBe<CampaignTone>("unknown");
  });
});

/* ────────── channelGroupFor ────────── */

describe("channelGroupFor", () => {
  it("returns 'paid' for paid / ads / ppc channels", () => {
    expect(channelGroupFor("paid-ads")).toBe<ChannelGroup>("paid");
    expect(channelGroupFor("google-ads")).toBe<ChannelGroup>("paid");
    expect(channelGroupFor("PPC")).toBe<ChannelGroup>("paid");
  });
  it("returns 'email' for email / mail / newsletter channels", () => {
    expect(channelGroupFor("email")).toBe<ChannelGroup>("email");
    expect(channelGroupFor("newsletter")).toBe<ChannelGroup>("email");
    expect(channelGroupFor("direct-mail")).toBe<ChannelGroup>("email");
  });
  it("returns 'social' for social / facebook / instagram / linkedin channels", () => {
    expect(channelGroupFor("social")).toBe<ChannelGroup>("social");
    expect(channelGroupFor("Facebook Ads")).toBe<ChannelGroup>("social");
    expect(channelGroupFor("LinkedIn")).toBe<ChannelGroup>("social");
  });
  it("returns 'events' for event / webinar / conference channels", () => {
    expect(channelGroupFor("event")).toBe<ChannelGroup>("events");
    expect(channelGroupFor("webinar")).toBe<ChannelGroup>("events");
    expect(channelGroupFor("conference")).toBe<ChannelGroup>("events");
  });
  it("returns 'other' for unknown or empty", () => {
    expect(channelGroupFor("")).toBe<ChannelGroup>("other");
    expect(channelGroupFor("radio")).toBe<ChannelGroup>("other");
    expect(channelGroupFor(null)).toBe<ChannelGroup>("other");
    expect(channelGroupFor(undefined)).toBe<ChannelGroup>("other");
  });
});

describe("channelGroupLabel", () => {
  it("returns Armenian/English display label per group", () => {
    expect(channelGroupLabel("paid")).toMatch(/Paid/);
    expect(channelGroupLabel("email")).toMatch(/Email/);
    expect(channelGroupLabel("social")).toMatch(/Social/);
    expect(channelGroupLabel("events")).toMatch(/Events/);
    expect(channelGroupLabel("other")).toMatch(/Other/);
  });
});

/* ────────── ordering ────────── */

describe("compareCampaignsBySpendDesc", () => {
  it("sorts campaigns by spend descending", () => {
    const out = CAMPAIGNS.slice().sort(compareCampaignsBySpendDesc).map((c) => c.id);
    expect(out).toEqual(["cmp-1", "cmp-3", "cmp-2"]);
  });
});

describe("compareCampaignsByRoiDesc", () => {
  it("sorts campaigns by roiPercent descending", () => {
    const out = CAMPAIGNS.slice().sort(compareCampaignsByRoiDesc).map((c) => c.id);
    // 250, -25, -100
    expect(out).toEqual(["cmp-1", "cmp-2", "cmp-3"]);
  });
});

describe("compareAttributionsByCreatedDesc", () => {
  it("sorts attributions by createdAt descending", () => {
    const atts = [
      { id: "a1", createdAt: "2026-06-02T10:00:00Z" },
      { id: "a3", createdAt: "2026-06-01T09:00:00Z" },
      { id: "a2", createdAt: "2026-06-08T11:00:00Z" },
    ];
    const out = atts.slice().sort(compareAttributionsByCreatedDesc).map((a) => a.id);
    expect(out).toEqual(["a2", "a1", "a3"]);
  });
});

/* ────────── aggregates ────────── */

describe("campaignTotalSpend", () => {
  it("sums spend across all rows", () => {
    expect(campaignTotalSpend(CAMPAIGNS)).toBe(1_700_000);
  });
  it("returns 0 for empty", () => {
    expect(campaignTotalSpend([])).toBe(0);
  });
});

describe("campaignTotalRevenue", () => {
  it("sums paid + accepted revenue", () => {
    // cmp-1: 3.5M + 0.5M = 4M, cmp-2: 0.15M + 0.05M = 0.2M, cmp-3: 0
    expect(campaignTotalRevenue(CAMPAIGNS)).toBe(4_200_000);
  });
});

describe("campaignPaidRevenue", () => {
  it("sums only paid revenue", () => {
    expect(campaignPaidRevenue(CAMPAIGNS)).toBe(3_650_000);
  });
});

describe("campaignAcceptedRevenue", () => {
  it("sums only accepted revenue", () => {
    expect(campaignAcceptedRevenue(CAMPAIGNS)).toBe(550_000);
  });
});

describe("campaignInfluencedPipeline", () => {
  it("sums influenced pipeline", () => {
    expect(campaignInfluencedPipeline(CAMPAIGNS)).toBe(3_100_000);
  });
});

describe("campaignLeadCount", () => {
  it("sums lead counts", () => {
    expect(campaignLeadCount(CAMPAIGNS)).toBe(70);
  });
});

describe("campaignCustomerCount", () => {
  it("sums customer counts", () => {
    expect(campaignCustomerCount(CAMPAIGNS)).toBe(19);
  });
});

describe("campaignNetRoi", () => {
  it("computes net roi from paid revenue and total spend", () => {
    // net = (revenue - spend) / spend = (3.65M - 1.7M) / 1.7M = 1.147 → 115%
    expect(campaignNetRoi({ paidRevenue: 3_650_000, totalSpend: 1_700_000 })).toBe(115);
  });
  it("returns 0 when spend is 0", () => {
    expect(campaignNetRoi({ paidRevenue: 100, totalSpend: 0 })).toBe(0);
  });
  it("returns negative when revenue < spend", () => {
    expect(campaignNetRoi({ paidRevenue: 100_000, totalSpend: 200_000 })).toBe(-50);
  });
});

describe("attributionCount", () => {
  it("returns attribution count from a row", () => {
    expect(attributionCount(CAMPAIGNS[0])).toBe(2);
    expect(attributionCount(CAMPAIGNS[2])).toBe(0);
  });
  it("returns 0 when attributions is undefined", () => {
    expect(attributionCount({})).toBe(0);
  });
});

/* ────────── ROI tone ────────── */

describe("roiTone", () => {
  it("returns 'positive' for > 0", () => {
    expect(roiTone(10)).toBe<_RoiTone>("positive");
    expect(roiTone(0.5)).toBe<_RoiTone>("positive");
  });
  it("returns 'negative' for < 0", () => {
    expect(roiTone(-1)).toBe<_RoiTone>("negative");
  });
  it("returns 'neutral' for 0 / null / NaN", () => {
    expect(roiTone(0)).toBe<_RoiTone>("neutral");
    expect(roiTone(null)).toBe<_RoiTone>("neutral");
    expect(roiTone(NaN)).toBe<_RoiTone>("neutral");
  });
});

/* ────────── formatting ────────── */

describe("formatRoiPercent", () => {
  it("prepends + for positive values", () => {
    expect(formatRoiPercent(42)).toBe("+42%");
  });
  it("returns plain % for negative values", () => {
    expect(formatRoiPercent(-25)).toBe("-25%");
  });
  it("returns 0% for zero", () => {
    expect(formatRoiPercent(0)).toBe("0%");
  });
  it("returns — for null/NaN", () => {
    expect(formatRoiPercent(null)).toBe("—");
    expect(formatRoiPercent(NaN)).toBe("—");
  });
});

describe("formatAttributionCount", () => {
  it("renders numbers as strings", () => {
    expect(formatAttributionCount(7)).toBe("7");
    expect(formatAttributionCount(0)).toBe("0");
  });
  it("returns — for null/NaN", () => {
    expect(formatAttributionCount(null)).toBe("—");
    expect(formatAttributionCount(NaN)).toBe("—");
  });
});

describe("formatCurrency (re-export)", () => {
  it("formats integer AMD with the Armenian digit grouping", () => {
    const out = formatCurrency(1_000_000);
    expect(out).toMatch(/1\s*000\s*000/);
  });
});
