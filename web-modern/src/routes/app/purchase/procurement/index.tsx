import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronLeft, Lock, PackageSearch, ShoppingCart } from "lucide-react";
import { z } from "zod";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  ProcurementBlanketOrderCreateRequestSchema,
  ProcurementBlanketOrderCreateResponseSchema,
  ProcurementCoverageResponseSchema,
  ProcurementReplenishmentResponseSchema,
  ProcurementRequisitionCreateRequestSchema,
  ProcurementRequisitionCreateResponseSchema,
  ProcurementRfqConvertRequestSchema,
  ProcurementRfqConvertResponseSchema,
  type ProcurementBlanketOrder,
  type ProcurementCoverage,
  type ProcurementReplenishmentSuggestion,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/app/purchase/procurement/")({
  component: ProcurementRoutePage,
});

// ---------------------------------------------------------------------------
// Tabs (route-local). This route owns the modern procurement vocabulary:
// requisition → rfq → quote → po → receipt → blanket coverage → demand.
// ---------------------------------------------------------------------------

export const PROCUREMENT_ROUTE_TABS = [
  "requisition",
  "rfq",
  "quote",
  "po",
  "receipt",
  "blanket",
  "replenishment",
] as const;

export type ProcurementRouteTab = (typeof PROCUREMENT_ROUTE_TABS)[number];

