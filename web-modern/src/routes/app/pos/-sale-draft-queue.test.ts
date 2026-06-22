import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../../lib/api/client";
import {
  createQueuedPosSaleDraft,
  persistQueuedPosSaleDrafts,
  POS_SALE_DRAFT_QUEUE_STORAGE_KEY,
  readQueuedPosSaleDrafts,
  shouldQueuePosSaleDraftError,
  type PosLocalSaleDraft,
} from "./-sale-draft-queue";

const SAMPLE_PAYLOAD = {
  receiptNumber: "R-LOCAL-1",
  paymentMethod: "card" as const,
  idempotencyKey: "pos-sale-ui-queue-test",
  lines: [{ catalogItemId: "catitem-pos-scanner", quantity: 2 }],
};

const SAMPLE_EVIDENCE = {
  receiptNumber: "R-LOCAL-1",
  customerLabel: "Ararat Market",
  paymentLabel: "Card",
  lineLabel: "2 x POS-SCANNER",
  quantity: 2,
  total: 50000,
};

function sampleDraft(index = 1): PosLocalSaleDraft {
  return createQueuedPosSaleDraft({
    cashSessionId: "pos-session-1",
    payload: {
      ...SAMPLE_PAYLOAD,
      receiptNumber: `R-LOCAL-${index}`,
      idempotencyKey: `pos-sale-ui-queue-test-${index}`,
    },
    evidence: {
      ...SAMPLE_EVIDENCE,
      receiptNumber: `R-LOCAL-${index}`,
    },
    queueReason: "manual",
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("POS sale draft queue", () => {
  it("resets corrupt localStorage queue data", () => {
    window.localStorage.setItem(POS_SALE_DRAFT_QUEUE_STORAGE_KEY, "{not-json");

    expect(readQueuedPosSaleDrafts()).toEqual([]);
    expect(window.localStorage.getItem(POS_SALE_DRAFT_QUEUE_STORAGE_KEY)).toBe("[]");
  });

  it("bounds persisted drafts to the most recent 25", () => {
    const drafts = Array.from({ length: 30 }, (_, index) => sampleDraft(index + 1));

    const persisted = persistQueuedPosSaleDrafts(drafts);

    expect(persisted).toHaveLength(25);
    expect(persisted[0]?.payload.receiptNumber).toBe("R-LOCAL-6");
    expect(readQueuedPosSaleDrafts()).toHaveLength(25);
  });

  it("creates a schema-valid draft with stable sale idempotency evidence", () => {
    const draft = createQueuedPosSaleDraft({
      cashSessionId: "pos-session-1",
      payload: SAMPLE_PAYLOAD,
      evidence: SAMPLE_EVIDENCE,
      queueReason: "post-failed",
      lastError: "Failed to fetch",
    });

    expect(draft.id).toBe("pos-sale-draft-pos-sale-ui-queue-test");
    expect(draft.payload.idempotencyKey).toBe("pos-sale-ui-queue-test");
    expect(draft.queueReason).toBe("post-failed");
    expect(draft.lastError).toBe("Failed to fetch");
  });

  it("queues network/server failures but not business validation failures", () => {
    expect(shouldQueuePosSaleDraftError(new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldQueuePosSaleDraftError(new Error("network offline"))).toBe(true);
    expect(
      shouldQueuePosSaleDraftError(new ApiError(503, "BACKEND_DOWN", "Backend unavailable")),
    ).toBe(true);
    expect(
      shouldQueuePosSaleDraftError(new ApiError(400, "PERIOD_LOCKED", "Period closed")),
    ).toBe(false);
    expect(shouldQueuePosSaleDraftError(new Error("finance period is closed"))).toBe(false);
  });
});
