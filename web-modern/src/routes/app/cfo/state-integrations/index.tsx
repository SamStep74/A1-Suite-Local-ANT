/**
 * /app/cfo/state-integrations — State Integrations hub (Pattern A).
 *
 * Mirrors the shape of /app/healthcheck (single-screen dispatch panel)
 * and the structure of /app/cabinet (subcomponents exported by name
 * so the co-located test can render them in isolation).
 *
 * Phase 8.8 surface (deliberately minimal — live e-gov sign / customs
 * flows land in 8.8b+):
 *   - Adapter select (6) → operation (derived) → JSON payload textarea
 *   - Dispatch                                        POST /api/state-int/:adapter/:operation
 *   - Audit list (auditor only)                      GET  /api/state-int/audit
 *
 * The "MODE: test" badge is hard-coded — every adapter stub returns a
 * deterministic envelope in test mode (no outbound calls to SRC,
 * e-Register, etc.). Inline-Armenian strings — no i18n framework yet,
 * matching the convention used by sibling routes.
 *
 * Public subcomponents are exported with `export function` (not
 * default exports) so the co-located test can import them by name
 * and exercise the pieces in isolation. This mirrors the cabinet
 * and healthcheck test extraction pattern.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronLeft, FileBadge2, Send, ShieldCheck } from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import { useUserAccess } from "../../../../lib/rbac/access";
import {
  StateIntAuditResponseSchema,
  StateIntDispatchRequestSchema,
  StateIntDispatchResponseSchema,
  type StateIntAdapterId,
  type StateIntAuditRow,
  type StateIntDispatchResponse,
  type StateIntOperation,
} from "../../../../lib/api/schemas";
import {
  STATE_INT_ADAPTERS,
  formatStateIntLatency,
  formatStateIntSignaturePreview,
  generateStateIntIdempotencyKey,
  isStateIntAuditorLike,
  stateIntAdapterLabelAm,
  stateIntDefaultPayloadFor,
  stateIntOperationFor,
  stateIntStatusLabelAm,
  tryParseStateIntPayload,
} from "../../../../lib/state-int/status";
// stateIntDefaultPayloadFor is exported for the co-located test to
// verify the dispatch prefilled payload matches the catalog default.

/* ────────── role gate (auditor-only audit panel) ────────── */

// TODO: read from useAuth() when the auth context is wired in 8.4.
// The test wraps the component in <UserAccessProvider value={{ cfo: false }}>
// to exercise the 403 branch, and toggles `viewerRole` via the
// vi.mocked `useCurrentRole` helper. For now the default role is
// "Owner" so the audit panel is visible by default — the server
// enforces the real RBAC.
const DEFAULT_VIEWER_ROLE: string | null = "Owner";

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/cfo/state-integrations/")({
  component: StateIntegrationsRoute,
});

/* ────────── subcomponent: dispatch form ────────── */

