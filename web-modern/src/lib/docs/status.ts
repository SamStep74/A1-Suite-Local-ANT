/**
 * Pure helpers for the Docs & Sign workspace.
 *
 * Source of truth: server/app.js (getDocument, getSignaturePackets,
 * /api/docs/templates). These helpers are UI-pure: no React, no I/O.
 * Unit-tested in __tests__/status.test.ts.
 *
 * Public surface:
 *  - classifyDocumentStatus     → "draft" | "out-for-signature" | "signed" | "voided" | "unknown"
 *  - classifySignerStatus       → "pending" | "signed" | "declined" | "voided" | "unknown"
 *  - classifyPacketStatus       → "draft" | "sent" | "signed" | "voided" | "expired" | "unknown"
 *  - compareDocumentsByStatusThenUpdated
 *  - comparePacketsByStatusThenDate
 *  - signerProgress             → 0..1
 *  - allSignersSigned
 *  - anySignerDeclined
 *  - sealedLabel                → "Sealed" | "Unsealed"
 *  - templateVariableCount      → safe count
 *  - AM_DOC_TYPES
 */
import type {
  DocsDocument,
  DocsDocumentStatus,
  DocsSignaturePacket,
  DocsSignaturePacketStatus,
  DocsSigner,
  DocsSignerStatus,
  DocsTemplate,
} from "../api/schemas";

/* ────────── types ────────── */

export type DocumentTone =
  | "draft"
  | "out-for-signature"
  | "signed"
  | "voided"
  | "unknown";

export type SignerTone =
  | "pending"
  | "signed"
  | "declined"
  | "voided"
  | "unknown";

export type PacketTone =
  | "draft"
  | "sent"
  | "signed"
  | "voided"
  | "expired"
  | "unknown";

export const AM_DOC_TYPES = [
  { value: "agreement", label: "Պայմանագիր (Agreement)" },
  { value: "nda", label: "Գաղտնության պայմանագիր (NDA)" },
  { value: "contract", label: "Պայման (Contract)" },
  { value: "offer", label: "Առաջարկ (Offer)" },
  { value: "policy", label: "Քաղաքականություն (Policy)" },
  { value: "other", label: "Այլ (Other)" },
] as const;

/* ────────── status maps ────────── */

const DOCUMENT_STATUSES: ReadonlySet<DocsDocumentStatus> = new Set([
  "draft",
  "out-for-signature",
  "signed",
  "voided",
]);

const SIGNER_STATUSES: ReadonlySet<DocsSignerStatus> = new Set([
  "pending",
  "signed",
  "declined",
  "voided",
]);

const PACKET_STATUSES: ReadonlySet<DocsSignaturePacketStatus> = new Set([
  "draft",
  "sent",
  "signed",
  "voided",
  "expired",
]);

export function classifyDocumentStatus(doc: Pick<DocsDocument, "status">): DocumentTone {
  const s = (doc.status ?? "").toString().toLowerCase();
  if (DOCUMENT_STATUSES.has(s as DocsDocumentStatus)) return s as DocumentTone;
  return "unknown";
}

export function classifySignerStatus(signer: Pick<DocsSigner, "status">): SignerTone {
  const s = (signer.status ?? "").toString().toLowerCase();
  if (SIGNER_STATUSES.has(s as DocsSignerStatus)) return s as SignerTone;
  return "unknown";
}

export function classifyPacketStatus(packet: Pick<DocsSignaturePacket, "status">): PacketTone {
  const s = (packet.status ?? "").toString().toLowerCase();
  if (PACKET_STATUSES.has(s as DocsSignaturePacketStatus)) return s as PacketTone;
  return "unknown";
}

/* ────────── ordering ────────── */

function documentToneRank(tone: DocumentTone): number {
  switch (tone) {
    case "draft":
      return 0;
    case "out-for-signature":
      return 1;
    case "signed":
      return 2;
    case "voided":
      return 3;
    default:
      return 4;
  }
}

function packetToneRank(tone: PacketTone): number {
  switch (tone) {
    case "draft":
      return 0;
    case "sent":
      return 1;
    case "signed":
      return 2;
    case "voided":
      return 3;
    case "expired":
      return 4;
    default:
      return 5;
  }
}

export function compareDocumentsByStatusThenUpdated(
  a: Pick<DocsDocument, "status" | "updatedAt">,
  b: Pick<DocsDocument, "status" | "updatedAt">,
): number {
  const ta = documentToneRank(classifyDocumentStatus(a));
  const tb = documentToneRank(classifyDocumentStatus(b));
  if (ta !== tb) return ta - tb;
  return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}

export function comparePacketsByStatusThenDate(
  a: Pick<DocsSignaturePacket, "status" | "createdAt">,
  b: Pick<DocsSignaturePacket, "status" | "createdAt">,
): number {
  const ta = packetToneRank(classifyPacketStatus(a));
  const tb = packetToneRank(classifyPacketStatus(b));
  if (ta !== tb) return ta - tb;
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

/* ────────── signer progress ────────── */

/** 0..1 — fraction of signers that have completed (signed). */
export function signerProgress(signers: ReadonlyArray<DocsSigner>): number | null {
  if (signers.length === 0) return null;
  const signed = signers.filter((s) => classifySignerStatus(s) === "signed").length;
  return signed / signers.length;
}

export function allSignersSigned(signers: ReadonlyArray<DocsSigner>): boolean {
  if (signers.length === 0) return false;
  return signers.every((s) => classifySignerStatus(s) === "signed");
}

export function anySignerDeclined(signers: ReadonlyArray<DocsSigner>): boolean {
  return signers.some((s) => classifySignerStatus(s) === "declined");
}

export function pendingSignerCount(signers: ReadonlyArray<DocsSigner>): number {
  return signers.filter((s) => classifySignerStatus(s) === "pending").length;
}

/* ────────── seal / template helpers ────────── */

export function sealedLabel(doc: Pick<DocsDocument, "sealedAt" | "sealedChecksum">): "Sealed" | "Unsealed" {
  return doc.sealedAt || doc.sealedChecksum ? "Sealed" : "Unsealed";
}

export function templateVariableCount(t: Pick<DocsTemplate, "variables">): number {
  return Array.isArray(t.variables) ? t.variables.length : 0;
}

export function hasRequiredVariables(t: Pick<DocsTemplate, "variables">): boolean {
  return Array.isArray(t.variables) && t.variables.some((v) => v.required === true);
}
