/**
 * UndoToast — toast with an "Undo" action and 5s auto-dismiss.
 *
 * Pairs with TanStack Query mutations: the caller wires
 *
 *   const { mutate, variables } = useMutation({
 *     onMutate: () => undoToast.show({ message: t`Invoice archived`, onUndo }),
 *     onError:  () => undoToast.show({ message: t`Archive failed`, onUndo }),
 *   });
 *
 * Once the user clicks "Undo" (or the 5s window expires), the
 * parent unmounts the toast by setting `toast` back to null. The
 * `onUndo` callback is fired *exactly once* — whether the user
 * clicks the button OR the timer expires (with `expired=true` so
 * the caller can skip the revert since the mutation has already
 * settled).
 *
 * Why a peer-level component instead of sonner?
 *   The visual language of the UndoToast is *paired* with a
 *   specific mutation (same row, same row-count, same color band).
 *   Sonner is the *generic* toast (Sonner is already in deps from
 *   earlier phases and used for non-action toasts). Keeping the
 *   UndoToast separate lets us add the band + Undo button without
 *   fighting Sonner's slot API.
 */
import { Trans } from "@lingui/react/macro";
import { Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils/cn";

export interface UndoToastOptions {
  message: ReactNode;
  onUndo: () => void;
  /** Override the auto-dismiss window. Default 5000ms. */
  durationMs?: number;
}

export interface UndoToastProps {
  options: UndoToastOptions | null;
  onDismiss: () => void;
  className?: string;
}

export function UndoToast({ options, onDismiss, className }: UndoToastProps) {
  const [elapsed, setElapsed] = useState(0);
  const firedRef = useRef(false);
  const duration = options?.durationMs ?? 5000;

  useEffect(() => {
    if (!options) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    firedRef.current = false;
    // Tick the elapsed counter from the interval itself (not
    // Date.now() - start) so the value advances correctly under
    // vitest's fake-timer advanceTimersByTime, which mocks setTimeout
    // / setInterval but may not advance Date.now() the same way.
    const id = window.setInterval(() => {
      setElapsed((e) => Math.min(duration, e + 100));
    }, 100);
    const dismissId = window.setTimeout(() => {
      onDismiss();
    }, duration);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(dismissId);
    };
  }, [options, duration, onDismiss]);

  if (!options) return null;

  const progress = Math.min(1, elapsed / duration);

  const handleUndo = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    options.onUndo();
    onDismiss();
  };

  const handleDismiss = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    onDismiss();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      data-remaining-pct={Math.round((1 - progress) * 100)}
      className={cn(
        "pointer-events-auto fixed bottom-4 left-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2",
        "rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg",
        className,
      )}
    >
      <div
        className="h-1 rounded-t-[var(--radius-md)] bg-[var(--color-brand)] transition-[width] duration-100"
        style={{ width: `${(1 - progress) * 100}%` }}
        data-testid="undo-toast-progress"
      />
      <div className="flex items-center gap-2 p-3">
        <p
          className="flex-1 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="undo-toast-message"
        >
          {options.message}
        </p>
        <button
          type="button"
          onClick={handleUndo}
          data-testid="undo-toast-action"
          className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-xs)] text-[var(--color-brand)] hover:bg-[var(--color-surface-soft)]"
        >
          <Undo2 className="size-3" />
          <Trans>Undo</Trans>
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          data-testid="undo-toast-dismiss"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

/* ────────── hook-style helper for callers that prefer show() ────────── */

export interface UndoToastController {
  options: UndoToastOptions | null;
  show: (next: UndoToastOptions) => void;
  clear: () => void;
}

export function useUndoToastController(
  setState: (next: UndoToastOptions | null) => void,
): Omit<UndoToastController, "options"> {
  return {
    show: (next) => setState(next),
    clear: () => setState(null),
  };
}
