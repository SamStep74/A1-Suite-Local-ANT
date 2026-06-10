/**
 * status.test.ts — unit tests for the Docs & Sign pure helpers.
 */
import { describe, it, expect } from "vitest";
import {
  allSignersSigned,
  anySignerDeclined,
  classifyDocumentStatus,
  classifyPacketStatus,
  classifySignerStatus,
  compareDocumentsByStatusThenUpdated,
  comparePacketsByStatusThenDate,
  hasRequiredVariables,
  pendingSignerCount,
  sealedLabel,
  signerProgress,
  templateVariableCount,
  AM_DOC_TYPES,
  type DocumentTone,
  type PacketTone,
  type SignerTone,
} from "../status";

/* ────────── fixtures ────────── */

const SIGNERS = {
  pending: { id: "s-1", signerName: "Anna", signOrder: 1, status: "pending" },
  signed: { id: "s-2", signerName: "Mariam", signOrder: 1, status: "signed" },
  declined: { id: "s-3", signerName: "Zara", signOrder: 1, status: "declined" },
  voided: { id: "s-4", signerName: "Lilit", signOrder: 1, status: "voided" },
};

const DOCUMENTS = {
  draft: { id: "d-1", status: "draft", updatedAt: "2026-06-01" },
  outForSig: { id: "d-2", status: "out-for-signature", updatedAt: "2026-06-02" },
  signed: { id: "d-3", status: "signed", updatedAt: "2026-06-03" },
  voided: { id: "d-4", status: "voided", updatedAt: "2026-06-04" },
  garbage: { id: "d-5", status: "garbage", updatedAt: "2026-06-05" },
};

const PACKETS = {
  draft: { id: "p-1", status: "draft", createdAt: "2026-06-01" },
  sent: { id: "p-2", status: "sent", createdAt: "2026-06-02" },
  signed: { id: "p-3", status: "signed", createdAt: "2026-06-03" },
  voided: { id: "p-4", status: "voided", createdAt: "2026-06-04" },
  expired: { id: "p-5", status: "expired", createdAt: "2026-06-05" },
  garbage: { id: "p-6", status: "garbage", createdAt: "2026-06-06" },
};

/* ────────── classifyDocumentStatus ────────── */

describe("classifyDocumentStatus", () => {
  it("maps known statuses", () => {
    expect(classifyDocumentStatus(DOCUMENTS.draft)).toBe<DocumentTone>("draft");
    expect(classifyDocumentStatus(DOCUMENTS.outForSig)).toBe<DocumentTone>("out-for-signature");
    expect(classifyDocumentStatus(DOCUMENTS.signed)).toBe<DocumentTone>("signed");
    expect(classifyDocumentStatus(DOCUMENTS.voided)).toBe<DocumentTone>("voided");
  });
  it("falls back to unknown", () => {
    expect(classifyDocumentStatus(DOCUMENTS.garbage)).toBe<DocumentTone>("unknown");
  });
});

/* ────────── classifySignerStatus ────────── */

describe("classifySignerStatus", () => {
  it("maps known statuses", () => {
    expect(classifySignerStatus(SIGNERS.pending)).toBe<SignerTone>("pending");
    expect(classifySignerStatus(SIGNERS.signed)).toBe<SignerTone>("signed");
    expect(classifySignerStatus(SIGNERS.declined)).toBe<SignerTone>("declined");
    expect(classifySignerStatus(SIGNERS.voided)).toBe<SignerTone>("voided");
  });
  it("falls back to unknown", () => {
    expect(classifySignerStatus({ status: "wat" })).toBe<SignerTone>("unknown");
  });
});

/* ────────── classifyPacketStatus ────────── */

describe("classifyPacketStatus", () => {
  it("maps known statuses", () => {
    expect(classifyPacketStatus(PACKETS.draft)).toBe<PacketTone>("draft");
    expect(classifyPacketStatus(PACKETS.sent)).toBe<PacketTone>("sent");
    expect(classifyPacketStatus(PACKETS.signed)).toBe<PacketTone>("signed");
    expect(classifyPacketStatus(PACKETS.voided)).toBe<PacketTone>("voided");
    expect(classifyPacketStatus(PACKETS.expired)).toBe<PacketTone>("expired");
  });
  it("falls back to unknown", () => {
    expect(classifyPacketStatus(PACKETS.garbage)).toBe<PacketTone>("unknown");
  });
});

/* ────────── compareDocumentsByStatusThenUpdated ────────── */

describe("compareDocumentsByStatusThenUpdated", () => {
  it("sorts draft/out-for-signature before signed/voided", () => {
    const out = [DOCUMENTS.signed, DOCUMENTS.draft, DOCUMENTS.outForSig, DOCUMENTS.voided]
      .slice()
      .sort(compareDocumentsByStatusThenUpdated)
      .map((d) => d.status);
    expect(out).toEqual(["draft", "out-for-signature", "signed", "voided"]);
  });
  it("within a status, sorts by updatedAt desc", () => {
    const a = { id: "x", status: "draft", updatedAt: "2026-01-01" };
    const b = { id: "y", status: "draft", updatedAt: "2026-06-01" };
    const c = { id: "z", status: "draft", updatedAt: "2026-03-01" };
    const out = [a, b, c].sort(compareDocumentsByStatusThenUpdated);
    expect(out.map((d) => d.updatedAt)).toEqual(["2026-06-01", "2026-03-01", "2026-01-01"]);
  });
  it("unknown sorts last", () => {
    const out = [DOCUMENTS.garbage, DOCUMENTS.draft].sort(compareDocumentsByStatusThenUpdated);
    expect(out[0].status).toBe("draft");
  });
});

