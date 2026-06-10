/**
 * ViewSwitcher — tab bar for switching between list/kanban/calendar
 * views, etc. Used at the top of /app/crm (List | Kanban) and
 * /app/inventory (Catalog | Stock | Moves) per the spec.
 *
 * The component is **uncontrolled** in the URL sense — the parent
 * owns the URL state and passes the current `value` in. On click, the
 * component calls `onChange(next)`. This keeps ViewSwitcher reusable
 * (it doesn't need to know about TanStack Router) and keeps the
 * "the URL is the single source of truth" responsibility with the
 * route.
 */

import { cn } from "../../lib/utils/cn";

export interface ViewSwitcherOption<V extends string> {
  value: V;
  label: string;
  /** Optional badge count (e.g. "Drafts (3)"). */
  count?: number;
}

export interface ViewSwitcherProps<V extends string> {
  /** The available options, in display order. */
  options: ReadonlyArray<ViewSwitcherOption<V>>;
  /** Current view (read from the URL by the parent). */
  value: V;
  /** Fires when the user clicks a tab. */
  onChange: (next: V) => void;
  /** Optional className for the wrapper. */
  className?: string;
  /** Accessible label, defaults to "View". */
  ariaLabel?: string;
}

export function ViewSwitcher<V extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel = "View",
}: ViewSwitcherProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[var(--text-sm)] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
              active
                ? "bg-[var(--color-brand)] text-white"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]",
            )}
          >
            <span>{opt.label}</span>
            {typeof opt.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold leading-4",
                  active
                    ? "bg-white/15 text-white"
                    : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
