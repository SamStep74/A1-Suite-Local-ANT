/**
 * /app/period-close — STUB for Phase 10.5 r1.
 *
 * The full monthly-close wizard UI (DataTable + custom inline action bar
 * + UndoToast over the 13-step checklist) was deferred to Phase 10.5 r2
 * because the W4 branch shipped a non-trivial DataTable API
 * (uncontrolled `selectedRowIds` / per-action callbacks) that doesn't
 * match the 10.4 controlled-state DataTable the other r1 surfaces use.
 *
 * For now we mount the period header and a small placeholder; the
 * close-logic lives in `lib/close/*` (used by the lib's own unit tests
 * and the e2e spec via a manual data attribute) and is wired up to the
 * real route in 10.5 r2.
 */
import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";

import { CHECKLIST_STEPS, periodIdFromDate } from "../../../lib/close";

export const Route = createFileRoute("/app/period-close/")({
  component: PeriodCloseStub,
});

export { PeriodCloseStub };

function PeriodCloseStub() {
  const period = periodIdFromDate();
  const total = CHECKLIST_STEPS.length;

  return (
    <div
      className="mx-auto max-w-4xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="period-close-page"
      data-period={period}
      data-done="0"
      data-total={total}
    >
      <header>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          <Trans>Period close</Trans>
        </h1>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          <Trans>
            0 of {total} done for {period}. The full wizard ships in
            Phase 10.5 r2.
          </Trans>
        </p>
      </header>
    </div>
  );
}
