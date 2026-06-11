/**
 * /app/crm-tube — Tube deals board (Phase 8.13, worker 1/3).
 *
 * Pattern A: kanban-style deals board. Reads from /api/crm/tube
 * (returns { tubes, defaultTubeId }) and /api/crm/tube/deals. Tabs
 * switch the active tube; columns are the tube's stages; cards are
 * the deals.
 *
 * Mirrors the shape of /app/crm/index.tsx and the structure of
 * /app/inventory/index.tsx (kanban). Drag-and-drop is intentionally
 * OUT of scope for V1 — cards are click-only.
 *
 * Armenian strings are inlined as `__ARM_*` placeholders and
 * substituted in via Python at the end of this file (the Edit tool
 * has historically corrupted Armenian text on mixed-language files).
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ListChecks,
  Plus,
  RadioTower,
  X,
} from "lucide-react";
import { getJson, postJson } from "../../../lib/api/client";
import {
  TubeDealSchema,
  TubeListResponseSchema,
  type TubeDeal,
  type TubeTube,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";

/* ────────── typed URL search ────────── */

type Search = { tube?: string };

export const Route = createFileRoute("/app/crm-tube/")({
  validateSearch: (raw): Search => ({
    tube: typeof raw.tube === "string" ? raw.tube : undefined,
  }),
  component: TubeWorkspace,
});

/* ────────── constants ────────── */

const ARMENIAN_TITLE = "Խողող · Deals pipeline";
const ARMENIAN_NO_DEALS = "Ոչ մի գործ չկա այս փուլում";
const ARMENIAN_DEAL_FORM_TITLE = "Նոր գործ";
const ARMENIAN_SUBMIT = "Ստեղծել";
const ARMENIAN_CANCEL = "Չեղարկել";

/* ────────── helpers ────────── */

function formatMmmDd(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function formatArm(value: number): string {
  // The legacy app renders AMD as "1,250,000 AMD". `money(..., { compact: true })`
  // would shorten 1.25M, which the spec explicitly disallows for the card.
  const v = Math.round(Number(value) || 0).toLocaleString("en-US");
  return `${v} AMD`;
}

/* ────────── root component ────────── */

function TubeWorkspace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const tubesQ = useQuery({
    queryKey: ["tube-tubes"],
    queryFn: () => getJson("/api/crm/tube", TubeListResponseSchema),
    staleTime: 30_000,
  });
  const dealsQ = useQuery({
    queryKey: ["tube-deals"],
    queryFn: () => getJson("/api/crm/tube/deals", TubeListResponseSchema),
    staleTime: 30_000,
  });

  const tubes: TubeTube[] = tubesQ.data?.tubes ?? [];
  const allDeals: TubeDeal[] = dealsQ.data?.deals ?? [];

  const activeTube = useMemo<TubeTube | null>(() => {
    if (tubes.length === 0) return null;
    const fromUrl = tubes.find((t) => t.id === search.tube);
    if (fromUrl) return fromUrl;
    return tubes[0];
  }, [tubes, search.tube]);

  const activeTubeId = activeTube?.id;
  const setActiveTube = (id: string) =>
    navigate({ search: { tube: id }, replace: true });

  const dealsForTube = useMemo<TubeDeal[]>(() => {
    if (!activeTubeId) return [];
    return allDeals.filter((d) => d.tube_id === activeTubeId);
  }, [allDeals, activeTubeId]);

  const isLoading = tubesQ.isLoading || dealsQ.isLoading;
  const isError = tubesQ.isError || dealsQ.isError;

  return (
    <div
      className="mx-auto max-w-7xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="tube-board"
      data-entity="tube-list"
    >
      <PageHeader />

      {isLoading ? (
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading tubes…
        </p>
      ) : isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load tube data.
        </p>
      ) : tubes.length === 0 ? (
        <EmptyTubes />
      ) : (
        <>
          <TubeTabs
            tubes={tubes}
            activeId={activeTubeId}
            onChange={setActiveTube}
          />
          {activeTube && (
            <KanbanBoard
              tube={activeTube}
              deals={dealsForTube}
            />
          )}
        </>
      )}

      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Back to Today
        </Link>
      </div>
    </div>
  );
}

/* ────────── header ────────── */

