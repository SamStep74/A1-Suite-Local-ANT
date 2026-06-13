/**
 * /app/smb-crm/automations — Automation list + run log (Phase 10, Track 5).
 *
 * Pattern A: read /api/smb-crm/automations + /api/smb-crm/automation-runs.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Play, Workflow } from "lucide-react";
import { getJson } from "../../../../lib/api/client";
import {
  SmbCrmAutomationListResponseSchema,
  SmbCrmAutomationRunListResponseSchema,
} from "../../../../lib/api/schemas";

export const Route = createFileRoute("/app/smb-crm/automations/")({
  component: AutomationsList,
});

function AutomationsList() {
  const aQ = useQuery({
    queryKey: ["smb-crm-automations"],
    queryFn: () =>
      getJson("/api/smb-crm/automations", SmbCrmAutomationListResponseSchema),
    staleTime: 30_000,
  });
  const rQ = useQuery({
    queryKey: ["smb-crm-automation-runs"],
    queryFn: () =>
      getJson(
        "/api/smb-crm/automation-runs",
        SmbCrmAutomationRunListResponseSchema,
      ),
    staleTime: 15_000,
  });

  const automations = aQ.data?.automations ?? [];
  const runs = rQ.data?.automationRuns ?? [];

  return (
    <div
      className="mx-auto max-w-5xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-automations"
    >
      <header className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Workflow className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-automations-h1"
            >
              Automations
            </h1>
            <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
              Triggers · actions · run log
            </p>
          </div>
        </div>
      </header>

      {aQ.isError || rQ.isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load automations.
        </p>
      ) : null}

      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        data-testid="smb-crm-automations-list"
      >
        <h2 className="mb-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Active ({automations.length})
        </h2>
        {automations.length === 0 ? (
          <p className="text-[11px] text-[var(--color-muted)]">No automations configured.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {automations.map((a: { id: string; name: string; triggerEvent: string; action: string; enabled: boolean }) => (
              <li
                key={a.id}
                className="flex items-center justify-between py-1.5 text-[var(--text-sm)]"
                data-automation-id={a.id}
              >
                <div>
                  <p className="font-medium text-[var(--color-ink)]">{a.name}</p>
                  <p className="text-[10px] text-[var(--color-muted)]">
                    {a.triggerEvent} → {a.action}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
                  data-testid="smb-crm-automation-run"
                  data-run-for={a.id}
                >
                  <Play className="size-2.5" /> Run
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
        data-testid="smb-crm-automations-runs"
      >
        <h2 className="mb-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Run log ({runs.length})
        </h2>
        {runs.length === 0 ? (
          <p className="text-[11px] text-[var(--color-muted)]">No runs yet.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-1 py-0.5">Automation</th>
                <th className="px-1 py-0.5">Status</th>
                <th className="px-1 py-0.5">When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r: { id: string; automationId: string | null; status: string; startedAt: string }) => (
                <tr key={r.id} data-run-id={r.id}>
                  <td className="px-1 py-0.5 text-[var(--color-ink)]">{r.automationId}</td>
                  <td className="px-1 py-0.5 text-[var(--color-muted)]">{r.status}</td>
                  <td className="px-1 py-0.5 text-[var(--color-muted)]">
                    {r.startedAt?.slice(0, 19).replace("T", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
