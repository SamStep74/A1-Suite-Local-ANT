/**
 * /app/smb-crm/quote-templates — Quote template library tests
 * (slice 13).
 *
 * Coverage:
 *   - The 4 built-in template cards render with their names
 *     and the "built-in" pill
 *   - The header subtitle mentions "Pick a template, fill
 *     qty + price, generate a printable PDF"
 *   - Clicking a template reveals the metadata editor +
 *     line item editor + create button
 *   - The line item editor seeds quantity + unitPrice from
 *     the template's defaults
 *   - Editing quantity or unitPrice updates the line total
 *     in real time
 *   - The preview total at the bottom equals the sum of the
 *     line totals
 *   - "Create quote + open PDF" is disabled when the quote
 *     number is empty
 *   - "Create quote + open PDF" is enabled when a template is
 *     selected AND the quote number is non-empty
 *   - Clicking Create calls postJson with the parsed
 *     QuoteFromTemplateRequest body (templateId, number,
 *     customerId, issueDate, currency, overrides)
 *   - On a successful response, the page opens
 *     /api/smb-crm/quotes/<id>.pdf in a new tab
 *   - The page shows the currency selector with AMD / USD /
 *     EUR / GBP / RUB
 *   - Armenian + emoji template line items round-trip into
 *     the line editor state
 *   - The create button is wired to use the idempotencyKey
 *     shape `qt-<templateId>-<number>-<timestamp>`
 *   - NO error appears when the templates list resolves
 *     successfully
 *   - An error alert appears when the templates list fails
 *     to load
 *   - The Back link points to /app/smb-crm
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

const mocks = vi.hoisted(() => ({
  fullPath: "/app/smb-crm/quote-templates/",
  getJsonMock: vi.fn(),
  postJsonMock: vi.fn(),
  windowOpenMock: vi.fn(),
  // Pre-seedable /api/smb-crm/quote-templates result.
  templatesData: null as null | {
    templates: Array<{
      id: string;
      orgId: string;
      name: string;
      description: string;
      lineItems: Array<{ name: string; description: string; quantity: number; unitPrice: number }>;
      builtin: boolean;
      createdAt: string;
    }>;
  },
  // Pre-seedable /api/smb-crm/customers result. null =
  // "loading" (matches the production default before the
  // query resolves).
  customersData: null as null | {
    customers: Array<{
      id: string;
      orgId: string;
      fullName: string;
      email: string | null;
      phone: string | null;
      companyName: string | null;
      address: string | null;
      locale: string;
      status: string;
      branchId: string | null;
      tags: string[];
      custom: Record<string, unknown>;
      mergedIntoId: string | null;
      createdAt: string;
      updatedAt?: string;
    }>;
  }
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg
  }),
  useSearch: () => ({}),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => <a data-href={to} {...rest}>{children}</a>
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: (opts: { queryKey: string[] }) => {
      const key = opts.queryKey[0];
      if (key === "smb-crm-quote-templates") {
        if (mocks.templatesData === null) {
          return { data: undefined, isLoading: true, isError: false };
        }
        if ("_error" in mocks.templatesData) {
          return { data: undefined, isLoading: false, isError: true };
        }
        return { data: mocks.templatesData, isLoading: false, isError: false };
      }
      if (key === "smb-crm-customers") {
        if (mocks.customersData === null) {
          return { data: undefined, isLoading: true, isError: false };
        }
        return { data: mocks.customersData, isLoading: false, isError: false };
      }
      return { data: undefined, isLoading: false, isError: false };
    },
    useMutation: (cfg: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (data: unknown, input: unknown) => void; onError?: (err: unknown) => void }) => {
      const fire = (input: unknown) => {
        cfg
          .mutationFn(input)
          .then((data) => cfg.onSuccess && cfg.onSuccess(data, input))
          .catch((err) => cfg.onError && cfg.onError(err));
      };
      return { mutate: fire, isPending: false, error: undefined as Error | undefined };
    },
    useQueryClient: () => ({
      invalidateQueries: vi.fn()
    })
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: (...args: unknown[]) => mocks.getJsonMock(...args),
  postJson: (...args: unknown[]) => mocks.postJsonMock(...args)
}));

// Stub window.open so we can assert the PDF URL.
// Use vi.stubGlobal so vitest handles restoration in afterEach.
const originalOpen = globalThis.open;
function stubWindowOpen() {
  vi.stubGlobal("open", mocks.windowOpenMock);
}
function restoreWindowOpen() {
  if (originalOpen) {
    vi.stubGlobal("open", originalOpen);
  } else {
    vi.unstubAllGlobals();
  }
}

import { Route } from "./index";

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  stubWindowOpen();
  mocks.templatesData = {
    templates: [
      { id: "tpl-standard-product", orgId: "_builtin", name: "Standard product quote", description: "Product name + 1 line of description. Single quantity.", lineItems: [{ name: "Product", description: "Catalog item", quantity: 1, unitPrice: 0 }], builtin: true, createdAt: "2026-06-01T00:00:00Z" },
      { id: "tpl-service-3", orgId: "_builtin", name: "Service quote · 3 lines", description: "3 service lines.", lineItems: [{ name: "Setup", description: "Onboarding", quantity: 1, unitPrice: 0 }, { name: "Monthly", description: "Recurring", quantity: 1, unitPrice: 0 }, { name: "Training", description: "One-time", quantity: 1, unitPrice: 0 }], builtin: true, createdAt: "2026-06-01T00:00:00Z" },
      { id: "tpl-subscription-annual", orgId: "_builtin", name: "Annual subscription", description: "12 months (1 free).", lineItems: [{ name: "Annual license", description: "12 months", quantity: 12, unitPrice: 0 }], builtin: true, createdAt: "2026-06-01T00:00:00Z" },
      { id: "tpl-consulting-blank", orgId: "_builtin", name: "Consulting (blank lines)", description: "5 blank consulting lines.", lineItems: [{ name: "Consulting 1", description: "", quantity: 1, unitPrice: 0 }, { name: "Consulting 2", description: "", quantity: 1, unitPrice: 0 }, { name: "Consulting 3", description: "", quantity: 1, unitPrice: 0 }, { name: "Consulting 4", description: "", quantity: 1, unitPrice: 0 }, { name: "Consulting 5", description: "", quantity: 1, unitPrice: 0 }], builtin: true, createdAt: "2026-06-01T00:00:00Z" }
    ]
  };
  // Default: 2 customers available for the picker.
  mocks.customersData = {
    customers: [
      {
        id: "cust-1",
        orgId: "org-1",
        fullName: "Petros Petrosyan",
        email: "info@acme.am",
        phone: null,
        companyName: "Acme LLC",
        address: null,
        locale: "hy-AM",
        status: "active",
        branchId: null,
        tags: [],
        custom: {},
        mergedIntoId: null,
        createdAt: "2026-06-01T00:00:00Z"
      },
      {
        id: "cust-2",
        orgId: "org-1",
        fullName: "Anna Sahakyan",
        email: "anna@brightfuture.am",
        phone: null,
        companyName: "Bright Future",
        address: null,
        locale: "en",
        status: "active",
        branchId: null,
        tags: [],
        custom: {},
        mergedIntoId: null,
        createdAt: "2026-06-01T00:00:00Z"
      }
    ]
  };
  mocks.postJsonMock.mockReset();
  mocks.windowOpenMock.mockReset();
});

afterEach(() => {
  cleanup();
  restoreWindowOpen();
});

describe("Quote templates — list", () => {
  it("renders the 4 built-in template cards", () => {
    renderRoute();
    const cards = screen.getAllByTestId("smb-crm-quote-template-card");
    expect(cards).toHaveLength(4);
    const ids = cards.map((el) => el.getAttribute("data-template-id"));
    expect(ids).toEqual([
      "tpl-standard-product",
      "tpl-service-3",
      "tpl-subscription-annual",
      "tpl-consulting-blank"
    ]);
  });

  it("shows the 'built-in' pill on every seeded template", () => {
    renderRoute();
    const builtins = screen.getAllByTestId("smb-crm-quote-template-builtin");
    expect(builtins).toHaveLength(4);
  });

  it("renders the page header with the documented subtitle", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-quote-templates-h1").textContent).toMatch(/Quote templates/);
    expect(screen.getByTestId("smb-crm-quote-templates-subtitle").textContent).toMatch(/Pick a template/);
    expect(screen.getByTestId("smb-crm-quote-templates-subtitle").textContent).toMatch(/printable PDF/);
  });

  it("shows the loading state when the templates query has no data", () => {
    mocks.templatesData = null as never;
    renderRoute();
    expect(screen.getByTestId("smb-crm-quote-templates-loading")).toBeTruthy();
  });
});

describe("Quote templates — pick + edit", () => {
  it("clicking a template reveals the metadata editor + line editor", () => {
    renderRoute();
    const cards = screen.getAllByTestId("smb-crm-quote-template-card");
    fireEvent.click(cards[1]!); // tpl-service-3
    expect(screen.getByTestId("smb-crm-quote-template-meta")).toBeTruthy();
    expect(screen.getByTestId("smb-crm-quote-template-lines")).toBeTruthy();
    expect(screen.getByTestId("smb-crm-quote-template-create-bar")).toBeTruthy();
  });

  it("seeds the line editor with the template's defaults", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[1]!);
    // tpl-service-3 has 3 line items, all with quantity=1, price=0.
    const qtys = screen.getAllByTestId("smb-crm-quote-template-qty") as HTMLInputElement[];
    const prices = screen.getAllByTestId("smb-crm-quote-template-price") as HTMLInputElement[];
    expect(qtys).toHaveLength(3);
    expect(prices).toHaveLength(3);
    for (const q of qtys) expect(q.value).toBe("1");
    for (const p of prices) expect(p.value).toBe("0");
  });

  it("editing qty + price updates the line total in real time", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[1]!);
    // Set line 0 qty=5, price=100 → line total = 500.00
    const qtys = screen.getAllByTestId("smb-crm-quote-template-qty") as HTMLInputElement[];
    const prices = screen.getAllByTestId("smb-crm-quote-template-price") as HTMLInputElement[];
    fireEvent.change(qtys[0]!, { target: { value: "5" } });
    fireEvent.change(prices[0]!, { target: { value: "100" } });
    const lineTotal = screen.getAllByTestId("smb-crm-quote-template-line-total")[0]!;
    expect(lineTotal.textContent).toMatch(/500\.00 AMD/);
  });

  it("the preview total equals the sum of the line totals", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!); // 1 line
    const qty = screen.getByTestId("smb-crm-quote-template-qty") as HTMLInputElement;
    const price = screen.getByTestId("smb-crm-quote-template-price") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "10" } });
    fireEvent.change(price, { target: { value: "250" } });
    const total = screen.getByTestId("smb-crm-quote-template-total");
    // The preview uses .toFixed(2) (no thousands separator).
    // The actual PDF uses formatMoney which adds the comma. The
    // preview's job is to show "what you'll get roughly".
    expect(total.textContent).toMatch(/2500\.00 AMD/);
    expect(total.textContent).toMatch(/Preview total/);
  });

  it("renders the currency selector with AMD + USD + EUR + GBP + RUB", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    const sel = screen.getByTestId("smb-crm-quote-template-currency") as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toEqual(["AMD", "USD", "EUR", "GBP", "RUB"]);
    // Default is AMD.
    expect(sel.value).toBe("AMD");
  });
});

describe("Quote templates — create + open PDF", () => {
  it("disables the Create button when the quote number is empty", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    const btn = screen.getByTestId("smb-crm-quote-template-create") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("enables the Create button when a template + number are both set", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    const numInput = screen.getByTestId("smb-crm-quote-template-number") as HTMLInputElement;
    fireEvent.change(numInput, { target: { value: "Q-1" } });
    const btn = screen.getByTestId("smb-crm-quote-template-create") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("sends a POST /api/smb-crm/quotes/from-template with the parsed body on click", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      quote: {
        id: "quote-new-1",
        org_id: "org-1",
        number: "Q-1",
        customer_id: null,
        deal_id: null,
        issue_date: "2026-06-15",
        expiry_date: null,
        status: "draft",
        total_amount: 1000,
        currency: "AMD",
        line_items_json: "[]",
        created_at: "2026-06-15T00:00:00Z",
        updated_at: "2026-06-15T00:00:00Z",
        template_id: "tpl-standard-product",
        template_name: "Standard product quote"
      },
      lineItems: [],
      totalAmount: 1000
    });
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    fireEvent.change(screen.getByTestId("smb-crm-quote-template-number"), { target: { value: "Q-1" } });
    // The customer field is now a <select> populated from
    // /api/smb-crm/customers. Use selectOption (not
    // fireEvent.change) so React's change event fires.
    fireEvent.change(screen.getByTestId("smb-crm-quote-template-customer"), { target: { value: "cust-1" } });
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-create"));
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    const [url, body] = mocks.postJsonMock.mock.calls[0]!;
    expect(url).toBe("/api/smb-crm/quotes/from-template");
    expect(body.templateId).toBe("tpl-standard-product");
    expect(body.number).toBe("Q-1");
    expect(body.customerId).toBe("cust-1");
    expect(body.currency).toBe("AMD");
    expect(Array.isArray(body.overrides)).toBe(true);
    expect(body.overrides).toHaveLength(1);
    // The idempotencyKey follows the documented shape.
    expect(body.idempotencyKey).toMatch(/^qt-tpl-standard-product-Q-1-\d+$/);
  });

  it("opens /api/smb-crm/quotes/<id>.pdf in a new tab on success", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      quote: { id: "quote-pdf-1", org_id: "org-1", number: "Q-1", customer_id: null, deal_id: null, issue_date: "2026-06-15", expiry_date: null, status: "draft", total_amount: 0, currency: "AMD", line_items_json: "[]", created_at: "2026-06-15T00:00:00Z", updated_at: "2026-06-15T00:00:00Z" },
      lineItems: [],
      totalAmount: 0
    });
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    fireEvent.change(screen.getByTestId("smb-crm-quote-template-number"), { target: { value: "Q-1" } });
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-create"));
    await waitFor(() => expect(mocks.windowOpenMock).toHaveBeenCalledTimes(1));
    expect(mocks.windowOpenMock).toHaveBeenCalledWith(
      "/api/smb-crm/quotes/quote-pdf-1.pdf",
      "_blank"
    );
  });
});

describe("Quote templates — edge cases", () => {
  it("renders an error alert when the templates query fails", () => {
    mocks.templatesData = { _error: true } as never;
    renderRoute();
    expect(screen.getByText(/Could not load quote templates/)).toBeTruthy();
  });

  it("renders an empty state when no templates are available", () => {
    mocks.templatesData = { templates: [] };
    renderRoute();
    expect(screen.getByTestId("smb-crm-quote-templates-empty")).toBeTruthy();
  });

  it("round-trips Armenian + emoji template line items into the line editor", () => {
    mocks.templatesData = {
      templates: [
        {
          id: "tpl-arm",
          orgId: "org-1",
          name: "Armenian test",
          description: "",
          lineItems: [
            { name: "Խորհրդատվություն", description: "Տեղադրում 🇦🇲", quantity: 3, unitPrice: 50000 }
          ],
          builtin: false,
          createdAt: "2026-06-01T00:00:00Z"
        }
      ]
    };
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    const qty = screen.getByTestId("smb-crm-quote-template-qty") as HTMLInputElement;
    expect(qty.value).toBe("3");
    // The Armenian line name appears in the line editor (we
    // check the parent <li> text content).
    const line = screen.getByTestId("smb-crm-quote-template-line");
    expect(line.textContent).toMatch(/Խորհրդատվություն/);
  });

  it("renders the Back link pointing to /app/smb-crm", () => {
    renderRoute();
    const back = screen.getByTestId("smb-crm-quote-template-back");
    expect(back.getAttribute("data-href")).toBe("/app/smb-crm");
  });
});

describe("Quote templates — customer picker (slice 16)", () => {
  it("renders the customer picker as a <select> with one option per customer", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    const sel = screen.getByTestId("smb-crm-quote-template-customer") as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
    // 1 placeholder option + 2 real customers.
    expect(sel.options).toHaveLength(3);
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual(["", "cust-1", "cust-2"]);
    // The placeholder option is selected by default.
    expect(sel.value).toBe("");
  });

  it("uses companyName over fullName when both are present", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    const sel = screen.getByTestId("smb-crm-quote-template-customer") as HTMLSelectElement;
    const cust1 = Array.from(sel.options).find((o) => o.value === "cust-1");
    expect(cust1?.textContent).toMatch(/Acme LLC/);
    // The email appears as a secondary indicator.
    expect(cust1?.textContent).toMatch(/info@acme\.am/);
  });

  it("the customer value flows into the outbound body on create", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      quote: { id: "quote-c-1", org_id: "org-1", number: "Q-1", customer_id: "cust-1", deal_id: null, issue_date: "2026-06-15", expiry_date: null, status: "draft", total_amount: 0, currency: "AMD", line_items_json: "[]", created_at: "2026-06-15T00:00:00Z", updated_at: "2026-06-15T00:00:00Z" },
      lineItems: [],
      totalAmount: 0
    });
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    fireEvent.change(screen.getByTestId("smb-crm-quote-template-number"), { target: { value: "Q-1" } });
    fireEvent.change(screen.getByTestId("smb-crm-quote-template-customer"), { target: { value: "cust-2" } });
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-create"));
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    const body = mocks.postJsonMock.mock.calls[0]![1];
    expect(body.customerId).toBe("cust-2");
  });

  it("renders an empty-state hint when no customers exist", () => {
    mocks.customersData = { customers: [] };
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    expect(screen.getByTestId("smb-crm-quote-template-customer-empty")).toBeTruthy();
    expect(screen.getByTestId("smb-crm-quote-template-customer-empty").textContent).toMatch(/No customers yet/);
  });

  it("the select is disabled while customers are still loading", () => {
    mocks.customersData = null;
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    const sel = screen.getByTestId("smb-crm-quote-template-customer") as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
    // The placeholder text mentions "Loading customers…"
    expect(sel.options[0]?.textContent).toMatch(/Loading/);
  });
});

describe("Quote templates — save as new template (slice 23)", () => {
  it("the Save as template button is hidden when no template is selected", () => {
    renderRoute();
    // No card clicked → no editor → no save button.
    expect(screen.queryByTestId("smb-crm-quote-template-save-as")).toBeNull();
  });

  it("the Save as template button is visible after picking a template", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    expect(screen.getByTestId("smb-crm-quote-template-save-as")).toBeTruthy();
  });

  it("clicking Save as template opens a modal prefilled with the template name + description", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as"));
    const modal = screen.getByTestId("smb-crm-quote-template-save-as-modal");
    expect(modal).toBeTruthy();
    const nameInput = screen.getByTestId("smb-crm-quote-template-save-as-name") as HTMLInputElement;
    expect(nameInput.value).toMatch(/Standard product quote \(copy\)/);
    // The submit button starts disabled (name is valid; but
    // we still verify it as not disabled when pre-filled).
    const submit = screen.getByTestId("smb-crm-quote-template-save-as-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it("submitting the modal POSTs the current line items + name to /api/smb-crm/quote-templates", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      template: {
        id: "tpl-custom-new",
        orgId: "org-1",
        name: "My custom quote",
        description: "Internal template",
        lineItems: [{ name: "Product", description: "Catalog item", quantity: 5, unitPrice: 100 }],
        builtin: false,
        createdAt: "2026-06-18T00:00:00Z"
      }
    });
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    // Adjust qty/price on the first line
    const qty = screen.getByTestId("smb-crm-quote-template-qty") as HTMLInputElement;
    const price = screen.getByTestId("smb-crm-quote-template-price") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "5" } });
    fireEvent.change(price, { target: { value: "100" } });
    // Open the modal + change the name
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as"));
    const nameInput = screen.getByTestId("smb-crm-quote-template-save-as-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "My custom quote" } });
    const descInput = screen.getByTestId("smb-crm-quote-template-save-as-description") as HTMLTextAreaElement;
    fireEvent.change(descInput, { target: { value: "Internal template" } });
    // Submit
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as-submit"));
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    const [url, body] = mocks.postJsonMock.mock.calls[0]!;
    expect(url).toBe("/api/smb-crm/quote-templates");
    expect(body.name).toBe("My custom quote");
    expect(body.description).toBe("Internal template");
    expect(body.sourceTemplateId).toBe("tpl-standard-product");
    expect(body.lineItems).toHaveLength(1);
    expect(body.lineItems[0].name).toBe("Product");
    expect(body.lineItems[0].quantity).toBe(5);
    expect(body.lineItems[0].unitPrice).toBe(100);
  });

  it("the modal closes after a successful save", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      template: {
        id: "tpl-custom-x",
        orgId: "org-1",
        name: "X",
        description: "",
        lineItems: [],
        builtin: false,
        createdAt: "2026-06-18T00:00:00Z"
      }
    });
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as"));
    expect(screen.getByTestId("smb-crm-quote-template-save-as-modal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as-submit"));
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId("smb-crm-quote-template-save-as-modal")).toBeNull());
  });

  it("the modal stays open when the save fails", async () => {
    mocks.postJsonMock.mockRejectedValue(new Error("name must be 1-100 characters"));
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as"));
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as-submit"));
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    // The modal should still be open (no setSaveAsOpen(false) in the
    // error path — the user can fix the name and retry).
    expect(screen.getByTestId("smb-crm-quote-template-save-as-modal")).toBeTruthy();
  });

  it("the Cancel button closes the modal without calling postJson", () => {
    renderRoute();
    fireEvent.click(screen.getAllByTestId("smb-crm-quote-template-card")[0]!);
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as"));
    expect(screen.getByTestId("smb-crm-quote-template-save-as-modal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("smb-crm-quote-template-save-as-cancel"));
    expect(screen.queryByTestId("smb-crm-quote-template-save-as-modal")).toBeNull();
    expect(mocks.postJsonMock).not.toHaveBeenCalled();
  });
});
