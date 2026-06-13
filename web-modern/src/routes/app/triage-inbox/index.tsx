/**
 * /app/triage-inbox — cross-feature work queue (Phase 10.5 W2).
 *
 * Composes the 10.4 primitives (DataTable + SavedViews + PeekPanel +
 * BulkActionBar + UndoToast) over the in-memory feed exposed by
 * `lib/triage/feed.ts`. The feed is a typed fixture; the 10.6 wiring
 * pass will swap the loader for a real Fastify endpoint.
 *
 * State model:
 *  - `feed`               : immutable result of `loadTriageFeed()`.
 *  - `filter`             : current saved-view filter (decoded from
 *                           the store; the route mutates the store on
 *                           selection so reloads are stable).
 *  - `tableState`         : full DataTableState (controlled mode);
 *                           rowSelection drives the bulk bar.
 *  - `peek`               : currently-open PeekPanel record (null =
 *                           closed).
 *  - `undoOptions`        : current UndoToast options (null = hidden).
 *  - `resolvedIds`        : in-memory map of `id -> originalStatus` for
 *                           the "Delete" → status→resolved + Undo
 *                           flow. We never persist this; it lives only
 *                           for the toast's 5s window.
 *
 * All user-facing strings use Lingui `<Trans>` / `t`. The i18n
 * extractor picks them up on the next `pnpm i18n:extract` run.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
  ClipboardCheck,
  Landmark,
  MessageCircle,
  Receipt,
  ShoppingBag,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  BulkActionBar,
  type BulkAction,
  DataTable,
  makeSelectColumn,
  PeekPanel,
  SavedViews,
  UndoToast,
  type DataTableState,
  type UndoToastOptions,
} from "../../../components/shared";
import { cn } from "../../../lib/utils/cn";
import {
  applyTriageView,
  loadTriageFeed,
} from "../../../lib/triage/feed";
import {
  TRIAGE_DEFAULT_VIEWS,
  TRIAGE_TABLE_ID,
  decodeTriageFilter,
  seedDefaultTriageViews,
} from "../../../lib/triage/savedViews";
import {
  type SavedViewState,
} from "../../../lib/components/savedViewsStore";
import {
  type TriageItem,
  type TriageSource,
  type TriageViewFilter,
} from "../../../lib/triage/schemas";

export const Route = createFileRoute("/app/triage-inbox/")({
  component: TriageInboxPage,
});

export { TriageInboxPage };

/* ────────── source icons ────────── */

const SOURCE_ICONS: Record<TriageSource, LucideIcon> = {
  invoice: Receipt,
  "tax-gate": Landmark,
  approval: ClipboardCheck,
  "customer-reply": MessageCircle,
  fleet: Truck,
  purchase: ShoppingBag,
};

/* ────────── relative time helper ────────── */

/** Format an ISO timestamp as a short relative string ("2h ago",
 *  "3d ago"). We use date-fns (already in deps) for a stable
 *  English default; Lingui will localize the wrapper message in
 *  the column header. */
function relativeRaised(iso: string): string {
  try {
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return iso;
    return formatDistanceToNow(ts, { addSuffix: true });
  } catch {
    return iso;
  }
}

/* ────────── view snapshot <-> filter codec (just wraps the lib) ────── */

const viewStateToFilter = (state: SavedViewState): TriageViewFilter =>
  decodeTriageFilter(state);

/* ────────── component ────────── */

