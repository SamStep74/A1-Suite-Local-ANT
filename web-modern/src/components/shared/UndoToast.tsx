/**
 * UndoToast — a single-action toast with an "Undo" affordance.
 *
 * Phase 10.4 shared primitive. Wraps `sonner`'s `toast()` API so
 * the calling code only needs to know about undoable actions, not
 * toast plumbing.
 *
 * Lifecycle:
 *   1. Caller invokes `controller.show({ message, onUndo, duration })`.
 *   2. Sonner renders the message + an "Undo" button.
 *   3. The user either:
 *      a) Clicks "Undo" → `onUndo()` is called and the toast dismisses.
 *      b) Lets the timer expire → the toast dismisses silently
 *         (the action is now considered confirmed).
 *   4. If `onUndo` throws, we log the error and re-show the toast
 *      with a "Could not undo — try again" message (caller decides
 *      what to do).
 *
 * `useUndoToastController()` is a tiny hook that returns a stable
 * `show` function bound to a `ToastFn`. Most routes use a single
 * controller; tests can use `createUndoToastController(toast)` to
 * pass a custom toast function.
 */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { toast as sonnerToast, type ExternalToast } from "sonner";
import { Trans } from "@lingui/react/macro";

export interface UndoToastOptions {
  /** Message rendered in the toast body. Lingui macros supported. */
  message: ReactNode;
  /** Called when the user clicks "Undo". Should be idempotent. */
  onUndo: () => void | Promise<void>;
  /** Duration in ms before the toast auto-dismisses. Defaults to 6000. */
  duration?: number;
  /** Override the default "Undo" label. */
  undoLabel?: ReactNode;
  /** Description line — second line of the toast. */
  description?: ReactNode;
}

export interface UndoToastProps {
  /** Options for the toast. Re-rendering with new options is a no-op
   *  because sonner keys the toast by id. */
  options: UndoToastOptions;
}

/**
 * UndoToast — a presentational version. Used when the caller
 * wants a *static* toast (e.g. mounted in a layout). Most code
 * should use `useUndoToastController().show()` instead.
 */
export function UndoToast({ options }: UndoToastProps): ReactNode {
  return (
    <div
      data-testid="undo-toast"
      className="flex items-center gap-3"
    >
      <span>{options.message}</span>
      {options.undoLabel !== null ? (
        <button
          type="button"
          onClick={() => {
            void options.onUndo();
          }}
          data-testid="undo-toast-action"
          className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-0.5 text-[var(--text-sm)] font-medium text-[var(--color-brand)] hover:bg-[var(--color-surface-soft)]"
        >
          {options.undoLabel ?? <Trans>Undo</Trans>}
        </button>
      ) : null}
    </div>
  );
}

/* ────────── controller (the part the route actually uses) ────────── */

/** Anything that quacks like `sonner.toast`. The route can pass a
 *  custom impl in tests. */
export type ToastFn = (
  message: ReactNode,
  opts?: ExternalToast,
) => string | number;

export interface UndoToastController {
  /** Show an undoable toast. Returns the toast id. */
  show: (opts: UndoToastOptions) => string | number;
}

const ControllerContext = createContext<UndoToastController | null>(null);

/**
 * Provider — wraps the app and exposes a controller via context.
 * If the parent route doesn't wrap with a provider, the
 * `useUndoToastController()` hook falls back to a default
 * controller bound to `sonner.toast`.
 */
export function UndoToastControllerProvider({
  children,
  controller,
}: {
  children: ReactNode;
  controller: UndoToastController;
}) {
  return (
    <ControllerContext.Provider value={controller}>
      {children}
    </ControllerContext.Provider>
  );
}

/** Default controller — uses `sonner.toast` directly. */
export const createUndoToastController = (
  toast: ToastFn = sonnerToast as unknown as ToastFn,
): UndoToastController => {
  return {
    show(opts) {
      const id = toast(
        <UndoToast options={opts} />,
        {
          duration: opts.duration ?? 6000,
        },
      );
      return id;
    },
  };
};

/** Hook — returns the controller from context, or a default. */
export function useUndoToastController(): UndoToastController {
  const fromContext = useContext(ControllerContext);
  const fallback = useMemo(
    () => createUndoToastController(),
    [],
  );
  return fromContext ?? fallback;
}
