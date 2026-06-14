/**
 * AI surface — citations chip strip (Phase 10.5 ask-ai).
 *
 * Renders an array of `Citation` objects as a row of small
 * clickable chips. The user clicks a chip to drill back into the
 * route (or, in Phase 11+, to open the document viewer).
 *
 * Why a dedicated component?
 *   • Centralises the chip styling so the sidebar, the full-page
 *     /app/ask-ai, and any future inline context popover stay
 *     visually consistent.
 *   • Keeps the parent layout-free — the strip is a pure list, no
 *     data fetching, no streaming.
 */
import { Link } from "@tanstack/react-router";
import { FileText, type LucideIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { APPS, type AppId } from "../../lib/apps";
import type { Citation } from "./schemas";
import { cn } from "../../lib/utils/cn";

export interface CitationsProps {
  citations: Citation[];
  /** Class on the outer wrapper (for layout slot spacing). */
  className?: string;
  /**
   * Optional click handler that takes precedence over the default
   * navigate behaviour. The sidebar (AskAiPanel) uses this to
   * bubble the click up to the parent so the parent can decide
   * whether to navigate, focus a record, or do something else.
   */
  onCitationClick?: (citation: Citation) => void;
}

export function Citations({ citations, className, onCitationClick }: CitationsProps) {
  if (citations.length === 0) return null;
  return (
    <ul
      data-testid="ask-ai-citations"
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {citations.map((c) => (
        <li key={c.id}>
          <CitationChip citation={c} onCitationClick={onCitationClick} />
        </li>
      ))}
    </ul>
  );
}

function CitationChip({ citation, onCitationClick }: { citation: Citation; onCitationClick?: (c: Citation) => void }) {
  const navigate = useNavigate();
  const meta = resolveAppMeta(citation);
  const Icon: LucideIcon = meta?.icon ?? FileText;
  const accent = meta?.accent ?? "blue";

  const className = cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
    "text-[11px] font-medium transition-colors",
    "border-[var(--color-line)] bg-[var(--color-surface-soft)]",
    "text-[var(--color-ink)] hover:border-[var(--color-brand)]",
    `hover:bg-[var(--color-${accent}-soft,var(--color-surface-soft))]`,
  );

  // If the parent supplied an onCitationClick handler, always
  // route the click through it. The sidebar uses this to close
  // the panel before navigating; the full-page version lets the
  // default in-app navigation run.
  const handleClick = onCitationClick
    ? () => onCitationClick(citation)
    : undefined;

  // For route citations, we prefer the in-app router navigation
  // (preserves session, runs route guards) over a plain anchor.
  // When the URL is a foreign origin, fall back to a regular link.
  if (citation.kind === "route" && citation.href) {
    return (
      <button
        type="button"
        data-testid="ask-ai-citation-chip"
        onClick={handleClick ?? (() => navigate({ to: citation.href as never }))}
        className={className}
        aria-label={`Open ${citation.label}`}
      >
        <Icon className="size-3" aria-hidden />
        <span>{citation.label}</span>
      </button>
    );
  }
  if (citation.href) {
    return (
      <Link
        to={citation.href as never}
        data-testid="ask-ai-citation-chip"
        className={className}
        aria-label={`Open ${citation.label}`}
      >
        <Icon className="size-3" aria-hidden />
        <span>{citation.label}</span>
      </Link>
    );
  }
  // Document citation without an href (Phase 10.5 stub). We still
  // render the chip so the user sees the citation exist, but it
  // is not interactive.
  return (
    <span
      data-testid="ask-ai-citation-chip"
      className={cn(className, "cursor-default")}
    >
      <Icon className="size-3" aria-hidden />
      <span>{citation.label}</span>
    </span>
  );
}

function resolveAppMeta(c: Citation): AppMetaLike | null {
  if (c.kind !== "route") return null;
  const appId = c.app as AppId;
  return APPS[appId] ?? null;
}

interface AppMetaLike {
  icon: LucideIcon;
  accent: "teal" | "blue" | "violet" | "green" | "amber" | "ruby" | "orange" | "pink";
}
