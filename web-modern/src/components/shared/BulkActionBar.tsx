/**
 * BulkActionBar — sticky bottom action bar that appears when the
 * DataTable has at least one row selected.
 *
 * Phase 10.4 shared primitive. Renders nothing when the selection
 * is empty (so the route doesn't need a guard).
 *
 * The bar is positioned `sticky bottom-0` so it stays visible
 * while the user scrolls the table. A `z-50` keeps it above the
 * table rows; the BottomBar (z-30) sits below it.
 *
 * Why a controlled list of `BulkAction`s:
 *   - The parent (route) defines the action set in one place. The
 *     bar is pure presentational.
 *   - Disabled state lives in the action's `disabled` callback so
 *     the bar can show a "no rows match" message inline.
 *   - Destructive actions set `variant: "danger"` — the bar maps
 *     that to a red button.
 */
import { type ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { cn } from "../../lib/utils/cn";
import { Button } from "../ui/Button";

export interface BulkAction {
  /** Stable id. */
  id: string;
  /** Visible label (Lingui macros supported via `Trans`). */
  label: ReactNode;
  /** Action callback. Receives the currently-selected ids. */
  onAction: (selectedIds: readonly string[]) => void;
  /** Set to true to disable the action (e.g. permission gate). */
  disabled?: boolean;
  /** Visual variant. Defaults to "secondary". */
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
}

export type BulkActionDef = BulkAction;

export interface BulkActionBarProps {
  /** Currently-selected row ids. */
  selectedIds: readonly string[];
  /** Action definitions. */
  actions: readonly BulkAction[];
  /** Called when the user clicks the "Clear" link. */
  onClearSelection?: () => void;
  /** Optional className override. */
  className?: string;
  /**
   * If true, render the bar even when `selectedIds` is empty.
   * Mostly useful for tests / e2e (`data-testid` always present).
   */
  forceRender?: boolean;
}

export function BulkActionBar({
  selectedIds,
  actions,
  onClearSelection,
  className,
  forceRender,
}: BulkActionBarProps): ReactNode {
  if (selectedIds.length === 0 && !forceRender) return null;

  const count = selectedIds.length;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      data-testid="bulk-action-bar"
      data-selected-count={count}
      className={cn(
        "sticky bottom-0 z-50 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-sm",
        className,
      )}
    >
      <span
        className="px-2 text-[var(--text-sm)] font-medium text-[var(--color-ink)]"
        data-testid="bulk-action-bar-count"
      >
        <Trans>{count} selected</Trans>
      </span>
      <div className="ml-2 h-5 w-px bg-[var(--color-line)]" aria-hidden />
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((a) => (
          <Button
            key={a.id}
            type="button"
            variant={a.variant ?? "secondary"}
            size="sm"
            disabled={a.disabled}
            onClick={() => a.onAction(selectedIds)}
            data-testid={`bulk-action-${a.id}`}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {onClearSelection ? (
        <button
          type="button"
          onClick={onClearSelection}
          data-testid="bulk-action-bar-clear"
          className="ml-auto px-2 text-[var(--text-sm)] text-muted-foreground hover:text-[var(--color-ink)]"
        >
          <Trans>Clear</Trans>
        </button>
      ) : null}
    </div>
  );
}
