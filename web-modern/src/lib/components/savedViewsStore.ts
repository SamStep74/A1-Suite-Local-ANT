/**
 * savedViewsStore — localStorage-backed store for per-user view
 * presets.
 *
 * Phase 10.4 shared primitive. Used by fiscal-gates and
 * triage-inbox (Phase 10.5 W1 and W2). The period-close-checklist
 * wizard (this phase) does NOT need it — the close checklist is a
 * single canonical list per period.
 *
 * This file exists so the shared/index.ts barrel resolves
 * (`export { type SavedView, type SavedViewState } from
 * "../../lib/components/savedViewsStore";`).
 *
 * The full implementation lands with the W1 / W2 workers. This
 * stub exports the types so other code (and the type system) can
 * reference them.
 */

export interface SavedView {
  id: string;
  name: string;
  state: unknown;
}

export interface SavedViewState {
  activeId: string | null;
  views: readonly SavedView[];
}
