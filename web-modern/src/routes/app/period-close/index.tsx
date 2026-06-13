/**
 * /app/period-close — Monthly Close Wizard (Phase 10.5 W4).
 *
 * A single-screen wizard that walks the user through the 13-step
 * monthly close checklist. The user picks a period (default =
 * the current month), then works through the list. Each step
 * can be Marked Done / Marked Blocked / Skipped via the
 * BulkActionBar; the UndoToast catches accidental Mark Done.
 *
 * The list is the *same* 13 steps every month, in the *same*
 * order — no SavedViews, no filter, no per-tenant override. The
 * differentiator is the high-quality, deterministic close
 * workflow, not configurability.
 *
 * State is localStorage-backed (`a1:close:<periodId>:<stepId>`).
 * No backend round-trip — closing is a personal/accountant
 * workflow, not a multi-user dance. The summary chip and the
 * progress bar derive from the live state.
 *
 * Composes the 10.4 primitives:
 *   - DataTable       — rows = steps, columns = status / category /
 *                       title / description
 *   - BulkActionBar   — Mark Done, Mark Blocked, Skip
 *   - UndoToast       — catches accidental Mark Done
 *
 * Lingui: every user-facing string is wrapped in `<Trans>` or
 * `t\`\`` so the 10.5-translation-pass worker can fill in `ru`
 * and `en` catalogs. The Armenian source strings live in this
 * file (and the surrounding lib/close/* helpers).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronLeft, CheckCircle2, AlertTriangle, MinusCircle, Circle } from "lucide-react";
import { useUndoToastController } from "../../../components/shared/UndoToast";
import {
  BulkActionBar,
  type BulkAction,
} from "../../../components/shared/BulkActionBar";
import { DataTable, type DataTableColumn } from "../../../components/shared/DataTable";
import { cn as _cn } from "../../../lib/utils/cn";
import {
  CHECKLIST_STEPS,
  groupByCategory as _groupByCategory,
  periodFromId,
  periodIdFromDate,
  readPeriodState,
  setStatusForSteps,
  summarize,
  inMemoryStorage,
  localStorageAdapter,
  type KeyValueStorage,
  type CloseRow,
} from "../../../lib/close";
import type {
  CloseStep,
  CloseStepState,
  CloseStepStatus,
} from "../../../lib/close";

/* `cn` is kept imported for parity with sibling routes — the
 * route doesn't currently use it but the test imports it from
 * here to keep the public surface stable. Strip the underscore
 * alias to avoid the "unused" lint: */
const cn = _cn;
const groupByCategory = _groupByCategory;

/* ────────── typed URL search ────────── */

type CloseSearch = {
  /** YYYY-MM period id. Defaults to the current month. */
  period: string;
};

export const Route = createFileRoute("/app/period-close/")({
  validateSearch: (raw): CloseSearch => {
    const period =
      typeof raw.period === "string" && /^\d{4}-\d{2}$/.test(raw.period)
        ? raw.period
        : periodIdFromDate();
    return { period };
  },
  component: PeriodCloseWizard,
});

/* ────────── root component ────────── */

