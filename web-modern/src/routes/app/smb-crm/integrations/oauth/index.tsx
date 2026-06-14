/**
 * /app/smb-crm/integrations/oauth — Phase 10.13.
 *
 * The 5 OAuth PULL providers (apollo, surfe, closely, webflow, make)
 * are sovereign sub-app connections: the tenant authorizes a
 * sub-app on the provider's site, we receive a code at
 * /api/oauth/:provider/callback, exchange it for an access +
 * refresh token, vault-seal it, and use it to PULL data into
 * the SMB-CRM.
 *
 * This page is the SPA's UI for that flow:
 *   - List the 5 providers (from GET /api/oauth/providers)
 *   - Per-provider status badge (from GET /api/oauth/:provider/status)
 *   - "Connect" button → GET /api/oauth/:provider/connect →
 *     window.location.href = url
 *   - "Disconnect" button → POST /api/oauth/:provider/disconnect
 *   - "Refresh now" button → POST /api/oauth/:provider/refresh
 *   - On mount, parse ?status=connected|error&detail=... from
 *     the URL (the callback redirects back to the SPA at
 *     /app/smb-crm/integrations?status=...) and surface a toast
 *     here if the user lands on the OAuth sub-page with a
 *     status param.
 *
 * SECURITY: status / connect / disconnect / refresh responses
 * NEVER include the access or refresh token. Only
 * `expiresAt`, `scopes`, `connectedAt`, `hasRefreshToken` are
 * surfaced. We use TanStack Query so a single OAuth sweep
 * refreshes the UI across all 5 provider cards at once.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plug, RefreshCw, Unplug, AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { getJson, postJson } from "../../../../../lib/api/client";
import {
  OAuthProviderListResponseSchema,
  OAuthStatusSchema,
  OAuthConnectResponseSchema,
  type OAuthStatus,
  type OAuthProviderDescriptor
} from "../../../../../lib/api/schemas";
import { cn } from "../../../../../lib/utils/cn";

export const Route = createFileRoute("/app/smb-crm/integrations/oauth/")({
  component: OAuthIntegrationsPage,
});

// We seed a stable "no-data" sentinel for the useQuery so the
// component renders an empty state without TS non-null assertions.
// `provider` is widened to string so the same sentinel works for
// any of the 5 providers in STATUS_BY_ID.
const NO_STATUS: OAuthStatus = { connected: false, provider: "apollo" };

const PROVIDER_ACCENTS: Record<string, string> = {
  apollo: "var(--color-violet)",
  surfe: "var(--color-green)",
  closely: "var(--color-ruby)",
  webflow: "var(--color-pink)",
  make: "var(--color-orange)",
};

const PROVIDER_NOTES: Record<string, string> = {
  apollo: "Pull contacts, emails, and company data from Apollo.",
  surfe: "Enrich contacts + sync LinkedIn data via Surfe.",
  closely: "Sync Closely sequences and reply detection.",
  webflow: "Sync Webflow CMS items + form submissions.",
  make: "Trigger Make scenarios on deal stage changes."
};

function OAuthIntegrationsPage() {
  const search = useSearch({ from: "/app/smb-crm/integrations/oauth/" }) as {
    status?: string;
    detail?: string;
  };
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // List of providers
  const providersQ = useQuery({
    queryKey: ["oauth", "providers"],
    queryFn: () =>
      getJson("/api/oauth/providers", OAuthProviderListResponseSchema)
  });

  // Status per provider — we fan out into 5 parallel queries so
  // the UI can render partially as each one resolves.
  const apolloStatus = useQuery({
    queryKey: ["oauth", "status", "apollo"],
    queryFn: () => getJson("/api/oauth/apollo/status", OAuthStatusSchema),
    retry: false
  });
  const surfeStatus = useQuery({
    queryKey: ["oauth", "status", "surfe"],
    queryFn: () => getJson("/api/oauth/surfe/status", OAuthStatusSchema),
    retry: false
  });
  const closelyStatus = useQuery({
    queryKey: ["oauth", "status", "closely"],
    queryFn: () => getJson("/api/oauth/closely/status", OAuthStatusSchema),
    retry: false
  });
  const webflowStatus = useQuery({
    queryKey: ["oauth", "status", "webflow"],
    queryFn: () => getJson("/api/oauth/webflow/status", OAuthStatusSchema),
    retry: false
  });
  const makeStatus = useQuery({
    queryKey: ["oauth", "status", "make"],
    queryFn: () => getJson("/api/oauth/make/status", OAuthStatusSchema),
    retry: false
  });

  const STATUS_BY_ID: Record<string, { data: OAuthStatus | undefined; isLoading: boolean }> = {
    apollo: { data: apolloStatus.data, isLoading: apolloStatus.isLoading },
    surfe: { data: surfeStatus.data, isLoading: surfeStatus.isLoading },
    closely: { data: closelyStatus.data, isLoading: closelyStatus.isLoading },
    webflow: { data: webflowStatus.data, isLoading: webflowStatus.isLoading },
    make: { data: makeStatus.data, isLoading: makeStatus.isLoading }
  };

  // Surface the callback's redirect status (the backend redirects
  // back to /app/smb-crm/integrations?status=connected on success
  // and ?status=error&detail=... on failure; if the user lands
  // here directly, we still pick up the params).
  useEffect(() => {
    if (search?.status === "connected") {
      setToast({ kind: "ok", text: `Connected: ${search.detail || "OAuth provider"}` });
    } else if (search?.status === "error") {
      setToast({ kind: "err", text: `OAuth error: ${search.detail || "unknown"}` });
    }
  }, [search?.status, search?.detail]);

  function refreshAll() {
    void qc.invalidateQueries({ queryKey: ["oauth", "status"] });
  }

  const disconnectMut = useMutation({
    mutationFn: async (provider: string) =>
      postJson(`/api/oauth/${provider}/disconnect`, {}, undefined),
    onSuccess: (_data, provider) => {
      setToast({ kind: "ok", text: `Disconnected: ${provider}` });
      refreshAll();
    },
    onError: (err: unknown) => {
      setToast({
        kind: "err",
        text: `Disconnect failed: ${(err && typeof err === "object" && "message" in err) ? String((err as { message?: unknown }).message) : "unknown"}`
      });
    }
  });

  const refreshMut = useMutation({
    mutationFn: async (provider: string) =>
      postJson(`/api/oauth/${provider}/refresh`, {}, undefined),
    onSuccess: (data: unknown, provider) => {
      const ok = data && typeof data === "object" && (data as { ok?: boolean }).ok === true;
      setToast({
        kind: ok ? "ok" : "err",
        text: ok
          ? `Refreshed: ${provider}`
          : `Refresh failed: ${(data as { reason?: string })?.reason || "unknown"}`
      });
      refreshAll();
    },
    onError: (err: unknown) => {
      setToast({
        kind: "err",
        text: `Refresh error: ${(err && typeof err === "object" && "message" in err) ? String((err as { message?: unknown }).message) : "unknown"}`
      });
    }
  });

  async function handleConnect(providerId: string) {
    try {
      const r = await postJson(
        `/api/oauth/${providerId}/connect`,
        {},
        OAuthConnectResponseSchema
      );
      // The provider's auth URL is on a different origin; a
      // full-page navigation is the simplest cross-origin
      // redirect. window.location.href replaces history.
      if (typeof window !== "undefined" && r?.url) {
        window.location.href = r.url;
      }
    } catch (err) {
      setToast({
        kind: "err",
        text: `Connect failed: ${(err && typeof err === "object" && "message" in err) ? String((err as { message?: unknown }).message) : "unknown"}`
      });
    }
  }

  const providers: OAuthProviderDescriptor[] = providersQ.data?.providers || [];

  return (
    <div
      className="mx-auto max-w-5xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-oauth-integrations"
    >
      <header className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]"
            data-testid="smb-crm-oauth-icon"
          >
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-oauth-h1"
            >
              OAuth integrations
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              5 sovereign sub-app connections · tokens are vault-sealed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
            data-testid="smb-crm-oauth-refresh-all"
            aria-label="Refresh all statuses"
          >
            <RefreshCw className="size-3.5" />
            Refresh all
          </button>
        </div>
      </header>

      {toast ? (
        <div
          role={toast.kind === "err" ? "alert" : "status"}
          data-testid={`smb-crm-oauth-toast-${toast.kind}`}
          className={cn(
            "flex items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-[var(--text-sm)]",
            toast.kind === "ok"
              ? "border-[var(--color-green,#15803d)] bg-[color-mix(in_srgb,var(--color-green,#15803d)_10%,transparent)] text-[var(--color-green,#15803d)]"
              : "border-[var(--color-ruby,#b23a48)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_10%,transparent)] text-[var(--color-ruby,#b23a48)]"
          )}
        >
          {toast.kind === "ok" ? (
            <CheckCircle2 className="size-4" aria-hidden />
          ) : (
            <AlertCircle className="size-4" aria-hidden />
          )}
          <span>{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-auto text-[var(--text-xs)] underline"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <ul
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        data-testid="smb-crm-oauth-cards"
      >
        {providers.length === 0 && providersQ.isLoading ? (
          <li className="text-[var(--text-sm)] text-[var(--color-muted)]" data-testid="smb-crm-oauth-loading">
            Loading providers…
          </li>
        ) : null}
        {providers.map((p) => {
          const slot = STATUS_BY_ID[p.id] || { data: NO_STATUS, isLoading: false };
          const status: OAuthStatus = slot.data || NO_STATUS;
          return (
            <li
              key={p.id}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
              data-provider-id={p.id}
              data-testid="smb-crm-oauth-card"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: PROVIDER_ACCENTS[p.id] }}
                    aria-hidden
                  />
                  <span
                    className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]"
                    data-testid="smb-crm-oauth-card-name"
                  >
                    {p.displayName}
                  </span>
                  {p.supportsPkce ? (
                    <span
                      className="rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--color-muted)]"
                      title="Uses PKCE — no static client secret"
                    >
                      PKCE
                    </span>
                  ) : null}
                </div>
                <ConnectionBadge status={status} isLoading={slot.isLoading} />
              </div>
              <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
                {PROVIDER_NOTES[p.id]}
              </p>
              {status.connected && status.expiresAt ? (
                <ExpiryLine expiresAt={status.expiresAt} />
              ) : null}
              <div className="flex flex-wrap items-center gap-1">
                {status.connected ? (
                  <>
                    <button
                      type="button"
                      onClick={() => refreshMut.mutate(p.id)}
                      disabled={refreshMut.isPending}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[11px] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
                      data-testid="smb-crm-oauth-refresh"
                      data-provider-id={p.id}
                    >
                      <RefreshCw className="size-3" /> Refresh now
                    </button>
                    <button
                      type="button"
                      onClick={() => disconnectMut.mutate(p.id)}
                      disabled={disconnectMut.isPending}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[11px] text-[var(--color-ruby,#b23a48)] hover:bg-[var(--color-surface-soft)] disabled:opacity-50"
                      data-testid="smb-crm-oauth-disconnect"
                      data-provider-id={p.id}
                    >
                      <Unplug className="size-3" /> Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleConnect(p.id)}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-brand)] px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
                    data-testid="smb-crm-oauth-connect"
                    data-provider-id={p.id}
                  >
                    <Plug className="size-3" /> Connect
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div>
        <Link
          to="/app/smb-crm/integrations"
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          data-testid="smb-crm-oauth-back"
        >
          <ChevronLeft className="size-3.5" />
          Back to integrations
        </Link>
      </div>
    </div>
  );
}

function ConnectionBadge({ status, isLoading }: { status: OAuthStatus; isLoading: boolean }) {
  if (isLoading) {
    return (
      <span
        className="rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-muted)]"
        data-testid="smb-crm-oauth-status-loading"
      >
        …
      </span>
    );
  }
  if (!status.connected) {
    const reason = status.reason ? `: ${status.reason}` : "";
    return (
      <span
        data-testid="smb-crm-oauth-status-disconnected"
        data-status="disconnected"
        className="rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-muted)]"
        title={`Not connected${reason}`}
      >
        Not connected
      </span>
    );
  }
  return (
    <span
      data-testid="smb-crm-oauth-status-connected"
      data-status="connected"
      className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-green,#15803d)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--color-green,#15803d)]"
    >
      <CheckCircle2 className="size-2.5" />
      Connected
    </span>
  );
}

function ExpiryLine({ expiresAt }: { expiresAt: string }) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms)) {
    return (
      <p className="text-[var(--text-xs)] text-[var(--color-muted)]" data-testid="smb-crm-oauth-expiry">
        Expires: {expiresAt}
      </p>
    );
  }
  const minutes = Math.round(ms / 60_000);
  const soon = ms < 5 * 60_000;
  const label =
    minutes < 0
      ? `Expired ${-minutes}m ago`
      : minutes < 60
        ? `Expires in ${minutes}m`
        : `Expires in ${Math.round(minutes / 60)}h`;
  return (
    <p
      data-testid="smb-crm-oauth-expiry"
      className={cn(
        "text-[var(--text-xs)]",
        soon
          ? "text-[var(--color-amber,#d97706)]"
          : "text-[var(--color-muted)]"
      )}
    >
      {label}
    </p>
  );
}
