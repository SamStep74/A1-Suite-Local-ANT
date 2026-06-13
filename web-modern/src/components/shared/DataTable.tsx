/**
 * DataTable — controlled, selection-aware table primitive.
 *
 * Phase 10.4 shared primitive. Phase 10.5 product differentiators
 * (fiscal-gates, triage-inbox, period-close-checklist, …) compose
 * this without touching it.
 *
 * Design choices:
 *   - **Controlled.** The parent owns `selectedIds` so that bulk
 *     actions can read the current selection synchronously. This
 *     avoids the "stale state" bug class that uncontrolled
 *     checkboxes with `defaultChecked` introduce.
 *   - **Generic over row + id.** The table doesn't know the shape
 *     of the data — only that each row has a string id and that
 *     columns can render any cell. The `id` field is also used as
 *     the React `key`, so two rows with the same id will clash
 *     (intentional — the type system forces ids to be unique).
 *   - **Render-prop columns.** Each column is `{ id, header, cell,
 *     width? }`. The `cell(row)` callback returns a ReactNode so
 *     Lingui macros work inside cells (`<Trans>…</Trans>`).
 *   - **No sort / filter / pagination.** Those concerns are owned
 *     by the calling route (URL state via `?status=`, `?page=`).
 *     Keeping the primitive narrow lets it stay composable.
 *   - **No data table library.** Tailwind + native `<table>` is
 *     enough for a 12-15 row checklist; a `tanstack/table` dep
 *     would add 30kB to the bundle for no current win.
 */
import {
  type ReactNode,
  useCallback,
  useId,
  useMemo,
} from "react";
import { Trans } from "@lingui/react/macro";
import { cn } from "../../lib/utils/cn";
import { makeSelectColumn } from "./makeSelectColumn";

export interface DataTableColumn<Row> {
  /** Stable id for the column. Used as a key. */
  id: string;
  /** Header content. Lingui macros supported. */
  header: ReactNode;
  /** Cell renderer. */
  cell: (row: Row) => ReactNode;
  /** Optional inline width (e.g. `"120px"`, `"20%"`). */
  width?: string;
  /** Tailwind class for the cell. Use for alignment, color, etc. */
  className?: string;
}

export interface DataTableState {
  /** Ids of currently selected rows. Order is the render order. */
  selectedIds: readonly string[];
}

export interface ToolbarApi {
  /** Replace the current selection. */
  setSelected: (ids: readonly string[]) => void;
  /** Append or remove a single id. */
  toggle: (id: string) => void;
  /** Clear the selection. */
  clear: () => void;
}

export interface DataTableProps<Row extends { id: string }> {
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  /** Controlled selection state. */
  selectedIds: readonly string[];
  /** Called when the user toggles a row (or all rows via the
   *  header checkbox). */
  onSelectionChange: (next: readonly string[]) => void;
  /** Accessible label for the underlying `<table>`. Defaults to
   *  "Data table" (translated). */
  ariaLabel?: string;
  /** Test id passthrough — handy for e2e selection by data
   *  attribute. */
  testId?: string;
  /** Optional row-level click handler. Selection checkbox still
   *  works independently (clicks on the checkbox column don't
   *  trigger this). */
  onRowClick?: (row: Row) => void;
  /** Message rendered when `rows` is empty. Defaults to a
   *  translated "No rows". */
  emptyMessage?: ReactNode;
}

/**
 * DataTable — the rendering primitive.
 *
 * Render shape:
 *
 *   <table role="grid">
 *     <thead><tr><th/><th>…header…</th>…</tr></thead>
 *     <tbody><tr><td><input type=checkbox/></td><td>…cell…</td>…</tr></tbody>
 *   </table>
 *
 * The header checkbox is tri-state: empty when no rows are
 * selected, indeterminate when some are, checked when all are.
 * The native `indeterminate` property has no React JSX binding so
 * we set it via a `ref` inside the cell component.
 */
