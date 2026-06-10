/**
 * InventoryRiskAgent — V1 tests.
 *
 * Pure-function evaluator. No network — the agent only reads the
 * catalog item + its stock balances / price-list entries. Output is
 * 0..2 suggestions per call.
 */

import { describe, expect, it } from "vitest";
import { inventoryRiskAgent } from "./inventory-risk";
import type { AgentContext } from "./types";

const BASE_ITEM = {
  id: "ci-1",
  sku: "EQ-CHAIR",
  name: "Treatment chair",
  itemType: "stockable",
  status: "active",
  trackStock: true,
  reorderPoint: 10,
  averageCost: 400000,
  preferredLocationId: "loc-1",
  preferredLocationCode: "WH/STOCK",
};

function ctx(item: unknown): AgentContext {
  return { type: "catalog.item", id: "ci-1", data: item };
}

describe("InventoryRiskAgent.evaluate", () => {
  it("returns no suggestions for a non-stockable item", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({ ...BASE_ITEM, trackStock: false, stockBalances: [] }),
    );
    expect(out).toEqual([]);
  });

  it("returns no suggestions for an archived item", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({ ...BASE_ITEM, status: "archived", stockBalances: [] }),
    );
    expect(out).toEqual([]);
  });

  it("returns no suggestions for a healthy item (>= reorder point)", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({
        ...BASE_ITEM,
        stockBalances: [
          {
            id: "sb-1",
            catalogItemId: "ci-1",
            locationId: "loc-1",
            locationCode: "WH/STOCK",
            quantity: 20,
            availableQuantity: 20,
          },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("emits a low-stock replenishment suggestion at default threshold", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({
        ...BASE_ITEM,
        stockBalances: [
          {
            id: "sb-1",
            catalogItemId: "ci-1",
            locationId: "loc-1",
            locationCode: "WH/STOCK",
            quantity: 5,
            availableQuantity: 5,
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    const s = out[0]!;
    expect(s.agentId).toBe("inventory-risk");
    expect(s.title).toMatch(/below reorder point/i);
    expect(s.risk).toBe("medium");
    expect(s.confidence).toBe(0.8);
    const action = s.proposedAction;
    expect(action.method).toBe("POST");
    expect(action.path).toBe("/api/inventory/moves");
    expect(action.body).toMatchObject({
      catalogItemId: "ci-1",
      destinationLocationId: "loc-1",
      moveType: "receipt",
      // 5 available, threshold 10 → suggested = 2*10 - 5 = 15
      quantity: 15,
      unitCost: 400000,
    });
  });

  it("emits an out-of-stock suggestion with high risk and a 2x threshold receipt", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({
        ...BASE_ITEM,
        reorderPoint: 10,
        stockBalances: [
          {
            id: "sb-1",
            catalogItemId: "ci-1",
            locationId: "loc-1",
            locationCode: "WH/STOCK",
            quantity: 0,
            availableQuantity: 0,
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    const s = out[0]!;
    expect(s.title).toMatch(/out of stock/i);
    expect(s.risk).toBe("high");
    expect(s.confidence).toBe(0.95);
    // 0 available, threshold 10 → suggested = 2*10 - 0 = 20
    expect((s.proposedAction.body as { quantity: number }).quantity).toBe(20);
  });

  it("aggregates multiple location balances correctly", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({
        ...BASE_ITEM,
        reorderPoint: 20,
        stockBalances: [
          {
            id: "sb-1",
            catalogItemId: "ci-1",
            locationId: "loc-1",
            locationCode: "WH/STOCK",
            quantity: 3,
            availableQuantity: 3,
          },
          {
            id: "sb-2",
            catalogItemId: "ci-1",
            locationId: "loc-2",
            locationCode: "WH/OUT",
            quantity: 5,
            availableQuantity: 5,
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    const action = out[0]!.proposedAction.body as { quantity: number };
    // total 8 available, threshold 20 → suggested = 2*20 - 8 = 32
    expect(action.quantity).toBe(32);
  });

  it("uses the default reorder point of 10 when none is set", async () => {
    const { reorderPoint: _reorderPoint, ...item } = BASE_ITEM;
    void _reorderPoint;
    const out = await inventoryRiskAgent.evaluate(
      ctx({
        ...item,
        stockBalances: [
          {
            id: "sb-1",
            catalogItemId: "ci-1",
            locationId: "loc-1",
            locationCode: "WH/STOCK",
            quantity: 0,
            availableQuantity: 0,
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    // 0 available, default threshold 10 → suggested = 20
    expect((out[0]!.proposedAction.body as { quantity: number }).quantity).toBe(20);
  });

  it("emits a below-minimum margin insight alongside the replenishment", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({
        ...BASE_ITEM,
        stockBalances: [
          {
            id: "sb-1",
            catalogItemId: "ci-1",
            locationId: "loc-1",
            locationCode: "WH/STOCK",
            quantity: 0,
            availableQuantity: 0,
          },
        ],
        priceListEntries: [
          {
            priceListId: "pl-1",
            priceListCode: "RETAIL-2026",
            marginStatus: "below_minimum",
            marginPercent: 8,
            marginRuleCode: "STD-20",
            standardCost: 100,
            netPrice: 108,
          },
        ],
      }),
    );
    expect(out).toHaveLength(2);
    // The first suggestion is the receipt, the second is the margin insight
    expect(out[0]!.proposedAction.path).toBe("/api/inventory/moves");
    expect(out[1]!.proposedAction.path).toBe("/_no-op");
    expect(out[1]!.kind).toBe("rule");
    expect(out[1]!.title).toMatch(/Below-minimum margin/i);
  });

  it("emits only the margin insight when stock is healthy", async () => {
    const out = await inventoryRiskAgent.evaluate(
      ctx({
        ...BASE_ITEM,
        stockBalances: [
          {
            id: "sb-1",
            catalogItemId: "ci-1",
            locationId: "loc-1",
            locationCode: "WH/STOCK",
            quantity: 50,
            availableQuantity: 50,
          },
        ],
        priceListEntries: [
          {
            priceListId: "pl-1",
            priceListCode: "RETAIL-2026",
            marginStatus: "below_minimum",
            marginRuleCode: "STD-20",
          },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.proposedAction.path).toBe("/_no-op");
  });
});
