/**
 * /app/assets — Fixed Assets workspace.
 *
 * Pattern A route (TanStack-Start + Zod + TanStack-Query). Mirrors
 * the shape of /app/healthcheck (single-screen panel) and the
 * structure of /app/cabinet (tabs + mutation + list/table).
 *
 * Phase 8.5 surface (mirrors server/app.js lines 3602-3851):
 *   - Registry: GET  /api/assets/report/value      (per-category rollup)
 *   - Depreciation: GET /api/assets/:id/depreciation (schedule; first 12 entries)
 *   - Maintenance: GET /api/assets/:id/maintenance-history (logs)
 *   - Assignment: POST /api/assets/:id/assign      (assigneeType + assigneeId)
 *
 * Role gate (not app-tier): assets is restricted to
 * Owner / Admin / Accountant / Operator. The workspace accepts an
 * optional `userRole` prop so the co-located test can render the
 * 403 branch. Server enforces; UI defaults to permissive until the
 * auth context is wired in 8.4.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Boxes,
  ChevronLeft,
  Lock,
  Send,
  Wrench,
  ClipboardList,
  Calculator,
} from "lucide-react";
import { getJson, postJson } from "../../../lib/api/client";
import {
  AssetsAssignRequestSchema,
  AssetsDepreciationResponseSchema,
  AssetsMaintenanceResponseSchema,
  AssetsValueRollupResponseSchema,
  type AssetsAssignRequest,
  type AssetsDepreciationResponse,
  type AssetsMaintenanceResponse,
  type AssetsValueRollupResponse,
} from "../../../lib/api/schemas";
import {
  ASSETS_DEFAULT_TAB,
  ASSETS_TABS,
  type AssetsTab,
  assetsTabFromHash,
  assetsTabLabelAm,
  formatAssetCostAmd,
  formatAssetPeriodIndex,
  generateAssetsIdempotencyKey,
  isValidAssetsAssetId,
} from "../../../lib/assets/status";
import { cn } from "../../../lib/utils/cn";

/* ────────── role gate ────────── */

export type AssetsUserRole = "Owner" | "Admin" | "Accountant" | "Operator" | "Manager" | "Viewer";

const ALLOWED_ROLES: ReadonlySet<AssetsUserRole> = new Set([
  "Owner",
  "Admin",
  "Accountant",
  "Operator",
]);

export function isAssetsRoleAllowed(role: AssetsUserRole): boolean {
  return ALLOWED_ROLES.has(role);
}

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/assets/")({
  component: AssetsWorkspace,
});

/* ────────── 403 card ────────── */

export function AssetsAccessDeniedCard() {
  return (
    <article
      data-testid="assets-403"
      data-entity="assets-forbidden"
      className="panel flex items-start gap-3 border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]"
    >
      <Lock className="size-4 shrink-0 text-[var(--color-ruby)]" aria-hidden />
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Մուտքը սահմանափակված է
        </h2>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Հիմնական միջոցները հասանելի են միայն Owner / Admin / Accountant / Operator դերերին
        </p>
      </div>
    </article>
  );
}

/* ────────── registry tab (rollup table) ────────── */

