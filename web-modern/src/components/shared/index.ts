/**
 * components/shared — barrel exports.
 *
 * Every list surface in the web-modern SPA should import its table
 * primitives from this single path. Phase 10.5 (product
 * differentiators) and beyond will compose these primitives
 * without touching them.
 */
export { DataTable, makeSelectColumn, type DataTableProps, type DataTableState, type ToolbarApi } from "./DataTable";
export { SavedViews, type SavedViewsProps } from "./SavedViews";
export { type SavedView, type SavedViewState } from "../../lib/components/savedViewsStore";
export { PeekPanel, type PeekPanelProps } from "./PeekPanel";
export {
  UndoToast,
  useUndoToastController,
  type UndoToastOptions,
  type UndoToastProps,
  type UndoToastController,
} from "./UndoToast";
export { BulkActionBar, type BulkAction, type BulkActionBarProps, type BulkActionDef } from "./BulkActionBar";
