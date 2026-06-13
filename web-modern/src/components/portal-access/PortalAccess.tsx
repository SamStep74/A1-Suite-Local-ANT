/**
 * PortalAccess — Customer portal access view (Phase 10, Track 5).
 *
 * Lets a customer connect their portal to a tenant subdomain. Renders a
 * single read-only form: pick tenant → pick branch → see the portal
 * subdomain + a magic-link request button.
 *
 * Armenian strings are inlined as `__ARM_*` placeholders.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { getJson, postJson } from "../../lib/api/client";
import {
  SmbCrmCurrentTenantResponseSchema,
  SmbCrmListTenantsResponseSchema,
  type SmbCrmTenant,
} from "../../lib/api/schemas";
import { cn } from "../../lib/utils/cn";

const ARM_TITLE = "Հաճախորդի պորտալ";
const ARM_SUBTITLE = "Կապեք ձեր պորտալը ընտրված tenant-ին";
const ARM_PICK = "Ընտրել tenant";
const ARM_REQUEST = "Ուղարկել մուտքի հղում";
const ARM_SENT = "Հղումն ուղարկված է";

export interface PortalAccessProps {
  customerEmail?: string;
  onPortalSelected?: (portalUrl: string) => void;
}

export function PortalAccess({
  customerEmail,
  onPortalSelected,
}: PortalAccessProps) {
  const [tenantId, setTenantId] = useState<string>("");

  const tenantsQ = useQuery({
    queryKey: ["smb-crm-portal-tenants"],
    queryFn: () =>
      getJson("/api/smb-crm/tenants", SmbCrmListTenantsResponseSchema),
    staleTime: 5 * 60_000,
  });

  const currentQ = useQuery({
    queryKey: ["smb-crm-portal-current", tenantId],
    queryFn: () =>
      getJson(
        `/api/smb-crm/tenants/current${tenantId ? `?slug=${encodeURIComponent(tenantId)}` : ""}`,
        SmbCrmCurrentTenantResponseSchema,
      ),
    enabled: !!tenantId,
  });

  const requestMut = useMutation({
    mutationFn: () =>
      postJson(
        "/api/smb-crm/portal/magic-link",
        {
          idempotencyKey: `smb-crm-portal-${Date.now()}`,
          tenantId,
          email: customerEmail,
        },
        // shape: { ok, sentAt }
        undefined as never,
      ),
  });

  const tenants: SmbCrmTenant[] = tenantsQ.data?.tenants ?? [];
  const selected = tenants.find((t) => t.id === tenantId) ?? null;
  const portalUrl = selected
    ? `https://${selected.slug}.armosphera.com`
    : null;

  return (
    <section
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
      data-testid="smb-crm-portal-access"
    >
      <header className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
          <KeyRound className="size-4" aria-hidden />
        </span>
        <div>
          <h3
            className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]"
            data-testid="smb-crm-portal-h3"
          >
            {ARM_TITLE}
          </h3>
          <p className="text-[11px] text-[var(--color-muted)]">
            {ARM_SUBTITLE}
          </p>
        </div>
      </header>

      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">{ARM_PICK}</span>
        <select
          value={tenantId}
          onChange={(e) => {
            setTenantId(e.target.value);
            onPortalSelected?.(
              e.target.value
                ? `https://${tenants.find((t) => t.id === e.target.value)?.slug}.armosphera.com`
                : "",
            );
          }}
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          data-testid="smb-crm-portal-tenant-select"
        >
          <option value="">—</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.companyName} ({t.slug})
            </option>
          ))}
        </select>
      </label>

      {portalUrl && (
        <a
          href={portalUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
          data-testid="smb-crm-portal-link"
        >
          <ExternalLink className="size-3" aria-hidden /> {portalUrl}
        </a>
      )}

      {currentQ.data?.tenant && (
        <div
          className={cn(
            "rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] p-2 text-[11px] text-[var(--color-ink)]",
          )}
          data-testid="smb-crm-portal-branches"
        >
          <p className="flex items-center gap-1 font-semibold">
            <Building2 className="size-3" aria-hidden />{" "}
            {currentQ.data.tenant.companyName} · {currentQ.data.branches.length}{" "}
            branch(es)
          </p>
          <ul className="mt-1 list-disc pl-4 text-[var(--color-muted)]">
            {currentQ.data.branches.map((b) => (
              <li key={b.id}>{b.name}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => requestMut.mutate()}
        disabled={!tenantId || requestMut.isPending || !!requestMut.data}
        className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
        data-testid="smb-crm-portal-request"
      >
        {requestMut.isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : requestMut.data ? (
          ARM_SENT
        ) : (
          ARM_REQUEST
        )}
      </button>
    </section>
  );
}

export default PortalAccess;
