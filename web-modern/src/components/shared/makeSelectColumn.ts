/**
 * makeSelectColumn — a thin helper for the "ID" column that
 * SavedViews code reaches for.
 *
 * The actual checkbox column is rendered by `DataTable` itself
 * (so the header checkbox and the tri-state indeterminate
 * behavior stay in one place). This helper exists so callers can
 * still build a `columns` array without re-implementing the
 * "this is the row id" cell.
 *
 * Why a separate file (instead of inlining in DataTable.tsx)?
 * The shared barrel re-exports `makeSelectColumn` as a named
 * symbol, and a circular import (`DataTable.tsx` exports it,
 * `DataTable.tsx` imports it) would trip Vite's strict module
 * graph. Keeping it in its own file is the cheap fix.
 */
import type { DataTableColumn } from "./DataTable";

/**
 * Build a "select" column whose cell renders the row's id.
 *
 * The column id is `"_id"` (underscore prefix) so it sorts
 * alphabetically before any user-defined column — keeps the id
 * visible at the left edge of the table.
 */
export const makeSelectColumn = <Row extends { id: string }>(): DataTableColumn<Row> => ({
  id: "_id",
  header: "ID",
  cell: (row) => row.id,
  width: "120px",
  className: "font-mono text-[var(--text-xs)] text-muted-foreground",
});
