/**
 * /app/flow/$ruleId — rule version history detail.
 *
 * Drills into a single automation rule from the Flow workspace.
 * Fetches `/api/workflow/rules/:id/versions` and renders the rule
 * header (name, trigger, action, enabled, approval required) plus a
 * version history table (version number, change type, who changed it,
 * when) and a small "latest dry-run" panel if present.
 *
 * Back-link returns to /app/flow with the rules view selected.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, CircleSlash, Workflow } from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  AutomationRuleVersionsResponseSchema,
  type AutomationRule,
  type AutomationRuleVersion,
  type AutomationRuleVersionsResponse,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  compareVersionsByNumberDesc,
  formatRelativeDate,
  formatStatusLabel,
  ruleEnabledTone,
  type RuleEnabledTone,
} from "../../../lib/flow/status";

/* ────────── typed URL search ────────── */

export const Route = createFileRoute("/app/flow/$ruleId")({
  validateSearch: () => ({}),
  component: RuleDetail,
});

/* ────────── tones ────────── */

const RULE_TONE: Record<RuleEnabledTone, { bg: string; fg: string; label: string }> = {
  enabled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Enabled",
  },
  disabled: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Disabled",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Unknown",
  },
};

/* ────────── root component ────────── */

function RuleDetail() {
  const { ruleId } = Route.useParams();

  const q = useQuery({
    queryKey: ["flow-rule-versions", ruleId],
    queryFn: async () => {
      const raw = await getJson(
        `/api/workflow/rules/${encodeURIComponent(ruleId)}/versions`,
      );
      return AutomationRuleVersionsResponseSchema.parse(raw) as AutomationRuleVersionsResponse;
    },
    enabled: Boolean(ruleId),
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader ruleId={ruleId} />
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Loading rule…</p>
      </div>
    );
  }

  if (q.isError || !q.data || q.data.versions.length === 0 && !q.data.rule) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
        <PageHeader ruleId={ruleId} />
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          <CircleSlash className="mx-auto mb-2 size-5 opacity-50" />
          {q.isError ? "Failed to load rule." : "No versions for this rule."}
        </div>
        <BackLink />
      </div>
    );
  }

  const rule: AutomationRule = q.data.rule;
  const versions: AutomationRuleVersion[] = q.data.versions ?? [];
  const sorted = versions.slice().sort(compareVersionsByNumberDesc);
  const tone = ruleEnabledTone(rule);
  const lastDryRun = rule.lastDryRun ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader ruleId={ruleId} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Current version" value={String(rule.currentVersion ?? "—")} hint="Տարբերակ" />
        <KpiCard
          label="Status"
          value={RULE_TONE[tone].label}
          hint={rule.approvalRequired ? "Approval required" : "Auto-execute"}
        />
        <KpiCard
          label="Total versions"
          value={String(sorted.length)}
          hint="Ընդհանուր տարբերակներ"
        />
        <KpiCard
          label="Last dry-run"
          value={lastDryRun ? formatStatusLabel(lastDryRun.status) : "—"}
          hint={lastDryRun ? formatRelativeDate(lastDryRun.createdAt) : "Never"}
        />
      </section>

      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        data-entity="flow-rule-meta"
      >
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">{rule.name}</h2>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-[var(--text-sm)] sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">Trigger</dt>
            <dd className="font-mono text-[var(--color-ink)]">{rule.trigger ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">Action</dt>
            <dd className="font-mono text-[var(--color-ink)]">{rule.action ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
        data-entity="flow-rule-version"
        data-count={String(sorted.length)}
      >
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Version</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Change type</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Reason</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Changed by</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {sorted.map((v) => (
              <tr key={v.id} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  v{v.versionNumber ?? "—"}
                </td>
                <td className="px-3 py-2 text-[var(--color-ink)]">{v.changeType ?? "—"}</td>
                <td className={cn("px-3 py-2 text-[var(--color-muted)]", !v.reason && "italic")}>
                  {v.reason ?? "(no reason)"}
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  {v.changedByName ?? v.changedByUserId ?? "—"}
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  {formatRelativeDate(v.changedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <BackLink />
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader({ ruleId }: { ruleId: string }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Workflow className="size-3" />
        Flow · Rule
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        Կանոնի տարբերակների պատմություն
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Rule versions for <span className="font-mono">{ruleId}</span>
      </p>
    </header>
  );
}

/* ────────── KPI card ────────── */

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className="mt-1 font-mono text-[var(--text-lg)] text-[var(--color-ink)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/* ────────── back link ────────── */

function BackLink() {
  return (
    <Link
      to="/app/flow"
      search={{ view: "rules" }}
      className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ChevronLeft className="size-3.5" />
      Back to Flow
    </Link>
  );
}