export function DataTable<Row extends { id: string }>(
  props: DataTableProps<Row>,
): ReactNode {
  const {
    rows,
    columns,
    selectedIds,
    onSelectionChange,
    ariaLabel,
    testId,
    onRowClick,
    emptyMessage,
  } = props;

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectedSet = useMemo(
    () => new Set(selectedIds),
    [selectedIds],
  );

  const handleToggleAll = useCallback(() => {
    if (selectedIds.length === rows.length && rows.length > 0) {
      onSelectionChange([]);
    } else {
      onSelectionChange(allIds);
    }
  }, [allIds, onSelectionChange, rows.length, selectedIds.length]);

  const handleToggleRow = useCallback(
    (id: string) => {
      const next = new Set(selectedSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Preserve render order rather than insertion order so the
      // consumer's URL-driven `?selected=…` is deterministic.
      onSelectionChange(allIds.filter((rid) => next.has(rid)));
    },
    [allIds, onSelectionChange, selectedSet],
  );

  const labelId = useId();

  if (rows.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-[var(--color-line)] p-6 text-center text-[var(--text-sm)] text-muted-foreground"
        data-testid={testId ? `${testId}-empty` : undefined}
      >
        {emptyMessage ?? <Trans>No rows</Trans>}
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]"
      data-testid={testId}
    >
      <table
        role="grid"
        aria-labelledby={labelId}
        aria-label={ariaLabel}
        className="w-full border-collapse text-left text-[var(--text-sm)]"
      >
        <caption id={labelId} className="sr-only">
          {ariaLabel ?? "Data table"}
        </caption>
        <thead className="bg-[var(--color-surface-soft)] text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          <tr>
            <th scope="col" className="w-10 px-3 py-2">
              <SelectAllCheckbox
                checked={selectedIds.length === rows.length}
                indeterminate={
                  selectedIds.length > 0 && selectedIds.length < rows.length
                }
                onChange={handleToggleAll}
                ariaLabel={
                  selectedIds.length === rows.length
                    ? "Deselect all rows"
                    : "Select all rows"
                }
                testId={testId ? `${testId}-select-all` : undefined}
              />
            </th>
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn("px-3 py-2", col.className)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const checked = selectedSet.has(row.id);
            return (
              <tr
                key={row.id}
                data-row-id={row.id}
                className={cn(
                  "border-t border-[var(--color-line)] align-top",
                  checked && "bg-[var(--color-surface-soft)]",
                  onRowClick && "cursor-pointer hover:bg-[var(--color-surface-soft)]",
                )}
                onClick={
                  onRowClick
                    ? (e) => {
                        // Don't fire row click when interacting
                        // with the checkbox cell.
                        const target = e.target as HTMLElement;
                        if (target.closest("[data-select-cell]")) return;
                        onRowClick(row);
                      }
                    : undefined
                }
              >
                <td className="w-10 px-3 py-2" data-select-cell>
                  <RowCheckbox
                    checked={checked}
                    onChange={() => handleToggleRow(row.id)}
                    ariaLabel={`Select row ${row.id}`}
                    testId={testId ? `${testId}-row-${row.id}-checkbox` : undefined}
                  />
                </td>
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn("px-3 py-2", col.className)}
                    data-testid={
                      testId ? `${testId}-row-${row.id}-cell-${col.id}` : undefined
                    }
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ────────── internal: row + header checkboxes ────────── */

function RowCheckbox({
  checked,
  onChange,
  ariaLabel,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={onChange}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer accent-[var(--color-brand)]"
    />
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
  testId,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  ariaLabel: string;
  testId?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      checked={checked}
      onChange={onChange}
      data-testid={testId}
      className="h-4 w-4 cursor-pointer accent-[var(--color-brand)]"
    />
  );
}

/* ────────── helper for the "select" column ────────── */

/**
 * makeSelectColumn — build a DataTableColumn whose cell is the
 * row's id (used by SavedViews / SavedView filters that key
 * selections by the same id).
 *
 * The current DataTable renders the checkbox in its own dedicated
 * column, so this helper is a thin alias for `columns[0] = { id:
 * "_id", header: "ID", cell: r => r.id }`. It exists so that
 * SavedViews code can talk about "the select column" without
 * hard-coding the index.
 */
export { makeSelectColumn };
