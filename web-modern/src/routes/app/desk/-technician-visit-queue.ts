import { ApiError, postJson } from "../../../lib/api/client";
import {
  UpdateServiceFieldVisitTechnicianStatusInputSchema,
  UpdateServiceFieldVisitTechnicianStatusResponseSchema,
  type ServiceFieldVisitTechnicianStatus,
} from "../../../lib/api/schemas";

export const TECHNICIAN_VISIT_QUEUE_STORAGE_KEY = "a1:desk:my-visits:technician-status-queue";
const TECHNICIAN_VISIT_QUEUE_LIMIT = 25;

const TECHNICIAN_VISIT_STATUSES = [
  "en-route",
  "in-progress",
  "completed",
] as const satisfies readonly ServiceFieldVisitTechnicianStatus[];

export const TECHNICIAN_VISIT_ACTIONS: {
  status: ServiceFieldVisitTechnicianStatus;
  label: string;
}[] = [
  { status: "en-route", label: "En route" },
  { status: "in-progress", label: "Start" },
  { status: "completed", label: "Complete" },
];

export type TechnicianVisitMutationInput = {
  visitId: string;
  status: ServiceFieldVisitTechnicianStatus;
  worksheetSummary?: string;
};

export type QueuedTechnicianVisitStatusUpdate = TechnicianVisitMutationInput & {
  idempotencyKey: string;
  queuedAt: string;
};

export type TechnicianVisitSubmitResult = {
  queued: boolean;
};

function getTechnicianVisitQueueStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resetQueuedTechnicianVisitStatusUpdates(): void {
  const storage = getTechnicianVisitQueueStorage();
  if (!storage) return;
  try {
    storage.setItem(TECHNICIAN_VISIT_QUEUE_STORAGE_KEY, "[]");
  } catch {
    // Storage may be unavailable in private browsing or quota pressure.
  }
}

export function persistQueuedTechnicianVisitStatusUpdates(
  queue: QueuedTechnicianVisitStatusUpdate[],
): QueuedTechnicianVisitStatusUpdate[] {
  const bounded = queue.slice(-TECHNICIAN_VISIT_QUEUE_LIMIT);
  const storage = getTechnicianVisitQueueStorage();
  if (!storage) return bounded;
  try {
    storage.setItem(TECHNICIAN_VISIT_QUEUE_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Keep the in-memory queue usable even if persistence fails.
  }
  return bounded;
}

function isTechnicianVisitStatus(value: unknown): value is ServiceFieldVisitTechnicianStatus {
  return typeof value === "string" && (TECHNICIAN_VISIT_STATUSES as readonly string[]).includes(value);
}

function isQueuedTechnicianVisitStatusUpdate(
  value: unknown,
): value is QueuedTechnicianVisitStatusUpdate {
  if (typeof value !== "object" || value == null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.visitId === "string" &&
    candidate.visitId.length > 0 &&
    isTechnicianVisitStatus(candidate.status) &&
    typeof candidate.idempotencyKey === "string" &&
    candidate.idempotencyKey.length > 0 &&
    candidate.idempotencyKey.length <= 200 &&
    typeof candidate.queuedAt === "string" &&
    candidate.queuedAt.length > 0 &&
    (candidate.worksheetSummary === undefined || typeof candidate.worksheetSummary === "string")
  );
}

export function readQueuedTechnicianVisitStatusUpdates(): QueuedTechnicianVisitStatusUpdate[] {
  const storage = getTechnicianVisitQueueStorage();
  if (!storage) return [];
  const raw = storage.getItem(TECHNICIAN_VISIT_QUEUE_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isQueuedTechnicianVisitStatusUpdate)) {
      resetQueuedTechnicianVisitStatusUpdates();
      return [];
    }
    return persistQueuedTechnicianVisitStatusUpdates(parsed);
  } catch {
    resetQueuedTechnicianVisitStatusUpdates();
    return [];
  }
}

function generateTechnicianVisitIdempotencyKey(
  visitId: string,
  status: ServiceFieldVisitTechnicianStatus,
): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `desk-visit:${visitId}:${status}:${Date.now()}:${random}`.slice(0, 200);
}

export function createQueuedTechnicianVisitStatusUpdate(
  input: TechnicianVisitMutationInput,
): QueuedTechnicianVisitStatusUpdate {
  const trimmedSummary = input.worksheetSummary?.trim();
  return {
    visitId: input.visitId,
    status: input.status,
    ...(trimmedSummary ? { worksheetSummary: trimmedSummary } : {}),
    idempotencyKey: generateTechnicianVisitIdempotencyKey(input.visitId, input.status),
    queuedAt: new Date().toISOString(),
  };
}

export async function sendTechnicianVisitStatusUpdate(
  update: QueuedTechnicianVisitStatusUpdate,
) {
  const payload = UpdateServiceFieldVisitTechnicianStatusInputSchema.parse({
    status: update.status,
    idempotencyKey: update.idempotencyKey,
    ...(update.worksheetSummary ? { worksheetSummary: update.worksheetSummary } : {}),
  });
  return postJson(
    `/api/service/field-visits/${update.visitId}/technician-status`,
    payload,
    UpdateServiceFieldVisitTechnicianStatusResponseSchema,
  );
}

export function shouldQueueTechnicianVisitStatusError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (error instanceof ApiError) return error.status >= 500 || error.status === 0;
  if (error instanceof TypeError) return true;

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("backend unavailable")
  );
}

export function normalizeVisitStatus(status: string): string {
  return status.trim().toLowerCase();
}

export function isTerminalVisitStatus(status: string): boolean {
  const normalized = normalizeVisitStatus(status);
  return normalized === "completed" || normalized === "cancelled" || normalized === "canceled";
}

export function canApplyTechnicianStatus(
  currentStatus: string,
  nextStatus: ServiceFieldVisitTechnicianStatus,
): boolean {
  const current = normalizeVisitStatus(currentStatus);
  if (isTerminalVisitStatus(current)) return false;
  if (nextStatus === "en-route") return current !== "en-route" && current !== "in-progress";
  if (nextStatus === "in-progress") return current === "en-route";
  return current === "in-progress";
}