function PageHeader() {
  return (
    <header>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <RadioTower className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
              Tube
            </h1>
            <p
              className="text-[var(--text-sm)] text-[var(--color-muted)]"
              data-testid="tube-subtitle"
            >
              {ARMENIAN_TITLE}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ────────── tube tabs ────────── */

function TubeTabs({
  tubes,
  activeId,
  onChange,
}: {
  tubes: TubeTube[];
  activeId?: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav
      role="tablist"
      aria-label="Tubes"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]"
    >
      {tubes.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-[var(--text-sm)] font-medium",
              active
                ? "border-[var(--color-brand)] text-[var(--color-ink)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            {t.name}
            <span
              className={cn(
                "rounded-[var(--radius-sm)] px-1 text-[10px]",
                active
                  ? "bg-[var(--color-surface-soft)] text-[var(--color-ink)]"
                  : "bg-transparent text-[var(--color-muted)]",
              )}
            >
              {t.stages.length}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ────────── kanban board ────────── */

function KanbanBoard({ tube, deals }: { tube: TubeTube; deals: TubeDeal[] }) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const dealsByStage = useMemo<Record<string, TubeDeal[]>>(() => {
    const out: Record<string, TubeDeal[]> = {};
    for (const s of tube.stages) out[s.id] = [];
    for (const d of deals) {
      if (out[d.stage_id]) out[d.stage_id].push(d);
    }
    return out;
  }, [tube.stages, deals]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
        >
          <Plus className="size-3.5" /> + New deal
        </button>
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.max(tube.stages.length, 1)}, minmax(220px, 1fr))`,
        }}
      >
        {tube.stages.map((stage) => {
          const list = dealsByStage[stage.id] ?? [];
          return (
            <div
              key={stage.id}
              data-stage-id={stage.id}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2"
            >
              <header className="flex items-center justify-between border-b border-[var(--color-line)] pb-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      background:
                        stage.color ?? "var(--color-muted)",
                    }}
                    aria-hidden
                  />
                  <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                    {stage.name}
                  </h3>
                </div>
                <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-muted)]">
                  {stage.probability}%
                </span>
              </header>

              {list.length === 0 ? (
                <p
                  className="px-1 py-3 text-center text-[11px] text-[var(--color-muted)]"
                  data-testid="empty-stage"
                >
                  {ARMENIAN_NO_DEALS}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {list.map((d) => (
                    <li key={d.id}>
                      <DealCard deal={d} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {createOpen && (
        <NewDealModal
          tube={tube}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ["tube-deals"] });
          }}
        />
      )}
    </section>
  );
}

/* ────────── deal card ────────── */

function DealCard({ deal }: { deal: TubeDeal }) {
  return (
    <Link
      to="/app/crm-tube/deals/$dealId"
      params={{ dealId: deal.id }}
      className="block rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-2 transition-colors hover:bg-[var(--color-surface-soft)]"
      data-deal-id={deal.id}
    >
      <p className="line-clamp-2 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        {deal.title}
      </p>
      {deal.contact_name && (
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          {deal.contact_name}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between">
        <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]">
          {formatArm(deal.value)}
        </span>
        {deal.expected_close_at && (
          <span className="text-[10px] text-[var(--color-muted)]">
            {formatMmmDd(deal.expected_close_at)}
          </span>
        )}
      </div>
    </Link>
  );
}

/* ────────── new-deal modal ────────── */

function NewDealModal({
  tube,
  onClose,
  onCreated,
}: {
  tube: TubeTube;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [stageId, setStageId] = useState<string>(
    tube.stages[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim(),
        value: Number(value) || 0,
        currency: "AMD",
        tube_id: tube.id,
        stage_id: stageId,
        idempotencyKey: `tube-deal-${Date.now()}`,
      };
      return postJson(
        "/api/crm/tube/deals",
        body,
        TubeDealSchema,
      );
    },
    onSuccess: () => {
      setError(null);
      onCreated();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const canSubmit = title.trim().length > 0 && stageId !== "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-label={ARMENIAN_DEAL_FORM_TITLE}
    >
      <form
        className="w-full max-w-sm space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) createMut.mutate();
        }}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            {ARMENIAN_DEAL_FORM_TITLE}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </header>

        <label className="block text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Title</span>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
            data-testid="new-deal-title"
          />
        </label>

        <label className="block text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Value (AMD)</span>
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
            data-testid="new-deal-value"
          />
        </label>

        <label className="block text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Stage</span>
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          >
            {tube.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-2 py-1 text-[11px] text-[var(--color-ruby,#b23a48)]"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]"
          >
            {ARMENIAN_CANCEL}
          </button>
          <button
            type="submit"
            disabled={!canSubmit || createMut.isPending}
            className="rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-2 py-1 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
            data-testid="new-deal-submit"
          >
            {createMut.isPending ? "…" : ARMENIAN_SUBMIT}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ────────── empty tubes ────────── */

function EmptyTubes() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center">
      <ListChecks className="size-8 text-[var(--color-muted)]" aria-hidden />
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        No tubes yet
      </h3>
      <p className="text-[11px] text-[var(--color-muted)]">
        The default tube will be created on first access.
      </p>
    </div>
  );
}
