/**
 * PeekPanel — right-side slide-out drawer for row detail.
 *
 * Uses the native HTML `<dialog>` element for a11y plumbing
 * (focus trap, ESC, ::backdrop). We layer a `right-anchored`
 * visual treatment on top so it reads as a side drawer, not a
 * centered modal. Click-outside (on the backdrop) closes the
 * panel.
 *
 * Why not Radix Dialog?
 *   Radix is not currently in web-modern's deps and adding a
 *   transitive runtime for a single component is overkill. The
 *   native `<dialog>` element gives us focus trap + ESC for free
 *   in modern browsers (Chrome 37+, Safari 15.4+, Firefox 98+),
 *   matches the SPA's "calm enterprise AI" aesthetic, and keeps
 *   the bundle small. If 10.5 needs compound dialogs (nested,
 *   stacked, modal-within-modal) we revisit and add Radix then.
 *
 *  - record      : the row to display. If null, the panel is closed.
 *  - onClose     : fires when the user dismisses (ESC, backdrop,
 *                  or the close button). The parent resets its
 *                  `record` state.
 *  - renderContent : receives the record and returns the detail
 *                  body. Keeps PeekPanel domain-agnostic.
 *  - title       : optional title shown in the header.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { cn } from "../../lib/utils/cn";

export interface PeekPanelProps<TRecord> {
  record: TRecord | null;
  onClose: () => void;
  title?: ReactNode;
  renderContent: (record: TRecord) => ReactNode;
  /** Optional className for the inner panel. */
  className?: string;
  /** Optional className for the wrapper. */
  wrapperClassName?: string;
}

export function PeekPanel<TRecord>({
  record,
  onClose,
  title,
  renderContent,
  className,
  wrapperClassName,
}: PeekPanelProps<TRecord>) {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingId = useId();

  // Open / close the <dialog> in response to the parent's `record`.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (record && !el.open) el.showModal();
    if (!record && el.open) el.close();
  }, [record]);

  // Wire the native `close` event (fires on ESC) back to the parent
  // so the parent can clear its `record` state.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.addEventListener("close", onClose);
    return () => el.removeEventListener("close", onClose);
  }, [onClose]);

  // Click on the dialog itself (not the inner content) closes it.
  // The native dialog puts clicks on the backdrop there because
  // the backdrop is technically outside the inner <div>.
  const onDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      onClick={onDialogClick}
      aria-labelledby={headingId}
      data-testid="peek-panel"
      data-open={record ? "true" : "false"}
      className={cn(
        "fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0",
        wrapperClassName,
      )}
    >
      <div
        className={cn(
          "absolute right-0 top-0 h-full w-[min(420px,100vw)] overflow-y-auto",
          "border-l border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl",
          "p-4",
          className,
        )}
        data-testid="peek-panel-content"
      >
        <header className="mb-3 flex items-start justify-between gap-2">
          <h2
            id={headingId}
            className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]"
          >
            {title ?? <Trans>Details</Trans>}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t`Close`}
            data-testid="peek-panel-close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
          >
            <X className="size-3.5" />
          </button>
        </header>
        {record ? renderContent(record) : null}
      </div>
    </dialog>
  );
}
