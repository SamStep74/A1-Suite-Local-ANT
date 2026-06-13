/**
 * /app/smb-crm/customers/$customerId — Customer detail (Phase 10, Track 5).
 *
 * Pattern A: reads /api/smb-crm/customers/:id, /api/smb-crm/deals,
 * /api/smb-crm/activities, plus the assist customer-summary route
 * (smb_crm.customer.summary). All read-only on this page.
 */
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Mail,
  Phone,
  Sparkles,
    Users,
} from "lucide-react";
import { getJson } from "../../../../lib/api/client";
import {
  SmbCrmCustomerSummaryResponseSchema,
  SmbCrmGetCustomerResponseSchema,
  SmbCrmListActivitiesResponseSchema,
  SmbCrmListDealsResponseSchema,
} from "../../../../lib/api/schemas";

export const Route = createFileRoute("/app/smb-crm/customers/$customerId")({
  component: CustomerDetail,
});

function CustomerDetail() {
  const { customerId } = useParams({ from: Route.fullPath }) as {
    customerId: string;
  };

  const cQ = useQuery({
    queryKey: ["smb-crm-customer", customerId],
    queryFn: () =>
      getJson(
        `/api/smb-crm/customers/${customerId}`,
        SmbCrmGetCustomerResponseSchema,
      ),
    enabled: !!customerId,
  });

  const dealsQ = useQuery({
    queryKey: ["smb-crm-customer-deals", customerId],
    queryFn: () =>
      getJson(
        `/api/smb-crm/deals?customerId=${encodeURIComponent(customerId)}`,
        SmbCrmListDealsResponseSchema,
      ),
    enabled: !!customerId,
  });

  const actsQ = useQuery({
    queryKey: ["smb-crm-customer-acts", customerId],
    queryFn: () =>
      getJson(
        `/api/smb-crm/activities?customerId=${encodeURIComponent(customerId)}`,
        SmbCrmListActivitiesResponseSchema,
      ),
    enabled: !!customerId,
  });

  const summaryQ = useQuery({
    queryKey: ["smb-crm-customer-summary", customerId],
    queryFn: () =>
      getJson(
        `/api/smb-crm/assist/customer-summary`,
        SmbCrmCustomerSummaryResponseSchema,
      ),
    enabled: !!customerId,
  });

  const c = cQ.data?.customer;
  const deals = dealsQ.data?.deals ?? [];
  const activities = actsQ.data?.activities ?? [];

  return (
    <div
      className="mx-auto max-w-4xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-customer-detail"
      data-customer-id={customerId}
    >
      <header className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
            <Users className="size-5" aria-hidden />
          </span>
          <div>
            <h1
              className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
              data-testid="smb-crm-customer-detail-h1"
            >
              {c?.fullName ?? "Customer"}
            </h1>
            <p className="flex items-center gap-2 text-[var(--text-sm)] text-[var(--color-muted)]">
              {c?.email && (
                <span
                  className="flex items-center gap-0.5"
                  data-testid="smb-crm-customer-detail-email"
                >
                  <Mail className="size-3" aria-hidden /> {c.email}
                </span>
              )}
              {c?.phone && (
                <span className="flex items-center gap-0.5">
                  <Phone className="size-3" aria-hidden /> {c.phone}
                </span>
              )}
            </p>
          </div>
        </div>
      </header>

      {cQ.isError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load customer.
        </p>
      ) : !c ? (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading…
        </p>
      ) : (
        <>
          <SummaryCard
            loading={summaryQ.isLoading}
            text={summaryQ.data?.summaryText ?? null}
          />
          <Section title={`Deals (${deals.length})`}>
            {deals.length === 0 ? (
              <p className="text-[11px] text-[var(--color-muted)]">No deals yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]" data-testid="smb-crm-customer-deals">
                {deals.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between py-1 text-[var(--text-sm)]"
                    data-deal-id={d.id}
                  >
                    <span className="text-[var(--color-ink)]">{d.title}</span>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
                      {formatArm(d.value, d.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={`Activities (${activities.length})`}>
            {activities.length === 0 ? (
              <p className="text-[11px] text-[var(--color-muted)]">No activity.</p>
            ) : (
              <ol
                className="space-y-1.5"
                data-testid="smb-crm-customer-activities"
              >
                {activities.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-2 text-[11px]"
                    data-activity-id={a.id}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold uppercase text-[var(--color-muted)]">
                        {a.type}
                      </span>
                      <span className="text-[var(--color-muted)]">
                        {a.activityAt?.slice(0, 10)}
                      </span>
                    </div>
                    {a.subject && (
                      <p className="mt-0.5 text-[var(--color-ink)]">{a.subject}</p>
                    )}
                    {a.body && (
                      <p className="text-[var(--color-muted)]">{a.body}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}

      <div>
        <Link
          to="/app/smb-crm/customers"
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" />
          Back to customers
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="smb-crm-customer-section"
    >
      <h2 className="mb-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SummaryCard({ loading, text }: { loading: boolean; text: string | null }) {
  return (
    <section
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="smb-crm-customer-summary"
    >
      <h2 className="mb-1 flex items-center gap-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        <Sparkles className="size-3.5" aria-hidden /> Customer summary
      </h2>
      {loading ? (
        <p className="text-[11px] text-[var(--color-muted)]">Generating…</p>
      ) : text ? (
        <p className="text-[var(--text-sm)] text-[var(--color-ink)]">{text}</p>
      ) : (
        <p className="text-[11px] text-[var(--color-muted)]">
          Click to generate an AI summary.
        </p>
      )}
    </section>
  );
}

function formatArm(value: number, currency: string): string {
  if (currency === "AMD") {
    const v = Math.round(Number(value) || 0).toLocaleString("en-US");
    return `${v} AMD`;
  }
  return `${Math.round(Number(value) || 0).toLocaleString("en-US")} ${currency}`;
}
