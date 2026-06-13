/**
 * /app/fiscal-gates — fiscal-gates triage workspace (Phase 10.5 W1).
 *
 * Composes the five 10.4 shared primitives around the per-period
 * tax-action list exposed by `lib/fiscal`:
 *
 *   - `DataTable`     — the gate list (controlled mode)
 *   - `SavedViews`    — three default triage views (current /
 *                       overdue / awaiting-customer) registered
 *                       via `seedDefaultTriageViews` on mount
 *   - `BulkActionBar` — Acknowledge / Mark filed / Escalate across
 *                       the selected row set
 *   - `PeekPanel`     — right-anchored detail drawer
 *   - `UndoToast`     — 5s revert window for "Mark filed"
 *
 * Lingui:
 *   Every user-facing string is wrapped in `<Trans>` or `t\`\`` so
 *   the extractor picks it up. The route does NOT hard-code any
 *   status / category / action label — it always goes through
 *   `useFiscalLabels()` (or `<StatusLabel>`, `<CategoryLabel>`,
 *   `<ActionLabel>`) from `lib/fiscal/labels.ts`.
 *
 * Data source:
 *   `seedGatesForPeriod(currentPeriod(), now)` is the in-memory
 *   seed (the lib doc explains why — W2 wires the real backend).
 *   The route owns the in-memory gate list; mutations go through
 *   `applyGateMutation` (also from the lib).
 */
import { createFileRoute } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import {
  DataTable,
  makeSelectColumn,
  type DataTableState,
} from "../../../components/shared/DataTable";
import { SavedViews } from "../../../components/shared/SavedViews";
import { PeekPanel } from "../../../components/shared/PeekPanel";
import { UndoToast, type UndoToastOptions } from "../../../components/shared/UndoToast";
import {
  GateAction,
  GateStatus,
  type FiscalGate,
} from "../../../lib/fiscal/schemas";
import {
  VIEW_KEYS,
  applyGateMutation,
  applyView,
  currentPeriod,
  formatAmount,
  seedDefaultTriageViews,
  seedGatesForPeriod,
  type ViewKey,
} from "../../../lib/fiscal/gates";
import {
  ActionLabel,
  CategoryLabel,
  GateDescription,
  GateLabel,
  StatusLabel,
  useFiscalLabels,
} from "../../../lib/fiscal/labels";

/* ────────── route registration ────────── */

export const Route = createFileRoute("/app/fiscal-gates/")({
  component: FiscalGatesWorkspace,
});

/* ────────── table id (used by SavedViews persistence) ────────── */

const TABLE_ID = "fiscal-gates";

/* ────────── component ────────── */

