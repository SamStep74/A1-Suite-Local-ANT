/**
 * KanbanBoard — generic column board with HTML5 DnD.
 *
 * Re-usable for deals-by-stage, leads-by-status, and any other
 * "items bucketed by a stage field" surface. Drag a card from one
 * column to another; on drop, the parent's `onMove(itemId, toColumn)`
 * fires. The board itself does not own state — it is a controlled
 * component.
 *
 * For Phase 2 V1 we only emit the move event; the parent can choose
 * to optimistically update or PATCH the server. Future reordering
 * (drag within a column) is intentionally out of scope per the spec.
 */

import { type ReactNode, useState } from "react";
import { cn } from "../../lib/utils/cn";

export interface KanbanColumn<C extends string> {
  id: C;
  title: string;
  /** Optional color accent (one of the 8-color tag palette names). */
  accent?: "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "violet" | "pink";
  /** Optional count shown in the column header. */
  count?: number;
}

export interface KanbanItem {
  /** Stable id. */
  id: string;
}

export interface KanbanBoardProps<C extends string, T extends KanbanItem> {
  columns: ReadonlyArray<KanbanColumn<C>>;
  /** Map of columnId → items in that column. */
  items: Record<C, ReadonlyArray<T>>;
  /** Render an item card. The card root MUST set data-item-id so the
   *  DnD handlers can find it. */
  renderItem: (item: T, column: C) => ReactNode;
  /** Fires when the user drops an item on a different column. */
  onMove?: (itemId: string, from: C, to: C) => void;
  /** Optional empty-state slot, rendered when a column has no items. */
  renderEmpty?: (column: C) => ReactNode;
  className?: string;
}

const ACCENT_BORDER: Record<NonNullable<KanbanColumn<string>["accent"]>, string> = {
  red: "border-l-[var(--color-ruby,#b23a48)]",
  orange: "border-l-[var(--color-amber,#d78b2f)]",
  yellow: "border-l-[var(--color-amber,#d78b2f)]",
  green: "border-l-[var(--color-success,#0a8a4a)]",
  teal: "border-l-[var(--color-teal,#00897b)]",
  blue: "border-l-[var(--color-blue,#2d6cdf)]",
  violet: "border-l-[var(--color-violet,#594cdb)]",
  pink: "border-l-[#c0266f]",
};

export function KanbanBoard<C extends string, T extends KanbanItem>({
  columns,
  items,
  renderItem,
  onMove,
  renderEmpty,
  className,
}: KanbanBoardProps<C, T>) {
  const [dragging, setDragging] = useState<{ itemId: string; from: C } | null>(null);
  const [hoverColumn, setHoverColumn] = useState<C | null>(null);

  function handleDragStart(itemId: string, from: C) {
    return (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData("text/plain", itemId);
      event.dataTransfer.effectAllowed = "move";
      setDragging({ itemId, from });
    };
  }

  function handleDragOver(col: C) {
    return (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (hoverColumn !== col) setHoverColumn(col);
    };
  }

  function handleDragLeave(col: C) {
    return (event: React.DragEvent<HTMLDivElement>) => {
      // Only clear if the leave is actually leaving the column container
      const related = event.relatedTarget as Node | null;
      if (related && event.currentTarget.contains(related)) return;
      if (hoverColumn === col) setHoverColumn(null);
    };
  }

  function handleDrop(col: C) {
    return (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setHoverColumn(null);
      const itemId = event.dataTransfer.getData("text/plain");
      const from = dragging?.from;
      setDragging(null);
      if (!itemId || !from) return;
      if (from === col) return;
      onMove?.(itemId, from, col);
    };
  }

  return (
    <div
      className={cn(
        "grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto",
        className,
      )}
    >
      {columns.map((col) => {
        const colItems = items[col.id] ?? [];
        const isHover = hoverColumn === col.id;
        return (
          <section
            key={col.id}
            data-column={col.id}
            onDragOver={handleDragOver(col.id)}
            onDragLeave={handleDragLeave(col.id)}
            onDrop={handleDrop(col.id)}
            className={cn(
              "flex min-h-[200px] flex-col gap-2 rounded-[var(--radius-md)] border-l-2 border-r border-y border-[var(--color-line)] bg-[var(--color-surface-soft)]/40 p-2",
              col.accent ? ACCENT_BORDER[col.accent] : "border-l-[var(--color-line)]",
              isHover && "bg-[var(--color-surface-soft)] outline-2 outline-dashed outline-[var(--color-brand)]/30",
            )}
          >
            <header className="flex items-center justify-between px-1.5 py-1">
              <h3 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
                {col.title}
              </h3>
              <span className="rounded-full bg-[var(--color-surface)] px-1.5 text-[11px] font-semibold text-[var(--color-muted)]">
                {col.count ?? colItems.length}
              </span>
            </header>

            <div className="flex flex-col gap-2">
              {colItems.length === 0 ? (
                renderEmpty ? (
                  <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] p-3 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
                    {renderEmpty(col.id)}
                  </div>
                ) : null
              ) : (
                colItems.map((item) => (
                  <div
                    key={item.id}
                    data-item-id={item.id}
                    draggable
                    onDragStart={handleDragStart(item.id, col.id)}
                    className="cursor-grab rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[0_1px_2px_rgb(0_0_0_/_3%)] transition-shadow hover:shadow-[0_2px_4px_rgb(0_0_0_/_5%)] active:cursor-grabbing"
                  >
                    {renderItem(item, col.id)}
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
