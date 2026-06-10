/**
 * /app/campaigns — Campaigns workspace: overview | channels | budget |
 * performance.
 *
 * Mirrors finance/ purchase/ people/ docs/ pattern (Pattern A from
 * the plan §3.5). The home route is a ViewSwitcher over four
 * surfaces:
 *
 *   - **Overview** — summary KPIs (spend, leads, customers, ROI) +
 *                    campaign table sorted by spend desc
 *   - **Channels** — campaigns grouped by channel (paid/email/social/events/other)
 *   - **Budget**   — campaign budgets + ROI per campaign
 *   - **Performance** — attribution funnel: leads → customers → deals → quotes
 *
 * URL state:
 *   ?view=overview | channels | budget | performance
 *
 * Data (requires app=campaigns access):
 *   - GET /api/campaigns/performance
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, ChevronLeft, CircleSlash } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  CampaignPerformanceResponseSchema,
  type CampaignAttribution,
  type CampaignPerformanceResponse,
  type CampaignPerformanceRow,
  type CampaignPerformanceSummary,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { cn } from "../../../lib/utils/cn";
import {
  attributionCount,
  campaignAcceptedRevenue,
  campaignCustomerCount,
  campaignInfluencedPipeline,
  campaignLeadCount,
  campaignNetRoi,
  campaignPaidRevenue,
  campaignTotalSpend,
  classifyCampaignStatus,
  channelGroupFor,
  channelGroupLabel,
  compareCampaignsByRoiDesc,
  compareCampaignsBySpendDesc,
  formatAttributionCount,
  formatCurrency,
  formatRoiPercent,
  roiTone,
  type CampaignTone,
  type ChannelGroup,
  type RoiTone as _RoiTone,
} from "../../../lib/campaigns/status";

/* ────────── typed URL search ────────── */

type View = "overview" | "channels" | "budget" | "performance";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "channels", label: "Channels" },
  { value: "budget", label: "Budget" },
  { value: "performance", label: "Performance" },
];

export const Route = createFileRoute("/app/campaigns/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "channels" || raw.view === "budget" || raw.view === "performance"
        ? raw.view
        : "overview";
    return { view: v };
  },
  component: CampaignsWorkspace,
});

/* ────────── tones ────────── */

const STATUS_TONE: Record<CampaignTone, { bg: string; fg: string; label: string }> = {
  active: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Active",
  },
  paused: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Paused",
  },
  completed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Completed",
  },
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Draft",
  },
  archived: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Archived",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Unknown",
  },
};

const ROI_CLASS: Record<ReturnType<typeof roiTone>, string> = {
  positive: "text-[var(--color-tag-green)]",
  negative: "text-[var(--color-tag-red)]",
  neutral: "text-[var(--color-ink)]",
};

/* ────────── root component ────────── */

function CampaignsWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const performanceQ = useQuery({
    queryKey: ["campaigns-performance"],
    queryFn: async () => {
      const raw = await getJson("/api/campaigns/performance");
      return CampaignPerformanceResponseSchema.parse(raw) as CampaignPerformanceResponse;
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Today
        </Link>
      </div>

      {view === "overview" && (
        <OverviewView
          data={performanceQ.data}
          loading={performanceQ.isLoading}
          error={performanceQ.isError}
        />
      )}
      {view === "channels" && (
        <ChannelsView
          data={performanceQ.data}
          loading={performanceQ.isLoading}
          error={performanceQ.isError}
        />
      )}
      {view === "budget" && (
        <BudgetView
          data={performanceQ.data}
          loading={performanceQ.isLoading}
          error={performanceQ.isError}
        />
      )}
      {view === "performance" && (
        <PerformanceView
          data={performanceQ.data}
          loading={performanceQ.isLoading}
          error={performanceQ.isError}
        />
      )}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Megaphone className="size-3" />
        Campaigns
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">Campaigns</h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Արշավներ · Վճարումներ · Հաճախորդներ · ROI
      </p>
    </header>
  );
}

/* ────────── KPI block ────────── */

function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--color-tag-green)]"
      : tone === "negative"
        ? "text-[var(--color-tag-red)]"
        : "text-[var(--color-ink)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className={cn("mt-1 font-mono text-[var(--text-lg)]", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── status pill ────────── */

