/**
 * /app/purchase — Purchase workspace: vendors | orders | analytics.
 *
 * Mirrors finance/ inventory/ people/ pattern (Pattern A from the plan
 * §3.4). The home route is a ViewSwitcher over three surfaces:
 *
 *   - **Vendors** — the registry of every vendor in the org. Each row
 *     shows name · tax ID · contact · status pill · terms. Click a row
 *     → (Phase 2.5 vendor detail surface; not built yet).
 *   - **Orders** — every purchase order sorted actionable first (draft
 *     → confirmed → partial → received → billed → cancelled), date desc
 *     within each status. Click → /app/purchase/$orderId (per-order
 *     detail with lines, receipts, returns).
 *   - **Analytics** — read-only KPIs pulled from
 *     /api/purchase/analytics: order count, vendor count, open value,
 *     billed value, receipt progress, price coverage.
 *
 * URL state:
 *   ?view=vendors | orders | analytics
 *
 * Data:
 *   - /api/purchase/vendors
 *   - /api/purchase/orders
 *   - /api/purchase/analytics
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronLeft,
  CircleCheck,
  CircleX,
  FileText,
  Package,
  PackageSearch,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";
import { getJson } from "../../../lib/api/client";
import {
  PurchaseAnalyticsResponseSchema,
  PurchaseOrdersResponseSchema,
  PurchaseVendorsResponseSchema,
  type PurchaseOrder,
  type PurchaseVendor,
} from "../../../lib/api/schemas";
import { ViewSwitcher } from "../../../components/view-switcher/ViewSwitcher";
import { money } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";
import {
  classifyOrderStatus,
  classifyVendor,
  compareOrdersByStatusThenDate,
  compareVendorsByName,
  formatCurrency,
  orderProgress,
  orderTotals,
  priceCoverage,
  sumAllValue,
  sumBilledValue,
  sumOpenValue,
  type OrderTone,
  type VendorTone,
} from "../../../lib/purchase/status";

/* ────────── typed URL search ────────── */

type View = "vendors" | "orders" | "analytics";

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "vendors", label: "Vendors" },
  { value: "orders", label: "Orders" },
  { value: "analytics", label: "Analytics" },
];

export const Route = createFileRoute("/app/purchase/")({
  validateSearch: (raw) => {
    const v: View =
      raw.view === "orders" || raw.view === "analytics" ? raw.view : "vendors";
    return { view: v };
  },
  component: PurchaseWorkspace,
});

/* ────────── tone maps ────────── */

const VENDOR_TONE: Record<VendorTone, { bg: string; fg: string; label: string }> = {
  active: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Active",
  },
  inactive: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "Inactive",
  },
  blocked: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Blocked",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
    label: "—",
  },
};

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

