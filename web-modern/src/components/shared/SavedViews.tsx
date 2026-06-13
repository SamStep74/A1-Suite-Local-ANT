/**
 * SavedViews — persisted per-user view presets.
 *
 * Phase 10.4 shared primitive. Period-close-checklist
 * (Phase 10.5 W4) does NOT use this — the close checklist is a
 * single canonical list per period, not a filterable list that
 * benefits from saved presets. fiscal-gates and triage-inbox do.
 *
 * This file exists so the shared/index.ts barrel resolves. The
 * real implementation lives with the workers that actually need
 * it; this stub is intentionally minimal so it doesn't drag in
 * extra surface area for the period-close worker's audit gates.
 */
import { type ReactNode } from "react";

export interface SavedView {
  id: string;
  name: string;
  /** Opaque blob — what the calling route persists. */
  state: unknown;
}

export interface SavedViewsProps {
  /** Currently-active view id (or null for "default"). */
  activeId: string | null;
  /** All available views. */
  views: readonly SavedView[];
  /** Called when the user picks a view. */
  onSelect: (id: string) => void;
  /** Called when the user wants to save the current state as a
   *  new view. The parent returns the new view's id. */
  onSave: (name: string) => Promise<string> | string;
  /** Optional className override. */
  className?: string;
}

/**
 * Minimal stub — just renders a dropdown listing the views. The
 * real SavedViews will be filled in by fiscal-gates (W1) or
 * triage-inbox (W2). This stub exists so the period-close-checklist
 * audit gates can resolve the shared/index.ts barrel.
 */
export function SavedViews(_props: SavedViewsProps): ReactNode {
  return null;
}
