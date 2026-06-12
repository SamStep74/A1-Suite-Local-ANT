/**
 * BulkActionBar — bottom-fixed action strip that shows when ≥1 row
 * is selected in a DataTable.
 *
 * Pairs with `DataTable.onSelectionChange`: the parent holds the
 * selectedRowIds array in state and renders <BulkActionBar
 * selectedRowIds={...} onAction={...} /> below the table. The bar
 * is a sibling of the table (not a child) so it can sit fixed
 * without interfering with the table's overflow scrolling.
 *
 *  - selectedRowIds : the array of row ids the parent knows about.
 *  - onAction       : dispatch on (action: BulkAction, ids: string[]).
 *                     The parent maps the action to the appropriate
 *                     TanStack Query mutation (which can pair with
 *                     UndoToast).
 *  - actions        : optional whitelist of allowed actions;
 *                     defaults to delete / export / tag.
 *  - onClear        : optional clear-selection handler (renders an X
 *                     button on the right when provided).
 */
import { Trans } from "@lingui/react/macro";
import { Download, Tag, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils/cn";

export type BulkAction = "delete" | "export" | "tag";

export interface BulkActionDef {
  action: BulkAction;
  label: ReactNode;
  icon?: ReactNode;
  /** tone: "danger" tints the button red. Defaults to "neutral". */
  tone?: "neutral" | "danger";
}

const DEFAULT_ACTIONS: Record<BulkAction, BulkActionDef> = {
  delete: {
    action: "delete",
    label: <Trans>Delete</Trans>,
    icon: <Trash2 className="size-3.5" />,
    tone: "danger",
  },
  export: {
    action: "export",
    label: <Trans>Export CSV</Trans>,
    icon: <Download className="size-3.5" />,
    tone: "neutral",
  },
  tag: {
    action: "tag",
    label: <Trans>Tag</Trans>,
    icon: <Tag className="size-3.5" />,
    tone: "neutral",
  },
};

export interface BulkActionBarProps {
  selectedRowIds: ReadonlyArray<string>;
  onAction: (action: BulkAction, selectedRowIds: string[]) => void;
  /** Whitelist of actions to render. Default: all three. */
  actions?: ReadonlyArray<BulkAction>;
  onClear?: () => void;
  className?: string;
}

export function BulkActionBar({
  selectedRowIds,
  onAction,
  actions,
  onClear,
  className,
}: BulkActionBarProps) {
  const count = selectedRowIds.length;
  if (count === 0) return null;

  const visibleActions = (actions ?? ["delete", "export", "tag"]).map(
    (a) => DEFAULT_ACTIONS[a],
  );

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      data-testid="bulk-action-bar"
      data-count={String(count)}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-3xl",
        "rounded-t-[var(--radius-md)] border border-b-0 border-[var(--color-line)]",
        "bg-[var(--color-surface)] px-3 py-2 shadow-[0_-4px_18px_rgba(0,0,0,0.08)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p
          className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]"
          data-testid="bulk-action-bar-count"
        >
          <Trans>{count} selected</Trans>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {visibleActions.map((a) => {
            const tone = a.tone === "danger"
              ? "border-[var(--color-ruby)] bg-[var(--color-ruby)] text-white hover:bg-[color-mix(in_srgb,var(--color-ruby)_88%,black)]"
              : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]";
            return (
              <button
                key={a.action}
                type="button"
                onClick={() => onAction(a.action, [...selectedRowIds])}
                data-testid={`bulk-action-${a.action}`}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border px-2 text-[var(--text-sm)]",
                  tone,
                )}
              >
                {a.icon}
                {a.label}
              </button>
            );
          })}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear selection"
              data-testid="bulk-action-clear"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
