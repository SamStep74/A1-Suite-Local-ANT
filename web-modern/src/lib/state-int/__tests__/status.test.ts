/**
 * Pure-helper tests for web-modern/src/lib/state-int/status.ts.
 *
 * Pattern A (mirroring web-modern/src/lib/cabinet/__tests__/status.test.ts).
 * Target: 100% line + branch coverage.
 */
import { describe, expect, it } from "vitest";
import {
  STATE_INT_ADAPTERS,
  STATE_INT_ADAPTERS_BY_ID,
  formatStateIntLatency,
  formatStateIntSignaturePreview,
  generateStateIntIdempotencyKey,
  isStateIntAdapterId,
  isStateIntAuditorLike,
  stateIntAdapterLabelAm,
  stateIntDefaultPayloadFor,
  stateIntOperationFor,
  stateIntStatusLabelAm,
  tryParseStateIntPayload,
} from "@/lib/state-int/status";
import type {
  StateIntAdapterId,
  StateIntOperation,
  StateIntStatus,
} from "@/lib/api/schemas";

const ALL_ADAPTER_IDS: ReadonlyArray<StateIntAdapterId> = [
  "src",
  "eregister",
  "egov",
  "idcard",
  "mobileid",
  "customs",
];

const ALL_OPERATIONS: ReadonlyArray<StateIntOperation> = [
  "submitVat",
  "lookup",
  "sign",
  "verify",
  "challenge",
  "declare",
];

describe("STATE_INT_ADAPTERS catalog", () => {
  it("contains exactly 6 adapters", () => {
    expect(STATE_INT_ADAPTERS).toHaveLength(6);
  });

  it("lists every adapter id exactly once", () => {
    const ids = STATE_INT_ADAPTERS.map((a) => a.id).sort();
    expect([...ids]).toEqual([...ALL_ADAPTER_IDS].sort());
  });

  it("each adapter has a non-empty Armenian label and a sample payload", () => {
    for (const adapter of STATE_INT_ADAPTERS) {
      expect(adapter.labelAm.length).toBeGreaterThan(0);
      expect(adapter.label.length).toBeGreaterThan(0);
      expect(adapter.samplePayloadJson.length).toBeGreaterThan(0);
      // sample payload must be valid JSON
      expect(() => JSON.parse(adapter.samplePayloadJson)).not.toThrow();
    }
  });

  it("STATE_INT_ADAPTERS_BY_ID has an entry for every adapter", () => {
    for (const id of ALL_ADAPTER_IDS) {
      expect(STATE_INT_ADAPTERS_BY_ID[id]).toBeDefined();
      expect(STATE_INT_ADAPTERS_BY_ID[id].id).toBe(id);
    }
  });

  it("does not mutate the caller's list reference", () => {
    const snapshot = STATE_INT_ADAPTERS.map((a) => a.id);
    // reading shouldn't change anything
    void STATE_INT_ADAPTERS.map((a) => a.label);
    expect(STATE_INT_ADAPTERS.map((a) => a.id)).toEqual(snapshot);
  });
});

describe("isStateIntAdapterId", () => {
  it("accepts every canonical adapter id", () => {
    for (const id of ALL_ADAPTER_IDS) {
      expect(isStateIntAdapterId(id)).toBe(true);
    }
  });

  it("rejects unknown ids, empty strings, and non-strings", () => {
    expect(isStateIntAdapterId("SRC")).toBe(false); // case-sensitive
    expect(isStateIntAdapterId("")).toBe(false);
    expect(isStateIntAdapterId(null)).toBe(false);
    expect(isStateIntAdapterId(undefined)).toBe(false);
    expect(isStateIntAdapterId(42)).toBe(false);
    expect(isStateIntAdapterId({ id: "src" })).toBe(false);
  });
});

describe("isStateIntAuditorLike", () => {
  it("accepts the three privileged roles", () => {
    expect(isStateIntAuditorLike("Owner")).toBe(true);
    expect(isStateIntAuditorLike("Admin")).toBe(true);
    expect(isStateIntAuditorLike("Auditor")).toBe(true);
  });

  it("rejects other roles and nullish inputs", () => {
    expect(isStateIntAuditorLike("Member")).toBe(false);
    expect(isStateIntAuditorLike("owner")).toBe(false); // case-sensitive
    expect(isStateIntAuditorLike("")).toBe(false);
    expect(isStateIntAuditorLike(null)).toBe(false);
    expect(isStateIntAuditorLike(undefined)).toBe(false);
  });
});

describe("stateIntDefaultPayloadFor / stateIntOperationFor / stateIntAdapterLabelAm", () => {
  it("returns the catalog entry fields for every adapter", () => {
    for (const adapter of STATE_INT_ADAPTERS) {
      expect(stateIntDefaultPayloadFor(adapter.id)).toBe(
        adapter.samplePayloadJson,
      );
      expect(stateIntOperationFor(adapter.id)).toBe(adapter.operation);
      expect(stateIntAdapterLabelAm(adapter.id)).toBe(adapter.labelAm);
    }
  });
});

