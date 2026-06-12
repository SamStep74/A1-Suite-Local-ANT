/**
 * AnalyticsReceivablesTableView — Phase 10.4 conversion (C1).
 *
 * Wires the 5 new shared primitives on top of the existing
 * receivables data: a DataTable over the buckets, a SavedViews
 * picker, a PeekPanel for row detail, and a BulkActionBar that
 * surfaces when ≥1 row is selected.
 *
 *   DataTable  → <DataTable> with column defs for bucket key,
 *                total, invoice count, customer count; sorting +
 *                filtering + pagination handled by TanStack.
 *   SavedViews → <SavedViews> injected into the toolbar slot, so
 *                users can save / restore column sort + page
 *                + filter combinations.
 *   PeekPanel  → opens on row click; renders the full bucket
 *                record.
 *   BulkActionBar → sits at the bottom of the viewport when
 *                rows are selected; bulk-tag / export are
 *                stubbed in this conversion (the 10.5
 *                Triage Inbox worker will wire real mutations).
 *
 * The legacy `AnalyticsReceivablesView` (KPI cards + plain table)
 * stays re-exported from the route for test compatibility.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import {
  type AgingBucket,
  type ReceivablesAgingResponse,
} from "../../api/schemas";
import { compareBucketsByTotalDesc } from "../status";
import { formatCurrency } from "../status";
import {
  DataTable,
  PeekPanel,
  SavedViews,
  BulkActionBar,
  makeSelectColumn,
  type DataTableState,
  type SavedViewState,
} from "../../../components/shared";
import { AnalyticsEmptyState } from ".";

export interface AnalyticsReceivablesTableViewProps {
  data: ReceivablesAgingResponse | undefined;
  loading: boolean;
  error: boolean;
}

const TABLE_ID = "analytics-receivables-buckets";

interface ViewModel extends AgingBucket {
  bucketKey: string;
}

const toRows = (buckets: ReadonlyArray<AgingBucket>): ViewModel[] =>
  buckets.map((b) => ({ ...b, bucketKey: b.key }));

const initialTableState: DataTableState = {
  sorting: [{ id: "total", desc: true }],
  columnFilters: [],
  pagination: { pageIndex: 0, pageSize: 25 },
  globalFilter: "",
  columnVisibility: {},
  rowSelection: {},
};

export function AnalyticsReceivablesTableView({
  data,
  loading,
  error,
}: AnalyticsReceivablesTableViewProps) {
  const { t } = useLingui();
  const [tableState, setTableState] = useState<DataTableState>(initialTableState);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [peekBucket, setPeekBucket] = useState<ViewModel | null>(null);

  const buckets = (data?.buckets ?? []).slice().sort(compareBucketsByTotalDesc);
  const rows = useMemo(() => toRows(buckets), [buckets]);

  const columns = useMemo<ColumnDef<ViewModel, unknown>[]>(
    () => [
      makeSelectColumn<ViewModel>(),
      {
        id: "key",
        header: () => <Trans>Bucket</Trans>,
        accessorKey: "key",
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="font-mono text-[var(--color-ink)]">{String(getValue())}</span>
        ),
      },
      {
        id: "label",
        header: () => <Trans>Label</Trans>,
        accessorKey: "label",
        enableSorting: true,
        cell: ({ getValue }) => {
          const v = getValue();
          return v == null ? "—" : String(v);
        },
      },
      {
        id: "total",
        header: () => <Trans>Total</Trans>,
        accessorKey: "total",
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="text-right font-mono text-[var(--color-ink)]">
            {formatCurrency(Number(getValue() ?? 0))}
          </span>
        ),
      },
      {
        id: "invoiceCount",
        header: () => <Trans>Invoices</Trans>,
        accessorKey: "invoiceCount",
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="text-right font-mono text-[var(--color-muted)]">
            {String(getValue() ?? 0)}
          </span>
        ),
      },
      {
        id: "customerCount",
        header: () => <Trans>Customers</Trans>,
        accessorKey: "customerCount",
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="text-right font-mono text-[var(--color-muted)]">
            {String(getValue() ?? 0)}
          </span>
        ),
      },
    ],
    [],
  );

  const handleStateChange = useCallback((next: DataTableState) => {
    setTableState(next);
  }, []);

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedRowIds(ids);
  }, []);

  const handleRowClick = useCallback((row: ViewModel) => {
    setPeekBucket(row);
  }, []);

  const handleSavedViewLoad = useCallback((state: SavedViewState) => {
    setTableState((prev) => ({
      ...prev,
      sorting: state.sort ? [state.sort] : [],
      pagination: { pageIndex: state.page, pageSize: state.pageSize },
      globalFilter: state.filter,
    }));
  }, []);

  const savedViewSnapshot: SavedViewState = useMemo(
    () => ({
      sort: tableState.sorting[0]
        ? { id: tableState.sorting[0].id, desc: tableState.sorting[0].desc }
        : null,
      filter: tableState.globalFilter,
      page: tableState.pagination.pageIndex,
      pageSize: tableState.pagination.pageSize,
      columns: tableState.sorting.map((s) => s.id),
    }),
    [tableState],
  );

  if (loading) {
    return <p className="text-[var(--text-sm)] text-[var(--color-muted)]">{t`Loading receivables…`}</p>;
  }
  if (error) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        <Trans>Failed to load receivables aging.</Trans>
      </p>
    );
  }
  if (!data || !data.summary) {
    return <AnalyticsEmptyState message="No receivables data." />;
  }

  return (
    <div className="space-y-3">
      <DataTable<ViewModel>
        tableId={TABLE_ID}
        columns={columns}
        data={rows}
        getRowId={(row) => row.bucketKey}
        state={tableState}
        onStateChange={handleStateChange}
        onSelectionChange={handleSelectionChange}
        onRowClick={handleRowClick}
        renderToolbar={() => (
          <SavedViews
            tableId={TABLE_ID}
            state={savedViewSnapshot}
            onLoad={handleSavedViewLoad}
          />
        )}
        emptyState={<Trans>No buckets in this period</Trans>}
      />

      <BulkActionBar
        selectedRowIds={selectedRowIds}
        onAction={(action, ids) => {
          // 10.5 wires these to real TanStack Query mutations. For
          // 10.4 we only need the wiring + the UndoToast round-trip
          // — dispatching a no-op is fine because the primitive
          // is what we're proving.
          if (typeof window !== "undefined") {
            // eslint-disable-next-line no-console
            console.info(`[10.4 canary] bulk action '${action}' on ${ids.length} bucket(s)`);
          }
        }}
        onClear={() => setSelectedRowIds([])}
      />

      <PeekPanel<ViewModel>
        record={peekBucket}
        onClose={() => setPeekBucket(null)}
        title={peekBucket ? peekBucket.label ?? peekBucket.key : null}
        renderContent={(b) => (
          <dl className="space-y-2 text-[var(--text-sm)]">
            <Row label="Bucket" value={b.key} />
            <Row label="Label" value={b.label ?? "—"} />
            <Row label="Total" value={formatCurrency(Number(b.total ?? 0))} />
            <Row label="Invoices" value={String(b.invoiceCount ?? 0)} />
            <Row label="Customers" value={String(b.customerCount ?? 0)} />
          </dl>
        )}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="font-mono text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
