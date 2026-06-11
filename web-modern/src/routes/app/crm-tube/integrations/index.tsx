/**
 * /app/crm-tube/integrations — Tube integration health view.
 *
 * Per docs/phase8-tube/design.md section 2.4, this is the
 * operator-facing grid of the 10 sovereign Tube connectors:
 *
 *   apollo · cloudtalk · respond-io · surfe · dexatel · make ·
 *   webflow · closely · instantly · pixxi
 *
 * V1 stub mode (the default — no <KEY>_ENABLED=1) keeps every
 * connector in `planned` status and never makes an outbound call.
 * The grid still lets the operator trigger a manual health check
 * via `POST /api/crm/tube/integrations/:key/health-check`, which
 * returns a fresh envelope (status, last_health_status,
 * last_health_at, last_health_latency) for the card to render.
 *
 *   - List:   GET  /api/crm/tube/integrations
 *   - Check:  POST /api/crm/tube/integrations/:key/health-check
 *
 * No URL search state — the grid is the entire surface. We could
 * add ?status= later if filtering becomes useful.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  CircleAlert,
  Plug,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  TubeIntegrationSchema,
  TubeListResponseSchema,
  type TubeIntegration,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/app/crm-tube/integrations/")({
  component: IntegrationsHealthRoute,
});

/** The 10 sovereign Tube connectors, in display order. Mirrors
 *  server/crmTube/connectors/registry.js#CONNECTOR_KEYS. */
const CONNECTOR_KEYS = [
  "apollo",
  "cloudtalk",
  "respond-io",
  "surfe",
  "dexatel",
  "make",
  "webflow",
  "closely",
  "instantly",
  "pixxi",
] as const;

type ConnectorKey = (typeof CONNECTOR_KEYS)[number];

/** Static display metadata — the engine owns the runtime state.
 *  Each connector's Armenian label pairs with the English name
 *  for the bilingual header. */
const CONNECTOR_DISPLAY: Record<
  ConnectorKey,
  { name: string; nameAm: string; tagline: string }
> = {
  apollo: { name: "Apollo.io", nameAm: "Ապոլլո", tagline: "contacts:read · contacts:enrich" },
  cloudtalk: { name: "CloudTalk", nameAm: "ԿլաուդԹոկ", tagline: "calls:read · calls:write" },
  "respond-io": { name: "Respond.io", nameAm: "Ռեսպոնդ", tagline: "messages:read · messages:write" },
  surfe: { name: "Surfe", nameAm: "Սուրֆ", tagline: "contacts:enrich · social:read" },
  dexatel: { name: "Dexatel", nameAm: "Դեքսաթել", tagline: "sms:read · sms:write" },
  make: { name: "Make", nameAm: "Մեյք", tagline: "scenarios:read · scenarios:run" },
  webflow: { name: "Webflow", nameAm: "Վեբflov", tagline: "forms:read · cms:read" },
  closely: { name: "Closely", nameAm: "Կլոսլի", tagline: "sequences:read · sequences:write" },
  instantly: { name: "Instantly.ai", nameAm: "Ինսթենթլի", tagline: "campaigns:read · campaigns:write" },
  pixxi: { name: "Pixxi", nameAm: "Պիքսի", tagline: "leads:read · leads:enrich" },
};

/* ────────── root component ────────── */

function IntegrationsHealthRoute() {
  const q = useQuery({
    queryKey: ["tube-integrations"],
    queryFn: () =>
      getJson("/api/crm/tube/integrations", TubeListResponseSchema),
    staleTime: 15_000,
  });

  const live = (q.data?.integrations ?? []) as TubeIntegration[];

  // Merge the 10 static connector keys with whatever the server
  // returned. If a connector is missing from the response (the
  // stub mode never registers it), we still render its card in
  // the `planned` state — that's the V1 default.
  const cards: Array<{ key: ConnectorKey; integration: TubeIntegration | null }> =
    CONNECTOR_KEYS.map((key) => ({
      key,
      integration: live.find((i) => i.connector_key === key) ?? null,
    }));

  return (
    <div
      className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="tube-integrations"
      data-entity="tube-integrations-grid"
    >
      <Header />

      {q.isLoading ? (
        <p className="px-3 py-10 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading integrations…
        </p>
      ) : q.isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-ruby,#b23a48)]/30 bg-[var(--color-ruby,#b23a48)]/5 px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load integrations. The Tube engine is offline.
        </p>
      ) : (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          data-testid="tube-integrations-grid-inner"
        >
          {cards.map((c) => (
            <ConnectorCard
              key={c.key}
              connectorKey={c.key}
              integration={c.integration}
            />
          ))}
        </div>
      )}

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

/* ────────── header ────────── */

function Header() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Plug className="size-3" />
        Tube · Integrations
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        Integrations
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Ինտ · 10 connectors
      </p>
    </header>
  );
}

