/**
 * /app/smb-crm/quote-templates — Armenian SMB quote template
 * library (Phase 10.13 / slice 13).
 *
 * Lists the 4 built-in templates + the org's custom ones.
 * Pick one, fill in quantity / unit price for each line, hit
 * "Create quote" → server creates the quote and returns the
 * id → we redirect to the new quote's printable PDF.
 *
 * Why a page (not a sidebar on /app/smb-crm):
 *   - Template selection is a "cold start" flow — the SMB
 *     opens a new deal, picks a template, and produces a
 *     quote. It doesn't belong in the wizard.
 *   - The form needs to be wide (line items + overrides) and
 *     the result needs a clear "go to PDF" CTA.
 *   - It's the entry point for the /api/smb-crm/quotes/:id.pdf
 *     route (slice 10) — the SPA wires the two together.
 *
 * What this page guarantees:
 *   - Server-recomputed totals: the page shows the local
 *     `quantity * unitPrice` as a preview, but the persisted
 *     total comes from the server. The page re-renders the
 *     server's authoritative total after creation.
 *   - Positional overrides: if a template has 3 line items,
 *     the override array MUST have exactly 3 entries
 *     (missing fields fall back to the template default).
 *   - No Armenian garbling: the input fields accept UTF-8
 *     directly; the server persists the line items as JSON
 *     with the original Armenian preserved.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ListChecks, Send } from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  QuoteTemplateListResponseSchema,
  QuoteFromTemplateRequestSchema,
  QuoteFromTemplateResponseSchema,
  type QuoteTemplate,
  type QuoteFromTemplateRequest,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

export const Route = createFileRoute("/app/smb-crm/quote-templates/")({
  component: QuoteTemplatesPage,
});

function QuoteTemplatesPage() {
  const templatesQ = useQuery({
    queryKey: ["smb-crm-quote-templates"],
    queryFn: () => getJson("/api/smb-crm/quote-templates", QuoteTemplateListResponseSchema),
    staleTime: 5 * 60_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [number, setNumber] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [currency, setCurrency] = useState<string>("AMD");
  // overrides is keyed by template line index. State is the
  // raw form values; the server re-derives the canonical
  // line item shape on submit.
  const [overrides, setOverrides] = useState<Array<{ quantity: number; unitPrice: number }>>([]);

  const selected = useMemo<QuoteTemplate | undefined>(
    () => templatesQ.data?.templates.find((t) => t.id === selectedId),
    [templatesQ.data, selectedId]
  );

  // When the user picks a template, seed the override array to
  // the template's defaults (length matched).
  useEffect(() => {
    if (selected) {
      setOverrides(
        selected.lineItems.map((it) => ({
          quantity: it.quantity || 1,
          unitPrice: it.unitPrice || 0
        }))
      );
    } else {
      setOverrides([]);
    }
  }, [selected]);

  // Live preview total (matches what the server will compute).
  const previewTotal = useMemo(
    () => overrides.reduce((acc, ov) => acc + (Number(ov.quantity) || 0) * (Number(ov.unitPrice) || 0), 0),
    [overrides]
  );

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("no template selected");
      // Validate via Zod (server does the same).
      const req: QuoteFromTemplateRequest = QuoteFromTemplateRequestSchema.parse({
        templateId: selected.id,
        number,
        customerId: customerId || undefined,
        issueDate: issueDate || undefined,
        expiryDate: expiryDate || undefined,
        currency,
        overrides: overrides.map((ov) => ({
          quantity: Number(ov.quantity) || 0,
          unitPrice: Number(ov.unitPrice) || 0
        })),
        idempotencyKey: `qt-${selected.id}-${number}-${Date.now()}`
      });
      return postJson(
        "/api/smb-crm/quotes/from-template",
        req,
        QuoteFromTemplateResponseSchema
      );
    },
    onSuccess: (resp) => {
      if (resp.ok && resp.quote?.id) {
        // The PDF is served by Fastify at /api/smb-crm/quotes/:id.pdf
        // (slice 10). Open it in a new tab so the SPA stays
        // mounted. The PDF route sets Content-Disposition: inline
        // so the browser opens the PDF in its built-in viewer.
        window.open(`/api/smb-crm/quotes/${resp.quote.id}.pdf`, "_blank");
      }
    }
  });

  const canCreate = Boolean(selected) && number.trim().length > 0 && !createMut.isPending;

  return (
    <div
      className="mx-auto max-w-4xl space-y-4 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="smb-crm-quote-templates"
    >
      <Header />

      {templatesQ.isError && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
        >
          Could not load quote templates.
        </p>
      )}

      <TemplateList
        templates={templatesQ.data?.templates ?? []}
        isLoading={templatesQ.isLoading}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
      />

      {selected && (
        <>
          <MetadataEditor
            number={number}
            onNumberChange={setNumber}
            customerId={customerId}
            onCustomerIdChange={setCustomerId}
            issueDate={issueDate}
            onIssueDateChange={setIssueDate}
            expiryDate={expiryDate}
            onExpiryDateChange={setExpiryDate}
            currency={currency}
            onCurrencyChange={setCurrency}
          />

          <LineItemEditor
            template={selected}
            overrides={overrides}
            onChange={setOverrides}
            previewTotal={previewTotal}
            currency={currency}
          />

          <CreateBar
            canCreate={canCreate}
            isPending={createMut.isPending}
            error={createMut.error?.message}
            onCreate={() => createMut.mutate()}
          />
        </>
      )}

      <BackLink />
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-end justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
          <ListChecks className="size-5" aria-hidden />
        </span>
        <div>
          <h1
            className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]"
            data-testid="smb-crm-quote-templates-h1"
          >
            Quote templates
          </h1>
          <p
            className="text-[var(--text-sm)] text-[var(--color-muted)]"
            data-testid="smb-crm-quote-templates-subtitle"
          >
            {ARM_SUBTITLE}
          </p>
        </div>
      </div>
    </header>
  );
}

const ARM_SUBTITLE = "Pick a template, fill qty + price, generate a printable PDF.";

function TemplateList({
  templates,
  isLoading,
  selectedId,
  onSelect,
}: {
  templates: ReadonlyArray<QuoteTemplate>;
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <p
        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3 text-[var(--text-sm)] text-[var(--color-muted)]"
        data-testid="smb-crm-quote-templates-loading"
      >
        Loading templates…
      </p>
    );
  }
  if (templates.length === 0) {
    return (
      <p
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
        data-testid="smb-crm-quote-templates-empty"
      >
        No templates available.
      </p>
    );
  }
  return (
    <ul
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      data-testid="smb-crm-quote-template-list"
    >
      {templates.map((t) => {
        const active = t.id === selectedId;
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-3 text-left text-[var(--text-sm)]",
                active
                  ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]"
                  : "border-[var(--color-line)] hover:border-[var(--color-brand)]"
              )}
              data-testid="smb-crm-quote-template-card"
              data-template-id={t.id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--color-ink)]">
                  {t.name}
                </span>
                {t.builtin && (
                  <span
                    className="rounded-[var(--radius-pill)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
                    data-testid="smb-crm-quote-template-builtin"
                  >
                    built-in
                  </span>
                )}
              </div>
              {t.description && (
                <span className="text-[11px] text-[var(--color-muted)]">
                  {t.description}
                </span>
              )}
              <span className="text-[10px] text-[var(--color-muted)]">
                {t.lineItems.length} line item{t.lineItems.length === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MetadataEditor({
  number,
  onNumberChange,
  customerId,
  onCustomerIdChange,
  issueDate,
  onIssueDateChange,
  expiryDate,
  onExpiryDateChange,
  currency,
  onCurrencyChange,
}: {
  number: string;
  onNumberChange: (v: string) => void;
  customerId: string;
  onCustomerIdChange: (v: string) => void;
  issueDate: string;
  onIssueDateChange: (v: string) => void;
  expiryDate: string;
  onExpiryDateChange: (v: string) => void;
  currency: string;
  onCurrencyChange: (v: string) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      data-testid="smb-crm-quote-template-meta"
    >
      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Quote number</span>
        <input
          type="text"
          value={number}
          onChange={(e) => onNumberChange(e.target.value)}
          required
          placeholder="Q-2026-0001"
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono text-[var(--text-sm)]"
          data-testid="smb-crm-quote-template-number"
        />
      </label>
      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Customer ID (optional)</span>
        <input
          type="text"
          value={customerId}
          onChange={(e) => onCustomerIdChange(e.target.value)}
          placeholder="cust-…"
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          data-testid="smb-crm-quote-template-customer"
        />
      </label>
      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Issue date</span>
        <input
          type="date"
          value={issueDate}
          onChange={(e) => onIssueDateChange(e.target.value)}
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          data-testid="smb-crm-quote-template-issue-date"
        />
      </label>
      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Valid until (optional)</span>
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => onExpiryDateChange(e.target.value)}
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          data-testid="smb-crm-quote-template-expiry-date"
        />
      </label>
      <label className="block text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Currency</span>
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[var(--text-sm)]"
          data-testid="smb-crm-quote-template-currency"
        >
          <option value="AMD">AMD</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="RUB">RUB</option>
        </select>
      </label>
    </div>
  );
}

function LineItemEditor({
  template,
  overrides,
  onChange,
  previewTotal,
  currency,
}: {
  template: QuoteTemplate;
  overrides: Array<{ quantity: number; unitPrice: number }>;
  onChange: (rows: Array<{ quantity: number; unitPrice: number }>) => void;
  previewTotal: number;
  currency: string;
}) {
  const updateRow = (idx: number, patch: Partial<{ quantity: number; unitPrice: number }>) => {
    onChange(overrides.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <div
      className="space-y-2"
      data-testid="smb-crm-quote-template-lines"
    >
      <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        {template.name} · {template.lineItems.length} line item{template.lineItems.length === 1 ? "" : "s"}
      </h2>
      <ol className="space-y-2">
        {template.lineItems.map((it, idx) => {
          const ov = overrides[idx] || { quantity: 0, unitPrice: 0 };
          const lineTotal = (Number(ov.quantity) || 0) * (Number(ov.unitPrice) || 0);
          return (
            <li
              key={idx}
              className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2"
              data-testid="smb-crm-quote-template-line"
              data-line-index={idx}
            >
              <div className="flex items-center justify-between gap-2 text-[var(--text-sm)]">
                <span className="font-medium text-[var(--color-ink)]">{it.name}</span>
                {it.description && (
                  <span className="text-[11px] text-[var(--color-muted)]">
                    {it.description}
                  </span>
                )}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[var(--text-sm)]">
                <label className="block">
                  <span className="text-[10px] text-[var(--color-muted)]">Quantity</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={ov.quantity}
                    onChange={(e) => updateRow(idx, { quantity: Number(e.target.value) || 0 })}
                    className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono"
                    data-testid="smb-crm-quote-template-qty"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-[var(--color-muted)]">Unit price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ov.unitPrice}
                    onChange={(e) => updateRow(idx, { unitPrice: Number(e.target.value) || 0 })}
                    className="mt-0.5 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono"
                    data-testid="smb-crm-quote-template-price"
                  />
                </label>
                <div className="text-right">
                  <span className="text-[10px] text-[var(--color-muted)]">Line total</span>
                  <p
                    className="mt-0.5 font-mono text-[var(--text-sm)]"
                    data-testid="smb-crm-quote-template-line-total"
                  >
                    {lineTotal.toFixed(2)} {currency}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div
        className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
        data-testid="smb-crm-quote-template-total"
      >
        <span className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Preview total
        </span>
        <span className="font-mono text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          {previewTotal.toFixed(2)} {currency}
        </span>
      </div>
      <p
        className="text-[10px] text-[var(--color-muted)]"
        data-testid="smb-crm-quote-template-total-note"
      >
        The server recomputes the total from quantity × unit price. The value above is a preview.
      </p>
    </div>
  );
}

function CreateBar({
  canCreate,
  isPending,
  error,
  onCreate,
}: {
  canCreate: boolean;
  isPending: boolean;
  error: string | undefined;
  onCreate: () => void;
}) {
  return (
    <nav
      className="flex flex-col gap-1"
      data-testid="smb-crm-quote-template-create-bar"
    >
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-ruby,#b23a48)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-ruby,#b23a48)_5%,transparent)] px-3 py-2 text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]"
          data-testid="smb-crm-quote-template-error"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCreate}
          disabled={!canCreate}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-white disabled:opacity-60"
          data-testid="smb-crm-quote-template-create"
        >
          <Send className="size-3.5" />
          {isPending ? "Creating…" : "Create quote + open PDF"}
        </button>
      </div>
    </nav>
  );
}

function BackLink() {
  return (
    <Link
      to="/app/smb-crm"
      className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      data-testid="smb-crm-quote-template-back"
    >
      <ChevronLeft className="size-3.5" />
      Back to SMB-CRM
    </Link>
  );
}
