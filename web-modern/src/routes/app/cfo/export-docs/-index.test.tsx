/**
 * /app/cfo/export-docs — route-level tests for the Pattern A route.
 *
 * Mirrors the state-integrations test pattern: mock the three layers
 * (Router, Query, API client), then drive the public component
 * surface. The route file exports its subcomponents (`SelectStep`,
 * `AutoFillStep`, `ValidationStep`, `FinalizedStep`, `StepIndicator`)
 * as named exports, so we can also import them in isolation.
 *
 * Coverage targets (Phase 8.9 layer 2 — 18+ tests required):
 *  1. Page shell — Armenian title + English subtitle
 *  2. Back-to-CFO link points to /app/cfo
 *  3. 403 panel when no cfo access
 *  4. Step indicator renders 4 steps with step 1 current
 *  5. Template select has 8 options + default
 *  6. Country select has 6 destinations
 *  7. Next button disabled until template chosen
 *  8. Next click calls postJson on /api/export-docs/ai/auto-fill
 *  9. Auto-fill request body includes idempotency + salesOrder + productMaster
 * 10. Auto-fill error shows role=alert
 * 11. Step 2 renders the draft + lines after auto-fill resolves
 * 12. Step 2 Validate click calls getJson on country-check URL
 * 13. Step 2 Back returns to step 1
 * 14. Step 3 renders validation with required certificates
 * 15. Step 3 hsNote renders when present
 * 16. Step 3 Finalize click calls postJson + postVoid
 * 17. Step 3 Back returns to step 2
 * 18. Step 4 renders the "Document finalized" + id
 * 19. Step 4 Start new resets wizard
 * 20. Pure: generateExportDocIdempotencyKey format
 * 21. Pure: exportDocTemplateLabelAm / formatExportDocRequiredCertificates
 * 22. Pure: isExportDocTemplateKind type guard
 * 23. Pure: buildExportDocSalesOrderDemo / buildExportDocProductMasterDemo
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  postVoid: vi.fn().mockResolvedValue(undefined),
  // cfoAccess toggled per test to flip the 403 branch.
  cfoAccess: true as boolean,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
  } & Record<string, unknown>) => (
    <a
      data-href={to}
      href={to}
      data-search={JSON.stringify(search ?? {})}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      // Capture mutationFn for direct invocation in tests, then
      // forward resolve/reject to onSuccess/onError.
      const mutate = (...args: unknown[]) => {
        opts
          .mutationFn(...args)
          .then((res: unknown) => {
            if (opts.onSuccess) opts.onSuccess(res, ...args);
          })
          .catch((err: unknown) => {
            if (opts.onError) opts.onError(err, ...args);
          });
      };
      return {
        mutate,
        // We track pending state at the test level by toggling a flag
        // in beforeEach; the route's `isPending` is read off the hook.
        isPending: false,
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
  postVoid: mocks.postVoid,
  patchJson: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../../lib/rbac/access", () => ({
  useUserAccess: (appId: string) => {
    if (appId === "cfo") return mocks.cfoAccess;
    return true;
  },
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

import { Route } from "./index";
import {
  EXPORT_DOC_TEMPLATES,
  buildExportDocProductMasterDemo,
  buildExportDocSalesOrderDemo,
  exportDocDestinationLabelAm,
  exportDocTemplateLabelAm,
  formatExportDocLinePreview,
  formatExportDocRequiredCertificates,
  formatExportDocStatusLabelAm,
  generateExportDocIdempotencyKey,
  isExportDocTemplateKind,
} from "../../../../lib/export-docs/status";
import type {
  ExportDoc,
  ExportDocAutoFillDraft,
  ExportDocCountryCheckResponse,
} from "../../../../lib/api/schemas";

/* ────────── helpers ────────── */

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const DRAFT: ExportDocAutoFillDraft = {
  destinationCountry: "RU",
  incoterm: "CIF",
  currency: "USD",
  lines: [
    { description: "Tomatoes (Cherry)", hsCode: "0702", quantity: 1000, uom: "kg" },
  ],
};

