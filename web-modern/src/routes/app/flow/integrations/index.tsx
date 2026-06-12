/**
 * /app/flow/integrations — Integration hub (Phase 10.2d).
 *
 * Pattern A ViewSwitcher over three surfaces:
 *
 *   - **Connectors** — third-party integrations (Stripe, S3, Twilio, …) +
 *     one-click health probe.
 *   - **Webhooks**   — registered outbound webhook endpoints (URL, events,
 *     enabled flag, secret).
 *   - **Deliveries** — webhook delivery ledger (per-attempt status,
 *     response code, retry).
 *
 * URL state:
 *   ?view=connectors | webhooks | deliveries
 *
 * Data (requires app=flow access):
 *   GET  /api/integrations/connectors
 *   POST /api/integrations/connectors/:key/health-check
 *   GET  /api/integrations/webhooks
 *   GET  /api/integrations/webhook-deliveries
 *   POST /api/integrations/webhook-deliveries/:id/retry
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ChevronLeft,
  CircleCheck,
  CircleX,
  Loader2,
  Plug,
  RotateCw,
} from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  IntegrationConnectorsResponseSchema,
  WebhookDeliveriesResponseSchema,
  WebhookEndpointsResponseSchema,
  type IntegrationConnector,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "../../../../lib/api/schemas";
import { ViewSwitcher } from "../../../../components/view-switcher/ViewSwitcher";
import { useUserAccess } from "../../../../lib/rbac/access";
import { cn } from "../../../../lib/utils/cn";

/* ────────── typed URL search ────────── */

type View = "connectors" | "webhooks" | "deliveries";

const VALID_VIEWS: ReadonlySet<View> = new Set(["connectors", "webhooks", "deliveries"]);
const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "connectors", label: "Connectors" },
  { value: "webhooks", label: "Webhooks" },
  { value: "deliveries", label: "Deliveries" },
];

export const Route = createFileRoute("/app/flow/integrations/")({
  validateSearch: (raw) => {
    const v: View =
      typeof raw.view === "string" && VALID_VIEWS.has(raw.view as View)
        ? (raw.view as View)
        : "connectors";
    return { view: v };
  },
  component: IntegrationsHub,
});

/* ────────── root component ────────── */

function IntegrationsHub() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view: View = search.view;
  const setView = (next: View) =>
    navigate({ search: { view: next }, replace: true });

  const access = useUserAccess("flow");

  if (!access) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-[var(--text-2xl)] font-semibold">Integrations</h1>
        <p className="mt-2 text-[var(--text-sm)] text-[var(--color-muted)]">
          You don&apos;t have access to Flow. Ask an admin to grant you the flow app role.
        </p>
        <Link
          to="/app"
          className="mt-4 inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-brand)] hover:underline"
        >
          <ChevronLeft className="size-3.5" /> Back to Today
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8">
      <PageHeader />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ViewSwitcher options={VIEW_OPTIONS} value={view} onChange={setView} />
        <Link
          to="/app/flow"
          search={{ view: "rules" }}
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" /> Back to Flow
        </Link>
      </div>

      {view === "connectors" && <ConnectorsView />}
      {view === "webhooks" && <WebhooksView />}
      {view === "deliveries" && <DeliveriesView />}
    </div>
  );
}

/* ────────── page header ────────── */

function PageHeader() {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Plug className="size-3" /> Integrations
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        Integration hub
      </h1>
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Connectors · Webhook endpoints · Delivery ledger
      </p>
    </header>
  );
}

/* ────────── tones ────────── */

const CONNECTOR_TONE: Record<string, { bg: string; fg: string }> = {
  healthy: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  degraded: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  down: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
  configured: {
    bg: "bg-[color-mix(in_srgb,var(--color-brand)_15%,transparent)]",
    fg: "text-[var(--color-brand)]",
  },
  planned: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
  disabled: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
  unknown: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
};

const DELIVERY_TONE: Record<string, { bg: string; fg: string }> = {
  succeeded: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  pending: {
    bg: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)]",
    fg: "text-[var(--color-muted)]",
  },
  retrying: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  failed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-red)_15%,transparent)]",
    fg: "text-[var(--color-tag-red)]",
  },
};

/* ────────── Connectors view ────────── */

