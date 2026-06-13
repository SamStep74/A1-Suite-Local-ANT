/**
 * state.test.ts — pure-function coverage for `lib/wizard/state.ts`.
 *
 * The wizard's reducer is a pure module: no React, no DOM, no
 * Lingui. Vitest's node environment is the default for
 * `src/lib/**`, so we just import the helpers and assert on
 * the values they return.
 *
 * What we cover:
 *   - `initialWizardState()` starts on the customer step with
 *     an empty draft and no errors.
 *   - `nextStep()` advances iff the current slice validates.
 *   - `nextStep()` populates the `errors` map and flips
 *     `attemptedAdvance` when the slice is invalid.
 *   - `prevStep()` clears errors and steps back.
 *   - `setCustomer()` merges without dropping fields, and clears
 *     the corresponding error key.
 *   - `addLineItem` / `removeLineItem` mutate the line-items
 *     list immutably.
 *   - `validateStep()` returns the right verdict per step.
 *   - `draftTotal()` sums quantity * unitPrice.
 *   - `markSubmitted()` sets the submit slice and is reachable
 *     from the terminal step.
 */
import { describe, expect, it } from "vitest";

import { ValidationCode, WizardStep } from "./schemas";
import {
  addLineItem,
  draftTotal,
  initialWizardState,
  markSubmitted,
  nextStep,
  prevStep,
  removeLineItem,
  setCustomer,
  setLineItems,
  setReviewConfirmed,
  updateLineItem,
  validateStep,
  type WizardState,
} from "./state";

/* ────────── helpers ────────── */

const validCustomer = {
  customerId: "cust-1",
  customerName: "Acme",
  issueDate: "2026-06-14",
};

const validLineItems = {
  items: [
    { id: "li-1", description: "Widget", quantity: 2, unitPrice: 100 },
  ],
};

/* ────────── initial state ────────── */

describe("initialWizardState", () => {
  it("starts on the customer step with an empty draft and no errors", () => {
    const s = initialWizardState();
    expect(s.step).toBe(WizardStep.Customer);
    expect(s.draft).toEqual({});
    expect(s.errors).toEqual({});
    expect(s.attemptedAdvance).toBe(false);
  });
});

/* ────────── validateStep ────────── */

describe("validateStep", () => {
  it("rejects the empty customer step with a per-field error map", () => {
    const s = initialWizardState();
    const v = validateStep(s, WizardStep.Customer);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected failure");
    // customerId, customerName, issueDate — all required / formatted.
    expect(Object.keys(v.errors).sort()).toEqual(
      ["customerId", "customerName", "issueDate"].sort(),
    );
    for (const code of Object.values(v.errors)) {
      expect([ValidationCode.Required, ValidationCode.DateFormat]).toContain(
        code,
      );
    }
  });

  it("accepts a fully populated customer step", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: { customer: validCustomer },
    };
    const v = validateStep(s, WizardStep.Customer);
    expect(v.ok).toBe(true);
  });

  it("rejects the line-items step with zero items", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.LineItems,
      draft: { lineItems: { items: [] } },
    };
    const v = validateStep(s, WizardStep.LineItems);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected failure");
    expect(v.errors["items"]).toBe(ValidationCode.MinOneLine);
  });

  it("rejects a line item with a non-positive quantity", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.LineItems,
      draft: {
        lineItems: {
          items: [
            { id: "li-1", description: "Widget", quantity: 0, unitPrice: 100 },
          ],
        },
      },
    };
    const v = validateStep(s, WizardStep.LineItems);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected failure");
    expect(v.errors["items.0.quantity"]).toBe(ValidationCode.Positive);
  });

  it("rejects a line item with a negative unit price", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.LineItems,
      draft: {
        lineItems: {
          items: [
            {
              id: "li-1",
              description: "Widget",
              quantity: 1,
              unitPrice: -5,
            },
          ],
        },
      },
    };
    const v = validateStep(s, WizardStep.LineItems);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected failure");
    expect(v.errors["items.0.unitPrice"]).toBe(ValidationCode.Nonnegative);
  });

  it("rejects the review step with no confirmation", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.Review,
    };
    const v = validateStep(s, WizardStep.Review);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("expected failure");
    // The review step's `z.literal(true)` failure lands on
    // the `confirmed` field key, not the root.
    expect(v.errors["confirmed"]).toBe(ValidationCode.ConfirmRequired);
  });

  it("accepts a confirmed review step", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.Review,
      draft: { review: { confirmed: true } },
    };
    const v = validateStep(s, WizardStep.Review);
    expect(v.ok).toBe(true);
  });

  it("treats the submit step as always valid", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.Submit,
    };
    const v = validateStep(s, WizardStep.Submit);
    expect(v.ok).toBe(true);
  });
});

/* ────────── nextStep ────────── */

describe("nextStep", () => {
  it("advances on a valid customer step", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: { customer: validCustomer },
    };
    const next = nextStep(s);
    expect(next.step).toBe(WizardStep.LineItems);
    expect(next.errors).toEqual({});
    expect(next.attemptedAdvance).toBe(false);
  });

  it("stays put and populates errors on an invalid customer step", () => {
    const s = initialWizardState();
    const next = nextStep(s);
    expect(next.step).toBe(WizardStep.Customer);
    expect(next.attemptedAdvance).toBe(true);
    expect(Object.keys(next.errors).length).toBeGreaterThan(0);
  });

  it("is a no-op on the terminal submit step", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.Submit,
    };
    const next = nextStep(s);
    expect(next.step).toBe(WizardStep.Submit);
    expect(next.errors).toEqual({});
    expect(next.attemptedAdvance).toBe(false);
  });
});

