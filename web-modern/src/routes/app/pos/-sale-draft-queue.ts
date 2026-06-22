import { ApiError, postJson } from "../../../lib/api/client";
import {
  PosCreateSaleRequestSchema,
  PosCreateSaleResponseSchema,
  type PosCreateSaleRequest,
  type PosCreateSaleResponse,
} from "../../../lib/api/schemas";

export const POS_SALE_DRAFT_QUEUE_STORAGE_KEY = "a1:pos:local-sale-drafts:v1";
const POS_SALE_DRAFT_QUEUE_LIMIT = 25;

export type PosLocalSaleDraftReason = "manual" | "post-failed" | "browser-offline";
export type PosLocalSaleDraftAutoReplayStatus =
  | "queued"
  | "retrying"
  | "retryable-failed"
  | "conflict-ready"
  | "failed";
export type PosLocalSaleDraftAutoReplayBlockReason =
  | "auth"
  | "business-validation"
  | "closed-session"
  | "conflict"
  | "client-error";
export type PosLocalSaleDraftOfflineReplayStatus = "queued" | "replayed" | "rejected";

export type PosLocalSaleDraftEvidence = {
  receiptNumber: string;
  customerLabel: string;
  paymentLabel: string;
  lineLabel: string;
  quantity: number;
  total: number | null;
};

export type PosLocalSaleDraft = {
  id: string;
  cashSessionId: string;
  payload: PosCreateSaleRequest;
  queuedAt: string;
  queueReason: PosLocalSaleDraftReason;
  autoReplayStatus: PosLocalSaleDraftAutoReplayStatus;
  autoReplayAttemptCount: number;
  lastError?: string;
  lastRetryAt?: string;
  autoReplayLastAttemptAt?: string;
  autoReplayLastFailureAt?: string;
  autoReplayBlockReason?: PosLocalSaleDraftAutoReplayBlockReason;
  offlineReplayItemId?: string;
  offlineReplaySourceKey?: string;
  offlineReplayStatus?: PosLocalSaleDraftOfflineReplayStatus;
  evidence: PosLocalSaleDraftEvidence;
};

export type PosLocalSaleDraftAutoReplayFailure = {
  status: Exclude<PosLocalSaleDraftAutoReplayStatus, "queued" | "retrying">;
  canAutoRetry: boolean;
  message: string;
  blockReason?: PosLocalSaleDraftAutoReplayBlockReason;
};

function getSaleDraftQueueStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resetQueuedPosSaleDrafts(): void {
  const storage = getSaleDraftQueueStorage();
  if (!storage) return;
  try {
    storage.setItem(POS_SALE_DRAFT_QUEUE_STORAGE_KEY, "[]");
  } catch {
    // Storage can be unavailable in private browsing or quota pressure.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeIntegerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeSaleDraftReason(value: unknown): PosLocalSaleDraftReason {
  return value === "post-failed" || value === "browser-offline" || value === "manual"
    ? value
    : "manual";
}

function normalizeAutoReplayStatus(value: unknown): PosLocalSaleDraftAutoReplayStatus {
  return value === "queued" ||
    value === "retrying" ||
    value === "retryable-failed" ||
    value === "conflict-ready" ||
    value === "failed"
    ? value
    : "queued";
}

function normalizeAutoReplayBlockReason(
  value: unknown,
): PosLocalSaleDraftAutoReplayBlockReason | undefined {
  return value === "auth" ||
    value === "business-validation" ||
    value === "closed-session" ||
    value === "conflict" ||
    value === "client-error"
    ? value
    : undefined;
}

function normalizeOfflineReplayStatus(
  value: unknown,
): PosLocalSaleDraftOfflineReplayStatus | undefined {
  return value === "queued" || value === "replayed" || value === "rejected"
    ? value
    : undefined;
}

function normalizeSaleDraftEvidence(
  value: unknown,
  payload: PosCreateSaleRequest,
): PosLocalSaleDraftEvidence | null {
  if (!isRecord(value)) return null;
  return {
    receiptNumber: stringValue(value.receiptNumber) || payload.receiptNumber,
    customerLabel:
      stringValue(value.customerLabel) || payload.customerId || "Walk-in customer",
    paymentLabel: stringValue(value.paymentLabel) || payload.paymentMethod,
    lineLabel:
      stringValue(value.lineLabel) ||
      `${payload.lines.length} sale line${payload.lines.length === 1 ? "" : "s"}`,
    quantity: numberValue(value.quantity) ?? payload.lines.length,
    total: numberValue(value.total) ?? null,
  };
}

function normalizeQueuedPosSaleDraft(value: unknown): PosLocalSaleDraft | null {
  if (!isRecord(value)) return null;
  const payloadResult = PosCreateSaleRequestSchema.safeParse(value.payload);
  if (!payloadResult.success) return null;
  const payload = payloadResult.data;
  const cashSessionId = stringValue(value.cashSessionId);
  const queuedAt = stringValue(value.queuedAt);
  const evidence = normalizeSaleDraftEvidence(value.evidence, payload);
  if (!cashSessionId || !queuedAt || !evidence) return null;

  return {
    id: stringValue(value.id) || `pos-sale-draft-${payload.idempotencyKey}`,
    cashSessionId,
    payload,
    queuedAt,
    queueReason: normalizeSaleDraftReason(value.queueReason),
    autoReplayStatus: normalizeAutoReplayStatus(value.autoReplayStatus),
    autoReplayAttemptCount: nonNegativeIntegerValue(value.autoReplayAttemptCount) ?? 0,
    ...(stringValue(value.lastError) ? { lastError: stringValue(value.lastError) } : {}),
    ...(stringValue(value.lastRetryAt)
      ? { lastRetryAt: stringValue(value.lastRetryAt) }
      : {}),
    ...(stringValue(value.autoReplayLastAttemptAt)
      ? { autoReplayLastAttemptAt: stringValue(value.autoReplayLastAttemptAt) }
      : {}),
    ...(stringValue(value.autoReplayLastFailureAt)
      ? { autoReplayLastFailureAt: stringValue(value.autoReplayLastFailureAt) }
      : {}),
    ...(normalizeAutoReplayBlockReason(value.autoReplayBlockReason)
      ? { autoReplayBlockReason: normalizeAutoReplayBlockReason(value.autoReplayBlockReason) }
      : {}),
    ...(stringValue(value.offlineReplayItemId)
      ? { offlineReplayItemId: stringValue(value.offlineReplayItemId) }
      : {}),
    ...(stringValue(value.offlineReplaySourceKey)
      ? { offlineReplaySourceKey: stringValue(value.offlineReplaySourceKey) }
      : {}),
    ...(normalizeOfflineReplayStatus(value.offlineReplayStatus)
      ? { offlineReplayStatus: normalizeOfflineReplayStatus(value.offlineReplayStatus) }
      : {}),
    evidence,
  };
}

export function persistQueuedPosSaleDrafts(
  queue: readonly PosLocalSaleDraft[],
): PosLocalSaleDraft[] {
  const bounded = queue.slice(-POS_SALE_DRAFT_QUEUE_LIMIT);
  const storage = getSaleDraftQueueStorage();
  if (!storage) return [...bounded];
  try {
    storage.setItem(POS_SALE_DRAFT_QUEUE_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Keep the in-memory queue usable even if persistence fails.
  }
  return [...bounded];
}

export function readQueuedPosSaleDrafts(): PosLocalSaleDraft[] {
  const storage = getSaleDraftQueueStorage();
  if (!storage) return [];
  const raw = storage.getItem(POS_SALE_DRAFT_QUEUE_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      resetQueuedPosSaleDrafts();
      return [];
    }
    const normalized = parsed.flatMap((value) => {
      const draft = normalizeQueuedPosSaleDraft(value);
      return draft ? [draft] : [];
    });
    if (normalized.length !== parsed.length) {
      resetQueuedPosSaleDrafts();
      return [];
    }
    return persistQueuedPosSaleDrafts(normalized);
  } catch {
    resetQueuedPosSaleDrafts();
    return [];
  }
}

export function createQueuedPosSaleDraft(input: {
  cashSessionId: string;
  payload: PosCreateSaleRequest;
  evidence: PosLocalSaleDraftEvidence;
  queueReason: PosLocalSaleDraftReason;
  lastError?: string;
}): PosLocalSaleDraft {
  const payload = PosCreateSaleRequestSchema.parse(input.payload);
  return {
    id: `pos-sale-draft-${payload.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    cashSessionId: input.cashSessionId,
    payload,
    queuedAt: new Date().toISOString(),
    queueReason: input.queueReason,
    autoReplayStatus: "queued",
    autoReplayAttemptCount: 0,
    ...(input.lastError ? { lastError: input.lastError.slice(0, 240) } : {}),
    evidence: input.evidence,
  };
}

export function derivePosSaleDraftOfflineReplaySourceKey(
  draft: Pick<PosLocalSaleDraft, "payload">,
): string {
  return `pos-sale:${draft.payload.idempotencyKey}`;
}

export function linkQueuedPosSaleDraftOfflineReplay(
  draft: PosLocalSaleDraft,
  input: {
    offlineReplayItemId?: string;
    offlineReplayStatus?: PosLocalSaleDraftOfflineReplayStatus;
    offlineReplaySourceKey?: string;
  },
): PosLocalSaleDraft {
  const offlineReplayItemId = stringValue(input.offlineReplayItemId);
  const offlineReplaySourceKey =
    stringValue(input.offlineReplaySourceKey) ||
    derivePosSaleDraftOfflineReplaySourceKey(draft);

  return {
    ...draft,
    offlineReplaySourceKey,
    ...(offlineReplayItemId ? { offlineReplayItemId } : {}),
    ...(input.offlineReplayStatus
      ? { offlineReplayStatus: input.offlineReplayStatus }
      : {}),
  };
}

export async function sendQueuedPosSaleDraft(
  draft: PosLocalSaleDraft,
): Promise<PosCreateSaleResponse> {
  return postJson(
    `/api/pos/cash-sessions/${draft.cashSessionId}/sales`,
    draft.payload,
    PosCreateSaleResponseSchema,
  );
}

function saleDraftErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code} ${error.message}`.toLowerCase();
  }
  return error instanceof Error ? error.message.toLowerCase() : "";
}

function isClosedSessionLikeError(error: unknown): boolean {
  const text = normalizedErrorText(error);
  return (
    text.includes("session_closed") ||
    text.includes("cash_session_closed") ||
    text.includes("cash session closed") ||
    text.includes("session is closed") ||
    text.includes("closed session")
  );
}

function isConflictLikeError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 409) return true;
  const text = normalizedErrorText(error);
  return text.includes("conflict") || text.includes("already exists");
}