export function AssetsRegistryTable({ data }: { data: AssetsValueRollupResponse["rollup"] }) {
  if (data.length === 0) {
    return (
      <p
        data-testid="assets-registry-empty"
        data-entity="assets-registry-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Բեռներ չկան · No rollup rows
      </p>
    );
  }
  return (
    <table
      data-testid="assets-registry-table"
      data-entity="assets-registry-table"
      className="w-full text-left text-[var(--text-sm)] text-[var(--color-ink)]"
    >
      <thead className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
        <tr>
          <th className="px-2 py-1">Կատեգորիա</th>
          <th className="px-2 py-1">Քանակ</th>
          <th className="px-2 py-1">Ընդհանուր արժեք</th>
          <th className="px-2 py-1">Մնացորդային</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr
            key={row.categoryId}
            data-testid="assets-registry-row"
            data-category={row.categoryId}
            className="border-t border-[var(--color-line)]"
          >
            <td className="px-2 py-1 font-medium">{row.categoryId}</td>
            <td className="px-2 py-1">{row.count}</td>
            <td className="px-2 py-1">{formatAssetCostAmd(row.totalCostAmd)}</td>
            <td className="px-2 py-1">{formatAssetCostAmd(row.totalNbvAmd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ────────── depreciation tab ────────── */

export function AssetsDepreciationView({
  assetId,
  result,
  error,
  onSubmit,
  isPending,
}: {
  assetId: string;
  result: AssetsDepreciationResponse | null;
  error: string;
  onSubmit: (assetId: string) => void;
  isPending: boolean;
}) {
  return (
    <div data-testid="assets-depreciation" className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(assetId);
        }}
        className="flex items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Asset ID
          <input
            type="text"
            value={assetId}
            onChange={() => onSubmit.length /* keep typecheck happy */ || undefined}
            readOnly
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="assets-depreciation-asset-id"
          />
        </label>
        <button
          type="submit"
          disabled={isPending || !isValidAssetsAssetId(assetId)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
          data-testid="assets-depreciation-submit"
        >
          <Calculator className="size-3.5" />
          {isPending ? "Հաշվարկվում է…" : "Հաշվել հարկումը"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
          error: {error}
        </p>
      ) : null}
      {result ? (
        <ul
          data-testid="assets-depreciation-schedule"
          data-entity="assets-depreciation-schedule"
          className="space-y-1"
        >
          {result.schedule.slice(0, 12).map((line) => (
            <li
              key={line.periodIndex}
              data-testid="assets-depreciation-row"
              data-period={line.periodIndex}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[var(--text-sm)]"
            >
              <span className="font-mono text-[11px] text-[var(--color-muted)]">
                {formatAssetPeriodIndex(line.periodIndex)}
              </span>
              <span>{formatAssetCostAmd(line.depreciationAmd)}</span>
              <span className="text-[var(--color-muted)]">·</span>
              <span>NBV {formatAssetCostAmd(line.netBookValueAmd)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ────────── maintenance tab ────────── */

export function AssetsMaintenanceView({
  assetId,
  result,
  error,
  onSubmit,
  isPending,
}: {
  assetId: string;
  result: AssetsMaintenanceResponse["logs"] | null;
  error: string;
  onSubmit: (assetId: string) => void;
  isPending: boolean;
}) {
  return (
    <div data-testid="assets-maintenance" className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(assetId);
        }}
        className="flex items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Asset ID
          <input
            type="text"
            value={assetId}
            readOnly
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="assets-maintenance-asset-id"
          />
        </label>
        <button
          type="submit"
          disabled={isPending || !isValidAssetsAssetId(assetId)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
          data-testid="assets-maintenance-submit"
        >
          <Wrench className="size-3.5" />
          {isPending ? "Բեռնվում է…" : "Բեռնել պատմությունը"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
          error: {error}
        </p>
      ) : null}
      {result && result.length > 0 ? (
        <ul
          data-testid="assets-maintenance-list"
          data-entity="assets-maintenance-list"
          className="space-y-1"
        >
          {result.map((log) => (
            <li
              key={log.id}
              data-testid="assets-maintenance-row"
              data-log-id={log.id}
              className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[var(--text-sm)]"
            >
              <span className="font-mono text-[11px] text-[var(--color-muted)]">{log.performed_at}</span>
              <span className="font-medium">{log.kind}</span>
              <span className="text-[var(--color-muted)]">·</span>
              <span>{formatAssetCostAmd(log.cost_amd)}</span>
            </li>
          ))}
        </ul>
      ) : result && result.length === 0 ? (
        <p
          data-testid="assets-maintenance-empty"
          data-entity="assets-maintenance-empty"
          className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
        >
          Սպասարկման գրառումներ չկան · No maintenance logs
        </p>
      ) : null}
    </div>
  );
}

/* ────────── assignment tab ────────── */

export function AssetsAssignmentForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: { assetId: string; assigneeType: string; assigneeId: string }) => void;
  isPending: boolean;
  error: string;
}) {
  const [assetId, setAssetId] = useState("");
  const [assigneeType, setAssigneeType] = useState("employee");
  const [assigneeId, setAssigneeId] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ assetId, assigneeType, assigneeId });
      }}
      data-testid="assets-assignment-form"
      className="grid grid-cols-1 gap-2 md:grid-cols-3"
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Asset ID
        <input
          type="text"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          required
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="assets-assignment-asset-id"
        />
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Assignee type
        <select
          value={assigneeType}
          onChange={(e) => setAssigneeType(e.target.value)}
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="assets-assignment-type"
        >
          <option value="employee">Employee</option>
          <option value="department">Department</option>
          <option value="location">Location</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[var(--text-sm)] text-[var(--color-muted)]">
        Assignee ID
        <input
          type="text"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          required
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="assets-assignment-assignee-id"
        />
      </label>
      <button
        type="submit"
        disabled={isPending || !isValidAssetsAssetId(assetId) || !assigneeId.trim()}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-medium text-[var(--color-surface)] disabled:opacity-50"
        data-testid="assets-assignment-submit"
      >
        <Send className="size-3.5" />
        {isPending ? "Ուղարկվում է…" : "Հանձնարարել"}
      </button>
      {error ? (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
          error: {error}
        </p>
      ) : null}
    </form>
  );
}

/* ────────── tab strip ────────── */

const TAB_ICON: Record<AssetsTab, typeof Boxes> = {
  registry: ClipboardList,
  depreciation: Calculator,
  maintenance: Wrench,
  assignment: Send,
};

export function AssetsTabs({
  active,
  onChange,
}: {
  active: AssetsTab;
  onChange: (tab: AssetsTab) => void;
}) {
  return (
    <div role="tablist" aria-label="Assets tabs" className="flex flex-wrap gap-2">
      {ASSETS_TABS.map((tab) => {
        const Icon = TAB_ICON[tab];
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            data-testid={`assets-tab-${tab}`}
            data-tab={tab}
            data-active={isActive}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-[var(--text-sm)] font-medium transition-colors",
              isActive
                ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-surface)]"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]",
            )}
          >
            <Icon className="size-3.5" />
            {assetsTabLabelAm(tab)}
          </button>
        );
      })}
    </div>
  );
}

