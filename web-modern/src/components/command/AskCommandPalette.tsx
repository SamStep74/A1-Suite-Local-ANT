/**
 * AskCommandPalette — ⌘K / Ctrl+K global command + ask palette. Phase 0.4e.
 *
 * The Odoo-style signature pattern (#1 in plan §3.2).
 *
 * Phase 0: static command list (open module pages, switch theme, sign out).
 * Phase 1 will add an "Ask AI" path that routes natural language to the
 * appropriate agent via MCP + the Vercel AI SDK v3.
 *
 * Built on cmdk. Keyboard-first. a11y: role="dialog", aria-modal, Escape closes.
 */
import { Command } from "cmdk";
import {
  Sparkles,
  Sun,
  Moon,
  Eye,
  LogOut,
  Compass,
  History,
  Settings,
  Search,
  Plus,
  Zap,
  Inbox,
  AlertTriangle,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { APP_IDS, APPS, appHref, appLinkTo, type AppId } from "../../lib/apps";
import { useTheme } from "../../lib/theme/ThemeProvider";
import { useDensity, DENSITIES, type Density } from "../../lib/density/DensityProvider";
import { HybridBadge } from "../ui/HybridBadge";
import { cn } from "../../lib/utils/cn";

interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
}

export function AskCommandPalette({ open, onOpenChange, onSignOut }: PaletteProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();
  const [query, setQuery] = useState("");

  // Reset query when closed.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const items = useMemo(
    () => buildCommands({ theme, setTheme, density, setDensity, onSignOut }),
    [theme, setTheme, density, setDensity, onSignOut],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ask / Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      <div
        className={cn(
          "relative w-[min(640px,92vw)] overflow-hidden rounded-[var(--radius-xl)]",
          "border border-[var(--color-line)] bg-[var(--color-surface)]",
          "shadow-[var(--shadow-2)]",
        )}
      >
        <Command label="Ask or command" loop shouldFilter>
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3">
            <Search className="size-4 text-[var(--color-muted)]" aria-hidden />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                // cmdk consumes the key events on the input; Escape needs
                // to be handled here to actually close the dialog. Without
                // this, ⌘K opens but Esc leaves it stuck.
                if (e.key === "Escape") {
                  e.preventDefault();
                  onOpenChange(false);
                }
              }}
              placeholder="Ask the AI, search, or run a command…"
              className={cn(
                "h-11 flex-1 bg-transparent text-[var(--text-base)]",
                "text-[var(--color-ink)] placeholder:text-[var(--color-muted)]",
                "outline-none",
              )}
            />
            <kbd className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
              ESC
            </kbd>
          </div>

          <Command.List
            className="max-h-[60vh] overflow-y-auto p-1.5"
            onKeyDown={(e) => {
              if (e.key === "Escape") onOpenChange(false);
            }}
          >
            <Command.Empty className="px-3 py-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
              {query.trim() === "" ? "Start typing to ask or run a command." : "No results."}
            </Command.Empty>

            {/* AI Ask group — placeholder for Phase 1 */}
            <Command.Group
              heading={
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="size-3" /> Ask the AI
                </span>
              }
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-agent)]"
            >
              <Command.Item
                value={`ask: ${query}`}
                disabled
                className="flex cursor-not-allowed items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-muted)]"
              >
                <Sparkles className="size-3.5 text-[var(--color-agent)]" />
                <span className="flex-1">
                  {query.trim()
                    ? `Ask: "${query.trim()}"`
                    : "Type a question, then press ↵ to ask (Phase 1)"}
                </span>
                <span className="badge-agent text-[10px]">agent</span>
              </Command.Item>
            </Command.Group>

            {/* Module nav */}
            <Command.Group
              heading="Open app"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted)]"
            >
              {APP_IDS.map((id) => (
                <AppItem key={id} id={id} onSelect={() => goToApp(navigate, id, onOpenChange)} />
              ))}
            </Command.Group>

            {/* Quick create — agentic shortcuts (Phase 1.8). The
                palette closes and the Desk page picks up the search
                param to auto-open the inline create form. */}
            <Command.Group
              heading={
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="size-3" /> Quick create
                </span>
              }
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-agent)]"
            >
              <Command.Item
                value="create ticket"
                onSelect={() => {
                  navigate({ to: "/app/desk", search: { status: "all", createTicket: "1" } });
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] aria-selected:bg-[var(--color-surface-soft)]"
              >
                <Plus className="size-3.5 text-[var(--color-agent)]" />
                <span className="flex-1">Create ticket</span>
                <HybridBadge kind="agent" />
              </Command.Item>
            </Command.Group>

            {/* Smart shortcuts — context deep-links. Phase 1.8 ships
                two: waiting-customer and today's approvals. Phase 4
                adds "My open tickets" (filtered by user.id) once
                owner-based filtering lands. */}
            <Command.Group
              heading={
                <span className="inline-flex items-center gap-1">
                  <Zap className="size-3" /> Smart shortcuts
                </span>
              }
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-muted)]"
            >
              <Command.Item
                value="tickets waiting customer"
                onSelect={() => {
                  navigate({ to: "/app/desk", search: { status: "waiting-customer", createTicket: null } });
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] aria-selected:bg-[var(--color-surface-soft)]"
              >
                <Clock className="size-3.5 text-[var(--color-copper)]" />
                <span className="flex-1">Tickets waiting &gt; 3 days</span>
                <span className="text-[10px] text-[var(--color-muted)]">Desk</span>
              </Command.Item>
              <Command.Item
                value="today approvals"
                onSelect={() => {
                  navigate({ to: "/app/copilot", search: { view: "chats" } });
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] aria-selected:bg-[var(--color-surface-soft)]"
              >
                <Inbox className="size-3.5 text-[var(--color-blue)]" />
                <span className="flex-1">Today's approvals</span>
                <span className="text-[10px] text-[var(--color-muted)]">Mission Control</span>
              </Command.Item>
              <Command.Item
                value="at-risk SLA"
                onSelect={() => {
                  navigate({ to: "/app", search: {} });
                  onOpenChange(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] aria-selected:bg-[var(--color-surface-soft)]"
              >
                <AlertTriangle className="size-3.5 text-[var(--color-ruby)]" />
                <span className="flex-1">At-risk &amp; breached SLAs</span>
                <span className="text-[10px] text-[var(--color-muted)]">Today</span>
              </Command.Item>
            </Command.Group>

            {/* Commands */}
            <Command.Group heading="Commands" className="...same...">
              {items.map((item) => (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => {
                    item.run();
                    if (!item.keepOpen) onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] aria-selected:bg-[var(--color-surface-soft)]"
                >
                  <item.icon className="size-3.5 text-[var(--color-muted)]" />
                  <span className="flex-1">{item.label}</span>
                  {item.hint && (
                    <span className="text-[10px] text-[var(--color-muted)]">{item.hint}</span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>

          <footer className="flex items-center gap-3 border-t border-[var(--color-line)] px-3 py-2 text-[10px] text-[var(--color-muted)]">
            <span>↑↓ to move</span>
            <span>↵ to select</span>
            <span className="ml-auto">⌘K to toggle</span>
          </footer>
        </Command>
      </div>
    </div>
  );
}

/* ──────────────── helpers ──────────────── */

function goToApp(navigate: ReturnType<typeof useNavigate>, id: AppId, close: (b: boolean) => void) {
  navigate(appLinkTo(id) as unknown as Parameters<typeof useNavigate>[0]);
  close(false);
}

function AppItem({ id, onSelect }: { id: AppId; onSelect: () => void }) {
  const meta = APPS[id];
  const Icon = meta.icon;
  return (
    <Command.Item
      value={`${meta.label} ${meta.labelAm} ${id}`}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] aria-selected:bg-[var(--color-surface-soft)]"
    >
      <Icon className="size-3.5 text-[var(--color-brand)]" />
      <span className="flex-1">{meta.label}</span>
      <span className="text-[10px] text-[var(--color-muted)]">{meta.labelAm}</span>
    </Command.Item>
  );
}

interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  keepOpen?: boolean;
  run: () => void;
}

interface CmdCtx {
  theme: ReturnType<typeof useTheme>["theme"];
  setTheme: ReturnType<typeof useTheme>["setTheme"];
  density: Density;
  setDensity: ReturnType<typeof useDensity>["setDensity"];
  onSignOut: () => void;
}

function buildCommands(ctx: CmdCtx): CommandItem[] {
  return [
    {
      id: "go-today",
      label: "Go to Today",
      icon: Compass,
      hint: "/app",
      run: () => {
        window.history.pushState({}, "", appHref("crm"));
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
    },
    {
      id: "go-mission",
      label: "Open Mission Control",
      icon: Sparkles,
      hint: "/app/copilot",
      run: () => {
        window.history.pushState({}, "", appHref("copilot"));
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
    },
    {
      id: "recent",
      label: "View recent items",
      icon: History,
      hint: "Phase 1",
      run: () => undefined,
      keepOpen: true,
    },
    {
      id: "settings",
      label: "Open settings",
      icon: Settings,
      hint: "Phase 2",
      run: () => undefined,
      keepOpen: true,
    },
    {
      id: "theme-light",
      label: "Theme: Light",
      icon: Sun,
      run: () => ctx.setTheme("light"),
    },
    {
      id: "theme-dark",
      label: "Theme: Dark",
      icon: Moon,
      run: () => ctx.setTheme("dark"),
    },
    {
      id: "theme-contrast",
      label: "Theme: Contrast (WCAG AAA)",
      icon: Eye,
      run: () => ctx.setTheme("contrast"),
    },
    ...DENSITIES.map<CommandItem>((d) => ({
      id: `density-${d}`,
      label: `Density: ${d.charAt(0).toUpperCase()}${d.slice(1)}`,
      icon: Eye,
      run: () => ctx.setDensity(d),
    })),
    {
      id: "signout",
      label: "Sign out",
      icon: LogOut,
      run: ctx.onSignOut,
    },
  ];
}
