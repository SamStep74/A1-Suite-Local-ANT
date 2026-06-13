/**
 * /app/smb-crm/deals — Kanban deals board (Phase 10, Track 5).
 *
 * Pattern A: tabs per stage, columns per stage, cards per deal.
 * Mirrors /app/crm-tube/index.tsx but uses the smb-crm `/api/smb-crm/deals`
 * + `/api/smb-crm/pipeline-stages` endpoints. Drag-and-drop is OUT of
 * scope for V1 — cards are click-only.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, KanbanSquare, Plus, X } from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  SmbCrmCreateDealRequestSchema,
  SmbCrmCreateDealResponseSchema,
  SmbCrmListDealsResponseSchema,
  type SmbCrmDeal,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

type Search = { stage?: string };

export const Route = createFileRoute("/app/smb-crm/deals/")({
  validateSearch: (raw): Search => ({
    stage: typeof raw.stage === "string" ? raw.stage : undefined,
  }),
  component: DealsBoard,
});

const STAGES = [
  { id: "lead", name: "Lead", color: "var(--color-amber)" },
  { id: "qualified", name: "Qualified", color: "var(--color-teal)" },
  { id: "proposal", name: "Proposal", color: "var(--color-blue)" },
  { id: "won", name: "Won", color: "var(--color-green)" },
  { id: "lost", name: "Lost", color: "var(--color-ruby)" },
];

const ARM_TITLE = "Գործեր · Deals pipeline";
const ARM_NEW = "Նոր գործ";

function DealsBoard() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const activeStage = search.stage ?? STAGES[0]!.id;

  const dealsQ = useQuery({
    queryKey: ["smb-crm-deals"],
    queryFn: () => getJson("/api/smb-crm/deals", SmbCrmListDealsResponseSchema),
    staleTime: 15_000,
  });

  const deals: SmbCrmDeal[] = dealsQ.data?.deals ?? [];

  const byStage = useMemo<Record<string, SmbCrmDeal[]>>(() => {
    const out: Record<string, SmbCrmDeal[]> = {};
    for (const s of STAGES) out[s.id] = [];
    for (const d of deals) {
      // map deal.status to stage; for open deals we use the active filter
      if (d.status === "won") out.won?.push(d);
      else if (d.status === "lost") out.lost?.push(d);
      else out[activeStage]?.push(d);
    }
    return out;
  }, [deals, activeStage]);

  const setStage = (id: string) =>
    navigate({ search: { stage: id }, replace: true });

  return (
    <div
      className="mx-auto max-w-7xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-deals"
    >
      <PageHeader />

      {dealsQ.isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load deals.
        </p>
      ) : (
        <>
          <StageTabs active={activeStage} onChange={setStage} />
          {STAGES.filter((s) => s.id === activeStage).map((s) => {
            const list = byStage[s.id] ?? [];
            return (
              <section
                key={s.id}
                data-testid="smb-crm-deals-column"
                data-stage={s.id}
                className="space-y-2"
              >
                <header className="flex items-center justify-between">
                  <h2 className="flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: s.color }}
                      aria-hidden
                    />
                    {s.name} ({list.length})
                  </h2>
                  <NewDealButton stageId={s.id} />
                </header>
                {list.length === 0 ? (
                  <p
                    className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-6 text-center text-[11px] text-[var(--color-muted)]"
                    data-testid="smb-crm-deals-empty"
                  >
                    No deals in this stage.
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((d) => (
                      <li key={d.id}>
                        <DealCard deal={d} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}

      <div>
        <Link
          to="/app/smb-crm"
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Back to onboarding
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
            <KanbanSquare className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-deals-h1"
            >
              Deals
            </h1>
            <p
              className="text-[var(--text-sm)] text-[var(--color-muted)]"
              data-testid="smb-crm-deals-subtitle"
            >
              {ARM_TITLE}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ────────── tabs ────────── */

function StageTabs({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  return (
    <nav
      role="tablist"
      aria-label="Pipeline"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--color-line)]"
      data-testid="smb-crm-deals-tabs"
    >
      {STAGES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={active === s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            "inline-flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-[var(--text-sm)] font-medium",
            active === s.id
              ? "border-[var(--color-brand)] text-[var(--color-ink)]"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]",
          )}
          data-stage={s.id}
        >
          <span
            className="size-2 rounded-full"
            style={{ background: s.color }}
            aria-hidden
          />
          {s.name}
        </button>
      ))}
    </nav>
  );
}

/* ────────── card ────────── */

function DealCard({ deal }: { deal: SmbCrmDeal }) {
  return (
    <Link
      to="/app/smb-crm/customers/$customerId"
      params={{ customerId: deal.customerId ?? "_" }}
      className="block rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 transition-colors hover:bg-[var(--color-surface-soft)]"
      data-deal-id={deal.id}
      data-testid="smb-crm-deal-card"
    >
      <p className="line-clamp-2 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        {deal.title}
      </p>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--color-muted)]">
        <span className="font-mono tabular-nums text-[var(--color-ink)]">
          {formatArm(deal.value, deal.currency)}
        </span>
        {deal.expectedCloseDate && <span>{deal.expectedCloseDate.slice(0, 10)}</span>}
      </div>
    </Link>
  );
}

/* ────────── new deal ────────── */

function NewDealButton({ stageId }: { stageId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [customerId, setCustomerId] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      postJson(
        "/api/smb-crm/deals",
        {
          idempotencyKey: `smb-crm-deal-${Date.now()}`,
          title: title.trim(),
          value: Number(value) || 0,
          currency: "AMD",
          customerId: customerId.trim() || undefined,
          stageId,
        } as ReturnType<typeof SmbCrmCreateDealRequestSchema.parse>,
        SmbCrmCreateDealResponseSchema,
      ),
    onSuccess: () => {
      setOpen(false);
      setTitle("");
      setValue("");
      setCustomerId("");
      qc.invalidateQueries({ queryKey: ["smb-crm-deals"] });
    },
  });

  const canSubmit = title.trim().length > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
        data-testid="smb-crm-deal-new"
      >
        <Plus className="size-3.5" /> {ARM_NEW}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
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
                {ARM_NEW}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-sm)] p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
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
                data-testid="smb-crm-deal-new-title"
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
                data-testid="smb-crm-deal-new-value"
              />
            </label>
            <label className="block text-[var(--text-sm)]">
              <span className="text-[var(--color-muted)]">Customer ID (optional)</span>
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
                data-testid="smb-crm-deal-new-customer"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || createMut.isPending}
                className="rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-2 py-1 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
                data-testid="smb-crm-deal-new-submit"
              >
                {createMut.isPending ? "…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function formatArm(value: number, currency: string): string {
  if (currency === "AMD") {
    const v = Math.round(Number(value) || 0).toLocaleString("en-US");
    return `${v} AMD`;
  }
  return `${Math.round(Number(value) || 0).toLocaleString("en-US")} ${currency}`;
}