describe("stateIntOperationFor", () => {
  it("maps each adapter id to its single operation", () => {
    expect(stateIntOperationFor("src")).toBe("submitVat");
    expect(stateIntOperationFor("eregister")).toBe("lookup");
    expect(stateIntOperationFor("egov")).toBe("sign");
    expect(stateIntOperationFor("idcard")).toBe("verify");
    expect(stateIntOperationFor("mobileid")).toBe("challenge");
    expect(stateIntOperationFor("customs")).toBe("declare");
  });

  it("covers every operation in the enum", () => {
    const ops = ALL_ADAPTER_IDS.map(stateIntOperationFor).sort();
    expect([...ops]).toEqual([...ALL_OPERATIONS].sort());
  });
});

describe("stateIntStatusLabelAm", () => {
  const KNOWN: ReadonlyArray<{ s: StateIntStatus; armenian: string }> = [
    { s: "ok", armenian: "Հաջողված" },
    { s: "deferred", armenian: "Հետաձգված" },
    { s: "advisory", armenian: "Ուղղորդող" },
    { s: "failed", armenian: "Ձախողված" },
  ];

  it("returns the Armenian label for every closed-enum status", () => {
    for (const { s, armenian } of KNOWN) {
      expect(stateIntStatusLabelAm(s)).toBe(armenian);
    }
  });
});

describe("formatStateIntSignaturePreview", () => {
  it("passes through short signatures unchanged", () => {
    expect(formatStateIntSignaturePreview("")).toBe("");
    expect(formatStateIntSignaturePreview("abc")).toBe("abc");
  });

  it("truncates long signatures at 40 chars and appends …", () => {
    const sig40 = "a".repeat(40);
    const sig41 = "a".repeat(41);
    expect(formatStateIntSignaturePreview(sig40)).toBe(sig40);
    expect(formatStateIntSignaturePreview(sig41)).toBe(`${"a".repeat(40)}…`);
  });

  it("truncates a realistic base64 payload", () => {
    const b64 =
      "MEUCIQDxExampleBase64SignaturePayloadThatIsDefinitelyLongerThanFortyChars==";
    const preview = formatStateIntSignaturePreview(b64);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview).toHaveLength(41); // 40 chars + …
    expect(preview.startsWith("MEUCIQDxExampleBase64SignaturePayloadTha")).toBe(
      true,
    );
  });
});

describe("formatStateIntLatency", () => {
  it("formats integer ms as `${ms}ms`", () => {
    expect(formatStateIntLatency(0)).toBe("0ms");
    expect(formatStateIntLatency(123)).toBe("123ms");
  });

  it("rounds fractional ms", () => {
    expect(formatStateIntLatency(123.4)).toBe("123ms");
    expect(formatStateIntLatency(123.6)).toBe("124ms");
  });

  it("clamps negative input to zero", () => {
    expect(formatStateIntLatency(-50)).toBe("0ms");
  });

  it("renders non-finite values as an em-dash", () => {
    expect(formatStateIntLatency(Number.NaN)).toBe("—");
    expect(formatStateIntLatency(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("generateStateIntIdempotencyKey", () => {
  it("produces the documented shape `ui-state-int-${adapter}-${operation}-${ms}`", () => {
    const key = generateStateIntIdempotencyKey("src", "submitVat", 1700000000000);
    expect(key).toBe("ui-state-int-src-submitVat-1700000000000");
  });

  it("uses Date.now() by default", () => {
    const before = Date.now();
    const key = generateStateIntIdempotencyKey("egov", "sign");
    const after = Date.now();
    const match = key.match(/^ui-state-int-egov-sign-(\d+)$/);
    expect(match).not.toBeNull();
    if (match) {
      const ms = Number(match[1]);
      expect(ms).toBeGreaterThanOrEqual(before);
      expect(ms).toBeLessThanOrEqual(after);
    }
  });

  it("two consecutive calls with the same now() produce equal keys", () => {
    const a = generateStateIntIdempotencyKey("idcard", "verify", 42);
    const b = generateStateIntIdempotencyKey("idcard", "verify", 42);
    expect(a).toBe(b);
  });
});

describe("tryParseStateIntPayload", () => {
  it("parses well-formed JSON objects", () => {
    const result = tryParseStateIntPayload('{"period":"2026-Q1","netAmount":100000}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed).toEqual({ period: "2026-Q1", netAmount: 100000 });
    }
  });

  it("parses well-formed JSON arrays & primitives", () => {
    expect(tryParseStateIntPayload("[1,2,3]").ok).toBe(true);
    expect(tryParseStateIntPayload('"hello"').ok).toBe(true);
    expect(tryParseStateIntPayload("42").ok).toBe(true);
  });

  it("tolerates leading/trailing whitespace", () => {
    const result = tryParseStateIntPayload('  {"k":1}  \n');
    expect(result.ok).toBe(true);
  });

  it("rejects empty input with a useful message", () => {
    const result = tryParseStateIntPayload("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it("rejects non-string input", () => {
    // @ts-expect-error -- verify runtime guard against bad callers
    const result = tryParseStateIntPayload(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/string/);
    }
  });

  it("rejects malformed JSON with a useful error", () => {
    const result = tryParseStateIntPayload("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid JSON/);
    }
  });
});