/* ────────── connector card ────────── */

function ConnectorCard({
  connectorKey,
  integration,
}: {
  connectorKey: ConnectorKey;
  integration: TubeIntegration | null;
}) {
  const qc = useQueryClient();
  const [localError, setLocalError] = useState<string | null>(null);

  const display = CONNECTOR_DISPLAY[connectorKey];
  const status = integration?.status ?? "planned";
  const mode = "stub"; // V1 — real mode is opt-in per <KEY>_ENABLED=1.
  const lastHealthStatus = integration?.last_health_status ?? null;
  const lastHealthAt = integration?.last_health_at ?? null;
  const lastHealthLatency = integration?.last_health_latency ?? null;

  const healthM = useMutation({
    mutationFn: async () => {
      setLocalError(null);
      // Response shape is a single TubeIntegration (the engine
      // returns the updated row).
      return postJson(
        `/api/crm/tube/integrations/${encodeURIComponent(connectorKey)}/health-check`,
        { idempotencyKey: `tube-health-${Date.now()}` },
        TubeIntegrationSchema,
      );
    },
    onSuccess: (data) => {
      // Update the cache in place so the card reflects the new
      // health check without a full refetch.
      qc.setQueryData(["tube-integrations"], (old: unknown) => {
        const envelope = (old ?? {}) as { integrations?: TubeIntegration[] };
        const list = envelope.integrations ?? [];
        const idx = list.findIndex((i) => i.connector_key === connectorKey);
        const next = [...list];
        if (idx >= 0) next[idx] = data;
        else next.push(data);
        return { ...envelope, integrations: next };
      });
    },
    onError: (err: Error) => {
      setLocalError(err.message ?? "Health check failed");
    },
  });

  return (
    <article
      className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      data-testid={`tube-integration-card-${connectorKey}`}
    >
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              {display.name}
            </p>
            <p className="text-[11px] text-[var(--color-muted)]">
              {display.nameAm} · {display.tagline}
            </p>
          </div>
          <StatusPill status={status} />
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-1 text-[11px] text-[var(--color-muted)]">
        <div>
          <dt className="uppercase tracking-wider">Mode</dt>
          <dd>
            <ModeChip mode={mode} />
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider">Last check</dt>
          <dd>
            {lastHealthStatus
              ? `${lastHealthStatus} · ${formatLatency(lastHealthLatency)}`
              : "—"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase tracking-wider">When</dt>
          <dd>{formatTimestamp(lastHealthAt)}</dd>
        </div>
      </dl>

      {localError && (
        <p
          role="alert"
          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-ruby,#b23a48)]"
        >
          <CircleAlert className="size-3" />
          {localError}
        </p>
      )}

      <button
        type="button"
        onClick={() => healthM.mutate()}
        disabled={healthM.isPending}
        data-testid={`tube-integration-health-${connectorKey}`}
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {healthM.isPending ? (
          <RefreshCw className="size-3.5 animate-spin" />
        ) : (
          <Stethoscope className="size-3.5" />
        )}
        {healthM.isPending ? "Checking…" : "Run health check"}
      </button>
    </article>
  );
}

/* ────────── small primitives ────────── */

const STATUS_TONE: Record<
  string,
  { bg: string; fg: string; label: string }
> = {
  planned: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
    label: "planned",
  },
  connected: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
    label: "connected",
  },
  paused: {
    bg: "bg-[color-mix(in_srgb,var(--color-amber,#d78b2f)_15%,transparent)]",
    fg: "text-[var(--color-amber,#d78b2f)]",
    label: "paused",
  },
  error: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
    label: "error",
  },
};

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.planned;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone.bg,
        tone.fg,
      )}
    >
      {tone.label}
    </span>
  );
}

function ModeChip({ mode }: { mode: string }) {
  return (
    <span
      data-testid={`tube-integration-mode-${mode}`}
      className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]"
    >
      {mode}
    </span>
  );
}

function formatLatency(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return `${ms}ms`;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Keep it short — the operator only needs month/day/hour.
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