export function procurementRouteTabFromHash(
  hash: string | null | undefined,
): ProcurementRouteTab {
  const normalized = (hash ?? "").replace(/^#/, "").trim();
  if (
    (PROCUREMENT_ROUTE_TABS as readonly string[]).includes(normalized)
  ) {
    return normalized as ProcurementRouteTab;
  }
  return "requisition";
}

export function procurementRouteTabToHash(tab: ProcurementRouteTab): string {
  return `#${tab}`;
}

// ---------------------------------------------------------------------------
// 403 access gate
// ---------------------------------------------------------------------------

export type ProcurementAccess = "purchase" | "none";

const DEFAULT_PROCUREMENT_ACCESS: ProcurementAccess = "purchase";

interface ProcurementAccessDeniedCardProps {
  resource: string;
}

export function ProcurementAccessDeniedCard({
  resource,
}: ProcurementAccessDeniedCardProps) {
  return (
    <div
      data-testid="procurement-403"
      data-entity="procurement-forbidden"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
    >
      <div className="flex items-center gap-3">
        <Lock
          className="h-5 w-5 text-[var(--color-text-muted)]"
          aria-hidden="true"
        />
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Forbidden - Access denied
        </h2>
      </div>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        {`You do not have access to ${resource}.`}
      </p>
      <Link
        to="/app/purchase"
        search={{ view: "vendors" }}
        data-testid="procurement-403-back"
        className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--color-link)] hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab labels (Armenian-first + English fallback)
// ---------------------------------------------------------------------------

const PROCUREMENT_TAB_LABELS: Readonly<
  Record<ProcurementRouteTab, { armenian: string; english: string }>
> = {
  requisition: { armenian: "Requisitions", english: "Requisition" },
  rfq: { armenian: "RFQs", english: "RFQ" },
  quote: { armenian: "Quotes", english: "Quote" },
  po: { armenian: "POs", english: "PO" },
  receipt: { armenian: "Receipts", english: "Receipt" },
  blanket: { armenian: "Blanket", english: "Coverage" },
  replenishment: { armenian: "Replenishment", english: "Demand" },
};

// ---------------------------------------------------------------------------
// Response schemas (quote/po/receipt are not in the schema registry, so
// we own minimal envelopes here for the route mutations.)
// ---------------------------------------------------------------------------

const ProcurementQuoteCreateResponseSchema = z.object({
  ok: z.literal(true),
  quote: z.object({ id: z.string().min(1) }),
});

const ProcurementPurchaseOrderCreateResponseSchema = z.object({
  ok: z.literal(true),
  purchaseOrder: z.object({ id: z.string().min(1) }),
});

const ProcurementReceiptCreateResponseSchema = z.object({
  ok: z.literal(true),
  receipt: z.object({ id: z.string().min(1) }),
});

// ---------------------------------------------------------------------------
// ID pill
// ---------------------------------------------------------------------------

interface ProcurementIdPillProps {
  tab: ProcurementRouteTab;
  id: string | null;
}

export function ProcurementIdPill({ tab, id }: ProcurementIdPillProps) {
  if (id === null) {
    return (
      <span
        data-testid={`procurement-${tab}-id-pill`}
        data-entity={`procurement-${tab}-id`}
        data-state="empty"
        className="inline-flex items-center rounded-full border border-dashed border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]"
      >
        no id yet
      </span>
    );
  }
  return (
    <span
      data-testid={`procurement-${tab}-id-pill`}
      data-entity={`procurement-${tab}-id`}
      data-state="ready"
      className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-xs font-mono text-[var(--color-text)]"
    >
      {id}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tab strip
// ---------------------------------------------------------------------------

interface ProcurementTabStripProps {
  active: ProcurementRouteTab;
  onChange: (tab: ProcurementRouteTab) => void;
}

export function ProcurementTabStrip({
  active,
  onChange,
}: ProcurementTabStripProps) {
  return (
    <div
      role="tablist"
      aria-label="Procurement tabs"
      data-testid="procurement-tab-strip"
      data-entity="procurement-tabs"
      className="flex flex-wrap gap-2"
    >
      {PROCUREMENT_ROUTE_TABS.map((tab) => {
        const isActive = active === tab;
        const labels = PROCUREMENT_TAB_LABELS[tab];
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`procurement-tab-${tab}`}
            data-entity={`procurement-tab-${tab}`}
            data-active={isActive ? "true" : "false"}
            onClick={() => onChange(tab)}
            className={cn(
              "rounded-[var(--radius-md)] border px-3 py-1.5 text-sm",
              isActive
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]",
            )}
          >
            <span className="font-medium">{labels.armenian}</span>
            <span className="ml-2 text-xs opacity-70">{labels.english}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

interface ProcurementFormShellProps {
  tab: ProcurementRouteTab;
  titleArmenian: string;
  titleEnglish: string;
  disabled: boolean;
  disabledReason: string;
  pill: React.ReactNode;
  children: React.ReactNode;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  error: string | null;
  success: string | null;
}

function ProcurementFormShell({
  tab,
  titleArmenian,
  titleEnglish,
  disabled,
  disabledReason,
  pill,
  children,
  onSubmit,
  pending,
  error,
  success,
}: ProcurementFormShellProps) {
  return (
    <form
      data-testid={`procurement-${tab}-form`}
      data-entity={`procurement-${tab}-form`}
      onSubmit={onSubmit}
      className="space-y-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            {titleArmenian}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            {titleEnglish}
          </p>
        </div>
        {pill}
      </header>

      {disabled ? (
        <p
          data-testid={`procurement-${tab}-disabled`}
          className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-2 text-xs text-[var(--color-text-muted)]"
        >
          {disabledReason}
        </p>
      ) : null}

      <fieldset disabled={disabled || pending} className="space-y-3">
        {children}
      </fieldset>

      {error !== null ? (
        <p
          role="alert"
          data-testid={`procurement-${tab}-error`}
          className="text-xs text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
      {success !== null ? (
        <p
          role="status"
          data-testid={`procurement-${tab}-success`}
          className="text-xs text-[var(--color-success)]"
        >
          {success}
        </p>
      ) : null}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          data-testid={`procurement-${tab}-submit`}
          disabled={disabled || pending}
          className="rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Submitting..." : "Submit"}
        </button>
      </div>
    </form>
  );
}

function ProcurementFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs font-medium text-[var(--color-text-muted)]"
    >
      {children}
    </label>
  );
}

function ProcurementTextInput({
  id,
  name,
  required,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      name={name}
      required={required}
      defaultValue={defaultValue}
      placeholder={placeholder}
      data-testid={id}
      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)]"
    />
  );
}

// ----- Requisition form ----------------------------------------------------

export function ProcurementRequisitionForm({
  disabled,
  pill,
  onCreated,
}: {
  disabled: boolean;
  pill: React.ReactNode;
  onCreated: (id: string) => void;
}) {
  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const neededBy = String(formData.get("neededBy") ?? "");
      const justification = String(formData.get("justification") ?? "");
      const payload: z.infer<typeof ProcurementRequisitionCreateRequestSchema> =
        {
          neededBy,
          ...(justification.length > 0 ? { justification } : {}),
          idempotencyKey: `requisition-ui-${Date.now()}`,  
        };
      const result = await postJson(
        "/api/procurement/requisitions",
        payload,
        ProcurementRequisitionCreateResponseSchema,
      );
      return result.requisition.id;
    },
    onSuccess: (id) => onCreated(id),
  });

  return (
    <ProcurementFormShell
      tab="requisition"
      titleArmenian="Requisition"
      titleEnglish="Requisition"
      disabled={disabled}
      disabledReason="Requisition form is always available."
      pill={pill}
      pending={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      success={mutation.isSuccess ? "Requisition created" : null}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        mutation.mutate(new FormData(form));
      }}
    >
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-requisition-neededBy">
          Needed by
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-requisition-neededBy"
          name="neededBy"
          required
          placeholder="2026-07-01"
        />
      </div>
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-requisition-justification">
          Justification
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-requisition-justification"
          name="justification"
          placeholder="Restock warehouse"
        />
      </div>
    </ProcurementFormShell>
  );
}

