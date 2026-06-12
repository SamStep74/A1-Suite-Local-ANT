/**
 * DataTable — headless table primitive built on TanStack Table v8.
 *
 * Composes the four operations every list surface in the SPA needs:
 * sort, filter, page, select. Everything else (toolbar extras, row
 * actions, row details) is delegated to the caller via render props
 * so this component stays small and re-usable.
 *
 *  - columns       : TanStack ColumnDef array; the caller picks
 *                    accessors, cell renderers, header labels.
 *  - data          : row array.
 *  - state / onStateChange : controlled mode (parent owns the table
 *                    state and can persist it via SavedViews).
 *  - initialState  : uncontrolled mode (state lives inside the
 *                    component, useful for one-off tables).
 *  - onSelectionChange : fires with the array of selected row ids
 *                    whenever the selection set changes; powers
 *                    BulkActionBar.
 *  - onRowClick    : optional row-click handler; if provided, the
 *                    whole `<tr>` becomes clickable and a PeekPanel
 *                    (or any drawer) can be opened.
 *  - renderToolbar : render prop injected into the toolbar row so
 *                    callers can hang SavedViews / column toggles /
 *                    global search beside the built-in controls.
 *
 * Lingui: every user-facing string this component owns (page
 * indicator, "No results", per-page selector) is wrapped in <Trans>.
 * Cell / column-header text is the caller's responsibility (it's
 * the column's domain label, not a table-control string).
 */
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Trans } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { cn } from "../../lib/utils/cn";

type StateSlice = keyof DataTableState;

export interface DataTableState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  pagination: PaginationState;
  globalFilter: string;
  columnVisibility: VisibilityState;
  rowSelection: RowSelectionState;
}

const fullState = (
  base: Partial<DataTableState> | undefined,
  override?: { slice: StateSlice; value: unknown },
): DataTableState => {
  const out: DataTableState = {
    sorting: base?.sorting ?? [],
    columnFilters: base?.columnFilters ?? [],
    pagination: base?.pagination ?? { pageIndex: 0, pageSize: 25 },
    globalFilter: base?.globalFilter ?? "",
    columnVisibility: base?.columnVisibility ?? {},
    rowSelection: base?.rowSelection ?? {},
  };
  if (override) {
    (out as unknown as Record<string, unknown>)[override.slice] = override.value;
  }
  return out;
};

export interface DataTableProps<TData> {
  tableId: string;
  columns: ColumnDef<TData, unknown>[];
  data: ReadonlyArray<TData>;

  /** Stable row-id getter — used by selection and SavedViews. */
  getRowId?: (row: TData, index: number) => string;

  /** Controlled mode. Omit to run uncontrolled. */
  state?: Partial<DataTableState>;
  onStateChange?: (next: DataTableState) => void;

  /** Uncontrolled initial state. */
  initialState?: Partial<DataTableState>;

  /** Defaults to true. Per-feature flags so the caller can opt out. */
  enableSorting?: boolean;
  enableFiltering?: boolean;
  enablePagination?: boolean;
  enableSelection?: boolean;

  /** Per-column filter fn override (e.g. fuzzy match). */
  globalFilterFn?: FilterFn<TData>;
  defaultPageSize?: number;

  /** Selection fan-out. Always fired with the post-change set. */
  onSelectionChange?: (selectedRowIds: string[]) => void;

  /** Row click. ESC and click-outside are the drawer's concern. */
  onRowClick?: (row: TData) => void;

  /** Inject toolbar extras (e.g. <SavedViews tableId=... />). */
  renderToolbar?: (api: ToolbarApi<TData>) => ReactNode;

  /** Optional empty-state node. Defaults to a localized "No results". */
  emptyState?: ReactNode;

  /** Optional className for the wrapper <section>. */
  className?: string;
}

export interface ToolbarApi<TData> {
  table: Table<TData>;
  state: DataTableState;
  selectedRowIds: string[];
}

