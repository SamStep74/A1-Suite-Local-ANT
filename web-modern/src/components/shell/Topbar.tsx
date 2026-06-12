/**
 * Topbar — the persistent bar at the top of every authenticated route.
 *
 * Per the plan §7: logo · current app · Ask/Command palette trigger ⌘K ·
 * density toggle · theme switch · notifications · help · user avatar.
 *
 * Phase 0 ships the shell with static placeholders for notifications/help;
 * the actual agent layer (notifications = agent events, help = AI assistant)
 * lands in Phase 1.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Sparkles,
  Sun,
  Moon,
  Eye,
  Bell,
  HelpCircle,
  User as UserIcon,
  Grid3x3,
  Minimize2,
  Maximize2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import { useTheme } from "../../lib/theme/ThemeProvider";
import { useDensity, DENSITIES, type Density } from "../../lib/density/DensityProvider";
import { APPS, type AppId } from "../../lib/apps";
import { cn } from "../../lib/utils/cn";
import {
  activateLocale,
  getActiveLocale,
  LOCALES,
  localeLabel,
  type Locale,
} from "../../i18n/lingui";

const DENSITY_ICON: Record<Density, LucideIcon> = {
  comfortable: Maximize2,
  compact: Minimize2,
  spacious: Grid3x3,
};
const DENSITY_LABEL: Record<Density, string> = {
  comfortable: "Comfortable",
  compact: "Compact",
  spacious: "Spacious",
};

export function Topbar({
  currentApp,
  userName,
  onOpenAppLauncher,
  onOpenCommandPalette,
  onOpenNotifications,
  onOpenHelp,
}: {
  currentApp?: AppId;
  userName?: string;
  onOpenAppLauncher: () => void;
  onOpenCommandPalette: () => void;
  onOpenNotifications: () => void;
  onOpenHelp: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();
  // Phase 10.3: locale switcher (dev-only). We hold the active
  // locale in local state so the highlight updates synchronously
  // when the user picks a new one. `activateLocale` is async
  // (dynamic import of the compiled catalog), so we set the
  // local state immediately and let Lingui re-render Trans
  // children via its I18nProvider context once the new catalog
  // is loaded.
  const [activeLocale, setActiveLocale] = useState<Locale>(() =>
    typeof window === "undefined" ? "hy" : getActiveLocale(),
  );
  useEffect(() => {
    // Cross-tab consistency: if another tab flips the locale,
    // mirror it here.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "a1:locale" && e.newValue) {
        setActiveLocale(e.newValue as Locale);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const switchLocale = (l: Locale) => {
    setActiveLocale(l);
    void activateLocale(l);
  };

  const appMeta = currentApp ? APPS[currentApp] : undefined;
  const densityIndex = DENSITIES.indexOf(density);
  const cycleDensity = () =>
    setDensity(DENSITIES[(densityIndex + 1) % DENSITIES.length]);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-12 items-center gap-3",
        "border-b border-[var(--color-line)] bg-[var(--color-surface)]",
        "px-3 [data-density=compact]:h-10 [data-density=spacious]:h-14",
      )}
    >
      {/* App launcher trigger */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenAppLauncher}
        aria-label="Open app launcher"
        className="!p-1.5"
      >
        <Grid3x3 className="size-4" />
      </Button>

      {/* Brand + current app */}
      <Link
        to="/app"
        className="flex items-center gap-2 text-[var(--text-md)] font-semibold text-[var(--color-brand)]"
      >
        <span className="rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-1.5 py-0.5 text-[11px] font-bold text-white">
          ANT
        </span>
        <span className="hidden [data-density=spacious]:inline">A1 Suite</span>
      </Link>

      {appMeta && (
        <>
          <span className="text-[var(--color-muted)]">/</span>
          <span className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            {appMeta.label}
          </span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* ⌘K trigger — the Odoo-style Ask/Command palette (Pattern #1 in §3.2) */}
      <button
        onClick={onOpenCommandPalette}
        className={cn(
          "flex h-7 min-w-[200px] items-center gap-2 rounded-[var(--radius-md)]",
          "border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5",
          "text-[var(--text-sm)] text-[var(--color-muted)]",
          "hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]",
          "transition-colors",
        )}
        aria-label="Open Ask / Command palette"
      >
        <Sparkles className="size-3.5" />
        <span className="flex-1 text-left">Ask or command…</span>
        <Kbd>⌘K</Kbd>
      </button>

      {/* Density toggle (cycles comfortable → compact → spacious) */}
      <Button
        variant="ghost"
        size="sm"
        onClick={cycleDensity}
        aria-label={`Density: ${DENSITY_LABEL[density]}. Click to change.`}
        className="!p-1.5"
      >
        {(() => {
          const Icon = DENSITY_ICON[density];
          return <Icon className="size-4" />;
        })()}
      </Button>

      {/* Theme switcher (light / dark / contrast) */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const next = theme === "light" ? "dark" : theme === "dark" ? "contrast" : "light";
          setTheme(next);
        }}
        aria-label={`Theme: ${theme}. Click to change.`}
        className="!p-1.5"
      >
        {theme === "light" ? <Sun className="size-4" /> : theme === "dark" ? <Moon className="size-4" /> : <Eye className="size-4" />}
      </Button>

      {/* Notifications (placeholder for agent events in Phase 1) */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenNotifications}
        aria-label="Notifications"
        className="!p-1.5"
      >
        <Bell className="size-4" />
      </Button>

      {/* Help (placeholder for AI assistant in Phase 1) */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenHelp}
        aria-label="Help"
        className="!p-1.5"
      >
        <HelpCircle className="size-4" />
      </Button>

      {/* Phase 10.3: dev-only locale switcher (Հյ / РУ / EN).
          Guarded by `import.meta.env.DEV` so the dev affordance
          never ships in production. The e2e canary spec targets
          this via `data-testid="locale-switcher"`. */}
      {import.meta.env.DEV && (
        <div
          data-testid="locale-switcher"
          role="group"
          aria-label="Language (dev only)"
          className="ml-1 flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-0.5"
        >
          {LOCALES.map((l) => {
            const isActive = l === activeLocale;
            return (
              <button
                key={l}
                type="button"
                onClick={() => switchLocale(l)}
                aria-pressed={isActive}
                aria-label={`Switch language to ${l}`}
                data-testid={`locale-switcher-${l}`}
                className={cn(
                  "min-w-[28px] rounded-[var(--radius-sm)] px-1.5 py-0.5",
                  "text-[11px] font-semibold leading-none transition-colors",
                  isActive
                    ? "bg-[var(--color-brand)] text-white"
                    : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                {localeLabel(l)}
              </button>
            );
          })}
        </div>
      )}

      {/* User avatar */}
      <button
        className={cn(
          "flex items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-1",
          "text-[var(--text-sm)] text-[var(--color-ink)]",
          "hover:bg-[var(--color-surface-soft)]",
        )}
        aria-label="Account menu"
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full",
            "bg-[var(--color-brand)] text-[11px] font-semibold text-white",
          )}
        >
          {(userName ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden md:inline">{userName ?? "Account"}</span>
        <UserIcon className="size-3.5 text-[var(--color-muted)]" />
      </button>
    </header>
  );
}