function FiscalGatesWorkspace() {
  const { t } = useLingui();
  const labels = useFiscalLabels();

  // Pinned "now" so the seed is stable for the lifetime of the
  // route instance. We don't refetch — the gate list is in-memory.
  const [now] = useState<Date>(() => new Date());
  const period = useMemo(() => currentPeriod(now), [now]);

  // The full set of gates for the current period. The seed is
  // deterministic from (period, now); later W2 swaps this for a
  // `useQuery` against `/api/fiscal/gates?period=…`.
  const [gates, setGates] = useState<ReadonlyArray<FiscalGate>>(() =>
    seedGatesForPeriod(period, now),
  );

  // Seed the three default SavedViews on mount (idempotent).
  useEffect(() => {
    seedDefaultTriageViews(TABLE_ID);
  }, []);

  // ── DataTable controlled state ──
  const [tableState, setTableState] = useState<DataTableState>({
    sorting: [],
    columnFilters: [],
    pagination: { pageIndex: 0, pageSize: 25 },
    globalFilter: "",
    columnVisibility: {},
    rowSelection: {},
  });

  // Selected row ids (mirrors DataTable.onSelectionChange).
  const [selectedRowIds, setSelectedRowIds] = useState<ReadonlyArray<string>>([]);

  // Peek panel: the row to show in the side drawer.
  const [peekRow, setPeekRow] = useState<FiscalGate | null>(null);

  // Undo toast: most recent mutation we can revert.
  const [toast, setToast] = useState<UndoToastOptions | null>(null);

  // View row mutation → reducer
  const dispatch = useCallback(
    (action: GateAction, ids: ReadonlyArray<string>) => {
      if (ids.length === 0) return;
      setGates((prev) => applyGateMutation(prev, ids, action));
    },
    [],
  );

  // Snapshot for the Undo toast
  const dispatchWithUndo = useCallback(
    (action: GateAction, ids: ReadonlyArray<string>) => {
      const before = gates;
      dispatch(action, ids);
      setToast({
        message: <Trans>Marked {ids.length} gate(s) as filed</Trans>,
        onUndo: () => setGates(before),
      });
    },
    [dispatch, gates],
  );

  // Filtered rows for the current view. The DataTable itself does
  // sort/filter; we do view-level filtering here so it composes
  // with the user's sort/page.
  const visibleRows = useMemo<ReadonlyArray<FiscalGate>>(() => {
    // Pull the active view from the toolbar's SavedView (if any).
    // SavedViews doesn't expose the loaded view up to us as a
    // state key — it pushes a `DataTableState`. We piggy-back on
    // `globalFilter` to round-trip the view key, since the
    // defaultDataTable already round-trips that field.
    const viewKey = viewKeyFromState(tableState);
    return applyView(gates, viewKey, now);
  }, [gates, tableState, now]);

  /* ────────── column defs ────────── */

  const columns = useMemo<ColumnDef<FiscalGate, unknown>[]>(
    () => [
      makeSelectColumn<FiscalGate>(),
      {
        id: "kind",
        header: () => <Trans>Gate</Trans>,
        accessorKey: "kind",
        cell: ({ getValue }) => <GateLabel kind={String(getValue())} />,
        enableSorting: true,
      },
      {
        id: "category",
        header: () => <Trans>Category</Trans>,
        accessorKey: "category",
        cell: ({ getValue }) => <CategoryLabel category={getValue() as FiscalGate["category"]} />,
        enableSorting: true,
      },
      {
        id: "dueDate",
        header: () => <Trans>Due</Trans>,
        accessorKey: "dueDate",
        cell: ({ getValue }) => <span>{String(getValue())}</span>,
        enableSorting: true,
      },
      {
        id: "status",
        header: () => <Trans>Status</Trans>,
        accessorKey: "status",
        cell: ({ getValue }) => <StatusLabel status={getValue() as FiscalGate["status"]} />,
        enableSorting: true,
      },
      {
        id: "amount",
        header: () => <Trans>Amount</Trans>,
        accessorKey: "amount",
        cell: ({ getValue }) => <span>{formatAmount(getValue() as number | null)}</span>,
        enableSorting: true,
      },
    ],
    [],
  );

  /* ────────── render ────────── */

  return (
    <div
      className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="fiscal-gates-page"
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            <Trans>Fiscal gates</Trans>
          </h1>
          <p
            className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]"
            data-testid="fiscal-gates-current-period"
          >
            <Trans>Current period</Trans>: <span className="font-mono">{period}</span>
          </p>
        </div>
      </header>

      <DataTable<FiscalGate>
        tableId={TABLE_ID}
        columns={columns}
        data={visibleRows}
        state={tableState}
        onStateChange={setTableState}
        defaultPageSize={25}
        onSelectionChange={setSelectedRowIds}
        onRowClick={(row) => setPeekRow(row)}
        renderToolbar={() => (
          <SavedViews
            tableId={TABLE_ID}
            state={{
              sort: null,
              filter: viewKeyFromState(tableState),
              page: tableState.pagination.pageIndex,
              pageSize: tableState.pagination.pageSize,
              columns: [],
            }}
            onLoad={(next) => {
              // Re-derive the view key from the loaded SavedView.
              const nextView = (next.filter || VIEW_KEYS.CurrentPeriod) as ViewKey;
              setTableState((s) => ({
                ...s,
                globalFilter: nextView,
                pagination: {
                  pageIndex: next.page ?? 0,
                  pageSize: next.pageSize ?? 25,
                },
              }));
            }}
          />
        )}
      />

      <FiscalBulkBar
        selectedRowIds={selectedRowIds}
        onAction={(action) => {
          if (action === GateAction.MarkFiled) {
            dispatchWithUndo(GateAction.MarkFiled, selectedRowIds);
          } else {
            dispatch(action, selectedRowIds);
          }
        }}
        onClear={() => {
          setTableState((s) => ({ ...s, rowSelection: {} }));
          setSelectedRowIds([]);
        }}
      />

      <PeekPanel<FiscalGate>
        record={peekRow}
        onClose={() => setPeekRow(null)}
        title={
          peekRow ? (
            <span>
              <GateLabel kind={peekRow.kind} />
            </span>
          ) : (
            <Trans>Gate details</Trans>
          )
        }
        renderContent={(g) => (
          <div className="space-y-3 text-[var(--text-sm)] text-[var(--color-ink)]">
            <p>
              <GateDescription kind={g.kind} />
            </p>
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-muted)]">
                  <Trans>Category</Trans>
                </dt>
                <dd>
                  <CategoryLabel category={g.category} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-muted)]">
                  <Trans>Status</Trans>
                </dt>
                <dd>
                  <StatusLabel status={g.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-muted)]">
                  <Trans>Due</Trans>
                </dt>
                <dd className="font-mono">{g.dueDate}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-muted)]">
                  <Trans>Amount</Trans>
                </dt>
                <dd>{formatAmount(g.amount)}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => dispatch(GateAction.Acknowledge, [g.id])}
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] hover:bg-[var(--color-surface-soft)]"
              >
                <ActionLabel action={GateAction.Acknowledge} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (g.status === GateStatus.Filed) return;
                  dispatchWithUndo(GateAction.MarkFiled, [g.id]);
                }}
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] hover:bg-[var(--color-surface-soft)]"
              >
                <ActionLabel action={GateAction.MarkFiled} />
              </button>
              <button
                type="button"
                onClick={() => dispatch(GateAction.Escalate, [g.id])}
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] hover:bg-[var(--color-surface-soft)]"
              >
                <ActionLabel action={GateAction.Escalate} />
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-muted)]">
              {labels.gateKindLabel(g.kind)} · {t`Period`} {g.period}
            </p>
          </div>
        )}
      />

      <div data-testid="fiscal-gates-undo">
        <UndoToast options={toast} onDismiss={() => setToast(null)} />
      </div>
    </div>
  );
}

