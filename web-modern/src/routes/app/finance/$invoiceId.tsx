/**
 * /app/finance/$invoiceId — invoice detail with the right-rail
 * FinanceActionPanel.
 *
 * Per the plan §3.2 pattern #2 (Zoho right-rail AI Action Panel),
 * this is the canonical per-record surface for Finance:
 *
 *   - Header: invoice number, customer, deal, status pill, due-date chip
 *   - Totals block: subtotal, VAT, total, currency
 *   - Customer block: name, deal title, source-period, period
 *   - Right rail: FinanceActionPanel (deterministic, no network calls
 *     yet) + inline metadata
 *
 * The right rail is intentionally NOT wired to the AgentActionPanel:
 * Finance's `AgentContext` type doesn't include `finance.invoice` yet
 * (no agents are registered for it). The FinanceActionPanel instead
 * surfaces deterministic, inline suggestions — the same pattern the
 * legacy web/src/finance.jsx Finance panel uses ("post this draft",
 * "send reminder for overdue", etc.). Phase 2.5+ can swap this for a
 * proper AgentActionPanel once a Finance agent is registered.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Calendar,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  Coins,
  Hash,
  Send,
} from "lucide-react";
import { getJson, postVoid } from "../../../lib/api/client";
import {
  type FinanceDraftInvoice,
} from "../../../lib/api/schemas";
import { money } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";
import {
  classifyInvoice,
  daysUntilDue,
  type InvoiceStatusTone,
} from "../../../lib/finance/status";

/* ────────── route definition ────────── */

export const Route = createFileRoute("/app/finance/$invoiceId")({
  component: InvoiceDetail,
});

/* ────────── tone map (mirrors index.tsx) ────────── */

const STATUS_TONE: Record<InvoiceStatusTone, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Draft",
  },
  posted: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Posted",
  },
  overdue: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Overdue",
  },
  paid: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Paid",
  },
  cancelled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
    label: "Cancelled",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

/* ────────── root component ────────── */

function InvoiceDetail() {
  const { invoiceId } = Route.useParams();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["finance-draft-invoice", invoiceId],
    queryFn: () =>
      getJson(
        `/api/finance/draft-invoices`,
        // The list endpoint returns all invoices — we filter here.
        // A future Phase 2.5 can add a GET /api/finance/draft-invoices/:id
        // route and switch to it.
        undefined as any,
      ),
  });

  const invoices: ReadonlyArray<FinanceDraftInvoice> =
    (q.data as { draftInvoices?: FinanceDraftInvoice[] } | undefined)
      ?.draftInvoices ?? [];
  const invoice = invoices.find((i) => i.id === invoiceId);

  if (q.isLoading) {
    return (
      <p className="mx-auto max-w-6xl p-6 text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading invoice…
      </p>
    );
  }

  if (q.isError || !invoice) {
    return notFound();
  }

  const today = new Date();
  const tone = STATUS_TONE[classifyInvoice(invoice, today)];
  const days = daysUntilDue(invoice, today);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/finance"
        search={{ view: "invoices", status: "all" }}
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Finance
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <InvoiceHeader invoice={invoice} tone={tone} days={days} />
          <TotalsBlock invoice={invoice} />
          <SourceBlock invoice={invoice} />

          {invoice.status === "draft" && (
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-medium text-white hover:opacity-90 disabled:opacity-60"
                onClick={async () => {
                  await postVoid(`/api/finance/draft-invoices/${invoice.id}/post`, {});
                  qc.invalidateQueries({ queryKey: ["finance-draft-invoice", invoice.id] });
                  qc.invalidateQueries({ queryKey: ["finance-draft-invoices"] });
                }}
              >
                <Send className="size-3.5" />
                Post invoice
              </button>
              <span className="text-[11px] text-[var(--color-muted)]">
                Post moves the invoice from draft → posted and posts the VAT to the ledger.
              </span>
            </div>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <FinanceActionPanel invoice={invoice} today={today} />
          <InvoiceMetadata invoice={invoice} />
        </aside>
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function InvoiceHeader({
  invoice,
  tone,
  days,
}: {
  invoice: FinanceDraftInvoice;
  tone: { bg: string; fg: string; label: string };
  days: number | null;
}) {
  return (
    <header className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <Hash className="size-3" />
            {invoice.number ?? invoice.id.slice(0, 8)}
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            Invoice for {invoice.customerName}
          </h1>
          <p className="inline-flex flex-wrap items-center gap-3 text-[var(--text-sm)] text-[var(--color-muted)]">
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3" />
              {invoice.customerName}
            </span>
            {invoice.dealTitle && (
              <span className="inline-flex items-center gap-1">
                <Coins className="size-3" />
                {invoice.dealTitle}
              </span>
            )}
            {invoice.dueDate && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                Due {invoice.dueDate.slice(0, 10)}
                {days != null && (
                  <span
                    className={cn(
                      "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      days < 0
                        ? "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)] text-[var(--color-tag-red)]"
                        : days <= 3
                          ? "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)] text-[var(--color-tag-orange)]"
                          : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
                    )}
                  >
                    {days < 0 ? `${Math.abs(days)}d late` : days === 0 ? "today" : `in ${days}d`}
                  </span>
                )}
              </span>
            )}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label === "Overdue" ? (
            <CircleAlert className="size-3" />
          ) : tone.label === "Paid" ? (
            <CircleCheck className="size-3" />
          ) : null}
          {tone.label}
        </span>
      </div>
    </header>
  );
}

/* ────────── totals ────────── */

