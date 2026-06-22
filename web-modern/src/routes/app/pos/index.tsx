/**
 * /app/pos — POS cash-session spine.
 *
 * Slice 425 frontend scope: open/close cash sessions, one-line sale
 * capture, receipt packet handoff, full-sale refund evidence, and tracked-line
 * stock return evidence. Terminal refunds, fiscal submission, receipt
 * printing, offline replay, and ledger posting stay outside this surface.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BadgeDollarSign,
  ChevronLeft,
  ClipboardCheck,
  Lock,
  ReceiptText,
  RotateCcw,
  ShoppingCart,
  Store,
} from "lucide-react";
import { getJson, postJson } from "../../../lib/api/client";
import {
  PosCloseCashSessionRequestSchema,
  PosCloseCashSessionResponseSchema,
  PosCreateSaleRequestSchema,
  PosCreateSaleResponseSchema,
  PosOpenCashSessionRequestSchema,
  PosOpenCashSessionResponseSchema,
  PosReceiptPacketRequestSchema,
  PosReceiptPacketResponseSchema,
  PosRefundRequestSchema,
  PosRefundResponseSchema,
  PosWorkspaceResponseSchema,
  type CatalogItem,
  type PosCashSession,
  type PosCreateSaleResponse,
  type PosPaymentMethod,
  type PosReceiptPacketResponse,
  type PosRefund,
  type PosRefundMethod,
  type PosWorkspaceResponse,
  type PosFiscalCloseoutLabels,
  type StockLocation,
} from "../../../lib/api/schemas";
import { useUserAccess } from "../../../lib/rbac/access.tsx";
import { money } from "../../../lib/utils/money";
import { cn } from "../../../lib/utils/cn";

export const Route = createFileRoute("/app/pos/")({
  component: PosWorkspace,
});

const POS_WORKSPACE_QUERY_KEY = ["pos", "workspace"] as const;
const POS_PAYMENT_METHODS: Array<{ value: PosPaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank-transfer", label: "Bank transfer" },
];
const POS_REFUND_METHODS: Array<{ value: PosRefundMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank-transfer", label: "Bank transfer" },
];

function PosWorkspace() {
  const hasAccess = useUserAccess("pos");
  const queryClient = useQueryClient();
  const [lastSale, setLastSale] = useState<PosCreateSaleResponse["sale"] | null>(null);
  const [lastReceiptPacket, setLastReceiptPacket] =
    useState<PosReceiptPacketResponse["receiptPacket"] | null>(null);
  const [lastRefund, setLastRefund] = useState<PosRefund | null>(null);

  const workspaceQ = useQuery({
    queryKey: POS_WORKSPACE_QUERY_KEY,
    queryFn: () => getJson("/api/pos/workspace", PosWorkspaceResponseSchema),
    staleTime: 15_000,
    enabled: hasAccess,
  });

  const refreshWorkspace = () => {
    void queryClient.invalidateQueries({ queryKey: POS_WORKSPACE_QUERY_KEY });
  };

  const updateWorkspaceSession = (session: PosCashSession | undefined) => {
    if (!session) return;
    queryClient.setQueryData<PosWorkspaceResponse | undefined>(
      POS_WORKSPACE_QUERY_KEY,
      (current) => {
        if (!current) return current;
        const sessions = current.sessions.some((row) => row.id === session.id)
          ? current.sessions.map((row) => (row.id === session.id ? session : row))
          : [session, ...current.sessions];
        return {
          ...current,
          openSession: current.openSession?.id === session.id ? session : current.openSession,
          sessions,
        };
      },
    );
  };

  const openMutation = useMutation({
    mutationFn: async (input: {
      stockLocationId: string;
      registerCode: string;
      openingCash: string;
      openedAt: string;
    }) => {
      const payload = PosOpenCashSessionRequestSchema.parse({
        stockLocationId: input.stockLocationId,
        registerCode: input.registerCode.trim(),
        openingCash: toAmount(input.openingCash),
        openedAt: optionalText(input.openedAt),
      });
      return postJson(
        "/api/pos/cash-sessions",
        payload,
        PosOpenCashSessionResponseSchema,
      );
    },
    onSuccess: refreshWorkspace,
  });

  const closeMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      countedCash: string;
      fiscalDeviceId: string;
      zReportNumber: string;
      receiptRangeStart: string;
      receiptRangeEnd: string;
      closeNote: string;
    }) => {
      const payload = PosCloseCashSessionRequestSchema.parse({
        countedCash: toAmount(input.countedCash),
        fiscalDeviceId: input.fiscalDeviceId.trim(),
        zReportNumber: input.zReportNumber.trim(),
        receiptRangeStart: input.receiptRangeStart.trim(),
        receiptRangeEnd: input.receiptRangeEnd.trim(),
        closeNote: optionalText(input.closeNote),
      });
      return postJson(
        `/api/pos/cash-sessions/${input.sessionId}/close`,
        payload,
        PosCloseCashSessionResponseSchema,
      );
    },
    onSuccess: refreshWorkspace,
  });

  const saleMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      catalogItemId: string;
      quantity: string;
      receiptNumber: string;
      paymentMethod: PosPaymentMethod;
      soldAt: string;
    }) => {
      const payload = PosCreateSaleRequestSchema.parse({
        receiptNumber: input.receiptNumber.trim(),
        paymentMethod: input.paymentMethod,
        soldAt: optionalText(input.soldAt),
        idempotencyKey: `pos-sale-ui-${Date.now()}`,
        lines: [
          {
            catalogItemId: input.catalogItemId,
            quantity: toPositiveInteger(input.quantity),
          },
        ],
      });
      return postJson(
        `/api/pos/cash-sessions/${input.sessionId}/sales`,
        payload,
        PosCreateSaleResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastSale(response.sale);
      setLastReceiptPacket(null);
      setLastRefund(null);
      refreshWorkspace();
    },
  });

  const receiptPacketMutation = useMutation({
    mutationFn: async (input: {
      saleId: string;
      fiscalDeviceId: string;
    }) => {
      const payload = PosReceiptPacketRequestSchema.parse({
        fiscalDeviceId: input.fiscalDeviceId.trim(),
      });
      return postJson(
        `/api/pos/sales/${input.saleId}/receipt-packet`,
        payload,
        PosReceiptPacketResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastSale(response.sale);
      setLastReceiptPacket(response.receiptPacket);
      refreshWorkspace();
    },
  });

  const refundMutation = useMutation({
    mutationFn: async (input: {
      saleId: string;
      idempotencyKey: string;
      refundReference: string;
      refundMethod: PosRefundMethod;
      reason: string;
    }) => {
      const payload = PosRefundRequestSchema.parse({
        idempotencyKey: input.idempotencyKey,
        refundReference: input.refundReference.trim(),
        refundMethod: input.refundMethod,
        reason: input.reason.trim(),
      });
      return postJson(
        `/api/pos/sales/${input.saleId}/refund`,
        payload,
        PosRefundResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastRefund(response.refund);
      setLastSale(response.sale);
      updateWorkspaceSession(response.session);
      refreshWorkspace();
    },
  });

  if (!hasAccess) {
    return (
      <div
        className="mx-auto max-w-4xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="pos-panel"
        data-entity="pos-root"
      >
        <PosHeader compact />
        <PosAccessDeniedCard />
        <BackToTodayLink />
      </div>
    );
  }

  const workspace = workspaceQ.data;
  const openSession = workspace?.openSession ?? null;
  const sessions = workspace?.sessions ?? [];
  const catalogItems = workspace?.catalogItems ?? [];
  const stockLocations = workspace?.stockLocations ?? [];
  const fiscalCloseoutLabels = workspace?.fiscalCloseoutLabels ?? {};

  return (
    <div
      className="mx-auto max-w-7xl space-y-5 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="pos-panel"
      data-entity="pos-root"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PosHeader />
        <BackToTodayLink />
      </div>

      {workspaceQ.isLoading ? (
        <section className="panel" data-testid="pos-loading">
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            Loading POS workspace…
          </p>
        </section>
      ) : workspaceQ.error ? (
        <section className="panel" data-testid="pos-error">
          <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby)]">
            Could not load POS workspace.
          </p>
          <p className="mt-1 text-[var(--text-xs)] text-[var(--color-muted)]">
            {(workspaceQ.error as Error).message}
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            {openSession ? (
              <section
                className="panel space-y-4"
                data-testid="pos-current-session"
                data-entity="pos-current-session"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
                      Current cash session
                    </h2>
                    <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
                      {sessionStockLocationName(openSession)} · opened {formatDateTime(openSession.openedAt)}
                    </p>
                  </div>
                  <StatusPill status={openSession.status} />
                </div>
                <SessionMetrics session={openSession} />
                <SaleCapturePanel
                  key={`sale-${openSession.id}`}
                  session={openSession}
                  catalogItems={catalogItems}
                  onSubmit={(input) => saleMutation.mutate(input)}
                  isPending={saleMutation.isPending}
                  error={saleMutation.error ? (saleMutation.error as Error).message : ""}
                  lastSale={lastSale}
                  receiptPacket={lastReceiptPacket}
                  onPrepareReceiptPacket={(input) => receiptPacketMutation.mutate(input)}
                  isPreparingReceiptPacket={receiptPacketMutation.isPending}
                  receiptPacketError={
                    receiptPacketMutation.error
                      ? (receiptPacketMutation.error as Error).message
                      : ""
                  }
                  lastRefund={lastRefund}
                  onRefund={(input) => refundMutation.mutate(input)}
                  isRefunding={refundMutation.isPending}
                  refundError={
                    refundMutation.error ? (refundMutation.error as Error).message : ""
                  }
                />
                <div className="space-y-3 border-t border-[var(--color-line)] pt-4 opacity-90">
                  <div>
                    <h3 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
                      Closeout
                    </h3>
                    <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
                      Fiscal evidence for ending the cash session.
                    </p>
                  </div>
                  <CloseSessionForm
                    key={openSession.id}
                    session={openSession}
                    onSubmit={(input) => closeMutation.mutate(input)}
                    isPending={closeMutation.isPending}
                    error={closeMutation.error ? (closeMutation.error as Error).message : ""}
                  />
                </div>
              </section>
            ) : (
              <section
                className="panel space-y-4"
                data-testid="pos-open-session-panel"
                data-entity="pos-open-session"
              >
                <div>
                  <h2 className="text-[var(--text-lg)] font-semibold text-[var(--color-ink)]">
                    Open cash session
                  </h2>
                  <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
                    Select the counter and starting cash for the drawer.
                  </p>
                </div>
                <OpenSessionForm
                  stockLocations={stockLocations}
                  onSubmit={(input) => openMutation.mutate(input)}
                  isPending={openMutation.isPending}
                  error={openMutation.error ? (openMutation.error as Error).message : ""}
                />
              </section>
            )}

            <FiscalEvidencePanel
              openSession={openSession}
              labels={fiscalCloseoutLabels}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <RecentSessionsTable sessions={sessions} />
            <CatalogStockPreview
              catalogItems={catalogItems}
              stockLocations={stockLocations}
            />
          </div>
        </>
      )}
    </div>
  );
}

function PosHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="space-y-1">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
        <Store className="size-3" />
        App · POS
      </span>
      <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
        POS
      </h1>
      {!compact ? (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Cash sessions · Z-report closeout evidence · fiscal catalog preview
        </p>
      ) : null}
    </header>
  );
}

function BackToTodayLink() {
  return (
    <Link
      to="/app"
      className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
    >
      <ChevronLeft className="size-3.5" />
      Today
    </Link>
  );
}

export function PosAccessDeniedCard() {
  return (
    <article
      data-testid="pos-403"
      data-entity="pos-forbidden"
      className="panel flex items-start gap-3 border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]"
    >
      <Lock className="size-4 shrink-0 text-[var(--color-ruby)]" aria-hidden />
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Մուտքը սահմանափակված է
        </h2>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          POS workspace-ը հասանելի չէ ձեր դերի համար
        </p>
      </div>
    </article>
  );
}

export function OpenSessionForm({
  stockLocations,
  onSubmit,
  isPending,
  error,
}: {
  stockLocations: readonly StockLocation[];
  onSubmit: (input: {
    stockLocationId: string;
    registerCode: string;
    openingCash: string;
    openedAt: string;
  }) => void;
  isPending?: boolean;
  error?: string;
}) {
  const [stockLocationId, setStockLocationId] = useState("");
  const [registerCode, setRegisterCode] = useState("POS-01");
  const [openingCash, setOpeningCash] = useState("0");
  const [openedAt, setOpenedAt] = useState("");

  const selectedStockLocationId = stockLocationId || stockLocations[0]?.id || "";
  const canSubmit =
    selectedStockLocationId.length > 0 &&
    registerCode.trim().length > 0 &&
    openingCash.trim().length > 0 &&
    !isPending;

  return (
    <form
      className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px] lg:grid-cols-[minmax(0,1fr)_140px_160px_190px_auto]"
      data-testid="pos-open-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          stockLocationId: selectedStockLocationId,
          registerCode,
          openingCash,
          openedAt,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Stock location
        <select
          value={selectedStockLocationId}
          onChange={(event) => setStockLocationId(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-open-stock-location"
        >
          {stockLocations.length === 0 ? (
            <option value="">No locations</option>
          ) : (
            stockLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.name}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Register
        <input
          value={registerCode}
          onChange={(event) => setRegisterCode(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-open-register-code"
        />
      </label>

      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Opening cash
        <input
          type="number"
          min="0"
          step="1"
          value={openingCash}
          onChange={(event) => setOpeningCash(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-open-opening-cash"
        />
      </label>

      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Opened at
        <input
          type="datetime-local"
          value={openedAt}
          onChange={(event) => setOpenedAt(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-open-opened-at"
        />
      </label>

      <div className="flex items-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="pos-open-submit"
        >
          <BadgeDollarSign className="size-4" aria-hidden />
          {isPending ? "Opening…" : "Open"}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="md:col-span-2 lg:col-span-5 text-[var(--text-sm)] text-[var(--color-ruby)]"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function SaleCapturePanel({
  session,
  catalogItems,
  onSubmit,
  isPending,
  error,
  lastSale,
  receiptPacket,
  onPrepareReceiptPacket,
  isPreparingReceiptPacket,
  receiptPacketError,
  lastRefund,
  onRefund,
  isRefunding,
  refundError,
}: {
  session: PosCashSession;
  catalogItems: readonly CatalogItem[];
  onSubmit: (input: {
    sessionId: string;
    catalogItemId: string;
    quantity: string;
    receiptNumber: string;
    paymentMethod: PosPaymentMethod;
    soldAt: string;
  }) => void;
  isPending?: boolean;
  error?: string;
  lastSale?: PosCreateSaleResponse["sale"] | null;
  receiptPacket?: PosReceiptPacketResponse["receiptPacket"] | null;
  onPrepareReceiptPacket: (input: {
    saleId: string;
    fiscalDeviceId: string;
  }) => void;
  isPreparingReceiptPacket?: boolean;
  receiptPacketError?: string;
  lastRefund?: PosRefund | null;
  onRefund: (input: {
    saleId: string;
    idempotencyKey: string;
    refundReference: string;
    refundMethod: PosRefundMethod;
    reason: string;
  }) => void;
  isRefunding?: boolean;
  refundError?: string;
}) {
  const [catalogItemId, setCatalogItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("cash");
  const [soldAt, setSoldAt] = useState("");

  const selectedCatalogItemId = catalogItemId || catalogItems[0]?.id || "";
  const selectedItem = catalogItems.find((item) => item.id === selectedCatalogItemId);
  const quantityNumber = toPositiveInteger(quantity);
  const unitPrice = typeof selectedItem?.listPrice === "number" ? selectedItem.listPrice : 0;
  const totalPreview =
    Number.isInteger(quantityNumber) && quantityNumber > 0 ? unitPrice * quantityNumber : Number.NaN;
  const canSubmit =
    Boolean(selectedItem) &&
    receiptNumber.trim().length > 0 &&
    Number.isInteger(quantityNumber) &&
    quantityNumber > 0 &&
    !isPending;

  return (
    <div
      className="space-y-3 border-b border-[var(--color-line)] pb-4"
      data-testid="pos-sale-panel"
      data-entity="pos-sale-capture"
    >
      <div className="flex items-center gap-2">
        <ShoppingCart className="size-4 text-[var(--color-brand)]" aria-hidden />
        <h3 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Sale capture
        </h3>
      </div>

      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_100px_150px_160px_minmax(180px,1fr)_auto]"
        data-testid="pos-sale-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({
            sessionId: session.id,
            catalogItemId: selectedCatalogItemId,
            quantity,
            receiptNumber,
            paymentMethod,
            soldAt,
          });
        }}
      >
        <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          Item
          <select
            value={selectedCatalogItemId}
            onChange={(event) => setCatalogItemId(event.target.value)}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="pos-sale-item"
          >
            {catalogItems.length === 0 ? (
              <option value="">No fiscal items</option>
            ) : (
              catalogItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          Qty
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="pos-sale-quantity"
          />
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          Receipt
          <input
            value={receiptNumber}
            onChange={(event) => setReceiptNumber(event.target.value)}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="pos-sale-receipt-number"
          />
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          Payment
          <select
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as PosPaymentMethod)}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="pos-sale-payment-method"
          >
            {POS_PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
          Sold at
          <input
            type="datetime-local"
            value={soldAt}
            onChange={(event) => setSoldAt(event.target.value)}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="pos-sale-sold-at"
          />
        </label>

        <div className="flex flex-col justify-end gap-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            Total
          </span>
          <span
            className="h-9 whitespace-nowrap text-[var(--text-sm)] font-semibold leading-9 text-[var(--color-ink)]"
            data-testid="pos-sale-total-preview"
          >
            {money(totalPreview)}
          </span>
        </div>

        <div className="md:col-span-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
            Unit price: {money(unitPrice)}
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="pos-sale-submit"
          >
            <ReceiptText className="size-4" aria-hidden />
            {isPending ? "Posting…" : "Post sale"}
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            className="md:col-span-6 text-[var(--text-sm)] text-[var(--color-ruby)]"
            data-testid="pos-sale-error"
          >
            {error}
          </p>
        ) : null}
      </form>

      {lastSale ? (
        <div className="space-y-2">
          <p
            className="text-[var(--text-sm)] font-medium text-[var(--color-tag-green)]"
            data-testid="pos-sale-success"
          >
            {isRefundedSale(lastSale) ? "Refunded sale" : "Posted sale"} {lastSale.id} · receipt{" "}
            {lastSale.receiptNumber} · {money(lastSale.total)} · status {lastSale.status}
          </p>
          {!isRefundedSale(lastSale) || receiptPacket ? (
            <ReceiptPacketHandoff
              key={`${lastSale.id}-${session.fiscalDeviceId ?? ""}`}
              sale={lastSale}
              defaultFiscalDeviceId={session.fiscalDeviceId ?? ""}
              packet={receiptPacket ?? null}
              onSubmit={onPrepareReceiptPacket}
              isPending={isPreparingReceiptPacket}
              error={receiptPacketError}
            />
          ) : null}
          <RefundEvidencePanel
            key={`${lastSale.id}-refund`}
            sale={lastSale}
            refund={lastRefund ?? null}
            onSubmit={onRefund}
            isPending={isRefunding}
            error={refundError}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ReceiptPacketHandoff({
  sale,
  defaultFiscalDeviceId,
  packet,
  onSubmit,
  isPending,
  error,
}: {
  sale: PosCreateSaleResponse["sale"];
  defaultFiscalDeviceId: string;
  packet: PosReceiptPacketResponse["receiptPacket"] | null;
  onSubmit: (input: {
    saleId: string;
    fiscalDeviceId: string;
  }) => void;
  isPending?: boolean;
  error?: string;
}) {
  const [fiscalDeviceId, setFiscalDeviceId] = useState(defaultFiscalDeviceId);
  const canSubmit = fiscalDeviceId.trim().length > 0 && !isPending;

  return (
    <form
      className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
      data-testid="pos-receipt-packet-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          saleId: sale.id,
          fiscalDeviceId,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Fiscal device
        <input
          value={fiscalDeviceId}
          onChange={(event) => setFiscalDeviceId(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-receipt-packet-fiscal-device-id"
        />
      </label>

      <div className="flex items-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="pos-receipt-packet-submit"
        >
          <ReceiptText className="size-4" aria-hidden />
          {isPending ? "Preparing…" : "Prepare evidence"}
        </button>
      </div>

      <p className="text-[var(--text-xs)] text-[var(--color-muted)] sm:col-span-2">
        Handoff packet only · no device submission
      </p>

      {packet ? (
        <p
          className="text-[var(--text-sm)] font-medium text-[var(--color-tag-green)] sm:col-span-2"
          data-testid="pos-receipt-packet-success"
        >
          Receipt evidence {packet.status} · checksum {packet.checksum}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="text-[var(--text-sm)] text-[var(--color-ruby)] sm:col-span-2"
          data-testid="pos-receipt-packet-error"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function RefundEvidencePanel({
  sale,
  refund,
  onSubmit,
  isPending,
  error,
}: {
  sale: PosCreateSaleResponse["sale"];
  refund: PosRefund | null;
  onSubmit: (input: {
    saleId: string;
    idempotencyKey: string;
    refundReference: string;
    refundMethod: PosRefundMethod;
    reason: string;
  }) => void;
  isPending?: boolean;
  error?: string;
}) {
  const [idempotencyKey] = useState(
    () => `pos-refund-ui-${sale.id}-${Date.now()}`,
  );
  const [refundReference, setRefundReference] = useState("");
  const [refundMethod, setRefundMethod] = useState<PosRefundMethod>("cash");
  const [reason, setReason] = useState("");
  const alreadyRefunded = isRefundedSale(sale) || Boolean(refund);
  const returnStockMoveCount = refund?.lines.filter((line) => line.returnStockMoveId).length ?? 0;
  const canSubmit =
    !alreadyRefunded &&
    refundReference.trim().length > 0 &&
    reason.trim().length > 0 &&
    !isPending;

  return (
    <section
      className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
      data-testid="pos-refund-panel"
      data-entity="pos-refund-evidence"
    >
      <div className="flex items-start gap-2">
        <RotateCcw className="mt-0.5 size-4 text-[var(--color-brand)]" aria-hidden />
        <div>
          <h4 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            Refund evidence
          </h4>
          <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
            Full-sale evidence · stock return evidence · no ledger posting
          </p>
        </div>
      </div>

      {refund ? (
        <div
          className="grid gap-2 text-[var(--text-sm)]"
          data-testid="pos-refund-success"
        >
          <p className="font-medium text-[var(--color-tag-green)]">
            Refund evidence {refund.status} · {money(refund.refundedTotal)} ·{" "}
            {refundMethodLabel(refund.refundMethod)}
          </p>
          <dl className="grid gap-1 sm:grid-cols-2">
            <EvidenceRow label="Reference" value={refund.refundReference} />
            <EvidenceRow label="Cash adjustment" value={money(refund.cashAdjustment)} />
            <EvidenceRow label="Inventory" value={refund.inventoryPostingStatus} />
            <EvidenceRow label="Return stock moves" value={String(returnStockMoveCount)} />
            <EvidenceRow label="Ledger" value={refund.ledgerPostingStatus} />
          </dl>
          <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
            Return stock evidence is recorded for tracked lines. Ledger journals,
            fiscal refunds, and receipt printing remain deferred.
          </p>
        </div>
      ) : alreadyRefunded ? (
        <p
          className="text-[var(--text-sm)] text-[var(--color-muted)]"
          data-testid="pos-refund-locked"
        >
          Refund evidence is already recorded for this sale.
        </p>
      ) : (
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px] lg:grid-cols-[minmax(0,1fr)_150px_minmax(0,1.2fr)_auto]"
          data-testid="pos-refund-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onSubmit({
              saleId: sale.id,
              idempotencyKey,
              refundReference,
              refundMethod,
              reason,
            });
          }}
        >
          <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            Reference
            <input
              value={refundReference}
              onChange={(event) => setRefundReference(event.target.value)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
              data-testid="pos-refund-reference"
            />
          </label>

          <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            Method
            <select
              value={refundMethod}
              onChange={(event) => setRefundMethod(event.target.value as PosRefundMethod)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
              data-testid="pos-refund-method"
            >
              {POS_REFUND_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            Reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
              data-testid="pos-refund-reason"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="pos-refund-submit"
            >
              <RotateCcw className="size-4" aria-hidden />
              {isPending ? "Recording…" : "Record refund"}
            </button>
          </div>
        </form>
      )}

      {error ? (
        <p
          role="alert"
          className="text-[var(--text-sm)] text-[var(--color-ruby)]"
          data-testid="pos-refund-error"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function CloseSessionForm({
  session,
  onSubmit,
  isPending,
  error,
}: {
  session: PosCashSession;
  onSubmit: (input: {
    sessionId: string;
    countedCash: string;
    fiscalDeviceId: string;
    zReportNumber: string;
    receiptRangeStart: string;
    receiptRangeEnd: string;
    closeNote: string;
  }) => void;
  isPending?: boolean;
  error?: string;
}) {
  const [countedCash, setCountedCash] = useState(String(session.expectedCash));
  const [fiscalDeviceId, setFiscalDeviceId] = useState("");
  const [zReportNumber, setZReportNumber] = useState("");
  const [receiptRangeStart, setReceiptRangeStart] = useState("");
  const [receiptRangeEnd, setReceiptRangeEnd] = useState("");
  const [closeNote, setCloseNote] = useState("");

  const canSubmit =
    countedCash.trim().length > 0 &&
    fiscalDeviceId.trim().length > 0 &&
    zReportNumber.trim().length > 0 &&
    receiptRangeStart.trim().length > 0 &&
    receiptRangeEnd.trim().length > 0 &&
    !isPending;

  return (
    <form
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      data-testid="pos-close-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          sessionId: session.id,
          countedCash,
          fiscalDeviceId,
          zReportNumber,
          receiptRangeStart,
          receiptRangeEnd,
          closeNote,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Counted cash
        <input
          type="number"
          min="0"
          step="1"
          value={countedCash}
          onChange={(event) => setCountedCash(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-close-counted-cash"
        />
      </label>

      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Fiscal device
        <input
          value={fiscalDeviceId}
          onChange={(event) => setFiscalDeviceId(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-close-fiscal-device-id"
        />
      </label>

      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Z-report
        <input
          value={zReportNumber}
          onChange={(event) => setZReportNumber(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-close-z-report-number"
        />
      </label>

      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Receipt start
        <input
          value={receiptRangeStart}
          onChange={(event) => setReceiptRangeStart(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-close-receipt-range-start"
        />
      </label>

      <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Receipt end
        <input
          value={receiptRangeEnd}
          onChange={(event) => setReceiptRangeEnd(event.target.value)}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-close-receipt-range-end"
        />
      </label>

      <label className="md:col-span-2 xl:col-span-3 flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
        Close note
        <textarea
          value={closeNote}
          onChange={(event) => setCloseNote(event.target.value)}
          rows={2}
          className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          data-testid="pos-close-note"
        />
      </label>

      <div className="md:col-span-2 xl:col-span-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          Expected: {money(session.expectedCash)}
        </p>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="pos-close-submit"
        >
          <ClipboardCheck className="size-4" aria-hidden />
          {isPending ? "Closing…" : "Close session"}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="md:col-span-2 xl:col-span-3 text-[var(--text-sm)] text-[var(--color-ruby)]"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

function SessionMetrics({ session }: { session: PosCashSession }) {
  const metrics = [
    { label: "Opening", value: money(session.openingCash) },
    { label: "Expected", value: money(session.expectedCash) },
    { label: "Counted", value: money(session.countedCash) },
    { label: "Difference", value: money(session.cashDifference) },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-4" data-testid="pos-session-metrics">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            {metric.label}
          </p>
          <p className="mt-1 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function FiscalEvidencePanel({
  openSession,
  labels,
}: {
  openSession: PosCashSession | null;
  labels: PosFiscalCloseoutLabels;
}) {
  const labelEntries = Object.entries(labels);
  return (
    <section
      className="panel space-y-3"
      data-testid="pos-evidence-panel"
      data-entity="pos-fiscal-evidence"
    >
      <div className="flex items-center gap-2">
        <ReceiptText className="size-4 text-[var(--color-brand)]" aria-hidden />
        <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Fiscal closeout
        </h2>
      </div>

      <dl className="grid gap-2 text-[var(--text-sm)]">
        <EvidenceRow label="Session" value={openSession ? openSession.id : "No open session"} />
        <EvidenceRow label="Cashier" value={openSession ? sessionCashierName(openSession) : "—"} />
        <EvidenceRow
          label="Expected cash"
          value={openSession ? money(openSession.expectedCash) : "—"}
        />
      </dl>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          Closeout labels
        </p>
        {labelEntries.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            No closeout labels configured.
          </p>
        ) : (
          <ul className="grid gap-1 text-[var(--text-sm)]">
            {labelEntries.map(([key, value]) => (
              <li
                key={key}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-2 py-1"
              >
                <span className="font-mono text-[11px] text-[var(--color-muted)]">
                  {key}
                </span>
                <span className="truncate text-[var(--color-ink)]">
                  {String(value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1.5">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className="truncate font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

export function RecentSessionsTable({
  sessions,
}: {
  sessions: readonly PosCashSession[];
}) {
  return (
    <section
      className="panel overflow-hidden"
      data-testid="pos-recent-sessions"
      data-entity="pos-recent-sessions"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Recent sessions
        </h2>
        <span className="text-[var(--text-xs)] text-[var(--color-muted)]">
          {sessions.length} rows
        </span>
      </div>

      {sessions.length === 0 ? (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          No cash sessions yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[var(--text-sm)]">
            <thead className="border-b border-[var(--color-line)] text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              <tr>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Cashier</th>
                <th className="px-2 py-2 font-medium">Location</th>
                <th className="px-2 py-2 text-right font-medium">Opening</th>
                <th className="px-2 py-2 text-right font-medium">Expected</th>
                <th className="px-2 py-2 text-right font-medium">Counted</th>
                <th className="px-2 py-2 text-right font-medium">Diff</th>
                <th className="px-2 py-2 font-medium">Z-report</th>
                <th className="px-2 py-2 font-medium">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {sessions.map((session) => (
                <tr key={session.id} data-entity="pos-session-row">
                  <td className="px-2 py-2"><StatusPill status={session.status} /></td>
                  <td className="px-2 py-2">{sessionCashierName(session)}</td>
                  <td className="px-2 py-2">{sessionStockLocationName(session)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(session.openingCash)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(session.expectedCash)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(session.countedCash)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(session.cashDifference)}</td>
                  <td className="px-2 py-2">{session.zReportNumber ?? "—"}</td>
                  <td className="px-2 py-2">{formatDateTime(session.closedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CatalogStockPreview({
  catalogItems,
  stockLocations,
}: {
  catalogItems: readonly CatalogItem[];
  stockLocations: readonly StockLocation[];
}) {
  return (
    <section
      className="panel space-y-4"
      data-testid="pos-catalog-stock-preview"
      data-entity="pos-catalog-stock-preview"
    >
      <div>
        <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Fiscal catalog
        </h2>
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          {catalogItems.length} active fiscal receipt items · {stockLocations.length} stock locations
        </p>
      </div>

      <div className="space-y-2">
        {catalogItems.length === 0 ? (
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            No fiscal catalog items available.
          </p>
        ) : (
          catalogItems.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                  {item.name}
                </p>
                <p className="font-mono text-[11px] text-[var(--color-muted)]">
                  {item.sku}
                </p>
              </div>
              <span className="shrink-0 text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                {money(item.listPrice)}
              </span>
            </div>
          ))
        )}
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          Locations
        </p>
        <div className="flex flex-wrap gap-2">
          {stockLocations.length === 0 ? (
            <span className="text-[var(--text-sm)] text-[var(--color-muted)]">
              No locations
            </span>
          ) : (
            stockLocations.map((location) => (
              <span
                key={location.id}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] px-2 py-1 text-[var(--text-xs)] text-[var(--color-ink)]"
              >
                <Store className="size-3 text-[var(--color-muted)]" aria-hidden />
                {location.code}
              </span>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: PosCashSession["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        status === "open"
          ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
          : "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)] text-[var(--color-muted)]",
      )}
      data-testid={`pos-session-status-${status}`}
    >
      {status}
    </span>
  );
}

function toAmount(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function toPositiveInteger(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) && Number.isInteger(amount) ? amount : Number.NaN;
}

function optionalText(value: string): string | undefined {
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function isRefundedSale(sale: { status: string }): boolean {
  return sale.status === "refunded" || sale.status === "refunded_full";
}

function refundMethodLabel(method: PosRefundMethod): string {
  return POS_REFUND_METHODS.find((entry) => entry.value === method)?.label ?? method;
}

function sessionCashierName(session: PosCashSession): string {
  return session.cashierName ?? session.cashierUserName ?? session.cashierUserId;
}

function sessionStockLocationName(session: PosCashSession): string {
  return session.stockLocationName ?? session.stockLocationId;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("hy-AM", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
