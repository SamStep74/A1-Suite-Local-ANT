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
import { LegacyLink } from "../../lib/deploy";
import { cn } from "../../lib/utils/cn";

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

      {/* 10.1: escape hatch to the legacy web/ build (mounted at /legacy/*
          by the Fastify backend). Sits right after the brand so it's the
          first thing an operator sees when a module isn't migrated yet. */}
      <LegacyLink to="/" className="ml-1">Open legacy UI</LegacyLink>

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