// ----- RFQ form ------------------------------------------------------------

export function ProcurementRfqForm({
  disabled,
  pill,
  onCreated,
}: {
  disabled: boolean;
  pill: React.ReactNode;
  onCreated: (id: string) => void;
}) {
  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const neededBy = String(formData.get("neededBy") ?? "");
      const justification = String(formData.get("justification") ?? "");
      const payload: z.infer<typeof ProcurementRfqConvertRequestSchema> = {
        neededBy,
        ...(justification.length > 0 ? { justification } : {}),
        idempotencyKey: `rfq-ui-${Date.now()}`,
      };
      const result = await postJson(
        "/api/procurement/rfqs",
        payload,
        ProcurementRfqConvertResponseSchema,
      );
      return result.rfq.id;
    },
    onSuccess: (id) => onCreated(id),
  });

  return (
    <ProcurementFormShell
      tab="rfq"
      titleArmenian="RFQ"
      titleEnglish="Request for Quote"
      disabled={disabled}
      disabledReason="Create a requisition first to enable RFQ."
      pill={pill}
      pending={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      success={mutation.isSuccess ? "RFQ created" : null}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        mutation.mutate(new FormData(form));
      }}
    >
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-rfq-neededBy">
          Needed by
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-rfq-neededBy"
          name="neededBy"
          required
          placeholder="2026-07-01"
        />
      </div>
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-rfq-justification">
          Justification
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-rfq-justification"
          name="justification"
          placeholder="Restock warehouse"
        />
      </div>
    </ProcurementFormShell>
  );
}

// ----- Quote form ----------------------------------------------------------

export function ProcurementQuoteForm({
  disabled,
  pill,
  onCreated,
}: {
  disabled: boolean;
  pill: React.ReactNode;
  onCreated: (id: string) => void;
}) {
  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const rfqId = String(formData.get("rfqId") ?? "");
      const amount = Number(formData.get("amount") ?? 0);
      const payload = {
        rfqId,
        amount,
        idempotencyKey: `quote-ui-${Date.now()}`,  
      };
      const result = await postJson(
        "/api/procurement/quotes",
        payload,
        ProcurementQuoteCreateResponseSchema,
      );
      return result.quote.id;
    },
    onSuccess: (id) => onCreated(id),
  });

  return (
    <ProcurementFormShell
      tab="quote"
      titleArmenian="Quote"
      titleEnglish="Quote"
      disabled={disabled}
      disabledReason="Create an RFQ first to enable quote capture."
      pill={pill}
      pending={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      success={mutation.isSuccess ? "Quote created" : null}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        mutation.mutate(new FormData(form));
      }}
    >
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-quote-rfqId">
          RFQ id
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-quote-rfqId"
          name="rfqId"
          required
          placeholder="rfq-..."
        />
      </div>
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-quote-amount">
          Amount
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-quote-amount"
          name="amount"
          required
          placeholder="100000"
        />
      </div>
    </ProcurementFormShell>
  );
}

// ----- PO form -------------------------------------------------------------