function StatusPill({ status }: { status: string | null | undefined }) {
  const tone = classifyCampaignStatus({ status });
  const cls = STATUS_TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        cls.bg,
        cls.fg,
      )}
    >
      {cls.label}
    </span>
  );
}

/* ────────── helper: read summary + rows from a response ────────── */

function readEnvelope(
  data: CampaignPerformanceResponse | undefined | null,
): {
  summary: CampaignPerformanceSummary;
  campaigns: CampaignPerformanceRow[];
  attributions: CampaignAttribution[];
} | null {
  if (!data?.summary || !data?.campaigns) return null;
  return {
    summary: data.summary,
    campaigns: data.campaigns,
    attributions: data.attributions ?? [],
  };
}

/* ────────── Overview view ────────── */

function OverviewView({
  data,
  loading,
  error,
}: {
  data: CampaignPerformanceResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading campaigns…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load campaigns.
      </p>
    );
  }

  const env = readEnvelope(data);
  if (!env) {
    return <EmptyState message="No campaign data available." />;
  }

  const sorted = env.campaigns.slice().sort(compareCampaignsBySpendDesc);
  const netRoi = campaignNetRoi(env.summary);
  const roiCls = ROI_CLASS[roiTone(netRoi)];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Campaigns"
          value={String(env.summary.campaignCount ?? env.campaigns.length)}
          hint="Արշավներ"
        />
        <KpiCard
          label="Total spend"
          value={formatCurrency(env.summary.totalSpend ?? campaignTotalSpend(env.campaigns))}
          hint="Ընդհանուր ծախս"
          tone="negative"
        />
        <KpiCard
          label="Paid revenue"
          value={formatCurrency(
            env.summary.paidRevenue ?? campaignPaidRevenue(env.campaigns),
          )}
          hint="Վճարված եկամուտ"
          tone="positive"
        />
        <KpiCard
          label="ROI"
          value={formatRoiPercent(env.summary.roiPercent ?? netRoi)}
          hint="Վերադարձ"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="campaigns-performance-row"
        data-count={String(sorted.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Name</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Spend</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Leads</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Customers</th>
              <th scope="col" className={cn("px-3 py-2 text-right font-semibold", roiCls)}>ROI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {sorted.map((c) => {
              const tone = roiTone(c.roiPercent);
              return (
                <tr key={c.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">{c.name}</td>
                  <td className="px-3 py-2"><StatusPill status={c.status} /></td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {formatCurrency(c.spend)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {formatAttributionCount(c.leadCount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {formatAttributionCount(c.customerCount)}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-mono", ROI_CLASS[tone])}>
                    {formatRoiPercent(c.roiPercent)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Channels view ────────── */

const CHANNEL_ORDER: ChannelGroup[] = ["paid", "email", "social", "events", "other"];

function ChannelsView({
  data,
  loading,
  error,
}: {
  data: CampaignPerformanceResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading channels…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load channels.
      </p>
    );
  }

  const env = readEnvelope(data);
  if (!env) {
    return <EmptyState message="No channel data available." />;
  }

  const byGroup = new Map<ChannelGroup, CampaignPerformanceRow[]>();
  for (const group of CHANNEL_ORDER) byGroup.set(group, []);
  for (const c of env.campaigns) {
    const g = channelGroupFor(c.channel);
    byGroup.get(g)?.push(c);
  }
  const totalRows = env.campaigns.length;

  return (
    <div className="space-y-4" data-entity="campaigns-channel-group" data-count={String(CHANNEL_ORDER.length)}>
      {CHANNEL_ORDER.map((group) => {
        const rows = byGroup.get(group) ?? [];
        const spend = campaignTotalSpend(rows);
        const revenue = campaignPaidRevenue(rows) + campaignAcceptedRevenue(rows);
        return (
          <section
            key={group}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
              <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                {channelGroupLabel(group)}
              </h2>
              <p className="font-mono text-[var(--text-xs)] text-[var(--color-muted)]">
                {rows.length} / {totalRows} · {formatCurrency(spend)} · {formatCurrency(revenue)}
              </p>
            </header>
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
                Այս խմբում արշավներ չկան։
              </p>
            ) : (
              <table className="w-full text-[var(--text-sm)]" role="table">
                <thead className="text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Name</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Channel</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Spend</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--color-surface-soft)]">
                      <td className="px-3 py-2 text-[var(--color-ink)]">{c.name}</td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">{c.channel ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                        {formatCurrency(c.spend)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-green)]">
                        {formatCurrency((c.paidRevenue ?? 0) + (c.acceptedRevenue ?? 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ────────── Budget view ────────── */

function BudgetView({
  data,
  loading,
  error,
}: {
  data: CampaignPerformanceResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading budget…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load budget.
      </p>
    );
  }

  const env = readEnvelope(data);
  if (!env) {
    return <EmptyState message="No budget data available." />;
  }

  const sorted = env.campaigns.slice().sort(compareCampaignsByRoiDesc);
  const totalSpend = campaignTotalSpend(env.campaigns);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Total budget"
          value={formatCurrency(totalSpend)}
          hint="Ընդհանուր բյուջե"
        />
        <KpiCard
          label="Top ROI"
          value={formatRoiPercent(sorted[0]?.roiPercent)}
          hint={sorted[0]?.name}
        />
        <KpiCard
          label="Active campaigns"
          value={String(
            env.campaigns.filter((c) => classifyCampaignStatus(c) === "active").length,
          )}
          hint="Ակտիվ արշավներ"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="campaigns-budget-row"
        data-count={String(sorted.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Name</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Spend</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Paid</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Accepted</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">ROI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {sorted.map((c) => {
              const tone = roiTone(c.roiPercent);
              return (
                <tr key={c.id} className="hover:bg-[var(--color-surface-soft)]">
                  <td className="px-3 py-2 text-[var(--color-ink)]">{c.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                    {formatCurrency(c.spend)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-green)]">
                    {formatCurrency(c.paidRevenue)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-blue)]">
                    {formatCurrency(c.acceptedRevenue)}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-mono", ROI_CLASS[tone])}>
                    {formatRoiPercent(c.roiPercent)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── Performance view ────────── */

function PerformanceView({
  data,
  loading,
  error,
}: {
  data: CampaignPerformanceResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading performance…</p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load performance.
      </p>
    );
  }

  const env = readEnvelope(data);
  if (!env) {
    return <EmptyState message="No performance data available." />;
  }

  const sorted = env.campaigns.slice().sort(compareCampaignsBySpendDesc);
  const totalLeads = campaignLeadCount(env.campaigns);
  const totalCustomers = campaignCustomerCount(env.campaigns);
  const totalPipeline = campaignInfluencedPipeline(env.campaigns);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Leads" value={formatAttributionCount(totalLeads)} hint="Լիդեր" tone="positive" />
        <KpiCard label="Customers" value={formatAttributionCount(totalCustomers)} hint="Հաճախորդներ" tone="positive" />
        <KpiCard
          label="Influenced pipeline"
          value={formatCurrency(totalPipeline)}
          hint="Ազդեցության խողովակ"
        />
        <KpiCard
          label="Attributions"
          value={formatAttributionCount(
            env.attributions.length || env.campaigns.reduce((s, c) => s + attributionCount(c), 0),
          )}
          hint="Ատրիբուցիաներ"
        />
      </div>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="campaigns-performance-funnel-row"
        data-count={String(sorted.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Name</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Leads</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Customers</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Deals</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Quotes</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Pipeline (AMD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {sorted.map((c) => (
              <tr key={c.id} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 text-[var(--color-ink)]">{c.name}</td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {formatAttributionCount(c.leadCount)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-green)]">
                  {formatAttributionCount(c.customerCount)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {formatAttributionCount(c.dealCount)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {formatAttributionCount(c.quoteCount)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-tag-blue)]">
                  {formatCurrency(c.influencedPipeline)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ────────── empty state ────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
      {message}
    </div>
  );
}
