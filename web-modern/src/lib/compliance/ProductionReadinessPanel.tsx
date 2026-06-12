/**
 * ProductionReadinessPanel — co-panel mounted inside the CFO dashboard
 * that surfaces the GET /api/compliance/production-readiness roll-up.
 *
 * Direct port of web/src/compliance.jsx#ProductionReadinessPanel
 * (Phase 8.10 layer 2). Renders the same three-block layout
 * (summary metrics + blocker banner + gate rows + meta row) using
 * the same Armenian-first bilingual style as the rest of the modern
 * shell. The Zod schema for the data prop is
 * `ProductionReadinessReadinessSchema` from
 * web-modern/src/lib/api/schemas.ts; the parsing happens at the
 * route boundary (see /app/cfo), this component trusts its input
 * shape.
 *
 * Data-testid contract (also asserted in e2e/compliance.spec.ts):
 *   - compliance-readiness-panel            → <article> root
 *   - compliance-readiness-status           → top-right pill ("Ready"/"Blocked")
 *   - compliance-readiness-summary-{total,passed,blocked} → metric cells
 *   - compliance-readiness-blocker-banner   → Armenian banner when blockers.length > 0
 *   - compliance-readiness-gate-row         → each gate row (data-gate-key={key})
 *   - compliance-readiness-as-of            → meta row "as of {asOf}"
 *   - compliance-readiness-review-flag      → meta row "review required" / "production-ready"
 */
import {
  formatProductionEffectiveDate,
  formatProductionPassBadge,
  formatProductionRate,
  formatProductionReviewFlag,
  formatProductionStatusBadgeClass,
  formatProductionStatusLabel,
  formatProductionStatusLabelHy,
} from "./status";
import type {
  ProductionReadinessGate,
  ProductionReadinessReadiness,
} from "../api/schemas";

/* ────────── props ────────── */

export interface ProductionReadinessPanelProps {
  /** Fully-parsed readiness object. Falsy is treated as "panel
   *  hidden" (matches the legacy null-return). The route decides
   *  whether to render the panel at all based on RBAC. */
  data: ProductionReadinessReadiness | null | undefined;
}

/* ────────── root component ────────── */

export function ProductionReadinessPanel({
  data,
}: ProductionReadinessPanelProps) {
  const readiness = data ?? null;
  if (!readiness) return null;

  const gates = readiness.gates ?? [];
  const blockers = readiness.blockers ?? [];
  const summary = readiness.summary;
  const total = summary?.total ?? gates.length;
  const passed = summary?.passed ?? 0;
  const blocked = summary?.blocked ?? blockers.length;

  return (
    <article
      className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm"
      data-testid="compliance-readiness-panel"
      data-entity="compliance-readiness-panel"
      data-status={readiness.status}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            Production readiness
          </span>
          <h2 className="mt-1 text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
            <span lang="hy">Մասնագիտական վերանայման gate</span>{" "}
            <span className="text-[var(--color-muted)]">
              (Professional review gate)
            </span>
          </h2>
        </div>
        <span
          data-testid="compliance-readiness-status"
          data-status={readiness.status}
          className={statusBadgeClass(readiness.status)}
        >
          <span lang="hy">{formatProductionStatusLabelHy(readiness)}</span>{" "}
          <span className="opacity-75">
            ({formatProductionStatusLabel(readiness)})
          </span>
        </span>
      </header>

      <div
        className="mt-4 grid grid-cols-3 gap-3"
        data-testid="compliance-readiness-summary"
      >
        <SummaryMetric
          label="բոլոր gate-երը"
          labelEn="Total gates"
          value={total}
          testid="compliance-readiness-summary-total"
        />
        <SummaryMetric
          label="անցած"
          labelEn="Passed"
          value={passed}
          tone="positive"
          testid="compliance-readiness-summary-passed"
        />
        <SummaryMetric
          label="արգելափակող"
          labelEn="Blocked"
          value={blocked}
          tone={blocked > 0 ? "negative" : "default"}
          testid="compliance-readiness-summary-blocked"
        />
      </div>

      {blockers.length > 0 && (
        <p
          data-testid="compliance-readiness-blocker-banner"
          className="mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-tag-red)_40%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-tag-red)_8%,var(--color-surface))] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          role="note"
        >
          Արտադրական օգտագործումը արգելափակված է մինչեւ հաշվապահի/իրավաբանի
          վերանայումը:{" "}
          <span className="text-[var(--color-muted)]">
            (Production use is blocked until accountant/lawyer review.)
          </span>
        </p>
      )}

      <section
        className="mt-4 divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]"
        data-testid="compliance-readiness-gates"
        data-count={String(gates.length)}
      >
        {gates.map((gate) => (
          <GateRow key={gate.key} gate={gate} />
        ))}
      </section>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-muted)]">
        <span data-testid="compliance-readiness-as-of">
          as of {readiness.asOf}
        </span>
        <span data-testid="compliance-readiness-review-flag">
          {formatProductionReviewFlag(readiness)}
        </span>
      </footer>
    </article>
  );
}

/* ────────── subcomponents ────────── */

function SummaryMetric({
  label,
  labelEn,
  value,
  tone = "default",
  testid,
}: {
  label: string;
  labelEn: string;
  value: number;
  tone?: "default" | "positive" | "negative";
  testid: string;
}) {
  const valueClass =
    tone === "positive"
      ? "text-[var(--color-tag-green)]"
      : tone === "negative"
        ? "text-[var(--color-tag-red)]"
        : "text-[var(--color-ink)]";
  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3"
      data-testid={testid}
    >
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <span lang="hy">{label}</span> · {labelEn}
      </p>
      <p className={`mt-1 font-mono text-[var(--text-lg)] ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function GateRow({ gate }: { gate: ProductionReadinessGate }) {
  const pass = formatProductionPassBadge(gate);
  const effective = formatProductionEffectiveDate(gate);
  const rate = formatProductionRate(gate.rate);
  const hasRate = typeof gate.rate === "number" && Number.isFinite(gate.rate);
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
      data-testid="compliance-readiness-gate-row"
      data-gate-key={gate.key}
      data-pass={gate.pass ? "true" : "false"}
    >
      <div className="min-w-0 flex-1 text-[var(--text-sm)]">
        <p>
          <strong className="font-semibold text-[var(--color-ink)]">
            {gate.label}
          </strong>{" "}
          <span className="text-[var(--color-muted)]">
            · {gate.ownerRole} · {effective}
            {hasRate ? ` · ${rate}` : ""}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] italic text-[var(--color-muted)]">
          {gate.nextAction}
        </p>
      </div>
      <span
        data-testid={`compliance-readiness-gate-pass-${gate.key}`}
        data-pass={pass}
        className={gatePassClass(pass)}
      >
        {pass}
      </span>
    </div>
  );
}

/* ────────── tone classes (top-level constants, not strings) ────────── */

function statusBadgeClass(status: ProductionReadinessReadiness["status"]): string {
  const tone = formatProductionStatusBadgeClass({ status });
  return tone === "ok"
    ? "inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-tag-green)]"
    : "inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-tag-red)]";
}

function gatePassClass(pass: "pass" | "review"): string {
  return pass === "pass"
    ? "inline-flex items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-tag-green)]"
    : "inline-flex items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-tag-orange)]";
}