export function ProcurementPoForm({
  disabled,
  pill,
  onCreated,
}: {
  disabled: boolean;
  pill: React.ReactNode;
  onCreated: (id: string) => void;
}) {
  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const quoteId = String(formData.get("quoteId") ?? "");
      const payload = {
        quoteId,
        idempotencyKey: `po-ui-${Date.now()}`,  
      };
      const result = await postJson(
        "/api/procurement/purchase-orders",
        payload,
        ProcurementPurchaseOrderCreateResponseSchema,
      );
      return result.purchaseOrder.id;
    },
    onSuccess: (id) => onCreated(id),
  });

  return (
    <ProcurementFormShell
      tab="po"
      titleArmenian="PO"
      titleEnglish="Purchase Order"
      disabled={disabled}
      disabledReason="Create a quote first to enable PO issuance."
      pill={pill}
      pending={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      success={mutation.isSuccess ? "Purchase order created" : null}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        mutation.mutate(new FormData(form));
      }}
    >
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-po-quoteId">
          Quote id
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-po-quoteId"
          name="quoteId"
          required
          placeholder="quote-..."
        />
      </div>
    </ProcurementFormShell>
  );
}

// ----- Receipt form --------------------------------------------------------

export function ProcurementReceiptForm({
  disabled,
  pill,
  onCreated,
}: {
  disabled: boolean;
  pill: React.ReactNode;
  onCreated: (id: string) => void;
}) {
  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const poId = String(formData.get("poId") ?? "");
      const payload = {
        poId,
        idempotencyKey: `receipt-ui-${Date.now()}`,  
      };
      const result = await postJson(
        "/api/procurement/receipts",
        payload,
        ProcurementReceiptCreateResponseSchema,
      );
      return result.receipt.id;
    },
    onSuccess: (id) => onCreated(id),
  });

  return (
    <ProcurementFormShell
      tab="receipt"
      titleArmenian="Receipt"
      titleEnglish="Receipt"
      disabled={disabled}
      disabledReason="Create a PO first to enable goods receipt."
      pill={pill}
      pending={mutation.isPending}
      error={mutation.isError ? errorMessage(mutation.error) : null}
      success={mutation.isSuccess ? "Receipt recorded" : null}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        mutation.mutate(new FormData(form));
      }}
    >
      <div className="space-y-1">
        <ProcurementFieldLabel htmlFor="procurement-receipt-poId">
          PO id
        </ProcurementFieldLabel>
        <ProcurementTextInput
          id="procurement-receipt-poId"
          name="poId"
          required
          placeholder="po-..."
        />
      </div>
    </ProcurementFormShell>
  );
}

// ----- Blanket order + coverage panel -------------------------------------