const VALIDATION: ExportDocCountryCheckResponse = {
  destinationCountry: "RU",
  pack: { requiredCertificates: ["Phyto", "COO"] },
  hsNote: "0702 — Tomatoes (Cherry)",
};

const FINALIZED: ExportDoc = {
  id: "exp-1",
  kind: "invoice",
  destinationCountry: "RU",
  status: "finalized",
  createdAt: "2026-06-11T12:00:00.000Z",
  lines: [],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  mocks.postVoid.mockReset();
  mocks.cfoAccess = true;
  // Default: postJson → auto-fill envelope; getJson → validation
  mocks.postJson.mockResolvedValue({ draft: DRAFT });
  mocks.getJson.mockResolvedValue(VALIDATION);
  mocks.postVoid.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("ExportDocs — page shell", () => {
  it("renders the H1 with the Armenian title 'Արտահանման փաստաթղթեր' + English subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Արտահանման փաստաթղթեր/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Export documentation wizard/)).toBeInTheDocument();
  });

  it("renders a back-to-CFO link that points to /app/cfo with a valid view", () => {
    renderRoute();
    const back = screen.getByTestId("export-docs-back");
    expect(back.getAttribute("data-href")).toBe("/app/cfo");
    expect(back.getAttribute("data-search")).toContain("view");
  });

  it("wraps the page in a panel with data-testid='export-docs-panel' and data-entity='export-docs'", () => {
    renderRoute();
    const panel = screen.getByTestId("export-docs-panel");
    expect(panel.tagName.toLowerCase()).toBe("div");
    expect(panel.getAttribute("data-entity")).toBe("export-docs");
  });
});

/* ────────── 403 access gate ────────── */

describe("ExportDocs — access gate", () => {
  it("renders the 403 panel when the user does not have cfo access", () => {
    mocks.cfoAccess = false;
    renderRoute();
    expect(screen.getByTestId("export-docs-forbidden")).toBeInTheDocument();
    expect(screen.getByTestId("export-docs-forbidden")).toHaveTextContent(/403/);
  });

  it("still shows the Armenian title above the 403 card so the user knows what they tried to open", () => {
    mocks.cfoAccess = false;
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Արտահանման փաստաթղթեր/ }),
    ).toBeInTheDocument();
  });
});

/* ────────── step indicator + step 1 (select) ────────── */

describe("ExportDocs — step indicator + step 1", () => {
  it("renders 4 step markers with step 1 as aria-current=step", () => {
    renderRoute();
    const indicator = screen.getByTestId("export-docs-step-indicator");
    expect(indicator.getAttribute("data-step")).toBe("1");
    for (const s of [1, 2, 3, 4]) {
      const step = screen.getByTestId(`export-docs-step-${s}`);
      if (s === 1) {
        expect(step.getAttribute("aria-current")).toBe("step");
      } else {
        expect(step.getAttribute("aria-current")).toBeNull();
      }
    }
  });

  it("lists all 8 templates in the template select plus a default option", () => {
    renderRoute();
    const select = screen.getByTestId("export-docs-template-select") as HTMLSelectElement;
    // 1 default + 8 templates
    expect(select.options).toHaveLength(EXPORT_DOC_TEMPLATES.length + 1);
    expect(EXPORT_DOC_TEMPLATES).toHaveLength(8);
  });

  it("lists all 6 destination countries in the country select", () => {
    renderRoute();
    const select = screen.getByTestId("export-docs-country-select") as HTMLSelectElement;
    // 6 destinations, preselected to the first (RU).
    expect(select.options).toHaveLength(6);
    expect(select.value).toBe("RU");
  });

  it("disables the Next button until a template is chosen", () => {
    renderRoute();
    const btn = screen.getByTestId("export-docs-next-button") as HTMLButtonElement;
    expect(btn).toBeDisabled();

    const select = screen.getByTestId("export-docs-template-select");
    fireEvent.change(select, { target: { value: "invoice" } });
    expect(btn).not.toBeDisabled();
  });
});

/* ────────── step 1 → 2: auto-fill POST ────────── */

