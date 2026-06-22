/**
 * /app/purchase/$orderId — purchase order detail.
 *
 * Mirrors finance/$invoiceId / people/$employeeId pattern. Three blocks:
 *   - Header: order #, vendor, status pill, dates
 *   - Totals: subtotal, VAT, total (in order currency, Armenian grouping)
 *   - Lines: catalog SKU · description · qty · received · remaining · unit cost · line total
 *   - Right rail: PurchaseActionPanel (deterministic) + metadata
 *
 * Data:
 *   - /api/purchase/orders/:id
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Truck,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  PurchaseOrderSchema,
  type PurchaseCreditNote,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  classifyOrderStatus,
  formatCurrency,
  lineRemainingQuantity,
  orderProgress,
  orderTotals,
  type OrderTone,
} from "../../../lib/purchase/status";

/* ────────── route definition ────────── */

export const Route = createFileRoute("/app/purchase/$orderId")({
  component: PurchaseOrderDetail,
});

/* ────────── tone map ────────── */

const ORDER_TONE: Record<OrderTone, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Draft",
  },
  confirmed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
    label: "Confirmed",
  },
  partial: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
    label: "Partial",
  },
  received: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Received",
  },
  billed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-purple)_15%,transparent)]",
    fg: "text-[var(--color-tag-purple)]",
    label: "Billed",
  },
  cancelled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Cancelled",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

/* ────────── root component ────────── */

function PurchaseOrderDetail() {
  const { orderId } = Route.useParams();
  const q = useQuery({
    queryKey: ["purchase-order", orderId],
    queryFn: async () => {
      const raw = await getJson(`/api/purchase/orders/${orderId}`);
      return PurchaseOrderSchema.parse(raw);
    },
  });

  if (q.isLoading) {
    return (
      <p className="mx-auto max-w-6xl p-6 text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading order…
      </p>
    );
  }
  if (q.isError || !q.data) {
    return notFound();
  }

  const order = q.data;
  const lines = order.lines ?? [];
  const tone = ORDER_TONE[classifyOrderStatus(order)];
  const totals = orderTotals(order);
  const progress = orderProgress(order);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <Link
        to="/app/purchase"
        search={{ view: "orders" }}
        className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        Purchase
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <OrderHeader order={order} tone={tone} />
          <TotalsBlock totals={totals} currency={order.currency ?? "AMD"} progress={progress} />
          <OrderLines lines={lines} currency={order.currency ?? "AMD"} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <PurchaseActionPanel order={order} />
          <ReturnCreditNotesPanel order={order} />
          <OrderMetadata order={order} />
        </aside>
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function OrderHeader({
  order,
  tone,
}: {
  order: PurchaseOrder;
  tone: { bg: string; fg: string; label: string };
}) {
  return (
    <header className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <Truck className="size-3" />
            {order.orderNumber ?? order.id.slice(0, 8)}
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            {order.vendorName ?? order.supplier ?? "Purchase order"}
          </h1>
          <p className="inline-flex flex-wrap items-center gap-3 text-[var(--text-sm)] text-[var(--color-muted)]">
            {order.orderDate && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                Ordered {order.orderDate.slice(0, 10)}
              </span>
            )}
            {order.expectedDate && (
              <span>· Expected {order.expectedDate.slice(0, 10)}</span>
            )}
            {order.createdByName && <span>· by {order.createdByName}</span>}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label === "Received" || tone.label === "Billed" ? (
            <CircleCheck className="size-3" />
          ) : tone.label === "Cancelled" ? (
            <CircleX className="size-3" />
          ) : null}
          {tone.label}
        </span>
      </div>
    </header>
  );
}

/* ────────── totals block ────────── */

