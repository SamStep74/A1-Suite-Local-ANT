/**
 * Tests for the inventory workspace pure helpers. TDD per
 * common/testing.md — the routes use these and the Mission
 * Control widgets will reuse them in Phase 2.6.
 */
import { describe, expect, it } from "vitest";
import {
  classifyStockLevel,
  indexByCatalogItemId,
  summariseItemStock,
  totalStockByItemId,
} from "../status";

describe("classifyStockLevel", () => {
  it("returns 'out' when availableQuantity is zero", () => {
    expect(classifyStockLevel({ availableQuantity: 0 })).toBe("out");
  });

  it("returns 'out' when availableQuantity is negative (defensive)", () => {
    expect(classifyStockLevel({ availableQuantity: -1 })).toBe("out");
  });

  it("returns 'low' when below the explicit reorderPoint", () => {
    expect(
      classifyStockLevel({ availableQuantity: 4, reorderPoint: 10 }),
    ).toBe("low");
  });

  it("returns 'low' when below the default reorderPoint (10)", () => {
    expect(classifyStockLevel({ availableQuantity: 5 })).toBe("low");
  });

  it("returns 'healthy' at or above the threshold", () => {
    expect(
      classifyStockLevel({ availableQuantity: 10, reorderPoint: 10 }),
    ).toBe("healthy");
    expect(
      classifyStockLevel({ availableQuantity: 50, reorderPoint: 10 }),
    ).toBe("healthy");
  });

  it("falls back to quantity when availableQuantity is missing", () => {
    expect(classifyStockLevel({ quantity: 3 })).toBe("low");
    expect(classifyStockLevel({ quantity: 20 })).toBe("healthy");
  });

  it("returns 'unknown' when neither quantity nor availableQuantity is set", () => {
    expect(classifyStockLevel({})).toBe("unknown");
    expect(classifyStockLevel({ reorderPoint: 10 })).toBe("unknown");
  });

  it("treats non-finite values as missing", () => {
    expect(classifyStockLevel({ availableQuantity: Number.NaN })).toBe(
      "unknown",
    );
    expect(
      classifyStockLevel({ availableQuantity: Number.POSITIVE_INFINITY }),
    ).toBe("unknown");
  });
});

describe("summariseItemStock", () => {
  it("returns zero + unknown when there are no rows", () => {
    expect(summariseItemStock([])).toEqual({
      totalAvailable: 0,
      health: "unknown",
    });
  });

  it("returns 'out' when the total across locations is zero", () => {
    expect(
      summariseItemStock([
        { availableQuantity: 0 },
        { availableQuantity: 0 },
      ]),
    ).toEqual({ totalAvailable: 0, health: "out" });
  });

  it("returns 'low' when the total is positive but below threshold", () => {
    expect(
      summariseItemStock([
        { availableQuantity: 3, reorderPoint: 10 },
        { availableQuantity: 4, reorderPoint: 10 },
      ]),
    ).toEqual({ totalAvailable: 7, health: "low" });
  });

  it("returns 'healthy' when the total is at or above the threshold", () => {
    expect(
      summariseItemStock([
        { availableQuantity: 8, reorderPoint: 5 },
        { availableQuantity: 2, reorderPoint: 5 },
      ]),
    ).toEqual({ totalAvailable: 10, health: "healthy" });
  });
});

describe("indexByCatalogItemId", () => {
  it("produces one entry per item with the right tier", () => {
    // 'out' means total sum is zero (matches the Inventory Risk Agent
    // rule: a multi-location warehouse with 50 at WH/2 and 0 at WH/1
    // is NOT out — we have 50 units to ship). 'low' means total is
    // positive but below the reorder point.
    const out = indexByCatalogItemId([
      {
        id: "a",
        stockBalances: [{ availableQuantity: 50, reorderPoint: 10 }],
      },
      { id: "b", stockBalances: [] },
      {
        id: "c",
        stockBalances: [
          { availableQuantity: 0 },
          { availableQuantity: 3 },
        ],
      },
      {
        id: "d",
        stockBalances: [
          { availableQuantity: 0 },
          { availableQuantity: 0 },
        ],
      },
    ]);
    expect(out.a?.health).toBe("healthy");
    expect(out.b?.health).toBe("unknown");
    expect(out.c?.health).toBe("low");
    expect(out.c?.totalAvailable).toBe(3);
    expect(out.d?.health).toBe("out");
    expect(out.d?.totalAvailable).toBe(0);
  });
});

describe("totalStockByItemId", () => {
  it("aggregates by catalogItemId", () => {
    const totals = totalStockByItemId([
      {
        id: "sb-1",
        catalogItemId: "ci-1",
        locationId: "loc-1",
        availableQuantity: 3,
        quantity: 3,
      },
      {
        id: "sb-2",
        catalogItemId: "ci-1",
        locationId: "loc-2",
        availableQuantity: 4,
        quantity: 4,
      },
      {
        id: "sb-3",
        catalogItemId: "ci-2",
        locationId: "loc-1",
        availableQuantity: 10,
        quantity: 10,
      },
    ]);
    expect(totals["ci-1"]).toBe(7);
    expect(totals["ci-2"]).toBe(10);
    expect(totals["ci-3"]).toBeUndefined();
  });
});