export function DispatchForm({
  adapterId,
  onAdapterChange,
  onSubmit,
  isPending,
  error,
}: {
  adapterId: StateIntAdapterId;
  onAdapterChange: (next: StateIntAdapterId) => void;
  onSubmit: (input: { payloadJson: string }) => void;
  isPending: boolean;
  error: string;
}) {
  const [operation, setOperation] = useState<StateIntOperation>(stateIntOperationFor(adapterId));
  const [payloadText, setPayloadText] = useState<string>(stateIntDefaultPayloadFor(adapterId));

  // When the adapter changes, reset operation + payload — the legacy
  // panel does the same in its useEffect on adapterId.
  useEffect(() => {
    setOperation(stateIntOperationFor(adapterId));
    setPayloadText(stateIntDefaultPayloadFor(adapterId));
  }, [adapterId]);

  return (
    <form
      data-testid="state-int-dispatch-form"
      data-entity="state-int-dispatch"
      className="panel space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ payloadJson: payloadText });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Ադապտեր / Adapter</span>
          <select
            data-testid="state-int-adapter-select"
            aria-label="Adapter"
            value={adapterId}
            onChange={(e) => onAdapterChange(e.target.value as StateIntAdapterId)}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            {STATE_INT_ADAPTERS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.labelAm}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Գործողություն / Operation</span>
          <select
            data-testid="state-int-operation-select"
            aria-label="Operation"
            value={operation}
            onChange={(e) => setOperation(e.target.value as StateIntOperation)}
            className="rounded-[var(--radius-md)] border border-[var(--radius-line,var(--color-line))] border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          >
            <option value={operation}>{operation}</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">JSON մուտքագրվող / Payload</span>
        <textarea
          data-testid="state-int-payload-textarea"
          aria-label="JSON payload"
          rows={8}
          spellCheck={false}
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-[var(--text-sm)] text-[var(--color-ink)]"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          data-testid="state-int-dispatch-button"
          data-entity="state-int-dispatch-submit"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send className="size-3.5" />
          {isPending ? "Ուղարկվում է…" : "Ուղարկել / Dispatch"}
        </button>
        {error && (
          <span
            data-testid="state-int-error"
            data-entity="state-int-dispatch-error"
            role="alert"
            className="action-status"
          >
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

/* ────────── subcomponent: last result ────────── */

export function ResultCard({ result }: { result: StateIntDispatchResponse | null }) {
  if (!result) return null;
  return (
    <article
      data-testid="state-int-result"
      data-entity="state-int-result"
      className="panel space-y-1.5 text-[var(--text-sm)]"
    >
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Վերջին արդյունք · Last result
      </h3>
      <p>
        <span className="text-[var(--color-muted)]">requestId</span>{" "}
        <code className="font-mono">{result.requestId}</code>
      </p>
      <p>
        <span className="text-[var(--color-muted)]">status</span>{" "}
        <strong>{stateIntStatusLabelAm(result.status)}</strong>
      </p>
      {result.providerRef && (
        <p>
          <span className="text-[var(--color-muted)]">providerRef</span>{" "}
          <code className="font-mono">{result.providerRef}</code>
        </p>
      )}
      {result.signatureB64 && (
        <p>
          <span className="text-[var(--color-muted)]">signature</span>{" "}
          <code className="font-mono">{formatStateIntSignaturePreview(result.signatureB64)}</code>
        </p>
      )}
      {result.certificateThumbprint && (
        <p>
          <span className="text-[var(--color-muted)]">thumbprint</span>{" "}
          <code className="font-mono">{result.certificateThumbprint}</code>
        </p>
      )}
      {result.advisoryOnly && (
        <p
          data-testid="state-int-advisory"
          data-entity="state-int-advisory"
          className="text-[var(--text-xs)] text-[var(--color-tag-orange)]"
        >
          ⚠ advisoryOnly: true · ստուգումը պետք է հաստատվի production միացմամբ
        </p>
      )}
    </article>
  );
}

/* ────────── subcomponent: audit panel ────────── */

export function AuditPanel({
  rows,
  loading,
  error,
  onRefresh,
}: {
  rows: ReadonlyArray<StateIntAuditRow>;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  return (
    <article
      data-testid="state-int-audit"
      data-entity="state-int-audit"
      className="panel space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          <ShieldCheck className="size-3.5" />
          Audit · Վերջին 200 կանչերը
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          data-testid="state-int-audit-refresh"
          data-entity="state-int-audit-refresh"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-line)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Բեռնվում է…" : "Թարմացնել audit"}
        </button>
      </div>
      {error && (
        <p role="alert" className="action-status">
          {error}
        </p>
      )}
      {rows.length === 0 && !loading ? (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Կանչեր դեռ չկան · No calls yet
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="state-int-audit-row"
              data-entity="state-int-audit-row"
              data-audit-id={row.id}
              className="py-1.5 text-[var(--text-sm)]"
            >
              <code className="font-mono text-[var(--color-muted)]">{row.called_at}</code>{" "}
              · <strong>{row.adapter}/{row.operation}</strong> ·{" "}
              {stateIntStatusLabelAm(row.status)} ·{" "}
              <span className="text-[var(--color-muted)]">
                {formatStateIntLatency(row.latency_ms)}
              </span>{" "}
              · <span className="font-mono text-[var(--color-muted)]">{row.request_id}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/* ────────── subcomponent: 403 panel ────────── */

function ForbiddenPanel() {
  return (
    <div
      data-testid="state-int-forbidden"
      data-entity="state-int-forbidden"
      className="panel text-center"
    >
      <p className="text-[var(--text-sm)] text-[var(--color-tag-red)]">
        403 · Մուտքը սահմանափակված է · CFO access required
      </p>
    </div>
  );
}

/* ────────── root route ────────── */

function StateIntegrationsRoute() {
  const hasAccess = useUserAccess("cfo");
  const qc = useQueryClient();

  // Adapter id drives the dispatch UI. Default to the first descriptor
  // (src) so the textarea has a realistic payload on first paint.
  const [adapterId, setAdapterId] = useState<StateIntAdapterId>(
    STATE_INT_ADAPTERS[0].id,
  );
  const [lastResult, setLastResult] = useState<StateIntDispatchResponse | null>(null);
  const [parseError, setParseError] = useState<string>("");
  const [dispatchError, setDispatchError] = useState<string>("");

  // The role determines whether the audit panel renders. The legacy
  // panel takes `role` as a prop; we mirror that with a local constant
  // because auth is not yet wired (8.4). The co-located test asserts
  // the panel's visibility for Owner/Admin/Auditor (true) and for
  // everything else (false).
  const viewerRole: string | null = DEFAULT_VIEWER_ROLE;
  const isAuditor = isStateIntAuditorLike(viewerRole);

  const operation = stateIntOperationFor(adapterId);

  const dispatchMut = useMutation({
    mutationFn: async (input: { payloadJson: string }) => {
      setParseError("");
      setDispatchError("");
      const parsed = tryParseStateIntPayload(input.payloadJson);
      if (!parsed.ok) {
        setParseError(parsed.error);
        throw new Error(parsed.error);
      }
      const idempotencyKey = generateStateIntIdempotencyKey(adapterId, operation);
      // Pre-validate with the same Zod schema the server uses; the
      // server uses .passthrough() so per-adapter fields pass through.
      const request = StateIntDispatchRequestSchema.parse({
        ...(parsed.parsed as Record<string, unknown>),
        idempotencyKey,
      });
      const res = await postJson(
        `/api/state-int/${adapterId}/${operation}`,
        request,
        StateIntDispatchResponseSchema,
      );
      return res;
    },
    onSuccess: (data) => {
      setLastResult(data);
      if (isAuditor) {
        void qc.invalidateQueries({ queryKey: ["state-int", "audit"] });
      }
    },
    onError: (err: Error) => {
      // Parse errors short-circuit the request — surface them in the
      // form (data-testid="state-int-error") instead of the result card.
      if (!parseError) {
        setDispatchError(err.message);
      }
    },
  });

  // Audit query — only enabled for auditor-like roles. The backend
  // also gates this; the UI just hides the panel for non-auditors.
  const auditQ = useQuery({
    queryKey: ["state-int", "audit"],
    enabled: isAuditor,
    queryFn: async () => {
      const res = await getJson("/api/state-int/audit", StateIntAuditResponseSchema);
      return res.audit;
    },
  });

  const auditRows = useMemo(
    () => (auditQ.data ?? []).slice(0, 200),
    [auditQ.data],
  );

  if (!hasAccess) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="state-int-panel"
        data-entity="state-int"
      >
        <header className="space-y-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            <Building2 className="size-3" />
            CFO · State integrations
          </span>
          <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
            Կառավարության ինտեգրացիաներ
          </h1>
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">State integrations hub</p>
        </header>
        <ForbiddenPanel />
        <div>
          <Link
            to="/app/cfo"
            search={{ view: "cash-flow" }}
            className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <ChevronLeft className="size-3.5" />
            back to CFO
          </Link>
        </div>
      </div>
    );
  }

  const adapterLabelAm = stateIntAdapterLabelAm(adapterId);
  const auditErrorMessage =
    auditQ.error instanceof Error
      ? auditQ.error.message
      : auditQ.error
        ? "audit չհաջողվեց"
        : "";

  return (
    <div
      className="mx-auto max-w-5xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="state-int-panel"
      data-entity="state-int"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Building2 className="size-3" />
          CFO · State integrations
        </span>
        <h1
          data-testid="state-int-title"
          className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
        >
          Կառավարության ինտեգրացիաներ
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">State integrations hub</p>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          <span
            data-testid="state-int-mode-badge"
            data-entity="state-int-mode"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-[var(--color-tag-blue)]"
          >
            <FileBadge2 className="size-3" />
            MODE: test
          </span>
          {" "}
          · {STATE_INT_ADAPTERS.length} ադապտեր · test ռեժիմում ոչ մի կոչ չի դուրս գալիս դեպի պետական համակարգեր
          {" "}· ընթացիկ ադապտեր՝ {adapterLabelAm}
        </p>
      </header>

      <DispatchForm
        adapterId={adapterId}
        onAdapterChange={setAdapterId}
        onSubmit={(input) => dispatchMut.mutate(input)}
        isPending={dispatchMut.isPending}
        error={parseError || dispatchError}
      />

      <ResultCard result={lastResult} />

      {isAuditor && (
        <AuditPanel
          rows={auditRows}
          loading={auditQ.isFetching}
          error={auditErrorMessage}
          onRefresh={() => void auditQ.refetch()}
        />
      )}

      <div>
        <Link
          to="/app/cfo"
          search={{ view: "cash-flow" }}
          data-testid="state-int-back"
          className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          back to CFO
        </Link>
      </div>
    </div>
  );
}