export function DataTable<TData>({
  tableId,
  columns,
  data,
  getRowId,
  state: controlledState,
  onStateChange,
  initialState,
  enableSorting = true,
  enableFiltering = true,
  enablePagination = true,
  enableSelection = true,
  globalFilterFn,
  defaultPageSize = 25,
  onSelectionChange,
  onRowClick,
  renderToolbar,
  emptyState,
  className,
}: DataTableProps<TData>) {
  const isControlled = controlledState !== undefined;

  const [internalSorting, setInternalSorting] = useState<SortingState>(
    initialState?.sorting ?? [],
  );
  const [internalColumnFilters, setInternalColumnFilters] = useState<ColumnFiltersState>(
    initialState?.columnFilters ?? [],
  );
  const [internalPagination, setInternalPagination] = useState<PaginationState>(
    initialState?.pagination ?? { pageIndex: 0, pageSize: defaultPageSize },
  );
  const [internalGlobalFilter, setInternalGlobalFilter] = useState<string>(
    initialState?.globalFilter ?? "",
  );
  const [internalColumnVisibility, setInternalColumnVisibility] = useState<VisibilityState>(
    initialState?.columnVisibility ?? {},
  );
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>(
    initialState?.rowSelection ?? {},
  );

  const sorting = isControlled ? (controlledState?.sorting ?? []) : internalSorting;
  const columnFilters = isControlled ? (controlledState?.columnFilters ?? []) : internalColumnFilters;
  const pagination = isControlled
    ? (controlledState?.pagination ?? { pageIndex: 0, pageSize: defaultPageSize })
    : internalPagination;
  const globalFilter = isControlled ? (controlledState?.globalFilter ?? "") : internalGlobalFilter;
  const columnVisibility = isControlled
    ? (controlledState?.columnVisibility ?? {})
    : internalColumnVisibility;
  const rowSelection = isControlled ? (controlledState?.rowSelection ?? {}) : internalRowSelection;

  // Default to `original.id` when the caller hasn't passed getRowId
  // — most call-sites have an `id` field on the row, and the
  // default TanStack behavior (stringified index) makes row
  // test-ids unstable and selection impossible without an explicit
  // getter. Fall back to the index for rows that don't have id.
  const resolvedGetRowId = useMemo(() => {
    if (getRowId) return getRowId;
    return (row: TData, index: number): string => {
      if (row && typeof row === "object" && "id" in row) {
        const id = (row as { id: unknown }).id;
        if (typeof id === "string" || typeof id === "number") return String(id);
      }
      return String(index);
    };
  }, [getRowId]);

  // When enableSelection is off, the makeSelectColumn() helper's
  // "select" column shouldn't be rendered. The helper is the only
  // public way to inject the select column, so filtering by id is
  // safe and keeps the caller's columns array untouched.
  const effectiveColumns = useMemo(
    () => (enableSelection ? columns : columns.filter((c) => c.id !== "select")),
    [columns, enableSelection],
  );

  const wrap = useCallback(
    <K extends StateSlice>(
      slice: K,
      setter: (next: DataTableState[K]) => void,
      fallback: DataTableState[K],
    ): OnChangeFn<DataTableState[K]> =>
      (updater) => {
        const current = (controlledState?.[slice] ?? fallback) as DataTableState[K];
        const next: DataTableState[K] =
          typeof updater === "function"
            ? (updater as (old: DataTableState[K]) => DataTableState[K])(current)
            : updater;
        if (!isControlled) setter(next);
        onStateChange?.(fullState(controlledState, { slice, value: next }));
      },
    [isControlled, onStateChange, controlledState],
  );

  const table = useReactTable<TData>({
    data: data as TData[],
    columns: effectiveColumns,
    getRowId: resolvedGetRowId,
    state: {
      sorting,
      columnFilters,
      pagination,
      globalFilter,
      columnVisibility,
      rowSelection,
    },
    enableSorting,
    enableFilters: enableFiltering,
    enableRowSelection: enableSelection,
    globalFilterFn: globalFilterFn ?? "auto",
    onSortingChange: wrap("sorting", setInternalSorting, internalSorting),
    onColumnFiltersChange: wrap("columnFilters", setInternalColumnFilters, internalColumnFilters),
    onPaginationChange: wrap("pagination", setInternalPagination, internalPagination),
    onGlobalFilterChange: wrap("globalFilter", setInternalGlobalFilter, internalGlobalFilter),
    onColumnVisibilityChange: wrap("columnVisibility", setInternalColumnVisibility, internalColumnVisibility),
    onRowSelectionChange: (updater) => {
      const next: RowSelectionState =
        typeof updater === "function"
          ? (updater as (old: RowSelectionState) => RowSelectionState)(rowSelection)
          : updater;
      if (!isControlled) setInternalRowSelection(next);
      onSelectionChange?.(Object.keys(next).filter((k) => next[k]));
      onStateChange?.(fullState(controlledState, { slice: "rowSelection", value: next }));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const liveState: DataTableState = {
    sorting,
    columnFilters,
    pagination,
    globalFilter,
    columnVisibility,
    rowSelection,
  };

  const selectedRowIds = useMemo(
    () => Object.keys(rowSelection).filter((k) => rowSelection[k]),
    [rowSelection],
  );

  const handleGlobalFilter = (e: ChangeEvent<HTMLInputElement>) => {
    table.setGlobalFilter(e.target.value);
  };

  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const totalRows = data.length;

  return (
    <section
      data-entity="data-table"
      data-table-id={tableId}
      data-row-count={String(totalRows)}
      className={cn(
        "space-y-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {enableFiltering && (
          <input
            type="search"
            value={globalFilter}
            onChange={handleGlobalFilter}
            placeholder="Search…"
            aria-label="Search table"
            data-testid="data-table-search"
            className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)] placeholder:text-[var(--color-muted)] sm:max-w-xs"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {renderToolbar?.({ table, state: liveState, selectedRowIds })}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-line)]">
        <table className="w-full text-[var(--text-sm)]" role="table">
          <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDir = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : "none"
                      }
                      className="px-3 py-2 text-left font-semibold"
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          disabled={!canSort}
                          className={cn(
                            "inline-flex items-center gap-1",
                            canSort && "cursor-pointer hover:text-[var(--color-ink)]",
                            !canSort && "cursor-default",
                          )}
                          data-testid={`data-table-sort-${header.column.id}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <span aria-hidden="true">
                              {sortDir === "asc" ? (
                                <ArrowUp className="size-3" />
                              ) : sortDir === "desc" ? (
                                <ArrowDown className="size-3" />
                              ) : (
                                <ArrowUpDown className="size-3 opacity-40" />
                              )}
                            </span>
                          )}
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.getAllColumns().length}
                  className="px-3 py-6 text-center text-[var(--color-muted)]"
                >
                  {emptyState ?? <Trans>No results</Trans>}
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row) => (
              <DataTableRow
                key={row.id}
                row={row}
                onRowClick={onRowClick}
                selectable={enableSelection}
              />
            ))}
          </tbody>
        </table>
      </div>

      {enablePagination && totalRows > 0 && (
        <div className="flex flex-col gap-2 text-[var(--text-xs)] text-[var(--color-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p data-testid="data-table-page-summary">
            <Trans>
              Showing {Math.min(pageIndex * pageSize + 1, totalRows)}–
              {Math.min((pageIndex + 1) * pageSize, totalRows)} of {totalRows}
            </Trans>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
              data-testid="data-table-prev"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 hover:bg-[var(--color-surface-soft)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="size-3" />
              <Trans>Prev</Trans>
            </button>
            <span data-testid="data-table-page-indicator">
              <Trans>Page {pageIndex + 1} of {Math.max(1, pageCount)}</Trans>
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
              data-testid="data-table-next"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 hover:bg-[var(--color-surface-soft)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trans>Next</Trans>
              <ChevronRight className="size-3" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

interface DataTableRowProps<TData> {
  row: Row<TData>;
  onRowClick?: (row: TData) => void;
  selectable: boolean;
}

function DataTableRow<TData>({ row, onRowClick, selectable }: DataTableRowProps<TData>) {
  const selected = row.getIsSelected();
  return (
    <tr
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      data-testid={`data-table-row-${row.id}`}
      data-selected={selected ? "true" : undefined}
      className={cn(
        "hover:bg-[var(--color-surface-soft)]",
        selected && "bg-[color-mix(in_srgb,var(--color-brand)_8%,var(--color-surface))]",
        onRowClick && "cursor-pointer",
      )}
    >
      {row.getVisibleCells().map((cell) => {
        const isSelectCol = selectable && cell.column.id === "select";
        return (
          <td
            key={cell.id}
            onClick={isSelectCol ? (e) => e.stopPropagation() : undefined}
            className="px-3 py-2 text-[var(--color-ink)]"
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      })}
    </tr>
  );
}

/* ────────── helpers ────────── */

/** Tiny convenience for callers that want a checkbox select column. */
export function makeSelectColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "select",
    enableSorting: false,
    enableHiding: false,
    header: ({ table }) => (
      <input
        type="checkbox"
        aria-label="Select all rows"
        checked={table.getIsAllPageRowsSelected()}
        ref={(el) => {
          if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
        }}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        data-testid="data-table-select-all"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`Select row ${row.id}`}
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
        data-testid={`data-table-row-select-${row.id}`}
      />
    ),
  };
}
