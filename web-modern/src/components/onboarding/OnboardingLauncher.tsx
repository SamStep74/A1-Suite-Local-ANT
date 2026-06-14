/**
 * OnboardingLauncher — the Topbar dropdown that lists the 5
 * default tours and starts one on click.
 *
 * UX:
 *   - Closed: a single "?" / Compass button in the Topbar. Badge
 *     shows the count of tours the user has NOT yet completed.
 *   - Open: a popover menu (top-anchored, right-aligned) listing
 *     every tour. Each row shows the feature name + goal + a
 *     checkmark if the tour is done. Deferred tours get a small
 *     "Preview" badge.
 *   - Clicking a row calls `runtime.start(tourId)` and closes the
 *     popover. The TourOverlay (mounted by the parent) takes over.
 *   - Below the list, a "Show tour launcher" / "Hide tour launcher"
 *     toggle controls whether the Topbar button is visible at all.
 *     This is the user-facing opt-out (separate from the per-tour
 *     "done" flag).
 *
 * Why a popover (not a modal):
 *   - The launcher is a quick-jump menu, not a wizard. A popover
 *     matches the density of the Topbar (small, top-anchored) and
 *     mirrors the existing AskAiPanel / CommandPalette patterns.
 *   - The actual tour experience is a separate modal
 *     (TourOverlay); keeping the launcher as a popover avoids
 *     two stacked modals.
 *
 * Lingui:
 *   - All chrome strings (button labels, menu header, toggle copy)
 *     use the React `<Trans>` / `t` macros.
 *
 * Visibility:
 *   - The whole launcher is gated by `import.meta.env.DEV` from
 *     the parent (Topbar). We keep the gate in Topbar so the
 *     `data-testid` selectors are stable across envs — the e2e
 *     can target the launcher without checking `process.env`.
 */
import { useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  Compass,
  CheckCircle2,
  Sparkles,
  Receipt,
  Inbox,
  FileText,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils/cn";
import type { TourRuntime } from "../../lib/onboarding/schemas";
import { Button } from "../ui/Button";

interface Props {
  runtime: TourRuntime;
  /** When false, the launcher button is hidden in the Topbar.
   *  Defaults to true. Stored under the `a1:onboarding:visible`
   *  localStorage key so the user's preference persists. */
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}

/** Lucide icon name → component. The DEFAULT_TOURS catalog stores
 *  the icon as a string so it stays JSON-serializable; we resolve
 *  the component here. The catalog's icon strings are restricted
 *  to this set (the schema regex doesn't constrain them yet, but
 *  the unit test asserts they all match). */
const ICONS: Record<string, LucideIcon> = {
  Receipt,
  Inbox,
  Sparkles,
  FileText,
  Settings,
};

export function OnboardingLauncher({
  runtime,
  visible = true,
  onVisibleChange,
}: Props) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click. The menu's "Start" button commits and
  // closes immediately, so we don't need a separate "close on
  // select" handler.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Close on Escape. The TourOverlay also listens for Escape; this
  // is for "menu open, no tour running" — closes the popover only.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!visible) return null;

  const unfinishedCount = runtime.tours.filter(
    (tour) => !runtime.isDone(tour.id),
  ).length;

  return (
    <div
      ref={wrapperRef}
      className="relative"
      data-testid="onboarding-launcher"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t({
          message: "Open onboarding tour launcher",
        })}
        data-testid="onboarding-launcher-trigger"
        className="!p-1.5"
      >
        <Compass className="size-4" />
        {unfinishedCount > 0 ? (
          <span
            data-testid="onboarding-launcher-badge"
            className={cn(
              "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center",
              "justify-center rounded-full px-1 text-[10px] font-semibold",
              "bg-[var(--color-brand)] text-white",
            )}
            aria-label={t({
              message: "{count} tours remaining",
            }).replace("{count}", String(unfinishedCount))}
          >
            {unfinishedCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label={t({ message: "Tours" })}
          data-testid="onboarding-launcher-menu"
          className={cn(
            "absolute right-0 top-full z-50 mt-1.5 w-80",
            "rounded-[var(--radius-md)] border border-[var(--color-line)]",
            "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-xl",
          )}
        >
          <div className="px-3 pt-2.5 pb-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              <Trans>Take a tour</Trans>
            </div>
            <div className="text-[var(--text-sm)] text-[var(--color-muted)]">
              <Trans>
                Quick walkthroughs of the 5 product differentiators.
              </Trans>
            </div>
          </div>
          <ul className="px-1 pb-1">
            {runtime.tours.map((tour) => {
              const done = runtime.isDone(tour.id);
              const Icon = ICONS[tour.icon] ?? Sparkles;
              return (
                <li key={tour.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      runtime.start(tour.id);
                      setOpen(false);
                    }}
                    data-testid={`onboarding-launcher-item-${tour.id}`}
                    data-done={done}
                    data-deferred={tour.deferred}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-[var(--radius-sm)]",
                      "px-2 py-1.5 text-left",
                      "hover:bg-[var(--color-surface-soft)]",
                    )}
                  >
                    <Icon
                      className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                          {tour.feature}
                        </span>
                        {tour.deferred ? (
                          <span
                            data-testid={`onboarding-launcher-deferred-${tour.id}`}
                            className="rounded-[var(--radius-sm)] bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-900"
                          >
                            <Trans>Preview</Trans>
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-[var(--text-xs)] text-[var(--color-muted)]">
                        {tour.goal}
                      </div>
                    </div>
                    {done ? (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]"
                        aria-label={t({ message: "Completed" })}
                        data-testid={`onboarding-launcher-done-${tour.id}`}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[var(--color-line)] px-3 py-2">
            <button
              type="button"
              onClick={() => onVisibleChange?.(false)}
              data-testid="onboarding-launcher-hide"
              className="text-[var(--text-xs)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              <Trans>Hide tour launcher</Trans>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
