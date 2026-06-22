/**
 * /app/pos — POS cash-session spine.
 *
 * Slice 427 frontend scope: open/close cash sessions, one-line sale
 * capture, receipt packet handoff, refund evidence, pre-receipt void evidence,
 * and tracked-line stock return evidence with POS ledger journal visibility,
 * plus closed-session card terminal settlement evidence, local receipt print
 * previews, and offline replay readiness evidence. Terminal refunds, live
 * fiscal submission, live receipt printing, and true browser-offline execution
 * stay outside this surface.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BadgeDollarSign,
  ChevronLeft,
  ClipboardCheck,
  CreditCard,
  Lock,
  Printer,
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
  PosOfflineReplayItemResponseSchema,
  PosOfflineReplayItemsResponseSchema,
  PosOfflineReplayMarkRequestSchema,
  PosOfflineReplayQueueRequestSchema,
  PosReceiptPacketRequestSchema,
  PosReceiptPacketResponseSchema,
  PosReceiptPrintRequestSchema,
  PosReceiptPrintResponseSchema,
  PosRefundRequestSchema,
  PosRefundResponseSchema,
  PosTerminalSettlementRequestSchema,
  PosTerminalSettlementResponseSchema,
  PosVoidRequestSchema,
  PosVoidResponseSchema,
  PosWorkspaceResponseSchema,
  type CatalogItem,
  type CustomerOption,
  type PosCashSession,
  type PosCreateSaleResponse,
  type PosCapabilityStatus,
  type PosOfflineReplayItem,
  type PosOfflineReplayMarkStatus,
  type PosPaymentMethod,
  type PosSalePaymentRequest,
  type PosReceiptPacketResponse,
  type PosReceiptPrint,
  type PosReceiptPrintResponse,
  type PosRefund,
  type PosRefundMethod,
  type PosRefundRequest,
  type PosTerminalSettlement,
  type PosTerminalSettlementPreview,
  type PosVoid,
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
const POS_OFFLINE_REPLAY_QUERY_KEY = ["pos", "offline-replay-items"] as const;
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
  const [lastReceiptPrint, setLastReceiptPrint] =
    useState<PosReceiptPrintResponse["receiptPrint"] | null>(null);
  const [lastRefund, setLastRefund] = useState<PosRefund | null>(null);
  const [lastVoid, setLastVoid] = useState<PosVoid | null>(null);
  const [lastTerminalSettlement, setLastTerminalSettlement] =
    useState<PosTerminalSettlement | null>(null);
  const [localOfflineReplayItems, setLocalOfflineReplayItems] = useState<
    PosOfflineReplayItem[]
  >([]);
  const [lastQueuedOfflineReplayItem, setLastQueuedOfflineReplayItem] =
    useState<PosOfflineReplayItem | null>(null);
  const [lastMarkedOfflineReplayItem, setLastMarkedOfflineReplayItem] =
    useState<PosOfflineReplayItem | null>(null);

  const workspaceQ = useQuery({
    queryKey: POS_WORKSPACE_QUERY_KEY,
    queryFn: () => getJson("/api/pos/workspace", PosWorkspaceResponseSchema),
    staleTime: 15_000,
    enabled: hasAccess,
  });

  const offlineReplayItemsQ = useQuery({
    queryKey: POS_OFFLINE_REPLAY_QUERY_KEY,
    queryFn: () =>
      getJson("/api/pos/offline-replay-items", PosOfflineReplayItemsResponseSchema),
    staleTime: 15_000,
    enabled: hasAccess,
  });

  const refreshWorkspace = () => {
    void queryClient.invalidateQueries({ queryKey: POS_WORKSPACE_QUERY_KEY });
  };

  const refreshOfflineReplay = () => {
    refreshWorkspace();
    void queryClient.invalidateQueries({ queryKey: POS_OFFLINE_REPLAY_QUERY_KEY });
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
      payments?: PosSalePaymentRequest[];
      soldAt: string;
      customerId: string;
    }) => {
      const payload = PosCreateSaleRequestSchema.parse({
        ...(input.customerId ? { customerId: input.customerId } : {}),
        receiptNumber: input.receiptNumber.trim(),
        paymentMethod: input.paymentMethod,
        ...(input.payments ? { payments: input.payments } : {}),
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
      setLastReceiptPrint(null);
      setLastRefund(null);
      setLastVoid(null);
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
      setLastReceiptPrint(response.receiptPacket.receiptPrint ?? null);
      refreshWorkspace();
    },
  });

  const receiptPrintMutation = useMutation({
    mutationFn: async (input: {
      saleId: string;
    }) => {
      const payload = PosReceiptPrintRequestSchema.parse({
        copyCount: 1,
        printMode: "local-preview",
        printFormat: "receipt-preview-json-v1",
      });
      return postJson(
        `/api/pos/sales/${input.saleId}/receipt-print`,
        payload,
        PosReceiptPrintResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastSale(response.sale);
      setLastReceiptPacket(response.receiptPacket);
      setLastReceiptPrint(response.receiptPrint);
      refreshWorkspace();
    },
  });

  const refundMutation = useMutation({
    mutationFn: async (input: {
      saleId: string;
      idempotencyKey: string;
      refundReference: string;
      refundMethod: PosRefundMethod;
      refundedTotal: string;
      reason: string;
      lines?: PosRefundRequest["lines"];
    }) => {
      const refundedTotal = optionalAmount(input.refundedTotal);
      const payload = PosRefundRequestSchema.parse({
        idempotencyKey: input.idempotencyKey,
        refundReference: input.refundReference.trim(),
        refundMethod: input.refundMethod,
        ...(refundedTotal !== undefined ? { refundedTotal } : {}),
        reason: input.reason.trim(),
        ...(input.lines?.length ? { lines: input.lines } : {}),
      });
      return postJson(
        `/api/pos/sales/${input.saleId}/refund`,
        payload,
        PosRefundResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastRefund(response.refund);
      setLastVoid(null);
      setLastSale(response.sale);
      updateWorkspaceSession(response.session);
      refreshWorkspace();
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (input: {
      saleId: string;
      idempotencyKey: string;
      voidReference: string;
      reason: string;
      voidedAt: string;
    }) => {
      const payload = PosVoidRequestSchema.parse({
        idempotencyKey: input.idempotencyKey,
        voidReference: input.voidReference.trim(),
        reason: input.reason.trim(),
        voidedAt: optionalText(input.voidedAt),
      });
      return postJson(
        `/api/pos/sales/${input.saleId}/void`,
        payload,
        PosVoidResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastVoid(response.void);
      setLastRefund(null);
      setLastSale(response.sale);
      updateWorkspaceSession(response.session);
      refreshWorkspace();
    },
  });

  const terminalSettlementMutation = useMutation({
    mutationFn: async (input: {
      sessionId: string;
      idempotencyKey: string;
      settlementReference: string;
      provider: string;
      settledTotal: string;
      processorFee: string;
      processorFeeAccountCode?: string;
      settledAt: string;
      note: string;
    }) => {
      const processorFee = optionalAmount(input.processorFee);
      const processorFeeAccountCode = optionalText(input.processorFeeAccountCode ?? "");
      const payload = PosTerminalSettlementRequestSchema.parse({
        idempotencyKey: input.idempotencyKey.trim(),
        settlementReference: input.settlementReference.trim(),
        provider: input.provider.trim(),
        settledTotal: toAmount(input.settledTotal),
        ...(processorFee !== undefined ? { processorFee } : {}),
        ...(processorFee !== undefined && processorFeeAccountCode
          ? { processorFeeAccountCode }
          : {}),
        settledAt: optionalText(input.settledAt),
        note: optionalText(input.note),
      });
      return postJson(
        `/api/pos/cash-sessions/${input.sessionId}/terminal-settlements`,
        payload,
        PosTerminalSettlementResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastTerminalSettlement(response.settlement);
      updateWorkspaceSession(response.session);
      refreshWorkspace();
    },
  });

  const queueOfflineReplayMutation = useMutation({
    mutationFn: async (input: {
      cashSessionId?: string;
      saleId?: string;
    }) => {
      const queuedAt = new Date().toISOString();
      const payload = PosOfflineReplayQueueRequestSchema.parse({
        actionType: "sale",
        sourceKey: `pos-offline-replay-ui-${input.cashSessionId ?? "workspace"}-${Date.now()}`,
        payload: {
          evidenceMode: "local-readiness-only",
          actionType: "sale",
          browserOfflineExecution: false,
          fiscalSubmission: false,
          terminalSubmission: false,
          route: "/app/pos",
          cashSessionId: input.cashSessionId ?? null,
          saleId: input.saleId ?? null,
          queuedAt,
        },
        ...(input.cashSessionId ? { cashSessionId: input.cashSessionId } : {}),
        ...(input.saleId ? { saleId: input.saleId } : {}),
        note: "Local offline replay readiness evidence from POS UI.",
      });
      return postJson(
        "/api/pos/offline-replay-items",
        payload,
        PosOfflineReplayItemResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastQueuedOfflineReplayItem(response.item);
      setLocalOfflineReplayItems((current) =>
        mergeOfflineReplayItems([response.item], current),
      );
      refreshOfflineReplay();
    },
  });

  const markOfflineReplayMutation = useMutation({
    mutationFn: async (input: {
      itemId: string;
      replayStatus: PosOfflineReplayMarkStatus;
      note: string;
    }) => {
      const payload = PosOfflineReplayMarkRequestSchema.parse({
        replayStatus: input.replayStatus,
        note: optionalText(input.note),
      });
      return postJson(
        `/api/pos/offline-replay-items/${input.itemId}/mark-replayed`,
        payload,
        PosOfflineReplayItemResponseSchema,
      );
    },
    onSuccess: (response) => {
      setLastMarkedOfflineReplayItem(response.item);
      setLocalOfflineReplayItems((current) =>
        mergeOfflineReplayItems([response.item], current),
      );
      refreshOfflineReplay();
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
  const customers = workspace?.customers ?? [];
  const stockLocations = workspace?.stockLocations ?? [];
  const fiscalCloseoutLabels = workspace?.fiscalCloseoutLabels ?? {};
  const terminalSettlementPreviews =
    workspace?.terminalSettlementPreviews ??
    (workspace?.terminalSettlement ? [workspace.terminalSettlement] : []);
  const offlineReplayItems = mergeOfflineReplayItems(
    localOfflineReplayItems,
    offlineReplayItemsQ.data?.items ?? [],
    workspace?.recentOfflineReplayItems ?? [],
  );

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
                  customers={customers}
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
                  receiptPrint={lastReceiptPrint}
                  onPrepareReceiptPrint={(input) => receiptPrintMutation.mutate(input)}
                  isPreparingReceiptPrint={receiptPrintMutation.isPending}
                  receiptPrintError={
                    receiptPrintMutation.error
                      ? (receiptPrintMutation.error as Error).message
                      : ""
                  }
                  lastRefund={lastRefund}
                  onRefund={(input) => refundMutation.mutate(input)}
                  isRefunding={refundMutation.isPending}
                  refundError={
                    refundMutation.error ? (refundMutation.error as Error).message : ""
                  }
                  lastVoid={lastVoid}
                  onVoid={(input) => voidMutation.mutate(input)}
                  isVoiding={voidMutation.isPending}
                  voidError={voidMutation.error ? (voidMutation.error as Error).message : ""}
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

            <div className="space-y-4">
              <FiscalEvidencePanel
                openSession={openSession}
                labels={fiscalCloseoutLabels}
              />
              <OfflineReplayReadinessPanel
                capabilityStatus={workspace?.capabilityStatus}
                items={offlineReplayItems}
                openSession={openSession}
                lastSale={lastSale}
                queuedItem={lastQueuedOfflineReplayItem}
                markedItem={lastMarkedOfflineReplayItem}
                onQueueSample={(input) => queueOfflineReplayMutation.mutate(input)}
                isQueuePending={queueOfflineReplayMutation.isPending}
                queueError={
                  queueOfflineReplayMutation.error
                    ? (queueOfflineReplayMutation.error as Error).message
                    : ""
                }
                onMarkItem={(input) => markOfflineReplayMutation.mutate(input)}
                isMarkPending={markOfflineReplayMutation.isPending}
                markError={
                  markOfflineReplayMutation.error
                    ? (markOfflineReplayMutation.error as Error).message
                    : ""
                }
                listError={
                  offlineReplayItemsQ.error
                    ? (offlineReplayItemsQ.error as Error).message
                    : ""
                }
              />
              <TerminalSettlementPanel
                previews={terminalSettlementPreviews}
                postedSettlement={lastTerminalSettlement}
                onSubmit={(input) => terminalSettlementMutation.mutate(input)}
                isPending={terminalSettlementMutation.isPending}
                error={
                  terminalSettlementMutation.error
                    ? (terminalSettlementMutation.error as Error).message
                    : ""
                }
              />
            </div>
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
  customers,
  onSubmit,
  isPending,
  error,
  lastSale,
  receiptPacket,
  onPrepareReceiptPacket,
  isPreparingReceiptPacket,
  receiptPacketError,
  receiptPrint,
  onPrepareReceiptPrint,
  isPreparingReceiptPrint,
  receiptPrintError,
  lastRefund,
  onRefund,
  isRefunding,
  refundError,
  lastVoid,
  onVoid,
  isVoiding,
  voidError,
}: {
  session: PosCashSession;
  catalogItems: readonly CatalogItem[];
  customers: readonly CustomerOption[];
  onSubmit: (input: {
    sessionId: string;
    catalogItemId: string;
    quantity: string;
    receiptNumber: string;
    paymentMethod: PosPaymentMethod;
    payments?: PosSalePaymentRequest[];
    soldAt: string;
    customerId: string;
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
  receiptPrint?: PosReceiptPrint | null;
  onPrepareReceiptPrint: (input: {
    saleId: string;
  }) => void;
  isPreparingReceiptPrint?: boolean;
  receiptPrintError?: string;
  lastRefund?: PosRefund | null;
  onRefund: (input: {
    saleId: string;
    idempotencyKey: string;
    refundReference: string;
    refundMethod: PosRefundMethod;
    refundedTotal: string;
    reason: string;
    lines?: PosRefundRequest["lines"];
  }) => void;
  isRefunding?: boolean;
  refundError?: string;
  lastVoid?: PosVoid | null;
  onVoid: (input: {
    saleId: string;
    idempotencyKey: string;
    voidReference: string;
    reason: string;
    voidedAt: string;
  }) => void;
  isVoiding?: boolean;
  voidError?: string;
}) {
  const [catalogItemId, setCatalogItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("cash");
  const [splitCashAmount, setSplitCashAmount] = useState("");
  const [splitCardAmount, setSplitCardAmount] = useState("");
  const [splitBankTransferAmount, setSplitBankTransferAmount] = useState("");
  const [soldAt, setSoldAt] = useState("");

  const selectedCatalogItemId = catalogItemId || catalogItems[0]?.id || "";
  const selectedItem = catalogItems.find((item) => item.id === selectedCatalogItemId);
  const quantityNumber = toPositiveInteger(quantity);
  const unitPrice = typeof selectedItem?.listPrice === "number" ? selectedItem.listPrice : 0;
  const totalPreview =
    Number.isInteger(quantityNumber) && quantityNumber > 0 ? unitPrice * quantityNumber : Number.NaN;
  const lastSaleLedgerCount =
    lastSale?.postings.ledgerPostingCount ?? lastSale?.postings.ledgerPostingIds?.length;
  const splitInputs: Array<{
    paymentMethod: PosPaymentMethod;
    label: string;
    value: string;
    onChange: (value: string) => void;
    testId: string;
  }> = [
    {
      paymentMethod: "cash",
      label: "Cash",
      value: splitCashAmount,
      onChange: setSplitCashAmount,
      testId: "pos-sale-split-cash",
    },
    {
      paymentMethod: "card",
      label: "Card",
      value: splitCardAmount,
      onChange: setSplitCardAmount,
      testId: "pos-sale-split-card",
    },
    {
      paymentMethod: "bank-transfer",
      label: "Bank transfer",
      value: splitBankTransferAmount,
      onChange: setSplitBankTransferAmount,
      testId: "pos-sale-split-bank-transfer",
    },
  ];
  const hasSplitPayments = splitInputs.some((entry) => entry.value.trim().length > 0);
  const splitAmountsAreValid = splitInputs.every((entry) => {
    const text = entry.value.trim();
    if (!text) return true;
    const amount = toAmount(text);
    return Number.isInteger(amount) && amount >= 0;
  });
  const splitPayments: PosSalePaymentRequest[] = splitAmountsAreValid
    ? splitInputs
        .map((entry) => ({
          paymentMethod: entry.paymentMethod,
          amount: toAmount(entry.value.trim()),
        }))
        .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0)
    : [];
  const splitPaymentTotal = splitPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const splitPaymentsMatchTotal =
    !hasSplitPayments ||
    (splitAmountsAreValid &&
      splitPayments.length > 0 &&
      amountsEqual(splitPaymentTotal, totalPreview));
  const splitPaymentError =
    hasSplitPayments && !splitAmountsAreValid
      ? "Split amounts must be whole AMD amounts."
      : hasSplitPayments && !splitPaymentsMatchTotal
        ? `Split total must match ${moneyOrDash(totalPreview)}.`
        : "";
  const canSubmit =
    Boolean(selectedItem) &&
    receiptNumber.trim().length > 0 &&
    Number.isInteger(quantityNumber) &&
    quantityNumber > 0 &&
    splitPaymentsMatchTotal &&
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
        className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_90px_140px_minmax(150px,1fr)_140px_minmax(170px,1fr)_auto]"
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
            ...(hasSplitPayments ? { payments: splitPayments } : {}),
            soldAt,
            customerId,
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
          Customer
          <select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
            data-testid="pos-sale-customer"
          >
            <option value="">Walk-in customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
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

        <fieldset
          className="md:col-span-7 grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 pb-2 pt-1 sm:grid-cols-[repeat(3,minmax(0,1fr))_minmax(120px,auto)]"
          data-testid="pos-sale-split-payments"
        >
          <legend className="px-1 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            Split payment
          </legend>
          {splitInputs.map((entry) => (
            <label
              key={entry.paymentMethod}
              className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]"
            >
              {entry.label}
              <input
                type="number"
                min="0"
                step="1"
                value={entry.value}
                onChange={(event) => entry.onChange(event.target.value)}
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                data-testid={entry.testId}
              />
            </label>
          ))}
          <div className="flex flex-col justify-end gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              Split total
            </span>
            <span
              className="h-9 whitespace-nowrap text-[var(--text-sm)] font-semibold leading-9 text-[var(--color-ink)]"
              data-testid="pos-sale-split-total"
            >
              {money(splitPaymentTotal)}
            </span>
          </div>
          {splitPaymentError ? (
            <p
              role="alert"
              className="sm:col-span-4 text-[var(--text-xs)] text-[var(--color-ruby)]"
              data-testid="pos-sale-split-error"
            >
              {splitPaymentError}
            </p>
          ) : null}
        </fieldset>

        <div className="md:col-span-7 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
            className="md:col-span-7 text-[var(--text-sm)] text-[var(--color-ruby)]"
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
            {saleOutcomeLabel(lastSale)} {lastSale.id} · receipt{" "}
            {lastSale.receiptNumber} · {money(lastSale.total)} · status {lastSale.status} · ledger{" "}
            {lastSale.postings.ledgerPosting}
            {typeof lastSaleLedgerCount === "number"
              ? ` (${journalCountLabel(lastSaleLedgerCount)})`
              : ""}
          </p>
          <SalePaymentEvidence sale={lastSale} />
          {!isTerminalSale(lastSale) || receiptPacket ? (
            <ReceiptPacketHandoff
              key={`${lastSale.id}-${session.fiscalDeviceId ?? ""}`}
              sale={lastSale}
              defaultFiscalDeviceId={session.fiscalDeviceId ?? ""}
              packet={receiptPacket ?? null}
              onSubmit={onPrepareReceiptPacket}
              isPending={isPreparingReceiptPacket}
              error={receiptPacketError}
              receiptPrint={receiptPrint ?? null}
              onPrepareReceiptPrint={onPrepareReceiptPrint}
              isPreparingReceiptPrint={isPreparingReceiptPrint}
              receiptPrintError={receiptPrintError}
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
          <VoidEvidencePanel
            key={`${lastSale.id}-void`}
            sale={lastSale}
            voidEvidence={lastVoid ?? null}
            onSubmit={onVoid}
            isPending={isVoiding}
            error={voidError}
          />
        </div>
      ) : null}
    </div>
  );
}

function SalePaymentEvidence({ sale }: { sale: PosCreateSaleResponse["sale"] }) {
  const explicitTotals = POS_PAYMENT_METHODS.map((method) => ({
    ...method,
    amount: salePaymentMethodTotal(sale, method.value),
  }));
  const hasMethodEvidence = explicitTotals.some((entry) => entry.amount !== undefined);
  const methodTotals = explicitTotals.map((entry) => ({
    ...entry,
    amount:
      entry.amount ??
      (hasMethodEvidence ? 0 : entry.value === sale.paymentMethod ? sale.total : 0),
  }));
  const paymentCount = sale.paymentCount ?? sale.payments?.length ?? 1;
  const paidCash = finiteAmount(sale.paidCash);

  return (
    <dl
      className="grid gap-2 text-[var(--text-xs)] sm:grid-cols-2 lg:grid-cols-6"
      data-testid="pos-sale-payment-evidence"
    >
      <EvidenceRow label="Customer" value={saleCustomerLabel(sale)} />
      <EvidenceRow label="Payment method" value={paymentMethodLabel(sale.paymentMethod)} />
      <EvidenceRow label="Payment count" value={String(paymentCount)} />
      {methodTotals.map((entry) => (
        <EvidenceRow key={entry.value} label={entry.label} value={money(entry.amount)} />
      ))}
      {paidCash !== undefined ? <EvidenceRow label="Paid cash" value={money(paidCash)} /> : null}
    </dl>
  );
}

export function ReceiptPacketHandoff({
  sale,
  defaultFiscalDeviceId,
  packet,
  onSubmit,
  isPending,
  error,
  receiptPrint,
  onPrepareReceiptPrint,
  isPreparingReceiptPrint,
  receiptPrintError,
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
  receiptPrint: PosReceiptPrint | null;
  onPrepareReceiptPrint: (input: {
    saleId: string;
  }) => void;
  isPreparingReceiptPrint?: boolean;
  receiptPrintError?: string;
}) {
  const [fiscalDeviceId, setFiscalDeviceId] = useState(defaultFiscalDeviceId);
  const canSubmit = fiscalDeviceId.trim().length > 0 && !isPending;
  const canPreparePrint = Boolean(packet) && !isPreparingReceiptPrint;
  const previewLines = receiptPrint ? receiptPrintPreviewLines(receiptPrint) : [];

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
        <>
          <p
            className="text-[var(--text-sm)] font-medium text-[var(--color-tag-green)] sm:col-span-2"
            data-testid="pos-receipt-packet-success"
          >
            Receipt evidence {packet.status} · checksum {packet.checksum}
          </p>
          <section
            className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 sm:col-span-2"
            data-testid="pos-receipt-print-panel"
            data-entity="pos-receipt-print-evidence"
          >
            <div className="flex items-start gap-2">
              <Printer className="mt-0.5 size-4 text-[var(--color-brand)]" aria-hidden />
              <div>
                <h4 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                  Local print evidence
                </h4>
                <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
                  Local print preview only · no fiscal device submission
                </p>
              </div>
            </div>

            {receiptPrint ? (
              <div
                className="grid gap-2 text-[var(--text-sm)]"
                data-testid="pos-receipt-print-success"
              >
                <p className="font-medium text-[var(--color-tag-green)]">
                  Local print evidence {receiptPrint.status}
                  {receiptPrint.checksum ? ` · checksum ${receiptPrint.checksum}` : ""}
                </p>
                <dl className="grid gap-1 sm:grid-cols-2">
                  <EvidenceRow
                    label="Mode"
                    value={receiptPrint.printMode ?? "local-preview"}
                  />
                  <EvidenceRow
                    label="Device submission"
                    value={
                      receiptPrint.deviceSubmissionStatus ??
                      (receiptPrint.submittedToDevice ? "submitted" : "not-submitted")
                    }
                  />
                  <EvidenceRow
                    label="Receipt"
                    value={receiptPrint.receiptNumber ?? packet.receiptNumber ?? sale.receiptNumber}
                  />
                  <EvidenceRow
                    label="Prepared"
                    value={formatDateTime(
                      receiptPrint.preparedAt ?? receiptPrint.printedAt ?? receiptPrint.createdAt,
                    )}
                  />
                </dl>
                {previewLines.length > 0 ? (
                  <pre
                    className="max-h-40 overflow-auto rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2 font-mono text-[var(--text-xs)] text-[var(--color-ink)]"
                    data-testid="pos-receipt-print-preview"
                  >
                    {previewLines.join("\n")}
                  </pre>
                ) : null}
                <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
                  Local print evidence only; no printer or fiscal device submission is triggered.
                </p>
              </div>
            ) : (
              <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
                Prepare a local receipt print preview from the prepared packet. This records
                local print evidence only; it does not submit to a fiscal device.
              </p>
            )}

            <div>
              <button
                type="button"
                disabled={!canPreparePrint}
                onClick={() => onPrepareReceiptPrint({ saleId: sale.id })}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="pos-receipt-print-submit"
              >
                <Printer className="size-4" aria-hidden />
                {isPreparingReceiptPrint ? "Preparing…" : "Prepare local preview"}
              </button>
            </div>

            {receiptPrintError ? (
              <p
                role="alert"
                className="text-[var(--text-sm)] text-[var(--color-ruby)]"
                data-testid="pos-receipt-print-error"
              >
                {receiptPrintError}
              </p>
            ) : null}
          </section>
        </>
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
    refundedTotal: string;
    reason: string;
    lines?: PosRefundRequest["lines"];
  }) => void;
  isPending?: boolean;
  error?: string;
}) {
  const [idempotencyKey] = useState(
    () => `pos-refund-ui-${sale.id}-${Date.now()}`,
  );
  const [refundReference, setRefundReference] = useState("");
  const [refundMethod, setRefundMethod] = useState<PosRefundMethod>("cash");
  const [refundedTotal, setRefundedTotal] = useState("");
  const [reason, setReason] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const alreadyRefunded = isTerminalSale(sale) || Boolean(refund);
  const refundedAmount = optionalAmount(refundedTotal);
  const refundedTotalValid =
    refundedTotal.trim().length === 0 ||
    (typeof refundedAmount === "number" &&
      Number.isSafeInteger(refundedAmount) &&
      refundedAmount > 0 &&
      refundedAmount <= sale.total);
  const refundLineInputs = sale.lines.map((line) => {
    const quantityText = returnQuantities[line.id] ?? "";
    const normalizedText = quantityText.trim();
    const quantity = toPositiveInteger(normalizedText || "0");
    const soldQuantity = Number.isSafeInteger(line.quantity) ? line.quantity : 0;
    const isBlankOrZero = normalizedText.length === 0 || normalizedText === "0";
    const isValid =
      isBlankOrZero ||
      (Number.isSafeInteger(quantity) && quantity > 0 && quantity <= soldQuantity);
    const returnedTotal =
      isValid && quantity > 0 && soldQuantity > 0
        ? Math.round((line.total * quantity) / soldQuantity)
        : 0;
    return {
      line,
      quantityText,
      quantity,
      isBlankOrZero,
      isValid,
      returnedTotal,
    };
  });
  const refundReturnLines: NonNullable<PosRefundRequest["lines"]> = refundLineInputs
    .filter((entry) => entry.isValid && !entry.isBlankOrZero && entry.quantity > 0)
    .map((entry) => ({
      saleLineId: entry.line.id,
      quantity: entry.quantity,
    }));
  const returnLinesValid = refundLineInputs.every((entry) => entry.isValid);
  const lineReturnTotal = refundLineInputs.reduce((sum, entry) => sum + entry.returnedTotal, 0);
  const hasReturnLines = refundReturnLines.length > 0;
  const returnAmountMatches =
    !hasReturnLines ||
    refundedAmount === undefined ||
    refundedAmount === lineReturnTotal;
  const returnLineError = !returnLinesValid
    ? "Return quantity must be a whole number within sold quantity."
    : hasReturnLines && !returnAmountMatches
      ? `Amount must match returned-line total ${money(lineReturnTotal)}.`
      : "";
  const returnStockMoveCount = refund?.lines.filter((line) => line.returnStockMoveId).length ?? 0;
  const returnedStockLines = refund?.lines.filter((line) => line.returnStockMoveId) ?? [];
  const refundLedgerCount =
    refund?.postings.ledgerPostingCount ?? refund?.postings.ledgerPostingIds?.length;
  const refundLedgerStatus = refund?.ledgerPostingStatus ?? "ready";
  const refundStockEvidenceCopy =
    returnStockMoveCount > 0
      ? "Return stock evidence is recorded for tracked lines."
      : "Refund amount evidence is recorded without stock return moves.";
  const canSubmit =
    !alreadyRefunded &&
    refundReference.trim().length > 0 &&
    refundedTotalValid &&
    returnLinesValid &&
    returnAmountMatches &&
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
            Refund amount evidence · stock return evidence · ledger {refundLedgerStatus}
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
            <EvidenceRow label="Customer" value={refundCustomerLabel(refund, sale)} />
            <EvidenceRow label="Sale status" value={sale.status} />
            <EvidenceRow label="Refunded total" value={money(refund.refundedTotal)} />
            <EvidenceRow label="Cash adjustment" value={money(refund.cashAdjustment)} />
            <EvidenceRow label="Inventory" value={refund.inventoryPostingStatus} />
            <EvidenceRow label="Return stock moves" value={String(returnStockMoveCount)} />
            <EvidenceRow
              label="Ledger journals"
              value={
                typeof refundLedgerCount === "number"
                  ? `${refund.ledgerPostingStatus} (${journalCountLabel(refundLedgerCount)})`
                  : refund.ledgerPostingStatus
              }
            />
          </dl>
          {returnedStockLines.length > 0 ? (
            <div
              className="grid gap-1 border-t border-[var(--color-line)] pt-2 text-[var(--text-xs)] text-[var(--color-muted)]"
              data-testid="pos-refund-line-evidence"
            >
              {returnedStockLines.map((line) => {
                const soldLine = sale.lines.find((saleLine) => saleLine.id === line.saleLineId);
                return (
                  <p key={line.id}>
                    {line.name} · returned {line.quantity}
                    {soldLine ? ` / sold ${soldLine.quantity}` : ""} · {money(line.total)}
                  </p>
                );
              })}
            </div>
          ) : null}
          <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
            {refund.ledgerPostingStatus === "posted"
              ? `${refundStockEvidenceCopy} Ledger reversal journals are posted; fiscal refunds and receipt printing remain deferred.`
              : `${refundStockEvidenceCopy} Ledger journals, fiscal refunds, and receipt printing remain deferred.`}
          </p>
        </div>
      ) : alreadyRefunded ? (
        <p
          className="text-[var(--text-sm)] text-[var(--color-muted)]"
          data-testid="pos-refund-locked"
        >
          Refund or void evidence is already recorded for this sale.
        </p>
      ) : (
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px] lg:grid-cols-[minmax(0,1fr)_150px_150px_minmax(0,1.2fr)_auto]"
          data-testid="pos-refund-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onSubmit({
              saleId: sale.id,
              idempotencyKey,
              refundReference,
              refundMethod,
              refundedTotal,
              reason,
              ...(refundReturnLines.length ? { lines: refundReturnLines } : {}),
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
            Amount
            <input
              type="number"
              min="1"
              max={sale.total}
              step="1"
              value={refundedTotal}
              onChange={(event) => setRefundedTotal(event.target.value)}
              placeholder={money(sale.total)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
              data-testid="pos-refund-refunded-total"
            />
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

          <fieldset
            className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 sm:col-span-2 lg:col-span-5"
            data-testid="pos-refund-line-return"
          >
            <legend className="px-1 text-[var(--text-xs)] font-semibold text-[var(--color-muted)]">
              Return stock
            </legend>
            <div className="grid gap-2 md:grid-cols-2">
              {refundLineInputs.map((entry) => (
                <label
                  key={entry.line.id}
                  className="grid gap-1 text-[var(--text-xs)] font-medium text-[var(--color-ink)]"
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate">
                      {entry.line.sku} · {entry.line.name}
                    </span>
                    <span className="shrink-0 text-[var(--color-muted)]">
                      sold {entry.line.quantity}
                    </span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={entry.line.quantity}
                    step="1"
                    value={entry.quantityText}
                    onChange={(event) =>
                      setReturnQuantities((current) => ({
                        ...current,
                        [entry.line.id]: event.target.value,
                      }))
                    }
                    className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                    data-testid={`pos-refund-line-quantity-${entry.line.id}`}
                  />
                </label>
              ))}
            </div>
            <p
              className={cn(
                "text-[var(--text-xs)]",
                returnLineError ? "text-[var(--color-ruby)]" : "text-[var(--color-muted)]",
              )}
              data-testid="pos-refund-line-return-total"
            >
              {returnLineError || `Line return total ${money(lineReturnTotal)}`}
            </p>
          </fieldset>

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

export function VoidEvidencePanel({
  sale,
  voidEvidence,
  onSubmit,
  isPending,
  error,
}: {
  sale: PosCreateSaleResponse["sale"];
  voidEvidence: PosVoid | null;
  onSubmit: (input: {
    saleId: string;
    idempotencyKey: string;
    voidReference: string;
    reason: string;
    voidedAt: string;
  }) => void;
  isPending?: boolean;
  error?: string;
}) {
  const [idempotencyKey] = useState(() => `pos-void-ui-${sale.id}-${Date.now()}`);
  const [voidReference, setVoidReference] = useState("");
  const [reason, setReason] = useState("");
  const [voidedAt, setVoidedAt] = useState("");
  const alreadyClosed = isTerminalSale(sale) || Boolean(voidEvidence);
  const returnStockMoveCount =
    voidEvidence?.lines.filter((line) => line.returnStockMoveId).length ?? 0;
  const voidLedgerCount =
    voidEvidence?.postings.ledgerPostingCount ?? voidEvidence?.postings.ledgerPostingIds?.length;
  const voidLedgerStatus = voidEvidence?.ledgerPostingStatus ?? "ready";
  const voidStockEvidenceCopy =
    returnStockMoveCount > 0
      ? "Return stock evidence is recorded for tracked lines."
      : "Void amount evidence is recorded without stock return moves.";
  const canSubmit =
    !alreadyClosed &&
    voidReference.trim().length > 0 &&
    reason.trim().length > 0 &&
    !isPending;

  return (
    <section
      className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
      data-testid="pos-void-panel"
      data-entity="pos-void-evidence"
    >
      <div className="flex items-start gap-2">
        <ClipboardCheck className="mt-0.5 size-4 text-[var(--color-brand)]" aria-hidden />
        <div>
          <h4 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
            Void evidence
          </h4>
          <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
            Pre-receipt cancellation · stock return evidence · ledger {voidLedgerStatus}
          </p>
        </div>
      </div>

      {voidEvidence ? (
        <div className="grid gap-2 text-[var(--text-sm)]" data-testid="pos-void-success">
          <p className="font-medium text-[var(--color-tag-green)]">
            Void evidence {voidEvidence.status} · {money(voidEvidence.voidedTotal)}
          </p>
          <dl className="grid gap-1 sm:grid-cols-2">
            <EvidenceRow label="Reference" value={voidEvidence.voidReference} />
            <EvidenceRow label="Sale status" value={sale.status} />
            <EvidenceRow label="Voided total" value={money(voidEvidence.voidedTotal)} />
            <EvidenceRow label="Cash adjustment" value={money(voidEvidence.cashAdjustment)} />
            <EvidenceRow label="Inventory" value={voidEvidence.inventoryPostingStatus} />
            <EvidenceRow label="Return stock moves" value={String(returnStockMoveCount)} />
            <EvidenceRow
              label="Ledger journals"
              value={
                typeof voidLedgerCount === "number"
                  ? `${voidEvidence.ledgerPostingStatus} (${journalCountLabel(voidLedgerCount)})`
                  : voidEvidence.ledgerPostingStatus
              }
            />
          </dl>
          <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
            {voidEvidence.ledgerPostingStatus === "posted"
              ? `${voidStockEvidenceCopy} Ledger reversal journals are posted; fiscal voids and receipt printing remain deferred.`
              : `${voidStockEvidenceCopy} Ledger journals, fiscal voids, and receipt printing remain deferred.`}
          </p>
        </div>
      ) : alreadyClosed ? (
        <p
          className="text-[var(--text-sm)] text-[var(--color-muted)]"
          data-testid="pos-void-locked"
        >
          Void evidence is available only for posted sales before receipt handoff, refund, or void.
        </p>
      ) : (
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_180px_auto]"
          data-testid="pos-void-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onSubmit({
              saleId: sale.id,
              idempotencyKey,
              voidReference,
              reason,
              voidedAt,
            });
          }}
        >
          <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            Reference
            <input
              value={voidReference}
              onChange={(event) => setVoidReference(event.target.value)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
              data-testid="pos-void-reference"
            />
          </label>

          <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            Reason
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
              data-testid="pos-void-reason"
            />
          </label>

          <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
            Voided at
            <input
              type="datetime-local"
              value={voidedAt}
              onChange={(event) => setVoidedAt(event.target.value)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
              data-testid="pos-void-voided-at"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="pos-void-submit"
            >
              <ClipboardCheck className="size-4" aria-hidden />
              {isPending ? "Recording…" : "Record void"}
            </button>
          </div>
        </form>
      )}

      {error ? (
        <p
          role="alert"
          className="text-[var(--text-sm)] text-[var(--color-ruby)]"
          data-testid="pos-void-error"
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
        <EvidenceRow
          label="Ledger"
          value={openSession ? openSession.postings?.ledgerPosting ?? "not-posted" : "—"}
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

export function OfflineReplayReadinessPanel({
  capabilityStatus,
  items,
  openSession,
  lastSale,
  queuedItem,
  markedItem,
  onQueueSample,
  isQueuePending,
  queueError,
  onMarkItem,
  isMarkPending,
  markError,
  listError,
}: {
  capabilityStatus?: PosCapabilityStatus;
  items: readonly PosOfflineReplayItem[];
  openSession: PosCashSession | null;
  lastSale?: PosCreateSaleResponse["sale"] | null;
  queuedItem?: PosOfflineReplayItem | null;
  markedItem?: PosOfflineReplayItem | null;
  onQueueSample: (input: {
    cashSessionId?: string;
    saleId?: string;
  }) => void;
  isQueuePending?: boolean;
  queueError?: string;
  onMarkItem: (input: {
    itemId: string;
    replayStatus: PosOfflineReplayMarkStatus;
    note: string;
  }) => void;
  isMarkPending?: boolean;
  markError?: string;
  listError?: string;
}) {
  const visibleItems = items.slice(0, 5);
  const queuedItems = items.filter((item) => item.replayStatus === "queued");
  const canQueueSample = Boolean(openSession) && !isQueuePending;

  return (
    <section
      className="panel space-y-3"
      data-testid="pos-offline-replay-panel"
      data-entity="pos-offline-replay-readiness"
    >
      <div className="flex items-center gap-2">
        <RotateCcw className="size-4 text-[var(--color-brand)]" aria-hidden />
        <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Offline replay readiness
        </h2>
      </div>

      <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
        Local readiness/evidence only; this does not run browser offline mode,
        fiscal submission, terminal submission, or printer commands.
      </p>

      <dl className="grid gap-2 text-[var(--text-sm)]">
        <EvidenceRow
          label="Capability"
          value={offlineReplayCapabilityLabel(capabilityStatus)}
        />
        <EvidenceRow label="Recent items" value={String(items.length)} />
        <EvidenceRow label="Queued" value={String(queuedItems.length)} />
      </dl>

      {listError ? (
        <p
          role="alert"
          className="text-[var(--text-xs)] text-[var(--color-ruby)]"
          data-testid="pos-offline-replay-list-error"
        >
          Replay list unavailable: {listError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          Sample evidence records queue plumbing for the POS UI only.
        </p>
        <button
          type="button"
          disabled={!canQueueSample}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="pos-offline-replay-submit"
          onClick={() =>
            onQueueSample({
              ...(openSession ? { cashSessionId: openSession.id } : {}),
              ...(lastSale ? { saleId: lastSale.id } : {}),
            })
          }
        >
          <ClipboardCheck className="size-4" aria-hidden />
          {isQueuePending ? "Queuing..." : "Queue sample"}
        </button>
      </div>
      {!openSession ? (
        <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
          Open a cash session before queueing local replay evidence.
        </p>
      ) : null}

      {queuedItem ? (
        <p
          className="text-[var(--text-sm)] font-medium text-[var(--color-tag-green)]"
          data-testid="pos-offline-replay-success"
        >
          Queued local readiness evidence {queuedItem.id} · status{" "}
          {queuedItem.replayStatus}
        </p>
      ) : null}

      {markedItem ? (
        <p
          className="text-[var(--text-sm)] font-medium text-[var(--color-tag-green)]"
          data-testid="pos-offline-replay-mark-success"
        >
          Replay item {markedItem.id} marked {markedItem.replayStatus}.
        </p>
      ) : null}

      {queueError ? (
        <p
          role="alert"
          className="text-[var(--text-sm)] text-[var(--color-ruby)]"
          data-testid="pos-offline-replay-error"
        >
          {queueError}
        </p>
      ) : null}

      {markError ? (
        <p
          role="alert"
          className="text-[var(--text-sm)] text-[var(--color-ruby)]"
          data-testid="pos-offline-replay-mark-error"
        >
          {markError}
        </p>
      ) : null}

      {visibleItems.length === 0 ? (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          No offline replay evidence queued yet.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="pos-offline-replay-items">
          {visibleItems.map((item) => {
            const canMark = item.replayStatus === "queued" && !isMarkPending;
            return (
              <li
                key={item.id}
                className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-2"
                data-testid="pos-offline-replay-item"
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                        {item.actionType}
                      </p>
                      <p className="truncate font-mono text-[11px] text-[var(--color-muted)]">
                        {item.sourceKey}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        item.replayStatus === "replayed"
                          ? "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]"
                          : item.replayStatus === "rejected"
                            ? "bg-[color-mix(in_srgb,var(--color-ruby)_12%,transparent)] text-[var(--color-ruby)]"
                            : "bg-[color-mix(in_srgb,var(--color-brand)_12%,transparent)] text-[var(--color-brand)]",
                      )}
                    >
                      {item.replayStatus}
                    </span>
                  </div>
                  <dl className="grid gap-1 text-[var(--text-xs)]">
                    <EvidenceRow
                      label="Session"
                      value={item.cashSessionId ?? "workspace"}
                    />
                    <EvidenceRow label="Sale" value={item.saleId ?? "—"} />
                    <EvidenceRow
                      label="Recorded"
                      value={formatDateTime(offlineReplayItemTimestamp(item))}
                    />
                  </dl>
                  {item.note ? (
                    <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
                      {item.note}
                    </p>
                  ) : null}
                  {item.replayStatus === "queued" ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canMark}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-xs)] font-semibold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="pos-offline-replay-mark-replayed"
                        onClick={() =>
                          onMarkItem({
                            itemId: item.id,
                            replayStatus: "replayed",
                            note: "Marked replayed from POS local readiness panel.",
                          })
                        }
                      >
                        <ClipboardCheck className="size-3.5" aria-hidden />
                        Mark replayed
                      </button>
                      <button
                        type="button"
                        disabled={!canMark}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-xs)] font-semibold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="pos-offline-replay-mark-rejected"
                        onClick={() =>
                          onMarkItem({
                            itemId: item.id,
                            replayStatus: "rejected",
                            note: "Rejected from POS local readiness panel.",
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function TerminalSettlementPanel({
  previews,
  postedSettlement,
  onSubmit,
  isPending,
  error,
}: {
  previews: readonly PosTerminalSettlementPreview[];
  postedSettlement: PosTerminalSettlement | null;
  onSubmit: (input: {
    sessionId: string;
    idempotencyKey: string;
    settlementReference: string;
    provider: string;
    settledTotal: string;
    processorFee: string;
    processorFeeAccountCode?: string;
    settledAt: string;
    note: string;
  }) => void;
  isPending?: boolean;
  error?: string;
}) {
  const defaultPreview = previews.find((preview) => preview.ready) ?? previews[0] ?? null;
  const [cashSessionId, setCashSessionId] = useState(defaultPreview?.cashSessionId ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(
    () => `pos-terminal-settlement-ui-${defaultPreview?.cashSessionId ?? "session"}-${Date.now()}`,
  );
  const [settlementReference, setSettlementReference] = useState("");
  const [provider, setProvider] = useState("Acba POS");
  const [settledTotal, setSettledTotal] = useState(
    defaultPreview ? String(defaultPreview.outstandingAmount) : "",
  );
  const [processorFee, setProcessorFee] = useState("");
  const [settledAt, setSettledAt] = useState("");
  const [note, setNote] = useState("");

  const selectedCashSessionId = cashSessionId || defaultPreview?.cashSessionId || "";
  const selectedPreview =
    previews.find((preview) => preview.cashSessionId === selectedCashSessionId) ??
    defaultPreview;
  const settledAmount = toAmount(settledTotal);
  const processorFeeAmount = optionalAmount(processorFee) ?? 0;
  const processorFeeProvided = processorFee.trim().length > 0;
  const processorFeeValid =
    !processorFeeProvided ||
    (Number.isSafeInteger(processorFeeAmount) && processorFeeAmount >= 0);
  const clearedAmount =
    Number.isSafeInteger(settledAmount) && processorFeeValid
      ? settledAmount + processorFeeAmount
      : Number.NaN;
  const clearedDifference =
    selectedPreview && Number.isFinite(clearedAmount)
      ? clearedAmount - selectedPreview.outstandingAmount
      : Number.NaN;
  const outstandingAfterCleared =
    selectedPreview && Number.isFinite(clearedAmount)
      ? selectedPreview.outstandingAmount - clearedAmount
      : Number.NaN;
  const previewProcessorFees = selectedPreview?.processorFeeTotal ?? 0;
  const previewClearedTotal =
    selectedPreview?.clearedTotal ?? (selectedPreview?.settledTotal ?? 0) + previewProcessorFees;
  const previewFeeAccountCode =
    selectedPreview?.processorFeeAccountCode ?? selectedPreview?.feeAccountCode;
  const postedLedgerCount =
    postedSettlement?.postings.totalLedgerPostingCount ??
    postedSettlement?.postings.ledgerPostingCount ??
    postedSettlement?.postings.ledgerPostingIds?.length;
  const postedProcessorFee = postedSettlement
    ? settlementProcessorFee(postedSettlement)
    : 0;
  const postedProcessorFeeAccountCode =
    postedSettlement?.processorFeeAccountCode ?? postedSettlement?.feeAccountCode;
  const postedClearedTotal = postedSettlement
    ? settlementClearedTotal(postedSettlement)
    : 0;
  const postedOutstandingAfter = postedSettlement
    ? settlementOutstandingAfter(postedSettlement)
    : 0;
  const postedFeeLedgerCount =
    postedSettlement?.postings.processorFeeLedgerPostingCount ??
    postedSettlement?.postings.feeLedgerPostingCount ??
    postedSettlement?.postings.processorFeeLedgerPostingIds?.length ??
    postedSettlement?.postings.feeLedgerPostingIds?.length;
  const postedFeeLedgerStatus =
    postedSettlement?.postings.processorFeeLedgerPosting ??
    postedSettlement?.postings.feeLedgerPosting ??
    postedSettlement?.postings.processorFeePosting ??
    postedSettlement?.postings.feePosting;
  const canSubmit =
    Boolean(selectedPreview?.ready) &&
    selectedCashSessionId.length > 0 &&
    idempotencyKey.trim().length > 0 &&
    settlementReference.trim().length > 0 &&
    provider.trim().length > 0 &&
    Number.isSafeInteger(settledAmount) &&
    processorFeeValid &&
    Number.isSafeInteger(clearedAmount) &&
    clearedAmount > 0 &&
    clearedAmount <= (selectedPreview?.outstandingAmount ?? 0) &&
    !isPending;

  return (
    <section
      className="panel space-y-3"
      data-testid="pos-terminal-settlement-panel"
      data-entity="pos-terminal-settlement"
    >
      <div className="flex items-center gap-2">
        <CreditCard className="size-4 text-[var(--color-brand)]" aria-hidden />
        <h2 className="text-[var(--text-md)] font-semibold text-[var(--color-ink)]">
          Terminal settlement
        </h2>
      </div>

      {!selectedPreview ? (
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          No closed-session card clearing preview.
        </p>
      ) : (
        <>
          <dl
            className="grid gap-2 text-[var(--text-sm)]"
            data-testid="pos-terminal-settlement-preview"
          >
            <EvidenceRow label="Cash session" value={selectedPreview.cashSessionId} />
            <EvidenceRow label="Status" value={selectedPreview.sessionStatus} />
            <EvidenceRow label="Card sales" value={money(selectedPreview.cardSalesTotal)} />
            <EvidenceRow label="Card refunds" value={money(selectedPreview.cardRefundsTotal)} />
            <EvidenceRow label="Already settled" value={money(selectedPreview.settledTotal)} />
            <EvidenceRow label="Posted processor fees" value={money(previewProcessorFees)} />
            <EvidenceRow label="Cleared to date" value={money(previewClearedTotal)} />
            <EvidenceRow label="Outstanding" value={money(selectedPreview.outstandingAmount)} />
            <EvidenceRow label="Clearing account" value={selectedPreview.clearingAccountCode} />
            <EvidenceRow label="Bank account" value={selectedPreview.bankAccountCode} />
            {previewFeeAccountCode ? (
              <EvidenceRow
                label="Fee account"
                value={previewFeeAccountCode}
              />
            ) : null}
          </dl>

          {postedSettlement ? (
            <div
              className="grid gap-2 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--color-tag-green)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-tag-green)_8%,transparent)] p-2 text-[var(--text-sm)]"
              data-testid="pos-terminal-settlement-success"
            >
              <p className="font-medium text-[var(--color-tag-green)]">
                Terminal settlement {postedSettlement.status} ·{" "}
                {postedSettlement.settlementReference} · cleared {money(postedClearedTotal)}
              </p>
              <dl className="grid gap-1 sm:grid-cols-2">
                <EvidenceRow label="Provider" value={postedSettlement.provider} />
                <EvidenceRow label="Bank deposit" value={money(postedSettlement.settledTotal)} />
                <EvidenceRow
                  label="Processor fee"
                  value={
                    postedProcessorFeeAccountCode
                      ? `${money(postedProcessorFee)} · ${postedProcessorFeeAccountCode}`
                      : money(postedProcessorFee)
                  }
                />
                <EvidenceRow label="Cleared total" value={money(postedClearedTotal)} />
                <EvidenceRow label="Difference" value={money(postedSettlement.difference)} />
                <EvidenceRow
                  label="Outstanding after"
                  value={money(postedOutstandingAfter)}
                />
                <EvidenceRow
                  label="Clearing account"
                  value={postedSettlement.clearingAccountCode}
                />
                <EvidenceRow label="Bank account" value={postedSettlement.bankAccountCode} />
                <EvidenceRow
                  label="Ledger journals"
                  value={
                    typeof postedLedgerCount === "number"
                      ? `${postedSettlement.ledgerPostingStatus} (${journalCountLabel(postedLedgerCount)})`
                      : postedSettlement.ledgerPostingStatus
                  }
                />
                {postedProcessorFee > 0 || postedFeeLedgerStatus ? (
                  <EvidenceRow
                    label="Fee journals"
                    value={postingEvidenceLabel(postedFeeLedgerStatus, postedFeeLedgerCount)}
                  />
                ) : null}
                <EvidenceRow
                  label="Settled at"
                  value={formatDateTime(postedSettlement.settledAt)}
                />
              </dl>
            </div>
          ) : null}

          {selectedPreview.ready ? (
            <form
              className="grid gap-2 sm:grid-cols-2"
              data-testid="pos-terminal-settlement-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canSubmit) return;
                onSubmit({
                  sessionId: selectedCashSessionId,
                  idempotencyKey,
                  settlementReference,
                  provider,
                  settledTotal,
                  processorFee,
                  processorFeeAccountCode: previewFeeAccountCode,
                  settledAt,
                  note,
                });
              }}
            >
              <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                Session
                <select
                  value={selectedCashSessionId}
                  onChange={(event) => {
                    const nextSessionId = event.target.value;
                    const nextPreview = previews.find(
                      (preview) => preview.cashSessionId === nextSessionId,
                    );
                    setCashSessionId(nextSessionId);
                    setIdempotencyKey(
                      `pos-terminal-settlement-ui-${nextSessionId}-${Date.now()}`,
                    );
                    setSettledTotal(
                      nextPreview ? String(nextPreview.outstandingAmount) : "",
                    );
                    setProcessorFee("");
                  }}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                  data-testid="pos-terminal-settlement-session"
                >
                  {previews.map((preview) => (
                    <option key={preview.cashSessionId} value={preview.cashSessionId}>
                      {preview.cashSessionId}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                Reference
                <input
                  value={settlementReference}
                  onChange={(event) => setSettlementReference(event.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                  data-testid="pos-terminal-settlement-reference"
                />
              </label>

              <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                Provider
                <input
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                  data-testid="pos-terminal-settlement-provider"
                />
              </label>

              <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                Settled bank deposit
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settledTotal}
                  onChange={(event) => setSettledTotal(event.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                  data-testid="pos-terminal-settlement-settled-total"
                />
              </label>

              <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                Processor fee
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={processorFee}
                  onChange={(event) => setProcessorFee(event.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                  data-testid="pos-terminal-settlement-processor-fee"
                />
              </label>

              <div
                className="sm:col-span-2 grid gap-2 sm:grid-cols-3"
                data-testid="pos-terminal-settlement-calculation"
              >
                <EvidenceRow label="Cleared total" value={moneyOrDash(clearedAmount)} />
                <EvidenceRow
                  label="Cleared difference"
                  value={moneyOrDash(clearedDifference)}
                />
                <EvidenceRow
                  label="Outstanding after"
                  value={moneyOrDash(outstandingAfterCleared)}
                />
              </div>

              <label className="flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                Settled at
                <input
                  type="datetime-local"
                  value={settledAt}
                  onChange={(event) => setSettledAt(event.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)]"
                  data-testid="pos-terminal-settlement-settled-at"
                />
              </label>

              <label className="sm:col-span-2 flex flex-col gap-1 text-[var(--text-sm)] font-medium text-[var(--color-ink)]">
                Note
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
                  data-testid="pos-terminal-settlement-note"
                />
              </label>

              <div className="sm:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[var(--text-xs)] text-[var(--color-muted)]">
                  Posts card clearing from account {selectedPreview.clearingAccountCode} to{" "}
                  {selectedPreview.bankAccountCode}
                  {processorFeeProvided && previewFeeAccountCode
                    ? ` with fee evidence in ${previewFeeAccountCode}.`
                    : "."}
                </p>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand)] px-3 text-[var(--text-sm)] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="pos-terminal-settlement-submit"
                >
                  <CreditCard className="size-4" aria-hidden />
                  {isPending ? "Posting..." : "Post settlement"}
                </button>
              </div>
            </form>
          ) : (
            <p
              className="text-[var(--text-sm)] text-[var(--color-muted)]"
              data-testid="pos-terminal-settlement-not-ready"
            >
              No outstanding card clearing amount for this closed session.
            </p>
          )}
        </>
      )}

      {error ? (
        <p
          role="alert"
          className="text-[var(--text-sm)] text-[var(--color-ruby)]"
          data-testid="pos-terminal-settlement-error"
        >
          {error}
        </p>
      ) : null}
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

function mergeOfflineReplayItems(
  ...lists: Array<readonly PosOfflineReplayItem[]>
): PosOfflineReplayItem[] {
  const byId = new Map<string, PosOfflineReplayItem>();
  for (const list of lists) {
    for (const item of list) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }
  return Array.from(byId.values());
}

function offlineReplayCapabilityLabel(status?: PosCapabilityStatus): string {
  return status?.offlineReplay?.trim() || "not advertised";
}

function offlineReplayItemTimestamp(item: PosOfflineReplayItem): string | null | undefined {
  return (
    item.replayedAt ??
    item.rejectedAt ??
    item.queuedAt ??
    item.createdAt ??
    item.updatedAt
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

function optionalAmount(value: string): number | undefined {
  const text = value.trim();
  return text.length > 0 ? toAmount(text) : undefined;
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

function isTerminalSale(sale: { status: string }): boolean {
  return isRefundedSale(sale) || sale.status === "voided";
}

function saleOutcomeLabel(sale: { status: string }): string {
  if (sale.status === "voided") return "Voided sale";
  if (isRefundedSale(sale)) return "Refunded sale";
  return "Posted sale";
}

function saleCustomerLabel(sale: Pick<PosCreateSaleResponse["sale"], "customerId" | "customerName">): string {
  return sale.customerName?.trim() || sale.customerId?.trim() || "Walk-in customer";
}

function refundCustomerLabel(
  refund: Pick<PosRefund, "customerId" | "customerName">,
  sale: Pick<PosCreateSaleResponse["sale"], "customerId" | "customerName">,
): string {
  return (
    refund.customerName?.trim() ||
    refund.customerId?.trim() ||
    saleCustomerLabel(sale)
  );
}

function refundMethodLabel(method: PosRefundMethod): string {
  return POS_REFUND_METHODS.find((entry) => entry.value === method)?.label ?? method;
}

function paymentMethodLabel(method: PosPaymentMethod): string {
  return POS_PAYMENT_METHODS.find((entry) => entry.value === method)?.label ?? method;
}

function salePaymentMethodTotal(
  sale: PosCreateSaleResponse["sale"],
  method: PosPaymentMethod,
): number | undefined {
  const rowTotal = sale.payments?.reduce((sum, payment) => {
    const rowMethod = payment.paymentMethod ?? payment.method;
    return rowMethod === method ? sum + payment.amount : sum;
  }, 0);

  if (method === "cash") {
    return firstFiniteAmount(
      sale.paidCash,
      sale.cashTotal,
      paymentRecordAmount(sale.paymentTotals, method),
      paymentRecordAmount(sale.paymentTotalsByMethod, method),
      paymentRecordAmount(sale.paidByMethod, method),
      rowTotal,
    );
  }

  if (method === "card") {
    return firstFiniteAmount(
      sale.paidCard,
      sale.cardTotal,
      paymentRecordAmount(sale.paymentTotals, method),
      paymentRecordAmount(sale.paymentTotalsByMethod, method),
      paymentRecordAmount(sale.paidByMethod, method),
      rowTotal,
    );
  }

  return firstFiniteAmount(
    sale.paidBankTransfer,
    sale.bankTransferTotal,
    paymentRecordAmount(sale.paymentTotals, method),
    paymentRecordAmount(sale.paymentTotalsByMethod, method),
    paymentRecordAmount(sale.paidByMethod, method),
    rowTotal,
  );
}

function paymentRecordAmount(
  record: Record<string, number> | undefined,
  method: PosPaymentMethod,
): number | undefined {
  if (!record) return undefined;
  const keys =
    method === "bank-transfer"
      ? ["bank-transfer", "bankTransfer", "bank_transfer", "bank"]
      : [method];
  for (const key of keys) {
    const amount = finiteAmount(record[key]);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

function firstFiniteAmount(...values: unknown[]): number | undefined {
  for (const value of values) {
    const amount = finiteAmount(value);
    if (amount !== undefined) return amount;
  }
  return undefined;
}

function finiteAmount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function amountsEqual(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.01;
}

function journalCountLabel(count: number): string {
  return `${count} journal${count === 1 ? "" : "s"}`;
}

function postingEvidenceLabel(status: string | undefined, count: number | undefined): string {
  if (typeof count === "number") return `${status ?? "posted"} (${journalCountLabel(count)})`;
  return status ?? "—";
}

function receiptPrintPreviewLines(receiptPrint: PosReceiptPrint): string[] {
  if (Array.isArray(receiptPrint.previewLines) && receiptPrint.previewLines.length > 0) {
    return receiptPrint.previewLines.filter((line) => line.trim().length > 0);
  }
  if (typeof receiptPrint.previewText === "string" && receiptPrint.previewText.trim().length > 0) {
    return receiptPrint.previewText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }
  return [];
}

function moneyOrDash(value: number): string {
  return Number.isFinite(value) ? money(value) : "—";
}

function settlementProcessorFee(settlement: PosTerminalSettlement): number {
  return settlement.processorFee ?? 0;
}

function settlementClearedTotal(settlement: PosTerminalSettlement): number {
  return (
    settlement.clearedTotal ??
    settlement.clearingReductionTotal ??
    settlement.clearingReduction ??
    settlement.settledTotal + settlementProcessorFee(settlement)
  );
}

function settlementOutstandingAfter(settlement: PosTerminalSettlement): number {
  return (
    settlement.outstandingAfterSettledAndFee ??
    settlement.outstandingAfterSettlement ??
    settlement.outstandingAmount ??
    settlement.expectedTotal - settlementClearedTotal(settlement)
  );
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