/* ────────── comparePacketsByStatusThenDate ────────── */

describe("comparePacketsByStatusThenDate", () => {
  it("sorts draft/sent before signed/voided/expired", () => {
    const out = [PACKETS.expired, PACKETS.draft, PACKETS.signed, PACKETS.sent, PACKETS.voided]
      .slice()
      .sort(comparePacketsByStatusThenDate)
      .map((p) => p.status);
    expect(out).toEqual(["draft", "sent", "signed", "voided", "expired"]);
  });
  it("within a status, sorts by createdAt desc", () => {
    const a = { id: "a", status: "sent", createdAt: "2026-01-01" };
    const b = { id: "b", status: "sent", createdAt: "2026-06-01" };
    const out = [a, b].sort(comparePacketsByStatusThenDate);
    expect(out[0].createdAt).toBe("2026-06-01");
  });
});

/* ────────── signer progress ────────── */

describe("signerProgress", () => {
  it("returns null when there are no signers", () => {
    expect(signerProgress([])).toBeNull();
  });
  it("returns 0 when none signed", () => {
    expect(signerProgress([SIGNERS.pending, SIGNERS.pending])).toBe(0);
  });
  it("returns 1 when all signed", () => {
    expect(signerProgress([SIGNERS.signed, SIGNERS.signed])).toBe(1);
  });
  it("returns the ratio in between", () => {
    expect(signerProgress([SIGNERS.signed, SIGNERS.pending, SIGNERS.declined, SIGNERS.pending])).toBe(0.25);
  });
});

describe("allSignersSigned", () => {
  it("returns false on empty array", () => {
    expect(allSignersSigned([])).toBe(false);
  });
  it("returns true only if every signer is signed", () => {
    expect(allSignersSigned([SIGNERS.signed, SIGNERS.signed])).toBe(true);
    expect(allSignersSigned([SIGNERS.signed, SIGNERS.pending])).toBe(false);
  });
});

describe("anySignerDeclined", () => {
  it("returns false on empty array", () => {
    expect(anySignerDeclined([])).toBe(false);
  });
  it("returns true if any declined", () => {
    expect(anySignerDeclined([SIGNERS.pending, SIGNERS.declined])).toBe(true);
  });
  it("returns false when none declined", () => {
    expect(anySignerDeclined([SIGNERS.pending, SIGNERS.signed])).toBe(false);
  });
});

describe("pendingSignerCount", () => {
  it("returns 0 when none pending", () => {
    expect(pendingSignerCount([SIGNERS.signed])).toBe(0);
  });
  it("returns the count of pending signers", () => {
    expect(pendingSignerCount([SIGNERS.pending, SIGNERS.signed, SIGNERS.pending, SIGNERS.declined])).toBe(2);
  });
  it("handles empty arrays", () => {
    expect(pendingSignerCount([])).toBe(0);
  });
});

/* ────────── sealed label ────────── */

describe("sealedLabel", () => {
  it("returns 'Sealed' when sealedAt is present", () => {
    expect(sealedLabel({ sealedAt: "2026-06-01", sealedChecksum: null })).toBe("Sealed");
  });
  it("returns 'Sealed' when sealedChecksum is present", () => {
    expect(sealedLabel({ sealedAt: null, sealedChecksum: "abc" })).toBe("Sealed");
  });
  it("returns 'Unsealed' when both are empty", () => {
    expect(sealedLabel({ sealedAt: null, sealedChecksum: null })).toBe("Unsealed");
    expect(sealedLabel({ sealedAt: "", sealedChecksum: "" })).toBe("Unsealed");
  });
});

/* ────────── template helpers ────────── */

describe("templateVariableCount", () => {
  it("returns 0 when variables is undefined", () => {
    expect(templateVariableCount({ variables: undefined as unknown as never[] })).toBe(0);
  });
  it("returns the array length when defined", () => {
    expect(
      templateVariableCount({ variables: [{ key: "x" }, { key: "y" }] }),
    ).toBe(2);
  });
});

describe("hasRequiredVariables", () => {
  it("returns false when no variables", () => {
    expect(hasRequiredVariables({ variables: [] })).toBe(false);
  });
  it("returns true if any variable is required", () => {
    expect(
      hasRequiredVariables({
        variables: [{ key: "x", required: true }],
      }),
    ).toBe(true);
  });
  it("returns false if none are required", () => {
    expect(
      hasRequiredVariables({
        variables: [{ key: "x", required: false }],
      }),
    ).toBe(false);
  });
});

/* ────────── AM_DOC_TYPES ────────── */

describe("AM_DOC_TYPES", () => {
  it("has 6 entries", () => {
    expect(AM_DOC_TYPES).toHaveLength(6);
  });
  it("includes the canonical doc types", () => {
    const values = AM_DOC_TYPES.map((t) => t.value);
    expect(values).toContain("agreement");
    expect(values).toContain("nda");
    expect(values).toContain("contract");
    expect(values).toContain("offer");
    expect(values).toContain("policy");
    expect(values).toContain("other");
  });
  it("each entry has Armenian + English label", () => {
    for (const t of AM_DOC_TYPES) {
      expect(t.label).toMatch(/[ա-֏]/); // at least one Armenian char
    }
  });
});