function TotalsBlock({
  totals,
  currency,
  progress,
}: {
  totals: ReturnType<typeof orderTotals>;
  currency: string;
  progress: number | null;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Totals
        </h2>
      </header>
      <dl className="grid grid-cols-2 gap-2 px-3 py-2 text-[var(--text-sm)] sm:grid-cols-4">
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Subtotal</dt>
          <dd className="font-mono text-[var(--text-md)] text-[var(--color-ink)]">
            {formatCurrency(totals.subtotal, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">VAT</dt>
          <dd className="font-mono text-[var(--text-md)] text-[var(--color-ink)]">
            {formatCurrency(totals.vat, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Total</dt>
          <dd className="font-mono text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
            {formatCurrency(totals.total, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-xs)] text-[var(--color-muted)]">Receipts</dt>
          <dd className="font-mono text-[var(--text-md)] text-[var(--color-ink)]">
            {progress == null ? "—" : `${Math.round(progress * 100)}%`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/* ────────── order lines ────────── */

function OrderLines({
  lines,
  currency,
}: {
  lines: PurchaseOrderLine[];
  currency: string;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Lines
        </h2>
        <p className="text-[11px] text-[var(--color-muted)]">{lines.length} item{lines.length === 1 ? "" : "s"}</p>
      </header>

      {lines.length === 0 ? (
        <p
          className="px-3 py-4 text-[var(--text-sm)] text-[var(--color-muted)]"
          data-entity="purchase-order-line"
          data-count="0"
        >
          No line items on this order.
        </p>
      ) : (
        <table
          className="w-full text-[var(--text-sm)]"
          role="table"
          data-entity="purchase-order-line"
          data-count={String(lines.length)}
        >
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                SKU
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Description
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Qty
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Received
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Remaining
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Unit cost
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Line total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {lines.map((line) => (
              <tr key={line.id} className="hover:bg-[var(--color-surface-soft)]">
                <td className="px-3 py-2 font-mono text-[var(--color-ink)]">
                  {line.catalogSku ?? "—"}
                </td>
                <td className="px-3 py-2 text-[var(--color-ink)]">
                  {line.catalogName ?? line.description ?? "—"}
                  {line.unitOfMeasure && (
                    <span className="ml-1 text-[10px] text-[var(--color-muted)]">
                      · {line.unitOfMeasure}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {line.quantity ?? 0}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {line.receivedQuantity ?? 0}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
                  {lineRemainingQuantity(line)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
                  {line.unitCost == null ? "—" : formatCurrency(line.unitCost, currency)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--color-ink)]">
                  {line.total == null ? "—" : formatCurrency(line.total, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ────────── right rail: deterministic action panel ────────── */

interface PanelAction {
  id: string;
  title: string;
  reason: string;
  tone: "primary" | "secondary" | "danger";
  hint?: string;
}

function deriveActions(order: PurchaseOrder): PanelAction[] {
  const out: PanelAction[] = [];
  const tone = classifyOrderStatus(order);

  if (tone === "draft") {
    out.push({
      id: "confirm-order",
      title: "Confirm this order",
      reason: "Move the order from draft to confirmed and notify the vendor.",
      tone: "primary",
    });
  }
  if (tone === "confirmed" || tone === "partial") {
    out.push({
      id: "record-receipt",
      title: "Record a receipt",
      reason: "Post a goods receipt against the remaining line quantities.",
      tone: "primary",
    });
  }
  if (tone === "partial") {
    out.push({
      id: "return-line",
      title: "Return damaged items",
      reason: "Some lines have been received; others remain pending. Return a partial amount if needed.",
      tone: "secondary",
      hint: "Phase 2.5",
    });
  }
  if (tone === "received") {
    out.push({
      id: "bill-order",
      title: "Convert to supplier bill",
      reason: "The order is fully received — post it to accounts payable as a bill.",
      tone: "primary",
    });
  }
  if (tone === "billed") {
    out.push({
      id: "settle-bill",
      title: "Settle the bill",
      reason: "The bill is open. Pay it from the bank or schedule the payment.",
      tone: "secondary",
      hint: "Phase 2.5",
    });
  }
  if (tone === "cancelled") {
    out.push({
      id: "reopen-order",
      title: "Reopen the order",
      reason: "Cancelled orders can be re-opened if the vendor will fulfill after all.",
      tone: "secondary",
      hint: "Phase 2.5",
    });
  }
  if (out.length === 0) {
    out.push({
      id: "noop",
      title: "No action needed",
      reason: "This order is in a steady state.",
      tone: "secondary",
    });
  }
  return out;
}

function PurchaseActionPanel({ order }: { order: PurchaseOrder }) {
  const actions = deriveActions(order);

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      aria-labelledby="purchase-action-heading"
    >
      <h2 id="purchase-action-heading" className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
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

/* ────────── right rail: read-only billed-return credit notes ────────── */

function ReturnCreditNotesPanel({ order }: { order: PurchaseOrder }) {
  const creditNotes = order.creditNotes ?? [];
  const currency = creditNotes[0]?.currency || order.currency || "AMD";
  const total = creditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);

  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      aria-labelledby="purchase-return-credit-notes-heading"
      data-entity="purchase-return-credit-note"
      data-count={String(creditNotes.length)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2
            id="purchase-return-credit-notes-heading"
            className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]"
          >
            <FileText className="size-3.5" /> Return credit notes
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
            Billed-return evidence
          </p>
        </div>
        <span className="font-mono text-[var(--text-xs)] font-semibold text-[var(--color-tag-red)]">
          {formatCurrency(total, currency)}
        </span>
      </div>

      {creditNotes.length === 0 ? (
        <p className="mt-3 text-[11px] text-[var(--color-muted)]">
          No return credit notes recorded.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {creditNotes.map((note) => (
            <ReturnCreditNoteItem
              key={note.id}
              note={note}
              fallbackCurrency={currency}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReturnCreditNoteItem({
  note,
  fallbackCurrency,
}: {
  note: PurchaseCreditNote;
  fallbackCurrency: string;
}) {
  const ledgerPostingIds = note.ledgerPostingIds ?? [];
  const evidenceDate = creditNoteDate(note.postedAt ?? note.createdAt);

  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] font-semibold text-[var(--color-ink)]">
            {note.id}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            {note.status || "status unknown"}
            {evidenceDate ? ` · ${evidenceDate}` : ""}
          </p>
        </div>
        <span className="font-mono text-[var(--text-xs)] font-semibold text-[var(--color-ink)]">
          {formatCurrency(note.amount, note.currency || fallbackCurrency)}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-[var(--color-muted)]">
        {note.billId && (
          <>
            <dt>Bill</dt>
            <dd className="truncate text-right font-mono text-[var(--color-ink)]">{note.billId}</dd>
          </>
        )}
        {note.returnId && (
          <>
            <dt>Return</dt>
            <dd className="truncate text-right font-mono text-[var(--color-ink)]">{note.returnId}</dd>
          </>
        )}
        {ledgerPostingIds.length > 0 && (
          <>
            <dt>Ledger</dt>
            <dd className="text-right font-mono text-[var(--color-ink)]">
              {ledgerPostingIds.join(", ")}
            </dd>
          </>
        )}
        {(note.createdByName || note.createdAt) && (
          <>
            <dt>Created</dt>
            <dd className="text-right text-[var(--color-ink)]">
              {[note.createdByName, creditNoteDate(note.createdAt)]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </>
        )}
      </dl>

      {note.note && (
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">{note.note}</p>
      )}
    </li>
  );
}

function creditNoteDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

/* ────────── inline metadata ────────── */

function OrderMetadata({ order }: { order: PurchaseOrder }) {
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-xs)] text-[var(--color-muted)]"
      aria-labelledby="purchase-meta-heading"
    >
      <h2 id="purchase-meta-heading" className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Metadata
      </h2>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between">
          <dt>ID</dt>
          <dd className="font-mono text-[var(--color-ink)]">{order.id}</dd>
        </div>
        {order.vendorId && (
          <div className="flex justify-between">
            <dt>Vendor ID</dt>
            <dd className="font-mono text-[var(--color-ink)]">{order.vendorId}</dd>
          </div>
        )}
        {order.billId && (
          <div className="flex justify-between">
            <dt>Bill</dt>
            <dd className="font-mono text-[var(--color-ink)]">{order.billId}</dd>
          </div>
        )}
        {order.receivedAt && (
          <div className="flex justify-between">
            <dt>Received at</dt>
            <dd className="font-mono text-[var(--color-ink)]">{order.receivedAt.slice(0, 10)}</dd>
          </div>
        )}
        {order.confirmedAt && (
          <div className="flex justify-between">
            <dt>Confirmed at</dt>
            <dd className="font-mono text-[var(--color-ink)]">{order.confirmedAt.slice(0, 10)}</dd>
          </div>
        )}
        {order.updatedAt && (
          <div className="flex justify-between">
            <dt>Updated</dt>
            <dd className="font-mono text-[var(--color-ink)]">{order.updatedAt.slice(0, 10)}</dd>
          </div>
        )}
        {order.note && (
          <div className="mt-2">
            <dt>Note</dt>
            <dd className="text-[var(--color-ink)]">{order.note}</dd>
          </div>
        )}
        {order.createdByName && (
          <div className="flex justify-between">
            <dt>Created by</dt>
            <dd className="font-mono text-[var(--color-ink)]">{order.createdByName}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-[10px] text-[var(--color-muted)]">
        <FileText className="mr-1 inline size-3 align-text-bottom" />
        Totals rendered in {order.currency ?? "AMD"}.
      </p>
    </section>
  );
}