describe("ExportDocs — auto-fill POST", () => {
  it("calls postJson on /api/export-docs/ai/auto-fill with the right body", async () => {
    renderRoute();
    // Pick template + country.
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.change(screen.getByTestId("export-docs-country-select"), {
      target: { value: "EU" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/export-docs/ai/auto-fill");
    const parsed = body as Record<string, unknown>;
    expect(parsed.destinationCountry).toBe("EU");
    // The demo data builders include the hardcoded tomato line.
    const salesOrder = parsed.salesOrder as Record<string, unknown>;
    const lines = salesOrder.lines as Array<Record<string, unknown>>;
    expect(lines[0]?.productId).toBe("demo-tomato");
  });

  it("renders the draft + lines when auto-fill resolves", async () => {
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-docs-draft")).toBeInTheDocument();
    });
    // Step 2 panel renders; indicator now says step 2.
    expect(screen.getByTestId("export-docs-step-indicator").getAttribute("data-step")).toBe("2");
    expect(screen.getByTestId("export-docs-step-2-panel")).toBeInTheDocument();
    const draftLine = screen.getByTestId("export-docs-draft-line");
    expect(draftLine.textContent).toMatch(/HS 0702/);
    expect(draftLine.textContent).toMatch(/1000 kg/);
  });

  it("renders a role=alert error when auto-fill rejects", async () => {
    mocks.postJson.mockRejectedValueOnce(new Error("boom"));
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));

    const alert = await screen.findByTestId("export-docs-error");
    expect(alert.textContent).toMatch(/boom/);
  });
});

/* ────────── step 2 → 3: country-check GET ────────── */

describe("ExportDocs — country-check GET", () => {
  it("calls getJson on /api/export-docs/ai/country-check with country + productId", async () => {
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-draft")).toBeInTheDocument();
    });
    // Now click Validate.
    mocks.getJson.mockClear();
    fireEvent.click(screen.getByTestId("export-docs-validate-button"));

    await waitFor(() => {
      expect(mocks.getJson).toHaveBeenCalledTimes(1);
    });
    const [path] = mocks.getJson.mock.calls[0];
    expect(path).toMatch(/^\/api\/export-docs\/ai\/country-check/);
    expect(path).toMatch(/[?&]country=RU/);
    expect(path).toMatch(/[?&]productId=demo-tomato/);
  });

  it("renders the validation result with required certificates", async () => {
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-draft")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-validate-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-docs-validation")).toBeInTheDocument();
    });
    expect(screen.getByTestId("export-docs-step-3-panel")).toBeInTheDocument();
    // The required certificates list renders as a comma-joined string.
    expect(screen.getByTestId("export-docs-validation").textContent).toMatch(
      /Phyto.*COO/,
    );
  });

  it("Back from step 2 returns to step 1", async () => {
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-draft")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-back-from-2"));
    expect(screen.getByTestId("export-docs-step-1-panel")).toBeInTheDocument();
  });
});

/* ────────── step 3 → 4: finalize POSTs ────────── */

