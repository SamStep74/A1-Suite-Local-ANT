/**
 * Skeleton — centered spinner + skeleton bars primitive.
 *
 * Used as the default for root-level `pendingComponent` (and any route
 * that needs a friendly "loading…" placeholder while a TanStack Query
 * resolves). Per the plan §6 R7 closure, every route should land in
 * either this primitive or a route-level override — never a blank page.
 *
 * Per plan §3.3 "no futuristic neon": the bars are a calm stone
 * pulse, the spinner is a single lucide-react `Loader2` glyph. No
 * glow, no gradient.
 */
import { Loader2 } from "lucide-react";

export interface SkeletonProps {
  /** Number of skeleton bars to render under the spinner. Default 3. */
  rows?: number;
  /** Accessible label. Default Armenian "Բեռնվում է…" with an English
   *  sibling rendered as visually-hidden for screen readers. */
  label?: string;
}

export function Skeleton({ rows = 3, label = "Բեռնվում է…" }: SkeletonProps) {
  // Cap rows at a sane max — anything above ~10 is almost certainly a
  // misconfiguration (a "loading whole table" should pick a different
  // primitive, not 50 skeleton bars).
  const safeRows = Math.max(1, Math.min(rows, 10));
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 p-8"
    >
      <Loader2 className="size-4 animate-spin text-stone-500" aria-hidden />
      <span lang="hy" className="text-sm text-stone-600">
        {label}
      </span>
      <span className="sr-only">Loading…</span>
      <div className="flex w-full flex-col gap-2" aria-hidden>
        {Array.from({ length: safeRows }).map((_, i) => (
          <div
            key={i}
            className="h-3 w-full rounded bg-stone-200 animate-pulse dark:bg-stone-800"
          />
        ))}
      </div>
    </div>
  );
}

export default Skeleton;