export function ProcurementBlanketCoveragePanel({
  pill,
  onCreated,
}: {
  pill: React.ReactNode;
  onCreated: (id: string) => void;
}) {
  const [coverageCatalogItemId, setCoverageCatalogItemId] = useState<
    string | null
  >(null);

  const coverageQuery = useQuery({
    queryKey: ["procurement-blanket-coverage", coverageCatalogItemId],
    enabled: coverageCatalogItemId !== null && coverageCatalogItemId.length > 0,
    queryFn: async () => {
      const productId = encodeURIComponent(coverageCatalogItemId ?? "");
      const raw = await getJson(
        `/api/procurement/blanket-orders/coverage?productId=${productId}`,
      );
      return ProcurementCoverageResponseSchema.parse(raw).coverage;
    },
  });

  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const catalogItemId = String(formData.get("catalogItemId") ?? "").trim();
      const payload: z.infer<
        typeof ProcurementBlanketOrderCreateRequestSchema
      > = {
        vendorId: String(formData.get("vendorId") ?? "").trim(),
        catalogItemId,
        startDate: String(formData.get("startDate") ?? "").trim(),
        endDate: String(formData.get("endDate") ?? "").trim(),
        committedQty: Number(formData.get("committedQty") ?? 0),
        unitPrice: Number(formData.get("unitPrice") ?? 0),
        currency: String(formData.get("currency") ?? "AMD")
          .trim()
          .toUpperCase(),
        idempotencyKey: `blanket-ui-${Date.now()}`,
      };
      const result = await postJson(
        "/api/procurement/blanket-orders",
        payload,
        ProcurementBlanketOrderCreateResponseSchema,
      );
      return result.blanket;
    },
    onSuccess: (blanket) => {
      onCreated(blanket.id);
      setCoverageCatalogItemId(blanket.catalogItemId);
    },
  });

  return (
    <section
      data-testid="procurement-blanket-panel"
      data-entity="procurement-blanket"
      className="space-y-4"
    >
      <ProcurementFormShell
        tab="blanket"
        titleArmenian="Blanket order"
        titleEnglish="Create blanket purchase coverage"
        disabled={false}
        disabledReason="Blanket order form is always available."
        pill={pill}
        pending={mutation.isPending}
        error={mutation.isError ? errorMessage(mutation.error) : null}
        success={mutation.isSuccess ? "Blanket order created" : null}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          mutation.mutate(new FormData(form));
        }}
      >
        <div className="space-y-1">
          <ProcurementFieldLabel htmlFor="procurement-blanket-vendorId">
            Vendor id
          </ProcurementFieldLabel>
          <ProcurementTextInput
            id="procurement-blanket-vendorId"
            name="vendorId"
            required
            placeholder="vendor-..."
          />
        </div>
        <div className="space-y-1">
          <ProcurementFieldLabel htmlFor="procurement-blanket-catalogItemId">
            Catalog item id
          </ProcurementFieldLabel>
          <ProcurementTextInput
            id="procurement-blanket-catalogItemId"
            name="catalogItemId"
            required
            placeholder="catitem-..."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <ProcurementFieldLabel htmlFor="procurement-blanket-startDate">
              Start date
            </ProcurementFieldLabel>
            <ProcurementTextInput
              id="procurement-blanket-startDate"
              name="startDate"
              required
              placeholder="2026-07-01"
            />
          </div>
          <div className="space-y-1">
            <ProcurementFieldLabel htmlFor="procurement-blanket-endDate">
              End date
            </ProcurementFieldLabel>
            <ProcurementTextInput
              id="procurement-blanket-endDate"
              name="endDate"
              required
              placeholder="2026-12-31"
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <ProcurementFieldLabel htmlFor="procurement-blanket-committedQty">
              Committed qty
            </ProcurementFieldLabel>
            <ProcurementTextInput
              id="procurement-blanket-committedQty"
              name="committedQty"
              required
              placeholder="100"
            />
          </div>
          <div className="space-y-1">
            <ProcurementFieldLabel htmlFor="procurement-blanket-unitPrice">
              Unit price
            </ProcurementFieldLabel>
            <ProcurementTextInput
              id="procurement-blanket-unitPrice"
              name="unitPrice"
              required
              placeholder="25000"
            />
          </div>
          <div className="space-y-1">
            <ProcurementFieldLabel htmlFor="procurement-blanket-currency">
              Currency
            </ProcurementFieldLabel>
            <ProcurementTextInput
              id="procurement-blanket-currency"
              name="currency"
              required
              defaultValue="AMD"
              placeholder="AMD"
            />
          </div>
        </div>
      </ProcurementFormShell>

      <form
        data-testid="procurement-blanket-coverage-form"
        data-entity="procurement-blanket-coverage-form"
        className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const nextCatalogItemId = String(
            formData.get("coverageCatalogItemId") ?? "",
          ).trim();
          setCoverageCatalogItemId(nextCatalogItemId);
        }}
      >
        <header>
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            Coverage lookup
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Show active blanket coverage by catalog item id
          </p>
        </header>
        <div className="space-y-1">
          <ProcurementFieldLabel htmlFor="procurement-blanket-coverage-catalogItemId">
            Catalog item id
          </ProcurementFieldLabel>
          <ProcurementTextInput
            id="procurement-blanket-coverage-catalogItemId"
            name="coverageCatalogItemId"
            required
            defaultValue={coverageCatalogItemId ?? ""}
            placeholder="catitem-..."
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="submit"
            data-testid="procurement-blanket-coverage-submit"
            className="rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={coverageQuery.isFetching}
          >
            {coverageQuery.isFetching ? "Checking..." : "Check coverage"}
          </button>
        </div>
      </form>

      <ProcurementBlanketCoverageState
        catalogItemId={coverageCatalogItemId}
        coverage={coverageQuery.data ?? null}
        isLoading={coverageQuery.isLoading}
        isError={coverageQuery.isError}
      />
    </section>
  );
}