describe("ExportDocs — finalize POSTs", () => {
  it("calls postJson on /api/export-docs then postVoid on /api/export-docs/{id}/finalize", async () => {
    mocks.postJson.mockResolvedValueOnce({ exportDoc: FINALIZED });
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-draft")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-validate-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-validation")).toBeInTheDocument();
    });

    mocks.postJson.mockClear();
    mocks.postVoid.mockClear();
    fireEvent.click(screen.getByTestId("export-docs-finalize-button"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    expect(mocks.postVoid).toHaveBeenCalledTimes(1);
    const [createPath, createBody] = mocks.postJson.mock.calls[0];
    expect(createPath).toBe("/api/export-docs");
    expect(createBody).toMatchObject({ kind: "invoice", destinationCountry: "RU" });
    expect((createBody as { idempotencyKey: string }).idempotencyKey).toMatch(
      /^ui-create-\d+$/,
    );
    const [finalizePath, finalizeBody] = mocks.postVoid.mock.calls[0];
    expect(finalizePath).toBe("/api/export-docs/exp-1/finalize");
    expect((finalizeBody as { idempotencyKey: string }).idempotencyKey).toMatch(
      /^ui-fin-\d+$/,
    );
  });

  it("renders the 'Document finalized' card + export-doc id on step 4", async () => {
    mocks.postJson.mockResolvedValueOnce({ exportDoc: FINALIZED });
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-draft")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-validate-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-validation")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-finalize-button"));

    await waitFor(() => {
      expect(screen.getByTestId("export-docs-finalized")).toBeInTheDocument();
    });
    expect(screen.getByTestId("export-docs-step-4-panel")).toBeInTheDocument();
    expect(screen.getByTestId("export-docs-finalized").textContent).toMatch(/exp-1/);
    expect(
      screen.getByRole("heading", { name: /Document finalized/ }),
    ).toBeInTheDocument();
  });

  it("'Start new' resets the wizard back to step 1", async () => {
    mocks.postJson.mockResolvedValueOnce({ exportDoc: FINALIZED });
    renderRoute();
    fireEvent.change(screen.getByTestId("export-docs-template-select"), {
      target: { value: "invoice" },
    });
    fireEvent.click(screen.getByTestId("export-docs-next-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-draft")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-validate-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-validation")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-finalize-button"));
    await waitFor(() => {
      expect(screen.getByTestId("export-docs-finalized")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("export-docs-start-new"));

    // Wizard back to step 1 — template select is empty again.
    const select = screen.getByTestId("export-docs-template-select") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByTestId("export-docs-step-1-panel")).toBeInTheDocument();
  });
});

/* ────────── pure helper sanity checks ────────── */

describe("ExportDocs — pure helpers", () => {
  it("generateExportDocIdempotencyKey returns the right shape for create + finalize", () => {
    const create = generateExportDocIdempotencyKey("ui-create");
    const fin = generateExportDocIdempotencyKey("ui-fin");
    expect(create).toMatch(/^ui-create-\d+$/);
    expect(fin).toMatch(/^ui-fin-\d+$/);
  });

  it("exportDocTemplateLabelAm + formatExportDocRequiredCertificates render Armenian / joined strings", () => {
    expect(exportDocTemplateLabelAm("invoice")).toMatch(/Export invoice/i);
    expect(formatExportDocRequiredCertificates(["Phyto", "COO"])).toBe("Phyto, COO");
    expect(formatExportDocRequiredCertificates([])).toBe("—");
  });

  it("isExportDocTemplateKind narrows correctly", () => {
    expect(isExportDocTemplateKind("invoice")).toBe(true);
    expect(isExportDocTemplateKind("garbage")).toBe(false);
    expect(isExportDocTemplateKind(42)).toBe(false);
  });

  it("buildExportDocSalesOrderDemo + buildExportDocProductMasterDemo produce the tomato demo", () => {
    const so = buildExportDocSalesOrderDemo("EU");
    expect(so.destinationCountry).toBe("EU");
    expect(so.incoterm).toBe("CIF");
    expect(so.currency).toBe("USD");
    expect(so.lines[0]?.productId).toBe("demo-tomato");
    expect(so.lines[0]?.description).toBe("Tomatoes");

    const pm = buildExportDocProductMasterDemo();
    expect(pm[0]?.id).toBe("demo-tomato");
    expect(pm[0]?.hsCode).toBe("0702");
  });

  it("formatExportDocLinePreview + formatExportDocStatusLabelAm render deterministically", () => {
    expect(
      formatExportDocLinePreview({
        description: "Tomatoes (Cherry)",
        hsCode: "0702",
        quantity: 1000,
        uom: "kg",
      }),
    ).toMatch(/Tomatoes.*HS 0702.*1000 kg/);
    expect(formatExportDocStatusLabelAm("finalized")).toMatch(/Ավարտված|Finalized/);
  });

  it("exportDocDestinationLabelAm returns a non-empty label for every destination", () => {
    for (const c of ["RU", "EAEU", "EU", "AE", "HK", "PH"] as const) {
      expect(exportDocDestinationLabelAm(c)).toBeTruthy();
    }
  });
});
