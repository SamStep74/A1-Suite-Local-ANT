import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, Lock, ShoppingCart } from "lucide-react";
import { z } from "zod";
import { postJson } from "../../../../lib/api/client";
import {
  ProcurementRequisitionCreateRequestSchema,
  ProcurementRequisitionCreateResponseSchema,
  ProcurementRfqConvertRequestSchema,
  ProcurementRfqConvertResponseSchema,
} from "../../../../lib/api/schemas";
import { cn } from "../../../../lib/utils/cn";

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/app/purchase/procurement/")({
  component: ProcurementRoutePage,
});

// ---------------------------------------------------------------------------
// Tabs (route-local). Worker-1's PROCUREMENT_TABS uses a different vocabulary
// (blanket/landed/credit) so this route owns its own five-tab vocabulary that
// matches the procurement spec: requisition → rfq → quote → po → receipt.
// ---------------------------------------------------------------------------

export const PROCUREMENT_ROUTE_TABS = [
  "requisition",
  "rfq",
  "quote",
  "po",
  "receipt",
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
        search={() => ({})}
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
        search={() => ({})}
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
    "requisition",
  );
  const [requisitionId, setRequisitionId] = useState<string | null>(null);
  const [rfqId, setRfqId] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  if (userAccess === "none") {
    return (
      <main
        data-testid="procurement-panel"
        data-entity="procurement"
        className="mx-auto max-w-3xl space-y-4 p-6"
      >
        <ProcurementHeader
          titleArmenian="Գ Procurement"
          titleEnglish="Procurement requisitions · RFQs · quotes · POs · receipts"
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
        titleEnglish="Procurement requisitions · RFQs · quotes · POs · receipts"
      />
      <ProcurementTabStrip active={activeTab} onChange={setActiveTab} />

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
    </main>
  );
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
