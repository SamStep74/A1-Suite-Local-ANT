/**
 * HybridBadge — the Salesforce Agentforce "agent vs rule" marker.
 *
 * Per the plan §3.2 pattern #10 (Conversational + deterministic hybrid UX),
 * every agentic surface visibly separates:
 *   - "agent"     → AI reasoning / proposal / ask (violet, --color-agent)
 *   - "rule"      → business logic / workflow step / approval (slate, --color-deterministic)
 *   - "resolved"  → completed (green, --color-success) — used for "what just happened" rows
 *
 * The badge is the smallest possible footprint: a pill with a one-letter
 * glyph + label, color-coded. Designed for use inside dense lists, tabs,
 * table headers, and Decision Cards.
 *
 * Why a dedicated component and not a tag with the same name?
 *   - Visual consistency: every agent/rule chip looks the same.
 *   - Accessibility: ARIA label distinguishes the two roles for screen readers.
 *   - Future i18n: the label text comes from one place; a Phase 5 i18n
 *     audit only touches this file.
 */
import { Bot, Cog, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils/cn";

export type HybridKind = "agent" | "rule" | "resolved";

interface KindMeta {
  label: string;
  ariaLabel: string;
  icon: LucideIcon;
  // CSS color role. --color-agent / --color-deterministic / --color-success
  // are theme-mutated (light/dark/contrast) in tokens.css.
  fg: string;
  bg: string;
  border: string;
}

const META: Record<HybridKind, KindMeta> = {
  agent: {
    label: "agent",
    ariaLabel: "AI agent",
    icon: Bot,
    fg: "text-[var(--color-agent)]",
    bg: "bg-[var(--color-agent-soft)]",
    border: "border-[color-mix(in_srgb,var(--color-agent)_25%,transparent)]",
  },
  rule: {
    label: "rule",
    ariaLabel: "Deterministic rule",
    icon: Cog,
    fg: "text-[var(--color-deterministic)]",
    bg: "bg-[var(--color-deterministic-soft)]",
    border: "border-[color-mix(in_srgb,var(--color-deterministic)_25%,transparent)]",
  },
  resolved: {
    label: "done",
    ariaLabel: "Completed",
    icon: Check,
    fg: "text-[var(--color-success)]",
    bg: "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]",
    border: "border-[color-mix(in_srgb,var(--color-success)_25%,transparent)]",
  },
};

export function HybridBadge({
  kind,
  className,
  showLabel = true,
}: {
  kind: HybridKind;
  className?: string;
  showLabel?: boolean;
}) {
  const meta = META[kind];
  const Icon = meta.icon;
  return (
    <span
      role="img"
      aria-label={meta.ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-1",
        "rounded-[var(--radius-sm)] border px-1.5 py-0.5",
        "text-[10px] font-semibold uppercase tracking-wider",
        meta.bg,
        meta.fg,
        meta.border,
        className,
      )}
    >
      <Icon className="size-2.5" aria-hidden />
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
}