function ConnectorsView() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["integration-connectors"],
    queryFn: async () => {
      const raw = await getJson("/api/integrations/connectors");
      return IntegrationConnectorsResponseSchema.parse(raw);
    },
  });
  const health = useMutation({
    mutationFn: async (key: string) =>
      postJson(`/api/integrations/connectors/${key}/health-check`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integration-connectors"] }),
  });

  if (q.isLoading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading connectors…
      </p>
    );
  }
  if (q.isError) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load connectors.
      </p>
    );
  }

  const connectors = q.data?.connectors ?? [];
  if (connectors.length === 0) {
    return <EmptyState message="No connectors configured." />;
  }

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
      data-entity="integration-connector"
      data-count={String(connectors.length)}
    >
      <table className="w-full text-[var(--text-sm)]" role="table">
        <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Connector</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Last health</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {connectors.map((c) => (
            <ConnectorRow
              key={c.key}
              connector={c}
              onHealthCheck={() => health.mutate(c.key)}
              healthPending={health.isPending && health.variables === c.key}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectorRow({
  connector,
  onHealthCheck,
  healthPending,
}: {
  connector: IntegrationConnector;
  onHealthCheck: () => void;
  healthPending: boolean;
}) {
  const tone = CONNECTOR_TONE[connector.status] ?? CONNECTOR_TONE.unknown;
  return (
    <tr
      className="hover:bg-[var(--color-surface-soft)]"
      data-testid={`connector-row-${connector.key}`}
    >
      <td className="px-3 py-2">
        <p className="font-medium text-[var(--color-ink)]">{connector.displayName}</p>
        <p className="text-[11px] text-[var(--color-muted)]">
          {connector.key} · {connector.description || "—"}
        </p>
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {connector.status === "healthy" ? (
            <CircleCheck className="size-3" />
          ) : connector.status === "down" ? (
            <CircleX className="size-3" />
          ) : null}
          {connector.status}
        </span>
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        {connector.lastHealthStatus ? (
          <>
            {connector.lastHealthStatus.status} ·{" "}
            {connector.lastHealthStatus.latencyMs ?? "?"}ms
          </>
        ) : (
          <span>Never checked</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onHealthCheck}
          disabled={healthPending}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[11px] font-semibold hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
        >
          {healthPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Activity className="size-3" />
          )}
          Check
        </button>
      </td>
    </tr>
  );
}

/* ────────── Webhooks view ────────── */

function WebhooksView() {
  const q = useQuery({
    queryKey: ["webhook-endpoints"],
    queryFn: async () => {
      const raw = await getJson("/api/integrations/webhooks");
      return WebhookEndpointsResponseSchema.parse(raw);
    },
  });

  if (q.isLoading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading webhooks…
      </p>
    );
  }
  if (q.isError) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load webhooks.
      </p>
    );
  }

  const endpoints = q.data?.endpoints ?? [];
  if (endpoints.length === 0) {
    return (
      <EmptyState message="No webhook endpoints registered. Owner-only — ask an admin to POST /api/integrations/webhooks." />
    );
  }

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
      data-entity="webhook-endpoint"
      data-count={String(endpoints.length)}
    >
      <table className="w-full text-[var(--text-sm)]" role="table">
        <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">URL</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Events</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Enabled</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {endpoints.map((e) => (
            <WebhookRow key={e.id} endpoint={e} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WebhookRow({ endpoint }: { endpoint: WebhookEndpoint }) {
  return (
    <tr data-testid={`webhook-row-${endpoint.id}`}>
      <td className="px-3 py-2 font-mono text-[11px] text-[var(--color-ink)]">
        {endpoint.url}
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">{endpoint.events.join(", ")}</td>
      <td className="px-3 py-2">
        {endpoint.enabled ? (
          <CircleCheck className="size-3.5 text-[var(--color-tag-green)]" />
        ) : (
          <CircleX className="size-3.5 text-[var(--color-tag-red)]" />
        )}
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">{endpoint.createdAt}</td>
    </tr>
  );
}

/* ────────── Deliveries view ────────── */

function DeliveriesView() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: async () => {
      const raw = await getJson("/api/integrations/webhook-deliveries");
      return WebhookDeliveriesResponseSchema.parse(raw);
    },
  });
  const retry = useMutation({
    mutationFn: async (id: string) =>
      postJson(`/api/integrations/webhook-deliveries/${id}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhook-deliveries"] }),
  });

  if (q.isLoading) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
        Loading deliveries…
      </p>
    );
  }
  if (q.isError) {
    return (
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        Failed to load deliveries.
      </p>
    );
  }

  const deliveries = q.data?.deliveries ?? [];
  if (deliveries.length === 0) {
    return <EmptyState message="No webhook deliveries yet." />;
  }

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]"
      data-entity="webhook-delivery"
      data-count={String(deliveries.length)}
    >
      <table className="w-full text-[var(--text-sm)]" role="table">
        <thead className="bg-[var(--color-surface-soft)] text-[var(--text-xs)] uppercase tracking-wide text-[var(--color-muted)]">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Event</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Endpoint</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Response</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Attempted</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {deliveries.map((d) => (
            <DeliveryRow
              key={d.id}
              delivery={d}
              onRetry={() => retry.mutate(d.id)}
              retryPending={retry.isPending && retry.variables === d.id}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryRow({
  delivery,
  onRetry,
  retryPending,
}: {
  delivery: WebhookDelivery;
  onRetry: () => void;
  retryPending: boolean;
}) {
  const tone = DELIVERY_TONE[delivery.status] ?? DELIVERY_TONE.failed;
  return (
    <tr data-testid={`delivery-row-${delivery.id}`}>
      <td className="px-3 py-2 font-mono text-[11px]">{delivery.eventType}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-[var(--color-muted)]">
        {delivery.endpointUrl ?? delivery.endpointId}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            tone.bg,
            tone.fg,
          )}
        >
          {delivery.status}
        </span>
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        {delivery.responseCode ?? "—"}{" "}
        {delivery.responseSnippet
          ? `· ${delivery.responseSnippet.slice(0, 40)}`
          : ""}
      </td>
      <td className="px-3 py-2 text-[var(--color-muted)]">{delivery.attemptedAt}</td>
      <td className="px-3 py-2 text-right">
        {delivery.status === "failed" ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retryPending}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1 text-[11px] font-semibold hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
          >
            {retryPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RotateCw className="size-3" />
            )}
            Retry
          </button>
        ) : null}
      </td>
    </tr>
  );
}

/* ────────── empty state ────────── */

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-6 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
      {message}
    </div>
  );
}