function TriageInboxPage() {
  const { t } = useLingui();

  // Seeded once on first mount. Idempotent — re-calls are a no-op.
  useEffect(() => {
    seedDefaultTriageViews();
  }, []);

  const feed = useMemo(() => loadTriageFeed(), []);

  // The first default view is the landing view per the e2e spec.
  const [filter, setFilter] = useState<TriageViewFilter>(
    () => TRIAGE_DEFAULT_VIEWS[0].filter,
  );

  const visibleItems = useMemo(
    () => applyTriageView(feed, filter),
    [feed, filter],
  );

  const [tableState, setTableState] = useState<DataTableState>(() => ({
    sorting: [],
    columnFilters: [],
    pagination: { pageIndex: 0, pageSize: 25 },
    globalFilter: "",
    columnVisibility: {},
    rowSelection: {} as RowSelectionState,
  }));

  const [peek, setPeek] = useState<TriageItem | null>(null);
  const [undoOptions, setUndoOptions] = useState<UndoToastOptions | null>(null);
  // In-memory map of resolved items (id -> original status). Undo
  // reverts from this map; the toast auto-dismiss discards the entry.
  const [resolvedMap, setResolvedMap] = useState<Record<string, TriageItem["status"]>>({});

  // Mirror row selection into the table state (the bulk bar reads
  // via selectedRowIds which is derived in the same render).
  const selectedRowIds = useMemo(
    () =>
      Object.keys(tableState.rowSelection).filter(
        (k) => tableState.rowSelection[k],
      ),
    [tableState.rowSelection],
  );

  /* ────────── columns ────────── */

  const columns = useMemo<ColumnDef<TriageItem, unknown>[]>(() => {
    const selectCol = makeSelectColumn<TriageItem>();
    return [
      selectCol,
      {
        id: "source",
        header: () => <Trans>Source</Trans>,
        accessorFn: (row) => row.source,
        cell: ({ row }) => {
          const Icon = SOURCE_ICONS[row.original.source];
          return (
            <span
              className="inline-flex items-center gap-1.5"
              data-testid={`triage-inbox-source-${row.original.id}`}
            >
              <Icon className="size-3.5 text-[var(--color-muted)]" aria-hidden />
              <span className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-muted)]">
                {row.original.source}
              </span>
            </span>
          );
        },
      },
      {
        id: "title",
        header: () => <Trans>Title</Trans>,
        accessorFn: (row) => row.title,
        cell: ({ row }) => (
          <span className="font-medium text-[var(--color-ink)]">
            {row.original.title}
          </span>
        ),
      },
      {
        id: "subtitle",
        header: () => <Trans>Detail</Trans>,
        accessorFn: (row) => row.subtitle,
        cell: ({ row }) => (
          <span className="text-[var(--text-xs)] text-[var(--color-muted)]">
            {row.original.subtitle}
          </span>
        ),
      },
      {
        id: "amount",
        header: () => <Trans>Amount</Trans>,
        accessorFn: (row) => row.amount,
        cell: ({ row }) =>
          row.original.amount == null ? (
            <span className="text-[var(--color-muted)]">—</span>
          ) : (
            <span className="font-mono text-[var(--text-xs)]">
              {row.original.amount.toLocaleString()}
            </span>
          ),
      },
      {
        id: "raised",
        header: () => <Trans>Raised</Trans>,
        accessorFn: (row) => row.raisedAt,
        cell: ({ row }) => (
          <span
            className="text-[var(--text-xs)] text-[var(--color-muted)]"
            data-testid={`triage-inbox-raised-${row.original.id}`}
          >
            {relativeRaised(row.original.raisedAt)}
          </span>
        ),
      },
      {
        id: "owner",
        header: () => <Trans>Owner</Trans>,
        accessorFn: (row) => row.assignee,
        cell: ({ row }) => (
          <span className="text-[var(--text-xs)] text-[var(--color-muted)]">
            {row.original.assignee || t`Unassigned`}
          </span>
        ),
      },
      {
        id: "status",
        header: () => <Trans>Status</Trans>,
        accessorFn: (row) => row.status,
        cell: ({ row }) => {
          const effective = resolvedMap[row.original.id] ?? row.original.status;
          return (
            <span
              className={cn(
                "inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5",
                "text-[10px] font-semibold uppercase tracking-wider",
                effective === "open"
                  ? "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] text-[var(--color-tag-blue)]"
                  : effective === "snoozed"
                    ? "bg-[color-mix(in_srgb,var(--color-tag-yellow)_15%,transparent)] text-[var(--color-tag-yellow)]"
                    : effective === "assigned"
                      ? "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)] text-[var(--color-tag-violet)]"
                      : "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]",
              )}
              data-testid={`triage-inbox-status-${row.original.id}`}
            >
              {effective}
            </span>
          );
        },
      },
    ];
  }, [resolvedMap, t]);

  /* ────────── view-load / row-click / bulk handlers ────────── */

  const handleViewLoad = useCallback((state: SavedViewState) => {
    setFilter(viewStateToFilter(state));
  }, []);

  const handleRowClick = useCallback((row: TriageItem) => {
    setPeek(row);
  }, []);

  const handleBulkAction = useCallback(
    (action: BulkAction, ids: string[]) => {
      if (action !== "delete") return;
      // Snapshot original status, transition each to resolved.
      const before: Record<string, TriageItem["status"]> = {};
      const items = feed.items;
      for (const id of ids) {
        const found = items.find((it) => it.id === id);
        if (found) before[id] = found.status;
      }
      setResolvedMap((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = "resolved";
        return next;
      });
      setTableState((s) => ({ ...s, rowSelection: {} }));
      setUndoOptions({
        message: t`Marked ${ids.length} item${ids.length === 1 ? "" : "s"} as resolved`,
        onUndo: () => {
          setResolvedMap((prev) => {
            const next = { ...prev };
            for (const [id, status] of Object.entries(before)) {
              next[id] = status;
            }
            return next;
          });
        },
      });
    },
    [feed.items, t],
  );

  /* ────────── render ────────── */

  return (
    <div
      className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="triage-inbox-page"
    >
      <header>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          <Trans>Triage inbox</Trans>
        </h1>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          <Trans>
            One queue for every "needs your attention" item across
            invoices, tax gates, approvals, customer replies, fleet, and
            purchase orders.
          </Trans>
        </p>
      </header>

      <DataTable<TriageItem>
        tableId={TRIAGE_TABLE_ID}
        columns={columns}
        data={visibleItems}
        state={tableState}
        onStateChange={setTableState}
        onSelectionChange={() => {
          // Selection is mirrored via rowSelection in tableState;
          // this callback fires after each toggle, so we don't
          // need to do anything extra here.
        }}
        onRowClick={handleRowClick}
        renderToolbar={({ state }) => (
          <SavedViews
            tableId={TRIAGE_TABLE_ID}
            state={{
              sort: state.sorting[0]
                ? { id: state.sorting[0].id, desc: state.sorting[0].desc }
                : null,
              filter: JSON.stringify(filter),
              page: state.pagination.pageIndex,
              pageSize: state.pagination.pageSize,
              columns: [],
            }}
            onLoad={handleViewLoad}
            renderExtra={() => (
              <button
                type="button"
                onClick={() => setFilter(TRIAGE_DEFAULT_VIEWS[0].filter)}
                data-testid="triage-inbox-reset-view"
                className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]"
              >
                <Trans>Reset</Trans>
              </button>
            )}
          />
        )}
        emptyState={<Trans>No items match this view</Trans>}
      />

      <BulkActionBar
        selectedRowIds={selectedRowIds}
        onAction={handleBulkAction}
        onClear={() => setTableState((s) => ({ ...s, rowSelection: {} }))}
        className="[&]:left-1/2 [&]:-translate-x-1/2"
      />

      <PeekPanel<TriageItem>
        record={peek}
        onClose={() => setPeek(null)}
        title={peek ? peek.title : t`Details`}
        renderContent={(record) => (
          <div
            className="space-y-3 text-[var(--text-sm)]"
            data-testid="triage-inbox-peek"
          >
            <div className="flex items-center gap-2">
              {(() => {
                const Icon = SOURCE_ICONS[record.source];
                return <Icon className="size-3.5 text-[var(--color-muted)]" aria-hidden />;
              })()}
              <span className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-muted)]">
                {record.source}
              </span>
            </div>
            <p className="text-[var(--color-ink)]">{record.subtitle}</p>
            <dl className="grid grid-cols-2 gap-2 text-[var(--text-xs)]">
              <dt className="text-[var(--color-muted)]">
                <Trans>Owner</Trans>
              </dt>
              <dd className="text-[var(--color-ink)]">
                {record.assignee || t`Unassigned`}
              </dd>
              <dt className="text-[var(--color-muted)]">
                <Trans>Status</Trans>
              </dt>
              <dd className="text-[var(--color-ink)]">{record.status}</dd>
              <dt className="text-[var(--color-muted)]">
                <Trans>Raised</Trans>
              </dt>
              <dd className="text-[var(--color-ink)]">
                {relativeRaised(record.raisedAt)}
              </dd>
              {record.amount != null && (
                <>
                  <dt className="text-[var(--color-muted)]">
                    <Trans>Amount</Trans>
                  </dt>
                  <dd className="font-mono text-[var(--color-ink)]">
                    {record.amount.toLocaleString()}
                  </dd>
                </>
              )}
            </dl>
            <pre className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2 text-[10px] text-[var(--color-muted)]">
              {JSON.stringify(record.payload, null, 2)}
            </pre>
          </div>
        )}
      />

      <UndoToast
        options={undoOptions}
        onDismiss={() => setUndoOptions(null)}
      />
    </div>
  );
}
