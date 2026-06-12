/**
 * Inventory item-detail panel subcomponents — Phase 10.0 split.
 *
 * The 12 form/header/panel/pill components below used to live in
 * `src/routes/app/inventory/$itemId.tsx`. They are presentational:
 * the route file owns the catalog/stock/moves queries, the
 * `useNavigate` tab navigation, the agent-context assembly, and
 * the `ITEM_STATUS_TONE → itemTone` derivation. The panels take
 * shaped props (item, balances, moves, itemTone, onPosted, …) and
 * render the UI.
 *
 * Public exports (also re-exported by the route file so existing
 * test imports keep working):
 *   - Tab                                  (URL search-param type)
 *   - ItemHeader, TabBar, OverviewPanel,
 *     PriceListPanel, VariantsPanel, Field,
 *     StockPanel, MovesPanel, PostMovePanel,
 *     ItemMetadata, Row, StockHealthPill
 */
import { useMemo } from "react";
import {
  ArrowDownToLine,
  Box,
  Calendar,
  CheckCircle2,
  ChevronRight,
  History,
  Info,
  PackageOpen,
  Receipt,
  Truck,
} from "lucide-react";
import {
  type CatalogItem,
  type PriceListItem,
  type StockBalance,
  type StockMove,
  type StockMoveType,
} from "../../api/schemas";
import { HybridBadge } from "../../../components/ui/HybridBadge";
import { StockMoveForm } from "../../../components/stock-move/StockMoveForm";
import { money, numberShort } from "../../utils/money";
import { cn } from "../../utils/cn";
import { classifyStockLevel, type StockHealth } from "../status";

/* ────────── shared types & constants ────────── */

export type Tab = "overview" | "stock" | "moves" | "post";

const TABS: { value: Tab; label: string; icon: typeof Box }[] = [
  { value: "overview", label: "Overview", icon: Info },
  { value: "stock", label: "Stock", icon: Box },
  { value: "moves", label: "Moves", icon: History },
  { value: "post", label: "Post move", icon: ArrowDownToLine },
];

const HEALTH_TONE: Record<StockHealth, { bg: string; fg: string; label: string }> = {
  out: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "Out of stock",
  },
  low: {
    bg: "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)]",
    fg: "text-[var(--color-amber,#d78b2f)]",
    label: "Low stock",
  },
  healthy: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "Healthy",
  },
  unknown: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
    label: "Not tracked",
  },
};

/* ────────── header ────────── */

export function ItemHeader({
  item,
  health,
  totalAvailable,
  itemTone,
}: {
  item: CatalogItem;
  health: StockHealth;
  totalAvailable: number;
  itemTone: { bg: string; fg: string; label: string };
}) {
  const tone = HEALTH_TONE[health];
  return (
    <header className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <PackageOpen className="size-3" />
            {item.sku}
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            {item.name}
          </h1>
          <p className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-sm)] text-[var(--color-muted)]">
            <span>{item.itemType}</span>
            {item.categoryName && <span>· {item.categoryName}</span>}
            {item.unitOfMeasure && <span>· uom {item.unitOfMeasure}</span>}
            {item.createdAt && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" />
                Created {new Date(item.createdAt).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              itemTone.bg,
              itemTone.fg,
            )}
          >
            {itemTone.label}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              tone.bg,
              tone.fg,
            )}
          >
            {health === "healthy" ? (
              <CheckCircle2 className="size-3" />
            ) : health === "out" || health === "low" ? (
              <Box className="size-3" />
            ) : null}
            {tone.label} · {numberShort(totalAvailable)}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ────────── tab bar ────────── */

