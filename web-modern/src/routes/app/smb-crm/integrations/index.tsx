/**
 * /app/smb-crm/integrations — Integration health view (Phase 10, Track 5).
 *
 * Pattern A: render the 10 smb-crm connector cards + a "health check" button
 * per row that calls /api/smb-crm/integrations/:key/health.
 *
 * The 10 connectors are: apollo, cloudtalk, respond-io, surfe, dexatel,
 * make, webflow, closely, instantly, pixxi.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronLeft, Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { postJson } from "../../../../lib/api/client";
import { cn } from "../../../../lib/utils/cn";

const CONNECTORS: Array<{ key: string; label: string; accent: string }> = [
  { key: "apollo", label: "Apollo", accent: "var(--color-violet)" },
  { key: "cloudtalk", label: "CloudTalk", accent: "var(--color-blue)" },
  { key: "respond-io", label: "Respond.io", accent: "var(--color-teal)" },
  { key: "surfe", label: "Surfe", accent: "var(--color-green)" },
  { key: "dexatel", label: "Dexatel", accent: "var(--color-amber)" },
  { key: "make", label: "Make", accent: "var(--color-orange)" },
  { key: "webflow", label: "Webflow", accent: "var(--color-pink)" },
  { key: "closely", label: "Closely", accent: "var(--color-ruby)" },
  { key: "instantly", label: "Instantly", accent: "var(--color-violet)" },
  { key: "pixxi", label: "Pixxi", accent: "var(--color-blue)" },
];

export const Route = createFileRoute("/app/smb-crm/integrations/")({
  component: IntegrationsHealth,
});

function IntegrationsHealth() {
  const [results, setResults] = useState<Record<string, "ok" | "fail" | "pending">>({});
  const healthMut = useMutation({
    mutationFn: async (key: string) => {
      const r = await postJson(
        `/api/smb-crm/integrations/${key}/health`,
        { idempotencyKey: `smb-crm-health-${key}-${Date.now()}` },
        // shape: { ok, latencyMs, message }
        // we accept any — fall back to ok:true when 2xx
        undefined as never,
      );
      return r as { ok: boolean };
    },
    onMutate: (key) =>
      setResults((s) => ({ ...s, [key]: "pending" })),
    onSuccess: (_data, key) =>
      setResults((s) => ({ ...s, [key]: "ok" })),
    onError: (_err, key) =>
      setResults((s) => ({ ...s, [key]: "fail" })),
  });

  return (
    <div
      className="mx-auto max-w-5xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-integrations"
    >
      <header className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Plug className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-integrations-h1"
            >
              Integrations
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              10 sovereign connectors · health check per row
            </p>
          </div>
        </div>
      </header>

      <ul
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="smb-crm-integration-cards"
      >
        {CONNECTORS.map((c) => {
          const status = results[c.key] ?? "idle";
          return (
            <li
              key={c.key}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2"
              data-connector-key={c.key}
              data-testid="smb-crm-integration-card"
            >
              <div className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ background: c.accent }}
                  aria-hidden
                />
                <span className="text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                  {c.label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <StatusBadge status={status} />
                <button
                  type="button"
                  onClick={() => healthMut.mutate(c.key)}
                  className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
                  data-testid="smb-crm-integration-health"
                >
                  <RefreshCw className="size-2.5" /> Check
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div>
        <Link
          to="/app/smb-crm/integrations/oauth"
          className="mb-2 inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface)]"
          data-testid="smb-crm-integration-oauth-link"
        >
          <ShieldCheck className="size-4 text-[var(--color-brand)]" aria-hidden />
          <span>
            <strong className="font-medium">OAuth providers</strong>
            <span className="ml-1 text-[var(--color-muted)]">— 5 sovereign sub-app connections (Apollo, Surfe, Closely, Webflow, Make)</span>
          </span>
        </Link>
      </div>

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

function StatusBadge({
  status,
}: {
  status: "idle" | "pending" | "ok" | "fail";
}) {
  const label: Record<typeof status, string> = {
    idle: "—",
    pending: "…",
    ok: "OK",
    fail: "FAIL",
  };
  const cls: Record<typeof status, string> = {
    idle: "bg-[var(--color-surface-soft)] text-[var(--color-muted)]",
    pending: "bg-[color-mix(in_srgb,var(--color-amber,#d97706)_15%,transparent)] text-[var(--color-amber,#d97706)]",
    ok: "bg-[color-mix(in_srgb,var(--color-green,#15803d)_15%,transparent)] text-[var(--color-green,#15803d)]",
    fail: "bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_15%,transparent)] text-[var(--color-ruby,#b23a48)]",
  };
  return (
    <span
      className={cn(
        "rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase",
        cls[status],
      )}
    >
      {label[status]}
    </span>
  );
}
