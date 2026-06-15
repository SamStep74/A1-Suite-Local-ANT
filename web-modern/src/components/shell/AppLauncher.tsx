/**
 * AppLauncher — 14-icon grid modal. Phase 0.4c.
 *
 * Click an app card → navigate to /app/<id>.
 * The accent color is the "app's house color" — used in hover state only,
 * never in default state (per "calm enterprise AI" — no neon).
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { X, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { APPS, APP_IDS, appLinkTo, type AppId } from "../../lib/apps";
import { cn } from "../../lib/utils/cn";

const ACCENT_BG: Record<string, string> = {
  teal: "hover:border-[var(--color-tag-teal)] hover:bg-[color-mix(in_srgb,var(--color-tag-teal)_6%,var(--color-surface))]",
  blue: "hover:border-[var(--color-tag-blue)] hover:bg-[color-mix(in_srgb,var(--color-tag-blue)_6%,var(--color-surface))]",
  violet: "hover:border-[var(--color-tag-violet)] hover:bg-[color-mix(in_srgb,var(--color-tag-violet)_6%,var(--color-surface))]",
  green: "hover:border-[var(--color-tag-green)] hover:bg-[color-mix(in_srgb,var(--color-tag-green)_6%,var(--color-surface))]",
  amber: "hover:border-[var(--color-tag-yellow)] hover:bg-[color-mix(in_srgb,var(--color-tag-yellow)_6%,var(--color-surface))]",
  ruby: "hover:border-[var(--color-tag-red)] hover:bg-[color-mix(in_srgb,var(--color-tag-red)_6%,var(--color-surface))]",
  copper: "hover:border-[var(--color-tag-orange)] hover:bg-[color-mix(in_srgb,var(--color-tag-orange)_6%,var(--color-surface))]",
  pink: "hover:border-[var(--color-tag-pink)] hover:bg-[color-mix(in_srgb,var(--color-tag-pink)_6%,var(--color-surface))]",
};

export function AppLauncher({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Trap initial focus.
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  const core = APP_IDS.filter((id) => APPS[id].group === "core");
  const ext = APP_IDS.filter((id) => APPS[id].group === "ext");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App launcher"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          "relative w-[min(900px,92vw)] rounded-[var(--radius-xl)]",
          "border border-[var(--color-line)] bg-[var(--color-surface)]",
          "shadow-[var(--shadow-2)] outline-none",
        )}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-line)] p-4">
          <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
            Apps
          </h2>
          <button
            onClick={onClose}
            aria-label="Close app launcher"
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="p-4 [data-density=compact]:p-3 [data-density=spacious]:p-6">
          <p className="mb-3 text-[var(--text-xs)] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Core
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {core.map((id) => (
              <AppCard
                key={id}
                id={id}
                onClick={() => {
                  navigate(appLinkTo(id) as unknown as Parameters<typeof navigate>[0]);
                  onClose();
                }}
              />
            ))}
          </div>

          <p className="mb-3 mt-5 text-[var(--text-xs)] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Extensions
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {ext.map((id) => (
              <AppCard
                key={id}
                id={id}
                onClick={() => {
                  navigate(appLinkTo(id) as unknown as Parameters<typeof navigate>[0]);
                  onClose();
                }}
              />
            ))}
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-[var(--color-line)] p-3 text-[var(--text-xs)] text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3" /> Ask the AI to build a custom app
          </span>
          <span className="ml-auto">
            Press <KbdInline>Esc</KbdInline> to close
          </span>
        </footer>
      </div>
    </div>
  );
}

function AppCard({ id, onClick }: { id: AppId; onClick: () => void }) {
  const meta = APPS[id];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-1 rounded-[var(--radius-lg)]",
        "border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-left",
        "transition-colors",
        ACCENT_BG[meta.accent] ?? "",
      )}
    >
      <Icon className="size-5 text-[var(--color-brand)]" aria-hidden />
      <span className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        {meta.label}
      </span>
      <span className="text-[var(--text-xs)] text-[var(--color-muted)]">
        {meta.tagline}
      </span>
      <span className="text-[11px] text-[var(--color-muted)] [data-density=compact]:hidden">
        {meta.labelAm}
      </span>
    </button>
  );
}

function KbdInline({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-ink)]">
      {children}
    </kbd>
  );
}

// Suppress unused-import warning for Link in case tree-shaking changes.
void Link;