function isRetryablePosSaleDraftTransportError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.code === "schema_mismatch") return false;
    return error.status === 0 || error.status >= 500;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;

  const message = normalizedErrorText(error);
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("backend unavailable")
  );
}

export function classifyPosSaleDraftAutoReplayFailure(
  error: unknown,
): PosLocalSaleDraftAutoReplayFailure {
  const message = saleDraftErrorMessage(error).slice(0, 240);
  if (isRetryablePosSaleDraftTransportError(error)) {
    return { status: "retryable-failed", canAutoRetry: true, message };
  }

  if (isClosedSessionLikeError(error)) {
    return {
      status: "conflict-ready",
      canAutoRetry: false,
      message,
      blockReason: "closed-session",
    };
  }

  if (isConflictLikeError(error)) {
    return {
      status: "conflict-ready",
      canAutoRetry: false,
      message,
      blockReason: "conflict",
    };
  }

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return { status: "failed", canAutoRetry: false, message, blockReason: "auth" };
    }
    if (error.status >= 400 && error.status < 500) {
      return {
        status: "failed",
        canAutoRetry: false,
        message,
        blockReason: "business-validation",
      };
    }
  }

  return { status: "failed", canAutoRetry: false, message, blockReason: "client-error" };
}

export function localSaleDraftReasonCanAutoReplay(
  reason: PosLocalSaleDraftReason,
): boolean {
  return reason === "post-failed" || reason === "browser-offline";
}

export function canAutoReplayQueuedPosSaleDraft(draft: PosLocalSaleDraft): boolean {
  return (
    localSaleDraftReasonCanAutoReplay(draft.queueReason) &&
    (draft.autoReplayStatus === "queued" ||
      draft.autoReplayStatus === "retryable-failed")
  );
}

function replayTimestamp(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function markQueuedPosSaleDraftAutoReplayAttempt(
  draft: PosLocalSaleDraft,
  attemptedAt: Date | string = new Date(),
): PosLocalSaleDraft {
  const timestamp = replayTimestamp(attemptedAt);
  return {
    ...draft,
    autoReplayStatus: "retrying",
    autoReplayAttemptCount: draft.autoReplayAttemptCount + 1,
    autoReplayLastAttemptAt: timestamp,
    lastRetryAt: timestamp,
    autoReplayBlockReason: undefined,
    autoReplayLastFailureAt: undefined,
  };
}

export function markQueuedPosSaleDraftAutoReplayFailure(
  draft: PosLocalSaleDraft,
  error: unknown,
  failedAt: Date | string = new Date(),
): PosLocalSaleDraft {
  const timestamp = replayTimestamp(failedAt);
  const failure = classifyPosSaleDraftAutoReplayFailure(error);
  return {
    ...draft,
    autoReplayStatus: failure.status,
    lastError: failure.message,
    lastRetryAt: timestamp,
    autoReplayLastFailureAt: timestamp,
    ...(failure.blockReason
      ? { autoReplayBlockReason: failure.blockReason }
      : { autoReplayBlockReason: undefined }),
  };
}

export function shouldQueuePosSaleDraftError(error: unknown): boolean {
  return isRetryablePosSaleDraftTransportError(error);
}