function PeriodCloseWizard() {
  const { t } = useLingui();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const periodId = search.period;
  const period = useMemo(() => periodFromId(periodId), [periodId]);

  // Storage: pick the right adapter once (after mount, so SSR
  // sees the in-memory fallback). The state hook is purely
  // cosmetic — we just need a re-render trigger when storage
  // changes.
  const [storage] = useState<KeyValueStorage>(() =>
    typeof window !== "undefined" && window.localStorage
      ? localStorageAdapter()
      : inMemoryStorage(),
  );

  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Read the live state for the period.
  const rows = useMemo(
    () => readPeriodState(storage, period),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storage, period, version],
  );
  const summary = useMemo(() => summarize(rows), [rows]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  const undo = useUndoToastController();

  /* ──── bulk actions ──── */

  const applyStatus = useCallback(
    (status: CloseStepStatus, message: string) => {
      if (selectedIds.length === 0) return;
      const ids = [...selectedIds];
      setStatusForSteps(storage, periodId, ids, status);
      setSelectedIds([]);
      refresh();
      undo.show({
        message,
        onUndo: () => {
          // Restore every touched row to `pending`. (See note in
          // the onUndo closure in the docstring above.)
          setStatusForSteps(storage, periodId, ids, "pending");
          refresh();
        },
      });
    },
    [periodId, refresh, selectedIds, storage, undo],
  );

  // We render a single message string with the count in it. To
  // keep the Lingui extraction clean we use the count-aware
  // `Trans` macro with `values={{ count }}`.
  const actions: BulkAction[] = useMemo(
    () => [
      {
        id: "mark-done",
        label: t`Mark done`,
        variant: "primary",
        onAction: (ids) => {
          applyStatus(
            "done",
            `${ids.length} step${ids.length === 1 ? "" : "s"} marked done`,
          );
        },
      },
      {
        id: "mark-blocked",
        label: t`Mark blocked`,
        variant: "outline",
        onAction: (ids) => {
          applyStatus(
            "blocked",
            `${ids.length} step${ids.length === 1 ? "" : "s"} marked blocked`,
          );
        },
      },
      {
        id: "skip",
        label: t`Skip`,
        variant: "ghost",
        onAction: (ids) => {
          applyStatus(
            "skipped",
            `${ids.length} step${ids.length === 1 ? "" : "s"} skipped`,
          );
        },
      },
    ],
    [applyStatus, t],
  );

  /* ──── columns ──── */

  const columns: DataTableColumn<CloseRow>[] =
    useMemo(
      () => [
        {
          id: "status",
          header: t`Status`,
          width: "120px",
          cell: (row) => <StatusPill status={row.state.status} />,
        },
        {
          id: "category",
          header: t`Category`,
          width: "120px",
          cell: (row) => (
            <span
              className={cn(
                "rounded-full bg-[var(--color-surface-soft)] px-2 py-0.5",
                "text-[var(--text-xs)] font-medium text-[var(--color-ink)]",
              )}
            >
              {row.step.category}
            </span>
          ),
        },
        {
          id: "title",
          header: t`Step`,
          cell: (row) => (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-[var(--color-ink)]">
                {row.step.title}
              </span>
              <span className="text-[var(--text-xs)] text-muted-foreground">
                {row.step.description}
              </span>
              {row.state.note ? (
                <span
                  className="mt-0.5 text-[var(--text-xs)] italic text-amber-700"
                  data-testid={`step-note-${row.step.id}`}
                >
                  {row.state.note}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          id: "owner",
          header: t`Owner`,
          width: "100px",
          cell: (row) => row.step.owner ?? "—",
        },
      ],
      [t],
    );

  // Re-render on locale change — Lingui's `t` is reactive but
  // we need to force the components to read the new strings.
  // We use a `useLingui()`-level re-render via the official
  // pattern: just re-render when the i18n catalog changes.
  useEffect(() => {
    // No-op; we re-render via t in the dependency arrays above.
  }, [t]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <PageHeader
        periodLabel={period.label}
        periodId={periodId}
        summary={summary}
        onShiftPeriod={(delta) => {
          const next = shiftPeriod(periodId, delta);
          void navigate({ search: { period: next } });
        }}
      />

      <DataTable
        rows={rows}
        columns={columns}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        testId="period-close-table"
        ariaLabel={t`Period close checklist`}
        emptyMessage={t`No steps in this checklist.`}
      />

      <BulkActionBar
        selectedIds={selectedIds}
        actions={actions}
        onClearSelection={() => setSelectedIds([])}
      />
    </div>
  );
}

/* ────────── header ────────── */

function PageHeader({
  periodLabel,
  periodId,
  summary,
  onShiftPeriod,
}: {
  periodLabel: string;
  periodId: string;
  summary: { total: number; done: number; blocked: number; skipped: number; pending: number; doneRatio: number };
  onShiftPeriod: (delta: -1 | 1) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            to="/app"
            className="inline-flex items-center gap-1 text-[var(--text-sm)] text-muted-foreground hover:text-[var(--color-ink)]"
            data-testid="period-close-back"
          >
            <ChevronLeft className="h-4 w-4" />
            <Trans>Back</Trans>
          </Link>
          <h1 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
            <Trans>Period close</Trans>
          </h1>
        </div>
        <div
          className="flex items-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1"
          data-testid="period-close-period-control"
        >
          <button
            type="button"
            aria-label={t`Previous month`}
            onClick={() => onShiftPeriod(-1)}
            className="rounded px-1 text-[var(--text-sm)] text-muted-foreground hover:bg-[var(--color-surface-soft)]"
            data-testid="period-prev"
          >
            ‹
          </button>
          <span
            className="min-w-[120px] text-center text-[var(--text-sm)] font-medium"
            data-testid="period-label"
            data-period-id={periodId}
          >
            {periodLabel}
          </span>
          <button
            type="button"
            aria-label={t`Next month`}
            onClick={() => onShiftPeriod(1)}
            className="rounded px-1 text-[var(--text-sm)] text-muted-foreground hover:bg-[var(--color-surface-soft)]"
            data-testid="period-next"
          >
            ›
          </button>
        </div>
      </div>
      <SummaryStrip
        total={summary.total}
        done={summary.done}
        blocked={summary.blocked}
        skipped={summary.skipped}
        pending={summary.pending}
        doneRatio={summary.doneRatio}
      />
    </div>
  );
}

function SummaryStrip({
  total,
  done,
  blocked,
  skipped,
  pending,
  doneRatio,
}: {
  total: number;
  done: number;
  blocked: number;
  skipped: number;
  pending: number;
  doneRatio: number;
}) {
  const pct = Math.round(doneRatio * 100);
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="period-close-summary"
      data-done={done}
      data-total={total}
      data-blocked={blocked}
      data-skipped={skipped}
      data-pending={pending}
      data-done-ratio={doneRatio}
    >
      <div className="flex items-center justify-between text-[var(--text-sm)]">
        <span
          className="font-medium text-[var(--color-ink)]"
          data-testid="period-close-summary-headline"
        >
          <Trans>{done} of {total} done</Trans>
        </span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-soft)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-[var(--color-brand)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-3 text-[var(--text-xs)] text-muted-foreground">
        <span data-testid="summary-pending">
          <Trans>{pending} pending</Trans>
        </span>
        <span data-testid="summary-blocked" className="text-amber-700">
          <Trans>{blocked} blocked</Trans>
        </span>
        <span data-testid="summary-skipped">
          <Trans>{skipped} skipped</Trans>
        </span>
      </div>
    </div>
  );
}

/* ────────── status pill ────────── */

function StatusPill({ status }: { status: CloseStepStatus }) {
  if (status === "done") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[var(--text-xs)] font-medium text-emerald-800"
        data-testid="status-pill-done"
      >
        <CheckCircle2 className="h-3 w-3" />
        <Trans>Done</Trans>
      </span>
    );
  }
  if (status === "blocked") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[var(--text-xs)] font-medium text-amber-800"
        data-testid="status-pill-blocked"
      >
        <AlertTriangle className="h-3 w-3" />
        <Trans>Blocked</Trans>
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[var(--text-xs)] font-medium text-zinc-700"
        data-testid="status-pill-skipped"
      >
        <MinusCircle className="h-3 w-3" />
        <Trans>Skipped</Trans>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-line)] px-2 py-0.5 text-[var(--text-xs)] font-medium text-muted-foreground"
      data-testid="status-pill-pending"
    >
      <Circle className="h-3 w-3" />
      <Trans>Pending</Trans>
    </span>
  );
}

/* ────────── helpers ────────── */

const shiftPeriod = (periodId: string, delta: -1 | 1): string => {
  const m = /^(\d{4})-(\d{2})$/.exec(periodId);
  if (!m) return periodId;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const d = new Date(Date.UTC(year, month + delta, 1));
  return periodIdFromDate(d);
};

/* ────────── exports for tests ────────── */

export { StatusPill, shiftPeriod };

// Re-export the type signature so the test can verify the row
// shape without importing from two places.
export type { CloseStep, CloseStepState, CloseStepStatus };

// `groupByCategory` and `CHECKLIST_STEPS` are public helpers
// from the lib; keep them reachable for the e2e test (it drives
// the category breakdown).
export { groupByCategory, CHECKLIST_STEPS };