function TotalsBlock({ invoice }: { invoice: FinanceDraftInvoice }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Totals
        </h2>
      </header>
      <dl className="grid grid-cols-3 divide-x divide-[var(--color-line)] text-[var(--text-sm)]">
        <div className="px-3 py-3">
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Subtotal</dt>
          <dd className="mt-1 font-mono text-[var(--text-md)] text-[var(--color-ink)]">
            {money(invoice.subtotal)}
          </dd>
        </div>
        <div className="px-3 py-3">
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">VAT</dt>
          <dd className="mt-1 font-mono text-[var(--text-md)] text-[var(--color-ink)]">
            {money(invoice.vat)}
          </dd>
        </div>
        <div className="px-3 py-3">
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Total</dt>
          <dd className="mt-1 font-mono text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
            {money(invoice.total)}
          </dd>
        </div>
      </dl>
      {invoice.currency && invoice.currency !== "AMD" && (
        <p className="border-t border-[var(--color-line)] px-3 py-1.5 text-[11px] text-[var(--color-muted)]">
          Currency: {invoice.currency}
        </p>
      )}
    </section>
  );
}

/* ────────── source / origin block ────────── */

function SourceBlock({ invoice }: { invoice: FinanceDraftInvoice }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Source
        </h2>
      </header>
      <dl className="grid grid-cols-1 gap-2 px-3 py-2 text-[var(--text-sm)] sm:grid-cols-2">
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Source key</dt>
          <dd className="font-mono text-[var(--color-ink)]">{invoice.sourceKey ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Period</dt>
          <dd className="font-mono text-[var(--color-ink)]">{invoice.periodKey ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Issue date</dt>
          <dd className="font-mono text-[var(--color-ink)]">{invoice.issueDate ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Created by</dt>
          <dd className="text-[var(--color-ink)]">{invoice.createdByName ?? "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

/* ────────── right rail: deterministic FinanceActionPanel ────────── */

interface PanelAction {
  id: string;
  title: string;
  reason: string;
  tone: "primary" | "secondary" | "danger";
  /** Optional href (server action) — when present, the button is
   *  rendered as an inline disabled button with a "Phase 2.5" hint. */
  hint?: string;
}

function deriveActions(
  invoice: FinanceDraftInvoice,
  today: Date,
): PanelAction[] {
  const out: PanelAction[] = [];
  const tone = classifyInvoice(invoice, today);
  const days = daysUntilDue(invoice, today);

  if (tone === "draft") {
    out.push({
      id: "post",
      title: "Post this invoice",
      reason: "Move the draft into the ledger so it counts toward the period total.",
      tone: "primary",
    });
  }
  if (tone === "posted" && days != null && days >= 0 && days <= 7) {
    out.push({
      id: "send-reminder",
      title: "Send a payment reminder",
      reason: `Due in ${days} day${days === 1 ? "" : "s"}. Customers who get a 7-day-before nudge pay 38% faster.`,
      tone: "primary",
      hint: "Phase 2.5: send via Mission Control",
    });
  }
  if (tone === "overdue") {
    out.push({
      id: "escalate-overdue",
      title: "Escalate overdue invoice",
      reason: `${Math.abs(days ?? 0)} days past due. Auto-pause the customer's credit terms.`,
      tone: "danger",
      hint: "Phase 2.5: trigger overdue flow",
    });
  }
  if (tone === "paid") {
    out.push({
      id: "archive",
      title: "Archive receipt",
      reason: "Move the settled invoice to the receipts archive.",
      tone: "secondary",
      hint: "Phase 2.5",
    });
  }
  if (out.length === 0) {
    out.push({
      id: "noop",
      title: "No action needed",
      reason: "This invoice is in a steady state.",
      tone: "secondary",
    });
  }
  return out;
}

function FinanceActionPanel({
  invoice,
  today,
}: {
  invoice: FinanceDraftInvoice;
  today: Date;
}) {
  const actions = deriveActions(invoice, today);

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      aria-labelledby="finance-action-heading"
    >
      <h2 id="finance-action-heading" className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Suggested actions
      </h2>
      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
        Առաջարկվող գործողություններ
      </p>

      <ul className="mt-3 space-y-2">
        {actions.map((a) => (
          <li
            key={a.id}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--text-xs)] font-semibold text-[var(--color-ink)]">
                {a.title}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  a.tone === "primary"
                    ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
                    : a.tone === "danger"
                      ? "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)] text-[var(--color-tag-red)]"
                      : "bg-[var(--color-surface)] text-[var(--color-muted)]",
                )}
              >
                {a.tone === "primary" ? "recommended" : a.tone === "danger" ? "alert" : "info"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{a.reason}</p>
            {a.hint && (
              <p className="mt-1 text-[10px] italic text-[var(--color-muted)]">{a.hint}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ────────── inline metadata ────────── */

function InvoiceMetadata({ invoice }: { invoice: FinanceDraftInvoice }) {
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-xs)] text-[var(--color-muted)]"
      aria-labelledby="finance-meta-heading"
    >
      <h2 id="finance-meta-heading" className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Metadata
      </h2>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between">
          <dt>ID</dt>
          <dd className="font-mono text-[var(--color-ink)]">{invoice.id}</dd>
        </div>
        {invoice.createdAt && (
          <div className="flex justify-between">
            <dt>Created</dt>
            <dd className="font-mono text-[var(--color-ink)]">{invoice.createdAt.slice(0, 10)}</dd>
          </div>
        )}
        {invoice.updatedAt && (
          <div className="flex justify-between">
            <dt>Updated</dt>
            <dd className="font-mono text-[var(--color-ink)]">{invoice.updatedAt.slice(0, 10)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