/* ────────── prevStep ────────── */

describe("prevStep", () => {
  it("steps back one entry in the order", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.LineItems,
    };
    const prev = prevStep(s);
    expect(prev.step).toBe(WizardStep.Customer);
    expect(prev.errors).toEqual({});
  });

  it("is a no-op on the first step", () => {
    const s = initialWizardState();
    const prev = prevStep(s);
    expect(prev.step).toBe(WizardStep.Customer);
  });

  it("clears errors when stepping back", () => {
    const s: WizardState = {
      ...initialWizardState(),
      step: WizardStep.LineItems,
      errors: { "items.0.quantity": ValidationCode.Positive },
      attemptedAdvance: true,
    };
    const prev = prevStep(s);
    expect(prev.errors).toEqual({});
    expect(prev.attemptedAdvance).toBe(false);
  });
});

/* ────────── setCustomer ────────── */

describe("setCustomer", () => {
  it("merges the partial payload without dropping fields", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: { customer: validCustomer },
    };
    const next = setCustomer(s, { customerName: "Updated" });
    expect(next.draft.customer).toEqual({
      ...validCustomer,
      customerName: "Updated",
    });
  });

  it("clears the touched field's error", () => {
    const s: WizardState = {
      ...initialWizardState(),
      errors: {
        customerId: ValidationCode.Required,
        customerName: ValidationCode.Required,
      },
    };
    const next = setCustomer(s, { customerId: "cust-1" });
    expect(next.errors["customerId"]).toBeUndefined();
    expect(next.errors["customerName"]).toBe(ValidationCode.Required);
  });
});

/* ────────── line item helpers ────────── */

describe("addLineItem / removeLineItem / updateLineItem", () => {
  it("appends a fresh row", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: { lineItems: { items: [] } },
    };
    const next = addLineItem(s);
    expect(next.draft.lineItems?.items.length).toBe(1);
    // The new row has stable non-empty fields.
    const row = next.draft.lineItems!.items[0];
    expect(row.id.length).toBeGreaterThan(0);
    expect(typeof row.quantity).toBe("number");
    expect(typeof row.unitPrice).toBe("number");
  });

  it("removes a row by id", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: {
        lineItems: {
          items: [
            { id: "a", description: "X", quantity: 1, unitPrice: 1 },
            { id: "b", description: "Y", quantity: 1, unitPrice: 1 },
          ],
        },
      },
    };
    const next = removeLineItem(s, "a");
    expect(next.draft.lineItems?.items.length).toBe(1);
    expect(next.draft.lineItems?.items[0].id).toBe("b");
  });

  it("updates a single field on a single row", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: {
        lineItems: {
          items: [
            { id: "a", description: "X", quantity: 1, unitPrice: 1 },
          ],
        },
      },
    };
    const next = updateLineItem(s, "a", { quantity: 5 });
    expect(next.draft.lineItems?.items[0].quantity).toBe(5);
    expect(next.draft.lineItems?.items[0].description).toBe("X");
  });

  it("does not mutate the original draft (immutable updates)", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: {
        lineItems: {
          items: [
            { id: "a", description: "X", quantity: 1, unitPrice: 1 },
          ],
        },
      },
    };
    const before = JSON.parse(JSON.stringify(s.draft));
    addLineItem(s);
    expect(s.draft).toEqual(before);
  });
});

/* ────────── review + submit helpers ────────── */

describe("setReviewConfirmed / markSubmitted", () => {
  it("setReviewConfirmed sets the review slice when true", () => {
    const s = initialWizardState();
    const next = setReviewConfirmed(s, true);
    expect(next.draft.review).toEqual({ confirmed: true });
  });

  it("setReviewConfirmed clears the review slice when false", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: { review: { confirmed: true } },
    };
    const next = setReviewConfirmed(s, false);
    expect(next.draft.review).toBeUndefined();
  });

  it("markSubmitted sets the submit slice", () => {
    const s = initialWizardState();
    const next = markSubmitted(s);
    expect(next.draft.submit).toEqual({ submitted: true });
  });
});

/* ────────── draftTotal ────────── */

describe("draftTotal", () => {
  it("sums quantity * unitPrice across line items", () => {
    const s: WizardState = {
      ...initialWizardState(),
      draft: {
        lineItems: {
          items: [
            { id: "a", description: "X", quantity: 2, unitPrice: 100 },
            { id: "b", description: "Y", quantity: 3, unitPrice: 50 },
          ],
        },
      },
    };
    expect(draftTotal(s)).toBe(2 * 100 + 3 * 50);
  });

  it("returns 0 for an empty draft", () => {
    expect(draftTotal(initialWizardState())).toBe(0);
  });
});

/* ────────── setLineItems ────────── */

describe("setLineItems", () => {
  it("replaces the items array and clears errors", () => {
    const s: WizardState = {
      ...initialWizardState(),
      errors: { "items.0.quantity": ValidationCode.Positive },
    };
    const next = setLineItems(s, validLineItems.items);
    expect(next.draft.lineItems?.items).toEqual(validLineItems.items);
    expect(next.errors).toEqual({});
  });
});
