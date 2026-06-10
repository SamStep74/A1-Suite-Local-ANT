/**
 * LeftRail — vertical icon column with the 14 module icons, sitting between
 * the Topbar and the main content. Zoho / Odoo pattern.
 *
 * Phase 0: static icon list with aria-current="page" on the active app, plus
 * collapse/expand with localStorage persistence. The "All apps" trigger at
 * the bottom opens the AppLauncher grid (Zoho pattern).
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Grid3x3 } from "lucide-react";
import { Button } from "../ui/Button";
import { APP_IDS, APPS, type AppId } from "../../lib/apps";
import { cn } from "../../lib/utils/cn";

const STORAGE_KEY = "ant.lefRail.collapsed";

export function LeftRail({ onOpenAppLauncher }: { onOpenAppLauncher: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();

  // Hydrate from localStorage on mount (avoid SSR mismatch).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // ignore (private mode)
    }
  }, []);

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Active app = first segment after /app/, OR null on /app.
  const currentApp: AppId | null = (() => {
    const m = pathname.match(/^\/app\/([^/?#]+)/);
    if (!m) return null;
    const id = m[1] as AppId;
    return APP_IDS.includes(id) ? id : null;
  })();

  return (
    <aside
      aria-label="App navigation"
      className={cn(
        "flex shrink-0 flex-col items-center gap-1 border-r border-[var(--color-line)]",
        "bg-[var(--color-surface)] py-2",
        collapsed ? "w-12" : "w-14",
      )}
    >
      {APP_IDS.map((id) => {
        const meta = APPS[id];
        const Icon = meta.icon;
        const isActive = currentApp === id;
        return (
          <Link
            key={id}
            to="/app/$appId"
            params={{ appId: id }}
            aria-current={isActive ? "page" : undefined}
            title={meta.label}
            className={cn(
              "group flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]",
              isActive
                ? "bg-[var(--color-brand)]/10 text-[var(--color-brand)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]",
              "transition-colors",
            )}
          >
            <Icon className="size-4" />
          </Link>
        );
      })}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenAppLauncher}
        aria-label="Open app launcher"
        title="All apps"
        className="!h-10 !w-10"
      >
        <Grid3x3 className="size-4" />
      </Button>

      <button
        onClick={toggle}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        className={cn(
          "flex h-8 w-10 items-center justify-center text-[10px] font-bold",
          "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
        )}
      >
        {collapsed ? "›" : "‹"}
      </button>
    </aside>
  );
}