/* ────────── local bulk-action bar (fiscal-specific actions) ────────── */

interface FiscalBulkBarProps {
  selectedRowIds: ReadonlyArray<string>;
  onAction: (action: GateAction) => void;
  onClear: () => void;
}

function FiscalBulkBar({ selectedRowIds, onAction, onClear }: FiscalBulkBarProps) {
  const count = selectedRowIds.length;
  if (count === 0) return null;
  const items: { key: GateAction; testid: string; label: React.ReactNode }[] = [
    {
      key: GateAction.Acknowledge,
      testid: "fiscal-gates-bulk-acknowledge",
      label: <ActionLabel action={GateAction.Acknowledge} />,
    },
    {
      key: GateAction.MarkFiled,
      testid: "fiscal-gates-bulk-mark_filed",
      label: <ActionLabel action={GateAction.MarkFiled} />,
    },
    {
      key: GateAction.Escalate,
      testid: "fiscal-gates-bulk-escalate",
      label: <ActionLabel action={GateAction.Escalate} />,
    },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]"
      data-testid="fiscal-gates-bulk-bar"
      data-count={String(count)}
    >
      <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        <Trans>{count} selected</Trans>
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => onAction(it.key)}
            data-testid={it.testid}
            className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] hover:bg-[var(--color-surface-soft)]"
          >
            {it.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClear}
          data-testid="fiscal-gates-bulk-clear"
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] hover:bg-[var(--color-surface-soft)]"
        >
          <Trans>Clear</Trans>
        </button>
      </div>
    </div>
  );
}

/* ────────── helpers ────────── */

function viewKeyFromState(s: DataTableState): ViewKey {
  const f = s.globalFilter;
  if (f === VIEW_KEYS.AllOverdue || f === VIEW_KEYS.AwaitingCustomer) return f;
  return VIEW_KEYS.CurrentPeriod;
}
