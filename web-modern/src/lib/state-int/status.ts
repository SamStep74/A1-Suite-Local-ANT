/**
 * State Integrations (Phase 8.8) — pure helpers.
 *
 * Source of truth:
 *   - server/app.js#app.post("/api/state-int/:adapter/:operation", ...)
 *   - server/app.js#app.get("/api/state-int/audit", ...)
 *   - web/src/stateIntegrations.jsx (legacy panel — UX reference)
 *   - .orchestration/phase8-state-integrations/plan.md
 *
 * Public surface (used by web-modern/src/routes/app/cfo/state-integrations/*):
 *   STATE_INT_ADAPTERS
 *   STATE_INT_ADAPTERS_BY_ID
 *   isStateIntAdapterId
 *   stateIntDefaultPayloadFor
 *   isStateIntAuditorLike
 *   formatStateIntSignaturePreview
 *   formatStateIntLatency
 *   generateStateIntIdempotencyKey
 *   tryParseStateIntPayload
 *   stateIntOperationFor
 *   stateIntAdapterLabelAm
 *   stateIntStatusLabelAm
 *
 * No React, no fetch, no router. Safe to import from server-side or tests.
 * Immutable: never mutates the input adapter/operation lists — lookups that
 * need a stable order build a fresh array with .slice().sort().
 */
import type { ZodError } from "zod";
import {
  StateIntAdapterIdSchema,
  type StateIntAdapterId,
  type StateIntOperation,
  type StateIntStatus,
} from "@/lib/api/schemas";

/* ── adapter catalog (read-only) ─────────────────────────────────────── */

export interface StateIntAdapterDescriptor {
  readonly id: StateIntAdapterId;
  readonly label: string;
  /** HY label used in the auditor table & dispatch button. */
  readonly labelAm: string;
  /** The single operation this adapter supports in Phase 8.8. */
  readonly operation: StateIntOperation;
  /**
   * A pre-baked sample payload rendered into the dispatch textarea. The
   * legacy panel used SAMPLE_PAYLOADS[adapterId] verbatim — we mirror that
   * so a new operator sees a realistic request body without typing.
   */
  readonly samplePayloadJson: string;
}

export const STATE_INT_ADAPTERS: ReadonlyArray<StateIntAdapterDescriptor> = [
  {
    id: "src",
    label: "SRC — Հարկային կոմիտե / State Revenue Committee",
    labelAm: "ՀԾ — Հարկային կոմիտե",
    operation: "submitVat",
    samplePayloadJson: JSON.stringify(
      { period: "2026-Q1", netAmount: 100000, vatRate: 20 },
      null,
      2,
    ),
  },
  {
    id: "eregister",
    label: "e-Register.am — State Register of Legal Entities",
    labelAm: "e-Register.am — Իրավաբանական անձանց ռեեստր",
    operation: "lookup",
    samplePayloadJson: JSON.stringify({ taxId: "01234567" }, null, 2),
  },
  {
    id: "egov",
    label: "e-Gov.am — Electronic Government",
    labelAm: "e-Gov.am — Էլեկտրոնային կառավարություն",
    operation: "sign",
    samplePayloadJson: JSON.stringify(
      {
        documentId: "doc-001",
        signerClaims: { idNumber: "AN-1234567", fullName: "Test User" },
      },
      null,
      2,
    ),
  },
  {
    id: "idcard",
    label: "ID Card — Identity verification",
    labelAm: "ID Card — Անձնագրի ստուգում",
    operation: "verify",
    samplePayloadJson: JSON.stringify({ subjectId: "AN-1234567" }, null, 2),
  },
  {
    id: "mobileid",
    label: "Mobile ID — Mobile signature",
    labelAm: "Mobile ID — Բջջային ստորագրություն",
    operation: "challenge",
    samplePayloadJson: JSON.stringify({ phone: "+37499123456" }, null, 2),
  },
  {
    id: "customs",
    label: "e-Customs — Customs declaration",
    labelAm: "e-Customs — Մաքսային հայտարարություն",
    operation: "declare",
    samplePayloadJson: JSON.stringify(
      {
        declarationType: "IMPORT",
        hsCode: "070200000",
        destinationCountry: "RU",
      },
      null,
      2,
    ),
  },
] as const;

