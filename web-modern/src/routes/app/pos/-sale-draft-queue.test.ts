import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../../../lib/api/client";
import {
  canAutoReplayQueuedPosSaleDraft,
  classifyPosSaleDraftAutoReplayFailure,
  createQueuedPosSaleDraft,
  derivePosSaleDraftOfflineReplaySourceKey,
  linkQueuedPosSaleDraftOfflineReplay,
  localSaleDraftReasonCanAutoReplay,
  markQueuedPosSaleDraftAutoReplayAttempt,
  markQueuedPosSaleDraftAutoReplayFailure,
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

function sampleDraft(
  index = 1,
  queueReason: PosLocalSaleDraft["queueReason"] = "manual",
): PosLocalSaleDraft {
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
    queueReason,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
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
    expect(draft.autoReplayStatus).toBe("queued");
    expect(draft.autoReplayAttemptCount).toBe(0);
    expect(canAutoReplayQueuedPosSaleDraft(draft)).toBe(true);
  });

  it("round-trips browser-offline drafts from storage as auto-replay eligible", () => {
    const draft = createQueuedPosSaleDraft({
      cashSessionId: "pos-session-1",
      payload: SAMPLE_PAYLOAD,
      evidence: SAMPLE_EVIDENCE,
      queueReason: "browser-offline",
      lastError: "Browser is offline",
    });

    window.localStorage.setItem(
      POS_SALE_DRAFT_QUEUE_STORAGE_KEY,
      JSON.stringify([draft]),
    );

    const [stored] = readQueuedPosSaleDrafts();

    expect(stored?.queueReason).toBe("browser-offline");
    expect(stored?.payload.idempotencyKey).toBe(SAMPLE_PAYLOAD.idempotencyKey);
    expect(stored?.autoReplayStatus).toBe("queued");
    expect(stored ? canAutoReplayQueuedPosSaleDraft(stored) : false).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(POS_SALE_DRAFT_QUEUE_STORAGE_KEY) || "[]"))
      .toMatchObject([{ queueReason: "browser-offline" }]);
  });

  it("round-trips durable offline replay evidence metadata from storage", () => {
    const draft = linkQueuedPosSaleDraftOfflineReplay(sampleDraft(1, "browser-offline"), {
      offlineReplayItemId: "offline-replay-item-1",
      offlineReplayStatus: "queued",
    });

    window.localStorage.setItem(
      POS_SALE_DRAFT_QUEUE_STORAGE_KEY,
      JSON.stringify([draft]),
    );

    const [stored] = readQueuedPosSaleDrafts();

    expect(stored).toMatchObject({
      offlineReplayItemId: "offline-replay-item-1",
      offlineReplaySourceKey: "pos-sale:pos-sale-ui-queue-test-1",
      offlineReplayStatus: "queued",
    });
    expect(stored?.payload.idempotencyKey).toBe(draft.payload.idempotencyKey);
  });

  it("drops unknown durable offline replay statuses while preserving valid draft data", () => {
    const draft = {
      ...sampleDraft(1, "browser-offline"),
      offlineReplayItemId: "offline-replay-item-1",
      offlineReplaySourceKey: "pos-sale:pos-sale-ui-queue-test-1",
      offlineReplayStatus: "legacy-pending",
    };

    window.localStorage.setItem(
      POS_SALE_DRAFT_QUEUE_STORAGE_KEY,
      JSON.stringify([draft]),
    );

    const [stored] = readQueuedPosSaleDrafts();
    const persisted = JSON.parse(
      window.localStorage.getItem(POS_SALE_DRAFT_QUEUE_STORAGE_KEY) || "[]",
    );

    expect(stored?.offlineReplayItemId).toBe("offline-replay-item-1");
    expect(stored?.offlineReplaySourceKey).toBe("pos-sale:pos-sale-ui-queue-test-1");
    expect(stored?.offlineReplayStatus).toBeUndefined();
    expect(persisted[0]).not.toHaveProperty("offlineReplayStatus");
  });

  it("normalizes unknown legacy draft reasons to manual", () => {
    const draft = {
      ...sampleDraft(1, "post-failed"),
      queueReason: "legacy-browser-offline",
    };

    window.localStorage.setItem(
      POS_SALE_DRAFT_QUEUE_STORAGE_KEY,
      JSON.stringify([draft]),
    );

    const [stored] = readQueuedPosSaleDrafts();

    expect(stored?.queueReason).toBe("manual");
    expect(stored ? canAutoReplayQueuedPosSaleDraft(stored) : true).toBe(false);
  });

  it("keeps post-failed drafts auto-replay eligible and manual drafts manual", () => {
    const postFailed = sampleDraft(1, "post-failed");
    const manual = sampleDraft(2, "manual");

    expect(localSaleDraftReasonCanAutoReplay("post-failed")).toBe(true);
    expect(localSaleDraftReasonCanAutoReplay("browser-offline")).toBe(true);
    expect(localSaleDraftReasonCanAutoReplay("manual")).toBe(false);
    expect(canAutoReplayQueuedPosSaleDraft(postFailed)).toBe(true);
    expect(canAutoReplayQueuedPosSaleDraft(manual)).toBe(false);
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
    expect(
      shouldQueuePosSaleDraftError(new ApiError(401, "UNAUTHORIZED", "Login required")),
    ).toBe(false);
    expect(
      shouldQueuePosSaleDraftError(
        new ApiError(409, "POS_SESSION_CLOSED", "Cash session is closed"),
      ),
    ).toBe(false);
    expect(shouldQueuePosSaleDraftError(new Error("finance period is closed"))).toBe(false);
    expect(
      shouldQueuePosSaleDraftError(
        new ApiError(500, "schema_mismatch", "API response did not match expected shape"),
      ),
    ).toBe(false);
  });

  it("does not let offline browser state make 4xx API failures retryable", () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    expect(
      shouldQueuePosSaleDraftError(new ApiError(400, "BAD_REQUEST", "Invalid sale")),
    ).toBe(false);
    expect(
      shouldQueuePosSaleDraftError(new ApiError(403, "FORBIDDEN", "Forbidden")),
    ).toBe(false);
    expect(shouldQueuePosSaleDraftError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("marks automatic replay attempts without changing sale identity", () => {
    const draft = sampleDraft();
    const retrying = markQueuedPosSaleDraftAutoReplayAttempt(
      draft,
      "2026-06-23T08:00:00.000Z",
    );

    expect(retrying.id).toBe(draft.id);
    expect(retrying.payload.idempotencyKey).toBe(draft.payload.idempotencyKey);
    expect(retrying.autoReplayStatus).toBe("retrying");
    expect(retrying.autoReplayAttemptCount).toBe(1);
    expect(retrying.autoReplayLastAttemptAt).toBe("2026-06-23T08:00:00.000Z");
    expect(retrying.lastRetryAt).toBe("2026-06-23T08:00:00.000Z");
    expect(canAutoReplayQueuedPosSaleDraft(retrying)).toBe(false);
  });

  it("derives deterministic durable offline replay source keys from sale idempotency", () => {
    const draft = sampleDraft();

    expect(derivePosSaleDraftOfflineReplaySourceKey(draft)).toBe(
      "pos-sale:pos-sale-ui-queue-test-1",
    );
    expect(derivePosSaleDraftOfflineReplaySourceKey({ ...draft })).toBe(
      derivePosSaleDraftOfflineReplaySourceKey(draft),
    );
  });

  it("links durable offline replay evidence without changing sale payload identity", () => {
    const draft = sampleDraft();
    const linked = linkQueuedPosSaleDraftOfflineReplay(draft, {
      offlineReplayItemId: "offline-replay-item-1",
      offlineReplayStatus: "replayed",
    });

    expect(linked.id).toBe(draft.id);
    expect(linked.payload).toBe(draft.payload);
    expect(linked.payload.idempotencyKey).toBe(draft.payload.idempotencyKey);
    expect(linked.offlineReplayItemId).toBe("offline-replay-item-1");
    expect(linked.offlineReplaySourceKey).toBe("pos-sale:pos-sale-ui-queue-test-1");
    expect(linked.offlineReplayStatus).toBe("replayed");
  });

  it("keeps retryable automatic replay failures eligible for another auto pass", () => {
    const retrying = markQueuedPosSaleDraftAutoReplayAttempt(
      sampleDraft(1, "post-failed"),
    );
    const failed = markQueuedPosSaleDraftAutoReplayFailure(
      retrying,
      new ApiError(503, "BACKEND_DOWN", "Backend unavailable"),
      "2026-06-23T08:01:00.000Z",
    );

    expect(failed.payload.idempotencyKey).toBe(retrying.payload.idempotencyKey);
    expect(failed.autoReplayStatus).toBe("retryable-failed");
    expect(failed.autoReplayAttemptCount).toBe(1);
    expect(failed.lastError).toBe("Backend unavailable");
    expect(failed.autoReplayLastFailureAt).toBe("2026-06-23T08:01:00.000Z");
    expect(failed.autoReplayBlockReason).toBeUndefined();
    expect(canAutoReplayQueuedPosSaleDraft(failed)).toBe(true);
  });

  it("classifies closed-session and conflict failures as visible non-auto-retry", () => {
    const draft = sampleDraft();
    const closed = markQueuedPosSaleDraftAutoReplayFailure(
      draft,
      new ApiError(409, "POS_SESSION_CLOSED", "Cash session is closed"),
      "2026-06-23T08:02:00.000Z",
    );
    const conflict = classifyPosSaleDraftAutoReplayFailure(
      new ApiError(409, "RECEIPT_CONFLICT", "Receipt already exists"),
    );

    expect(closed.autoReplayStatus).toBe("conflict-ready");
    expect(closed.autoReplayBlockReason).toBe("closed-session");
    expect(canAutoReplayQueuedPosSaleDraft(closed)).toBe(false);
    expect(conflict).toMatchObject({
      status: "conflict-ready",
      canAutoRetry: false,
      blockReason: "conflict",
    });
  });

  it("classifies 4xx validation and auth failures as failed non-auto-retry", () => {
    expect(
      classifyPosSaleDraftAutoReplayFailure(
        new ApiError(401, "UNAUTHORIZED", "Login required"),
      ),
    ).toMatchObject({
      status: "failed",
      canAutoRetry: false,
      blockReason: "auth",
    });
    expect(
      classifyPosSaleDraftAutoReplayFailure(
        new ApiError(400, "PERIOD_LOCKED", "Period closed"),
      ),
    ).toMatchObject({
      status: "failed",
      canAutoRetry: false,
      blockReason: "business-validation",
    });
    expect(
      classifyPosSaleDraftAutoReplayFailure(
        new ApiError(500, "schema_mismatch", "API response did not match expected shape"),
      ),
    ).toMatchObject({
      status: "failed",
      canAutoRetry: false,
      blockReason: "client-error",
    });
  });
});