export function TabBar({
  tab,
  onTabChange,
}: {
  tab: Tab;
  onTabChange: (next: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1"
    >
      {TABS.map((t) => {
        const active = t.value === tab;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(t.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-sm)] transition",
              active
                ? "bg-[var(--color-surface-soft)] font-semibold text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            <Icon className="size-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────── overview tab ────────── */

export function OverviewPanel({
  item,
  priceListEntries,
}: {
  item: CatalogItem;
  priceListEntries: PriceListItem[];
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          <Info className="size-3.5" />
          Item details
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-[var(--text-sm)] sm:grid-cols-3">
          <Field label="SKU" value={item.sku} mono />
          <Field label="Type" value={item.itemType} />
          <Field label="Status" value={item.status} />
          <Field label="Category" value={item.categoryName ?? "—"} />
          <Field
            label="Unit of measure"
            value={item.unitOfMeasure ?? "—"}
          />
          <Field
            label="List price"
            value={
              typeof item.listPrice === "number"
                ? money(item.listPrice, { compact: true })
                : "—"
            }
            mono
          />
          <Field
            label="Standard cost"
            value={
              typeof item.standardCost === "number"
                ? money(item.standardCost, { compact: true })
                : "—"
            }
            mono
          />
          <Field
            label="Track stock"
            value={item.trackStock ? "Yes" : "No"}
          />
          <Field
            label="Track lots"
            value={item.trackLots ? "Yes" : "No"}
          />
        </dl>
        {item.description && (
          <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[var(--text-sm)] text-[var(--color-muted)]">
            {item.description}
          </p>
        )}
      </section>

      <PriceListPanel entries={priceListEntries} />

      <VariantsPanel variants={item.variants ?? []} />
    </div>
  );
}

export function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-[var(--color-muted)]">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[var(--text-sm)] text-[var(--color-ink)]",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function PriceListPanel({ entries }: { entries: PriceListItem[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        <Receipt className="size-3.5" />
        Price list entries
      </h2>
      <table className="w-full text-left text-[var(--text-sm)]">
        <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <tr>
            <th className="py-1 font-medium">Price list</th>
            <th className="py-1 text-right font-medium">List</th>
            <th className="py-1 text-right font-medium">Net</th>
            <th className="py-1 text-right font-medium">Cost</th>
            <th className="py-1 text-right font-medium">Margin</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const marginTone =
              e.marginStatus === "below_minimum"
                ? "text-[var(--color-tag-red)]"
                : "text-[var(--color-tag-green)]";
            return (
              <tr
                key={e.id}
                className="border-t border-[var(--color-line)]"
              >
                <td className="py-1 font-mono text-[var(--color-ink)]">
                  {e.priceListId.slice(0, 8)}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {typeof e.listPrice === "number"
                    ? money(e.listPrice, { compact: true })
                    : "—"}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-[var(--color-ink)]">
                  {typeof e.netPrice === "number"
                    ? money(e.netPrice, { compact: true })
                    : "—"}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-[var(--color-muted)]">
                  {typeof e.standardCost === "number"
                    ? money(e.standardCost, { compact: true })
                    : "—"}
                </td>
                <td
                  className={cn(
                    "py-1 text-right font-mono tabular-nums",
                    marginTone,
                  )}
                >
                  {typeof e.marginPercent === "number"
                    ? `${e.marginPercent.toFixed(1)}%`
                    : "—"}
                </td>
                <td className="py-1 text-[var(--color-muted)]">
                  {e.marginStatus ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function VariantsPanel({
  variants,
}: {
  variants: NonNullable<CatalogItem["variants"]>;
}) {
  if (variants.length === 0) {
    return null;
  }
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h2 className="mb-3 inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        <Box className="size-3.5" />
        Variants
      </h2>
      <ul className="space-y-1 text-[var(--text-sm)]">
        {variants.map((v) => (
          <li
            key={v.id}
            className="flex items-center justify-between border-t border-[var(--color-line)] pt-1 first:border-t-0 first:pt-0"
          >
            <span className="font-mono text-[var(--color-ink)]">
              {v.sku}
            </span>
            <span className="text-[var(--color-muted)]">
              {v.name}
              {typeof v.listPrice === "number" && (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-mono text-[var(--color-ink)]">
                    {money(v.listPrice, { compact: true })}
                  </span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ────────── stock tab ────────── */

export function StockPanel({ balances }: { balances: StockBalance[] }) {
  if (balances.length === 0) {
    return (
      <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        No stock on hand for this item. Use the "Post move" tab to
        record a receipt.
      </p>
    );
  }
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Stock by location
        </h2>
      </header>
      <table className="w-full text-left text-[var(--text-sm)]">
        <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 text-right font-medium">On hand</th>
            <th className="px-3 py-2 text-right font-medium">Reserved</th>
            <th className="px-3 py-2 text-right font-medium">Available</th>
            <th className="px-3 py-2 text-right font-medium">Avg cost</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr
              key={b.id}
              className="border-t border-[var(--color-line)]"
            >
              <td className="px-3 py-2">
                <div className="font-mono text-[var(--color-ink)]">
                  {b.locationCode ?? b.locationId}
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {b.locationName ?? b.locationType ?? ""}
                </div>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                {b.quantity}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-muted)]">
                {b.reservedQuantity ?? 0}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                {b.availableQuantity}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                {typeof b.averageCost === "number"
                  ? money(b.averageCost, { compact: true })
                  : "—"}
              </td>
              <td className="px-3 py-2">
                <StockHealthPill health={classifyStockLevel(b)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ────────── moves tab ────────── */

export function MovesPanel({ moves }: { moves: StockMove[] }) {
  const visible = moves.slice(0, 25);
  if (visible.length === 0) {
    return (
      <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
        No stock moves for this item yet.
      </p>
    );
  }
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2">
        <h2 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
          Recent moves
        </h2>
      </header>
      <table className="w-full text-left text-[var(--text-sm)]">
        <thead className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">From → To</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => (
            <tr
              key={m.id}
              className="border-t border-[var(--color-line)]"
            >
              <td className="px-3 py-2 text-[var(--color-muted)]">
                {m.createdAt
                  ? new Date(m.createdAt).toLocaleString()
                  : "—"}
              </td>
              <td className="px-3 py-2 text-[var(--color-ink)]">
                {m.moveType}
              </td>
              <td className="px-3 py-2 text-[var(--color-muted)]">
                <span className="inline-flex items-center gap-1">
                  {m.sourceLocationCode ?? "—"}
                  <ChevronRight className="size-3" />
                  {m.destinationLocationCode ?? "—"}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-ink)]">
                {m.quantity}
              </td>
              <td className="px-3 py-2 text-[var(--color-muted)]">
                {m.reason ?? m.reference ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ────────── post-move tab ────────── */

export function PostMovePanel({
  item,
  balances,
  onPosted,
}: {
  item: CatalogItem;
  balances: StockBalance[];
  onPosted: () => void;
}) {
  // Distinct locations across this item's balances — the form
  // wants StockLocation[] (with code + name + locationType), so we
  // shape the balances into what StockMoveForm expects.
  const locations = useMemo(() => {
    const seen = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        locationType: string;
      }
    >();
    for (const b of balances) {
      if (!b.locationId) continue;
      if (seen.has(b.locationId)) continue;
      seen.set(b.locationId, {
        id: b.locationId,
        code: b.locationCode ?? b.locationId.slice(0, 6),
        name: b.locationName ?? b.locationType ?? "—",
        locationType: b.locationType ?? "internal",
      });
    }
    return [...seen.values()];
  }, [balances]);

  const initial = useMemo(() => {
    const preferred = balances[0];
    return {
      catalogItemId: item.id,
      destinationLocationId: preferred?.locationId,
      moveType: "receipt" as StockMoveType,
      quantity: 1,
      unitCost:
        typeof item.standardCost === "number"
          ? item.standardCost
          : undefined,
    };
  }, [item.id, item.standardCost, balances]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <HybridBadge kind="rule" />
        <span className="text-[11px] text-[var(--color-muted)]">
          This is a deterministic form — the AI agent on the right
          rail proposes the same action, with reasoning. Use whichever
          you trust in the moment.
        </span>
      </div>
      <StockMoveForm
        initial={initial}
        catalogItemId={item.id}
        hideCatalogItem
        locations={locations}
        onSuccess={onPosted}
      />
    </div>
  );
}

/* ────────── right-rail metadata ────────── */

export function ItemMetadata({ item }: { item: CatalogItem }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <h3 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        Details
      </h3>
      <dl className="mt-2 space-y-1.5 text-[var(--text-sm)]">
        <Row label="Created" value={item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"} />
        <Row label="Updated" value={item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"} />
        <Row label="Owner" value={item.createdByName ?? "—"} />
        <Row
          label="Fiscal receipt"
          value={item.fiscalReceiptRequired ? "Required" : "Optional"}
        />
        <Row
          label="VAT mode"
          value={item.vatMode ?? "—"}
        />
      </dl>
      <div className="mt-3 flex items-center gap-1.5 border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
        <Truck className="size-3" />
        <span>Stock tiers and price lists are deterministic sources the Inventory Risk Agent reads.</span>
      </div>
    </div>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]">
        {value}
      </dd>
    </div>
  );
}

/* ────────── small primitive (overlap with index) ────────── */

export function StockHealthPill({ health }: { health: StockHealth }) {
  const tone = HEALTH_TONE[health];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone.bg,
        tone.fg,
      )}
    >
      {health === "healthy" ? (
        <CheckCircle2 className="size-3" />
      ) : health === "low" || health === "out" ? (
        <Box className="size-3" />
      ) : null}
      {tone.label.replace(" stock", "")}
    </span>
  );
}