/** Frozen map id → descriptor, for O(1) lookup. */
export const STATE_INT_ADAPTERS_BY_ID: Readonly<
  Record<StateIntAdapterId, StateIntAdapterDescriptor>
> = Object.freeze(
  STATE_INT_ADAPTERS.reduce<Record<StateIntAdapterId, StateIntAdapterDescriptor>>(
    (acc, descriptor) => {
      acc[descriptor.id] = descriptor;
      return acc;
    },
    {} as Record<StateIntAdapterId, StateIntAdapterDescriptor>,
  ),
);

/* ── predicates ──────────────────────────────────────────────────────── */

export function isStateIntAdapterId(value: unknown): value is StateIntAdapterId {
  return StateIntAdapterIdSchema.safeParse(value).success;
}

const AUDITOR_ROLES: ReadonlyArray<string> = ["Owner", "Admin", "Auditor"];

export function isStateIntAuditorLike(role: string | null | undefined): boolean {
  if (typeof role !== "string") return false;
  return AUDITOR_ROLES.includes(role);
}

/* ── payload helpers ─────────────────────────────────────────────────── */

export function stateIntDefaultPayloadFor(
  adapterId: StateIntAdapterId,
): string {
  return STATE_INT_ADAPTERS_BY_ID[adapterId].samplePayloadJson;
}

export function stateIntOperationFor(
  adapterId: StateIntAdapterId,
): StateIntOperation {
  return STATE_INT_ADAPTERS_BY_ID[adapterId].operation;
}

export function stateIntAdapterLabelAm(adapterId: StateIntAdapterId): string {
  return STATE_INT_ADAPTERS_BY_ID[adapterId].labelAm;
}

/* ── formatters ──────────────────────────────────────────────────────── */

/**
 * Armenian-first status label. Falls back to the raw token for anything
 * not in the closed enum (defense in depth — the schema already rejects
 * unknown statuses at the wire, but a UI table that receives an
 * unexpected value should still render something).
 */
const STATE_INT_STATUS_LABELS_AM: Readonly<Record<StateIntStatus, string>> =
  Object.freeze({
    ok: "Հաջողված",
    deferred: "Հետաձգված",
    advisory: "Ուղղորդող",
    failed: "Ձախողված",
  });

export function stateIntStatusLabelAm(status: StateIntStatus): string {
  return STATE_INT_STATUS_LABELS_AM[status] ?? status;
}

/**
 * Slice the first 40 chars of a base64 signature for the audit table.
 * A trailing "…" is appended when the input exceeds 40 chars, exactly
 * like the legacy web/ panel. Pure & total — never throws on short input.
 */
export function formatStateIntSignaturePreview(signatureB64: string): string {
  if (signatureB64.length <= 40) return signatureB64;
  return `${signatureB64.slice(0, 40)}…`;
}

export function formatStateIntLatency(latencyMs: number): string {
  if (!Number.isFinite(latencyMs)) return "—";
  const rounded = Math.max(0, Math.round(latencyMs));
  return `${rounded}ms`;
}

/* ── idempotency ─────────────────────────────────────────────────────── */

/**
 * Idempotency key shape: `ui-state-int-${adapterId}-${operation}-${ms}`.
 * The server uses this key as the cache row PK in idempotency_keys, so a
 * fresh dispatch always inserts a new row; a click-replay returns the
 * prior response byte-for-byte.
 */
export function generateStateIntIdempotencyKey(
  adapterId: StateIntAdapterId,
  operation: StateIntOperation,
  now: number = Date.now(),
): string {
  return `ui-state-int-${adapterId}-${operation}-${now}`;
}

/* ── payload parsing (safe wrapper around JSON.parse) ────────────────── */

export type StateIntPayloadParseResult =
  | { readonly ok: true; readonly parsed: unknown }
  | { readonly ok: false; readonly error: string };

export function tryParseStateIntPayload(
  raw: string,
): StateIntPayloadParseResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "payload must be a string" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "payload is empty" };
  }
  try {
    return { ok: true, parsed: JSON.parse(trimmed) };
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `invalid JSON: ${message}` };
  }
}

/* ── re-export the Zod-inferred error type alias for callers ─────────── */

export type StateIntZodError = ZodError;