function PurchaseWorkspace() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;

  const setView = (next: View) => navigate({ search: { view: next }, replace: true });

  const vendorsQ = useQuery({
    queryKey: ["purchase-vendors"],
    queryFn: async () => {
      const raw = await getJson("/api/purchase/vendors");
      return PurchaseVendorsResponseSchema.parse(raw);
    },
  });
  const ordersQ = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: async () => {
      const raw = await getJson("/api/purchase/orders");
      return PurchaseOrdersResponseSchema.parse(raw);
    },
  });
  const analyticsQ = useQuery({
    queryKey: ["purchase-analytics"],
    queryFn: async () => {
      const raw = await getJson("/api/purchase/analytics");
      return PurchaseAnalyticsResponseSchema.parse(raw);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <div className="flex items-center gap-3">
          <Link
            to="/app/purchase/procurement"
            data-testid="purchase-toolbar-procurement"
            data-entity="purchase-toolbar-procurement"
            className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <ShoppingCart className="size-3.5" />
            Procurement
          </Link>
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <ChevronLeft className="size-3.5" />
            Today
          </Link>
        </div>
      </div>

      {view === "vendors" && (
        <VendorsView
          data={vendorsQ.data}
          loading={vendorsQ.isLoading}
          error={vendorsQ.isError}
        />
      )}
      {view === "orders" && (
        <OrdersView
          data={ordersQ.data}
          loading={ordersQ.isLoading}
          error={ordersQ.isError}
        />
      )}
      {view === "analytics" && (
        <AnalyticsView
          data={analyticsQ.data}
          orders={ordersQ.data?.orders ?? []}
          vendors={vendorsQ.data?.vendors ?? []}
          loading={analyticsQ.isLoading || ordersQ.isLoading || vendorsQ.isLoading}
          error={analyticsQ.isError}
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
        <Truck className="size-3" />
        Purchase
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        Purchase
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Մատակարարներ · Պատվերներ · Վերլուծություն
      </p>
    </header>
  );
}

/* ────────── Vendors view ────────── */

function VendorsView({
  data,
  loading,
  error,
}: {
  data: { vendors: PurchaseVendor[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading vendors…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load vendors.
      </p>
    );
  }

  const vendors = (data?.vendors ?? []).slice().sort(compareVendorsByName);
  const active = vendors.filter((v) => classifyVendor(v) === "active").length;
  const blocked = vendors.filter((v) => classifyVendor(v) === "blocked").length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {vendors.length === 0 ? (
          <EmptyState message="No vendors yet." />
        ) : (
          <div
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            data-entity="purchase-vendor"
            data-count={String(vendors.length)}
          >
            <table className="w-full text-[var(--text-sm)]" role="table">
              <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Tax ID
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Contact
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Terms
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {vendors.map((v) => (
                  <VendorRow key={v.id} vendor={v} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VendorsSidebar total={vendors.length} active={active} blocked={blocked} />
    </div>
  );
}

function VendorRow({ vendor }: { vendor: PurchaseVendor }) {
  const tone = VENDOR_TONE[classifyVendor(vendor)];
  return (
    <tr className="hover:bg-[var(--color-surface-soft)]">
      <td className="px-3 py-2">
        <span className="font-medium text-[var(--color-ink)]">{vendor.name}</span>
        {vendor.note && (
          <p className="text-[11px] text-[var(--color-muted)]">{vendor.note}</p>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[var(--color-muted)]">
        {vendor.taxId ?? "—"}
      </td>
      <td className="px-3 py-2 text-[var(--color-ink)]">
        {vendor.email ?? vendor.phone ?? "—"}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
        {vendor.paymentTermsDays != null
          ? `${vendor.paymentTermsDays}d`
          : "—"}
        {vendor.leadTimeDays != null && (
          <span className="ml-1 text-[10px] text-[var(--color-muted)]">
            · {vendor.leadTimeDays}d lead
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label === "Active" ? (
            <CircleCheck className="size-3" />
          ) : tone.label === "Blocked" ? (
            <CircleX className="size-3" />
          ) : null}
          {tone.label}
        </span>
      </td>
    </tr>
  );
}

function VendorsSidebar({
  total,
  active,
  blocked,
}: {
  total: number;
  active: number;
  blocked: number;
}) {
  return (
    <aside
      className="space-y-3 lg:sticky lg:top-4 lg:self-start"
      aria-label="Vendors overview"
    >
      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <h2 className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <Building2 className="size-3.5" /> Vendor directory
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Մատակարարների տեղեկատու
        </p>
        <dl className="mt-3 space-y-2 text-[var(--text-sm)]">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">Total</dt>
            <dd className="font-mono text-[var(--color-ink)]">{total}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-green)]">
              <CircleCheck className="size-3" /> Active
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{active}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-red)]">
              <CircleX className="size-3" /> Blocked
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{blocked}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

/* ────────── Orders view ────────── */

function OrdersView({
  data,
  loading,
  error,
}: {
  data: { orders: PurchaseOrder[] } | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading orders…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load orders.
      </p>
    );
  }

  const orders = (data?.orders ?? []).slice().sort(compareOrdersByStatusThenDate);
  const openValue = sumOpenValue(orders);
  const billedValue = sumBilledValue(orders);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {orders.length === 0 ? (
          <EmptyState message="No purchase orders yet." />
        ) : (
          <div
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
            data-entity="purchase-order"
            data-count={String(orders.length)}
          >
            <table className="w-full text-[var(--text-sm)]" role="table">
              <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Order #
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Vendor
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Progress
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {orders.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OrdersSidebar
        total={orders.length}
        openValue={openValue}
        billedValue={billedValue}
      />
    </div>
  );
}

function OrderRow({ order }: { order: PurchaseOrder }) {
  const tone = ORDER_TONE[classifyOrderStatus(order)];
  const progress = orderProgress(order);
  return (
    <tr className="hover:bg-[var(--color-surface-soft)]">
      <td className="px-3 py-2">
        <Link
          to="/app/purchase/$orderId"
          params={{ orderId: order.id }}
          className="font-mono text-[var(--color-ink)] hover:underline"
        >
          {order.orderNumber ?? order.id.slice(0, 8)}
        </Link>
        {order.orderDate && (
          <p className="text-[11px] text-[var(--color-muted)]">
            {order.orderDate.slice(0, 10)}
          </p>
        )}
      </td>
      <td className="px-3 py-2 text-[var(--color-ink)]">
        {order.vendorName ?? order.supplier ?? "—"}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {tone.label}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-ink)]">
        {formatCurrency(orderTotals(order).total, order.currency ?? "AMD")}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-muted)]">
        {progress == null ? "—" : `${Math.round(progress * 100)}%`}
      </td>
    </tr>
  );
}

function OrdersSidebar({
  total,
  openValue,
  billedValue,
}: {
  total: number;
  openValue: number;
  billedValue: number;
}) {
  return (
    <aside
      className="space-y-3 lg:sticky lg:top-4 lg:self-start"
      aria-label="Orders overview"
    >
      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <h2 className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <FileText className="size-3.5" /> Orders
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Պատվերների ամփոփագիր
        </p>
        <dl className="mt-3 space-y-2 text-[var(--text-sm)]">
          <div className="flex items-center justify-between">
            <dt className="text-[var(--color-muted)]">Total</dt>
            <dd className="font-mono text-[var(--color-ink)]">{total}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-blue)]">
              <Wallet className="size-3" /> Open value
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{money(openValue)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="inline-flex items-center gap-1 text-[var(--color-tag-purple)]">
              <CircleCheck className="size-3" /> Billed value
            </dt>
            <dd className="font-mono text-[var(--color-ink)]">{money(billedValue)}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

/* ────────── Analytics view ────────── */

function AnalyticsView({
  data,
  orders,
  vendors,
  loading,
  error,
}: {
  data: import("../../../lib/api/schemas").PurchaseAnalyticsResponse | undefined;
  orders: PurchaseOrder[];
  vendors: PurchaseVendor[];
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading analytics…
      </p>
    );
  }
  if (error || !data) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load analytics.
      </p>
    );
  }

  const summary = data.summary;
  const allValue = sumAllValue(orders);
  const lineCount = summary.lineCount ?? 0;
  const pricedLineCount = summary.vendorPricedLineCount ?? 0;
  const coverage = priceCoverage(lineCount, pricedLineCount);
  const orderCreditNotes = orders.flatMap((order) => order.creditNotes ?? []);
  const returnCreditNoteCount = summary.returnCreditNoteCount ?? orderCreditNotes.length;
  const returnCreditNoteAmount =
    summary.returnCreditNoteAmount ??
    orderCreditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);
  const replenishmentSummary = data.replenishment?.summary;
  const replenishmentSuggestions = data.replenishment?.suggestions ?? [];
  const replenishmentSuggestionCount =
    summary.replenishmentSuggestionCount ?? replenishmentSummary?.suggestionCount ?? 0;
  const replenishmentSuggestedQty =
    summary.replenishmentSuggestedQty ?? replenishmentSummary?.suggestedQty ?? 0;
  const replenishmentSalesDemandQty =
    summary.replenishmentSalesDemandQty ?? replenishmentSummary?.salesDemandQty ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <KpiCard
        label="Active vendors"
        value={String(summary.activeVendorCount)}
        subtitle={`${summary.vendorCount} total`}
        tone="green"
      />
      <KpiCard
        label="Open orders"
        value={String(summary.orderCount)}
        subtitle={formatCurrency(summary.openValue, "AMD")}
        tone="blue"
      />
      <KpiCard
        label="Receipt progress"
        value={
          summary.receiptProgressPercent == null
            ? "—"
            : `${Math.round(summary.receiptProgressPercent)}%`
        }
        subtitle={`${summary.remainingQuantity ?? 0} units remaining`}
        tone="orange"
      />
      <KpiCard
        label="Price coverage"
        value={coverage == null ? "—" : `${Math.round(coverage * 100)}%`}
        subtitle={`${pricedLineCount} of ${lineCount} lines priced`}
        tone="purple"
      />
      <KpiCard
        label="Billed value"
        value={formatCurrency(summary.billedValue, "AMD")}
        subtitle={`of ${formatCurrency(allValue, "AMD")} total`}
        tone="muted"
      />
      <KpiCard
        label="Returned quantity"
        value={String(summary.returnedQuantity ?? 0)}
        subtitle="units returned to vendors"
        tone="red"
      />
      <KpiCard
        label="Return credit notes"
        value={formatCurrency(returnCreditNoteAmount, "AMD")}
        subtitle={`${returnCreditNoteCount} credit note${returnCreditNoteCount === 1 ? "" : "s"}`}
        tone="red"
      />
      <KpiCard
        label="Replenishment"
        value={String(replenishmentSuggestionCount)}
        subtitle={`${replenishmentSuggestedQty} units suggested`}
        tone="orange"
      />
      <section className="lg:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)] text-[var(--color-muted)]">
        <h2 className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <Package className="size-3.5" /> Procurement health
        </h2>
        <p className="mt-1">
          Drill into the top vendors or orders from the <strong>Vendors</strong> and{" "}
          <strong>Orders</strong> tabs. The full backlog + per-vendor score
          panel lives in Phase 4 procurement.
        </p>
        <p className="mt-2">
          Snapshot taken from {vendors.length} vendor{vendors.length === 1 ? "" : "s"} ·{" "}
          {orders.length} order{orders.length === 1 ? "" : "s"}.
        </p>
      </section>
      <section
        className="lg:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[var(--text-sm)]"
        data-testid="purchase-replenishment-preview"
        data-entity="purchase-replenishment-suggestion"
        data-count={String(replenishmentSuggestions.length)}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="inline-flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              <PackageSearch className="size-3.5" /> Demand queue
            </h2>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">
              {replenishmentSalesDemandQty} units of sales demand mapped to purchase cover.
            </p>
          </div>
          <Link
            to="/app/purchase/procurement"
            hash="replenishment"
            className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-link)] hover:underline"
          >
            Open procurement
          </Link>
        </div>
        {replenishmentSuggestions.length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-[var(--color-muted)]">
            No purchase replenishment suggestions right now.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--color-line)] rounded-[var(--radius-sm)] border border-[var(--color-line)]">
            {replenishmentSuggestions.slice(0, 3).map((suggestion) => {
              const vendor = suggestion.recommendedVendorName
                || suggestion.recommendedVendor?.vendorName
                || "Vendor price missing";
              const demand = suggestion.salesQuoteDemand ?? suggestion.salesDemandQty ?? 0;
              return (
                <li
                  key={suggestion.catalogItemId}
                  className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <Link
                      to="/app/inventory/$itemId"
                      params={{ itemId: suggestion.catalogItemId }}
                      search={{ tab: "stock" }}
                      className="font-mono text-[var(--color-link)] hover:underline"
                    >
                      {suggestion.sku || suggestion.catalogItemId}
                    </Link>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      {suggestion.name || suggestion.catalogItemId} · {vendor}
                    </p>
                  </div>
                  <p className="font-mono text-[var(--color-ink)]">
                    {suggestion.suggestedQty} suggested · {demand} demand
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle: string;
  tone: "green" | "blue" | "orange" | "purple" | "red" | "muted";
}) {
  const toneClasses: Record<typeof tone, string> = {
    green: "text-[var(--color-tag-green)]",
    blue: "text-[var(--color-tag-blue)]",
    orange: "text-[var(--color-tag-orange)]",
    purple: "text-[var(--color-tag-purple)]",
    red: "text-[var(--color-tag-red)]",
    muted: "text-[var(--color-muted)]",
  };
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </p>
      <p className={cn("mt-1 font-mono text-[var(--text-2xl)] font-semibold", toneClasses[tone])}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-[var(--color-muted)]">{subtitle}</p>
    </section>
  );
}

/* ────────── empty state ────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      {message}
    </div>
  );
}