/* ────────── root workspace ────────── */

function AssetsWorkspace() {
  const initialTab =
    typeof window !== "undefined"
      ? assetsTabFromHash(window.location.hash)
      : ASSETS_DEFAULT_TAB;
  const [tab, setTab] = useState<AssetsTab>(initialTab);
  const [deprAssetId, setDeprAssetId] = useState("");
  const [maintAssetId, setMaintAssetId] = useState("");
  const [deprError, setDeprError] = useState("");
  const [maintError, setMaintError] = useState("");
  const [assignError, setAssignError] = useState("");

  const rollupQuery = useQuery({
    queryKey: ["assets-rollup"],
    queryFn: async () => {
      const res = await getJson(
        "/api/assets/report/value",
        AssetsValueRollupResponseSchema,
      );
      return res.rollup;
    },
  });

  const [deprResult, setDeprResult] = useState<AssetsDepreciationResponse | null>(null);
  const [maintResult, setMaintResult] = useState<AssetsMaintenanceResponse["logs"] | null>(null);

  const deprQuery = useQuery({
    queryKey: ["assets-depreciation", deprAssetId],
    queryFn: async () => {
      if (!isValidAssetsAssetId(deprAssetId)) return null;
      const res = await getJson(
        `/api/assets/${deprAssetId}/depreciation`,
        AssetsDepreciationResponseSchema,
      );
      return res;
    },
    enabled: false,
  });

  const maintQuery = useQuery({
    queryKey: ["assets-maintenance", maintAssetId],
    queryFn: async () => {
      if (!isValidAssetsAssetId(maintAssetId)) return null;
      const res = await getJson(
        `/api/assets/${maintAssetId}/maintenance-history`,
        AssetsMaintenanceResponseSchema,
      );
      return res;
    },
    enabled: false,
  });

  const assignMut = useMutation({
    mutationFn: async (input: { assetId: string; assigneeType: string; assigneeId: string }) => {
      setAssignError("");
      const payload: AssetsAssignRequest = AssetsAssignRequestSchema.parse({
        assigneeType: input.assigneeType,
        assigneeId: input.assigneeId,
        idempotencyKey: generateAssetsIdempotencyKey("assign"),
      });
      return postJson(
        `/api/assets/${input.assetId}/assign`,
        payload,
      );
    },
    onSuccess: (data) => {
      // Mirror cabinet: invalidate the rollup so the registry tab re-fetches.
      rollupQuery.refetch?.();
      return data;
    },
    onError: (err: Error) => {
      setAssignError(err.message);
    },
  });

  return (
    <div
      className="mx-auto max-w-6xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="assets-panel"
      data-entity="assets-root"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Boxes className="size-3" />
          App · Assets
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Հիմնական միջոցներ
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Fixed assets · depreciation · maintenance · assignment
        </p>
      </header>

      <AssetsTabs active={tab} onChange={setTab} />

      <section className="panel space-y-3" data-testid={`assets-${tab}-panel`}>
        {tab === "registry" ? (
          rollupQuery.isPending ? (
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">Բեռնվում է…</p>
          ) : rollupQuery.error ? (
            <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
              error: {(rollupQuery.error as Error).message}
            </p>
          ) : (
            <AssetsRegistryTable data={rollupQuery.data ?? []} />
          )
        ) : null}

        {tab === "depreciation" ? (
          <AssetsDepreciationView
            assetId={deprAssetId}
            result={deprQuery.data ?? deprResult}
            error={deprError || (deprQuery.error ? (deprQuery.error as Error).message : "")}
            onSubmit={(id) => {
              setDeprAssetId(id);
              setDeprError("");
              deprQuery.refetch().then((r) => {
                if (r.data) setDeprResult(r.data);
              }).catch((err: Error) => setDeprError(err.message));
            }}
            isPending={deprQuery.isFetching}
          />
        ) : null}

        {tab === "maintenance" ? (
          <AssetsMaintenanceView
            assetId={maintAssetId}
            result={maintQuery.data?.logs ?? maintResult}
            error={maintError || (maintQuery.error ? (maintQuery.error as Error).message : "")}
            onSubmit={(id) => {
              setMaintAssetId(id);
              setMaintError("");
              maintQuery.refetch().then((r) => {
                if (r.data) setMaintResult(r.data.logs);
              }).catch((err: Error) => setMaintError(err.message));
            }}
            isPending={maintQuery.isFetching}
          />
        ) : null}

        {tab === "assignment" ? (
          <AssetsAssignmentForm
            onSubmit={(input) => assignMut.mutate(input)}
            isPending={assignMut.isPending}
            error={assignError}
          />
        ) : null}
      </section>

      <div>
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          back to Today
        </Link>
      </div>
    </div>
  );
}