function ProcurementBlanketCoverageState({
  catalogItemId,
  coverage,
  isLoading,
  isError,
}: {
  catalogItemId: string | null;
  coverage: ProcurementCoverage | null;
  isLoading: boolean;
  isError: boolean;
}) {
  if (catalogItemId === null) {
    return (
      <section
        data-testid="procurement-blanket-coverage-idle"
        data-entity="procurement-blanket-coverage"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm text-[var(--color-text-muted)]"
      >
        Enter a catalog item id to check blanket coverage.
      </section>
    );
  }

  if (isLoading) {
    return (
      <section
        data-testid="procurement-blanket-coverage-loading"
        data-entity="procurement-blanket-coverage"
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]"
      >
        Loading blanket coverage…
      </section>
    );
  }

  if (isError || coverage === null) {
    return (
      <section
        data-testid="procurement-blanket-coverage-error"
        data-entity="procurement-blanket-coverage"
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-danger)]"
      >
        Failed to load blanket coverage.
      </section>
    );
  }

  return (
    <section
      data-testid="procurement-blanket-coverage-panel"
      data-entity="procurement-blanket-coverage"
      data-count={String(coverage.blanketOrders.length)}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
            <PackageSearch className="h-4 w-4" aria-hidden="true" />
            Coverage
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            {catalogItemId}
          </p>
        </div>
        <div className="text-right font-mono text-xs text-[var(--color-text-muted)]">
          <div>{formatProcurementQuantity(coverage.committedQty)} committed</div>
          <div>{formatProcurementQuantity(coverage.openPoQty)} open PO</div>
          <div>{formatProcurementQuantity(coverage.remainingQty)} remaining</div>
          <div>{formatProcurementQuantity(coverage.uncoveredOpenPoQty)} uncovered</div>
        </div>
      </header>

      {coverage.blanketOrders.length === 0 ? (
        <p
          data-testid="procurement-blanket-coverage-empty"
          className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-muted)]"
        >
          No active blanket coverage for this catalog item.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
          <table
            role="table"
            data-testid="procurement-blanket-coverage-table"
            className="w-full text-sm"
          >
            <thead className="bg-[var(--color-surface-muted)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Blanket</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Vendor</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Item</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Dates</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Committed</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Remaining</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Unit price</th>
              </tr>
            </thead>
            <tbody>
              {coverage.blanketOrders.map((blanket) => (
                <ProcurementBlanketCoverageRow
                  key={blanket.id}
                  blanket={blanket}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProcurementBlanketCoverageRow({
  blanket,
}: {
  blanket: ProcurementBlanketOrder;
}) {
  const vendor = blanket.vendorName || blanket.vendorId;
  const itemLabel = blanket.sku || blanket.catalogItemId;
  return (
    <tr
      data-testid="procurement-blanket-coverage-row"
      className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
    >
      <td className="px-3 py-2">
        <span className="font-mono text-[var(--color-text)]">
          {blanket.id}
        </span>
        <p className="text-xs text-[var(--color-text-muted)]">
          {blanket.catalogItemId}
        </p>
      </td>
      <td className="px-3 py-2 text-[var(--color-text-muted)]">
        <span className="block text-[var(--color-text)]">{vendor}</span>
        <span className="font-mono text-xs">{blanket.vendorId}</span>
      </td>
      <td className="px-3 py-2 text-[var(--color-text-muted)]">
        <span className="block font-mono text-[var(--color-text)]">{itemLabel}</span>
        <span className="text-xs">{blanket.name || blanket.catalogItemId}</span>
      </td>
      <td className="px-3 py-2 text-[var(--color-text-muted)]">
        <span className="block">{blanket.startDate}</span>
        <span className="text-xs">to {blanket.endDate}</span>
      </td>
      <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--color-text)]">
        {formatProcurementQuantity(blanket.committedQty)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-text)]">
        {formatProcurementQuantity(blanket.remainingQty)}
        <p className="text-xs text-[var(--color-text-muted)]">
          {formatProcurementQuantity(blanket.consumedQty)} consumed
        </p>
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-text-muted)]">
        {formatProcurementMoney(blanket.unitPrice, blanket.currency)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface ProcurementHeaderProps {
  titleArmenian: string;
  titleEnglish: string;
}

export function ProcurementHeader({
  titleArmenian,
  titleEnglish,
}: ProcurementHeaderProps) {
  return (
    <header
      data-testid="procurement-header"
      data-entity="procurement-header"
      className="flex items-start justify-between gap-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <ShoppingCart className="h-5 w-5 text-[var(--color-accent)]" />
        </span>
        <div>
          <h2
            data-testid="procurement-title"
            data-entity="procurement-title"
            className="text-xl font-semibold text-[var(--color-text)]"
          >
            {titleArmenian}
          </h2>
          <p
            data-testid="procurement-subtitle"
            data-entity="procurement-subtitle"
            className="text-xs text-[var(--color-text-muted)]"
          >
            {titleEnglish}
          </p>
        </div>
      </div>
      <Link
        to="/app/purchase"
        search={{ view: "vendors" }}
        data-testid="procurement-back-link"
        data-entity="procurement-back-link"
        className="inline-flex items-center gap-1 text-xs text-[var(--color-link)] hover:underline"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Delays
      </Link>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Workspace (root component, exposed for tests)
// ---------------------------------------------------------------------------

export interface ProcurementWorkspaceProps {
  userAccess?: ProcurementAccess;
}

export function ProcurementWorkspace({
  userAccess = DEFAULT_PROCUREMENT_ACCESS,
}: ProcurementWorkspaceProps = {}) {
  const [activeTab, setActiveTab] = useState<ProcurementRouteTab>(
    () => (typeof window === "undefined"
      ? "requisition"
      : procurementRouteTabFromHash(window.location.hash)),
  );
  const [requisitionId, setRequisitionId] = useState<string | null>(null);
  const [rfqId, setRfqId] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [blanketId, setBlanketId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleHashChange = () => {
      setActiveTab(procurementRouteTabFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const setActiveTabWithHash = (tab: ProcurementRouteTab) => {
    setActiveTab(tab);
    if (typeof window === "undefined") return;
    const nextHash = procurementRouteTabToHash(tab);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  };

  if (userAccess === "none") {
    return (
      <main
        data-testid="procurement-panel"
        data-entity="procurement"
        className="mx-auto max-w-3xl space-y-4 p-6"
      >
        <ProcurementHeader
          titleArmenian="Գ Procurement"
          titleEnglish="Procurement requisitions · RFQs · quotes · POs · receipts · blanket coverage · replenishment"
        />
        <ProcurementAccessDeniedCard resource="procurement" />
      </main>
    );
  }

  return (
    <main
      data-testid="procurement-panel"
      data-entity="procurement"
      className="mx-auto max-w-3xl space-y-4 p-6"
    >
      <ProcurementHeader
        titleArmenian="Գ Procurement"
        titleEnglish="Procurement requisitions · RFQs · quotes · POs · receipts · blanket coverage · replenishment"
      />
      <ProcurementTabStrip active={activeTab} onChange={setActiveTabWithHash} />

      {activeTab === "requisition" ? (
        <ProcurementRequisitionForm
          disabled={false}
          pill={
            <ProcurementIdPill tab="requisition" id={requisitionId} />
          }
          onCreated={setRequisitionId}
        />
      ) : null}

      {activeTab === "rfq" ? (
        <ProcurementRfqForm
          disabled={requisitionId === null}
          pill={<ProcurementIdPill tab="rfq" id={rfqId} />}
          onCreated={setRfqId}
        />
      ) : null}

      {activeTab === "quote" ? (
        <ProcurementQuoteForm
          disabled={rfqId === null}
          pill={<ProcurementIdPill tab="quote" id={quoteId} />}
          onCreated={setQuoteId}
        />
      ) : null}

      {activeTab === "po" ? (
        <ProcurementPoForm
          disabled={quoteId === null}
          pill={<ProcurementIdPill tab="po" id={poId} />}
          onCreated={setPoId}
        />
      ) : null}

      {activeTab === "receipt" ? (
        <ProcurementReceiptForm
          disabled={poId === null}
          pill={<ProcurementIdPill tab="receipt" id={receiptId} />}
          onCreated={setReceiptId}
        />
      ) : null}

      {activeTab === "blanket" ? (
        <ProcurementBlanketCoveragePanel
          pill={<ProcurementIdPill tab="blanket" id={blanketId} />}
          onCreated={setBlanketId}
        />
      ) : null}

      {activeTab === "replenishment" ? (
        <ProcurementReplenishmentPanel />
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Replenishment panel
// ---------------------------------------------------------------------------

export function ProcurementReplenishmentPanel() {
  const query = useQuery({
    queryKey: ["procurement-replenishment"],
    queryFn: async () => {
      const raw = await getJson("/api/procurement/analytics/replenishment");
      return ProcurementReplenishmentResponseSchema.parse(raw);
    },
  });

  if (query.isLoading) {
    return (
      <section
        data-testid="procurement-replenishment-loading"
        data-entity="procurement-replenishment"
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]"
      >
        Loading replenishment…
      </section>
    );
  }

  if (query.isError || !query.data) {
    return (
      <section
        data-testid="procurement-replenishment-error"
        data-entity="procurement-replenishment"
        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-danger)]"
      >
        Failed to load replenishment suggestions.
      </section>
    );
  }

  const suggestions = query.data.suggestions;
  const summary = query.data.summary;

  return (
    <section
      data-testid="procurement-replenishment-panel"
      data-entity="procurement-replenishment"
      data-count={String(suggestions.length)}
      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-[var(--color-text)]">
            <PackageSearch className="h-4 w-4" aria-hidden="true" />
            Replenishment
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Purchase-to-sales demand suggestions
          </p>
        </div>
        {summary ? (
          <span className="font-mono text-xs text-[var(--color-text-muted)]">
            {formatProcurementQuantity(summary.suggestedQty)} suggested
          </span>
        ) : null}
      </header>

      {suggestions.length === 0 ? (
        <p
          data-testid="procurement-replenishment-empty"
          className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-muted)]"
        >
          No replenishment suggestions right now.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)]">
          <table
            role="table"
            data-testid="procurement-replenishment-table"
            className="w-full text-sm"
          >
            <thead className="bg-[var(--color-surface-muted)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Item</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">On hand</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Open PO</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sales demand</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Suggested</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Vendor</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((suggestion) => (
                <ProcurementReplenishmentRow
                  key={suggestion.catalogItemId}
                  suggestion={suggestion}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProcurementReplenishmentRow({
  suggestion,
}: {
  suggestion: ProcurementReplenishmentSuggestion;
}) {
  const salesDemand = suggestion.salesQuoteDemand ?? suggestion.salesDemandQty ?? 0;
  const openPo = suggestion.openPoQty ?? suggestion.openPurchaseQty ?? suggestion.openDemand ?? 0;
  const vendor = suggestion.recommendedVendorName
    || suggestion.recommendedVendor?.vendorName
    || "Vendor price missing";

  return (
    <tr
      data-testid="procurement-replenishment-row"
      className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
    >
      <td className="px-3 py-2">
        <Link
          to="/app/inventory/$itemId"
          params={{ itemId: suggestion.catalogItemId }}
          search={{ tab: "stock" }}
          className="font-mono text-[var(--color-link)] hover:underline"
        >
          {suggestion.sku || suggestion.catalogItemId}
        </Link>
        <p className="text-xs text-[var(--color-text-muted)]">
          {suggestion.name || suggestion.catalogItemId}
        </p>
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-text)]">
        {formatProcurementQuantity(suggestion.onHand)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-text-muted)]">
        {formatProcurementQuantity(openPo)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[var(--color-text-muted)]">
        {formatProcurementQuantity(salesDemand)}
      </td>
      <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--color-text)]">
        {formatProcurementQuantity(suggestion.suggestedQty)}
      </td>
      <td className="px-3 py-2 text-[var(--color-text-muted)]">
        <span className="block text-[var(--color-text)]">{vendor}</span>
        <span className="text-xs">{suggestion.leadTimeDays ?? 0}d lead</span>
      </td>
    </tr>
  );
}

function formatProcurementQuantity(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatProcurementMoney(
  value: number | null | undefined,
  currency: string,
): string {
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
  return `${currency} ${amount}`;
}

// ---------------------------------------------------------------------------
// Default route page
// ---------------------------------------------------------------------------

function ProcurementRoutePage() {
  return <ProcurementWorkspace userAccess={DEFAULT_PROCUREMENT_ACCESS} />;
}

// ---------------------------------------------------------------------------
// Tiny utility
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}
