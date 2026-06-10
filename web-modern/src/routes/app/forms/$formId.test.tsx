/**
 * /app/forms/$formId — route-level tests for the form detail surface.
 *
 * Mirrors cfo/$loanId pattern. Coverage:
 *
 *  - Loading state ("Loading form…")
 *  - Not-found (no data envelope)
 *  - Error state
 *  - Header (title, monogram, status pill, formId)
 *  - KPIs: fields, required, submissions, updated
 *  - Schema table: rows + entity marker
 *  - Submissions table: rows + entity marker
 *  - Back-link to /app/forms
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  params: { formId: "form-1" as string },
  data: null as unknown,
  loading: false,
  error: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useParams: () => mocks.params,
    useSearch: () => ({}),
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
  useNavigate: () => vi.fn(),
  notFound: () => {
    throw new Error("notFound() called");
  },
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (String(queryKey[0] ?? "") === "forms") {
        return {
          data: mocks.data,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import under test ────────── */

import { Route } from "./$formId";

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

const FORM = {
  form: {
    id: "form-1",
    title: "Contact",
    description: "Հիմնական կոնտակտային ձև",
    status: "published",
    submissionCount: 12,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-06-15T10:00:00Z",
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "phone", label: "Phone", type: "phone", required: false },
      { key: "message", label: "Message", type: "textarea", required: false },
    ],
    submissions: [
      {
        id: "s1",
        data: { name: "Alice", email: "a@b.co", phone: "555", message: "Hi" },
        leadId: "lead-1",
        createdAt: "2026-06-15T10:00:00Z",
      },
      {
        id: "s2",
        data: { name: "Bob", email: "b@b.co" },
        leadId: null,
        createdAt: "2026-06-10T10:00:00Z",
      },
    ],
  },
};

const EMPTY_FORM = {
  form: {
    id: "form-2",
    title: "Empty",
    description: null,
    status: "draft",
    submissionCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    fields: [],
    submissions: [],
  },
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { formId: "form-1" };
  mocks.data = JSON.parse(JSON.stringify(FORM));
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found / error ────────── */

describe("FormDetail — loading / not-found / error", () => {
  it("shows the loading message while the query is in-flight", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading form/i)).toBeInTheDocument();
  });
  it("shows 'Form not found' when data envelope is missing", () => {
    mocks.data = null;
    renderRoute();
    expect(screen.getByText(/Form not found/i)).toBeInTheDocument();
  });
  it("shows 'Form not found' when form field is missing", () => {
    mocks.data = { form: null };
    renderRoute();
    expect(screen.getByText(/Form not found/i)).toBeInTheDocument();
  });
  it("shows the 'failed' message when the query errors", () => {
    mocks.error = true;
    mocks.data = null;
    renderRoute();
    expect(screen.getByText(/Failed to load form/i)).toBeInTheDocument();
  });
});

/* ────────── header ────────── */

describe("FormDetail — header", () => {
  it("renders the form title as a level-1 heading", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Contact", level: 1 })).toBeInTheDocument();
  });
  it("renders the formId in the subtitle", () => {
    renderRoute();
    expect(screen.getByText(/form-1/)).toBeInTheDocument();
  });
  it("renders the Forms · Form monogram badge", () => {
    renderRoute();
    expect(screen.getByText(/Forms · Form/)).toBeInTheDocument();
  });
  it("renders a status pill for the form's status", () => {
    renderRoute();
    expect(screen.getAllByText("published").length).toBeGreaterThan(0);
  });
  it("renders the description when present", () => {
    renderRoute();
    expect(screen.getByText(/Հիմնական կոնտակտային ձև/)).toBeInTheDocument();
  });
});

/* ────────── KPIs ────────── */

describe("FormDetail — KPIs", () => {
  it("renders fields, required, submissions, updated", () => {
    renderRoute();
    expect(screen.getByText("Fields")).toBeInTheDocument();
    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Submissions").length).toBeGreaterThan(0);
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });
  it("shows 4 fields and 2 required for the standard fixture", () => {
    renderRoute();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

/* ────────── schema table ────────── */

describe("FormDetail — schema table", () => {
  it("renders the field rows from the schema", () => {
    renderRoute();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("phone")).toBeInTheDocument();
    expect(screen.getByText("message")).toBeInTheDocument();
  });
  it("renders a hidden forms-form-field entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-form-field"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("4");
  });
  it("shows 'Այո' for required fields", () => {
    renderRoute();
    expect(screen.getAllByText("Այո").length).toBe(2);
  });
  it("shows empty-state when there are no fields", () => {
    mocks.data = JSON.parse(JSON.stringify(EMPTY_FORM));
    renderRoute();
    expect(screen.getByText(/Այս ձևը դաշտեր չունի։/)).toBeInTheDocument();
  });
});

/* ────────── submissions table ────────── */

describe("FormDetail — submissions table", () => {
  it("renders a hidden forms-form-submission entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-form-submission"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("shows filled/total in each submission row", () => {
    renderRoute();
    // Alice filled all 4: "4/4", Bob filled 2/4: "2/4"
    expect(screen.getByText("4/4")).toBeInTheDocument();
    expect(screen.getByText("2/4")).toBeInTheDocument();
  });
  it("shows leadId when present and '—' when null", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-form-submission"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/lead-1/);
    expect(rows[1].textContent).toMatch(/—/);
  });
  it("sorts submissions by createdAt desc (Alice 2026-06-15 → Bob 2026-06-10)", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-form-submission"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/2026-06-15/);
    expect(rows[1].textContent).toMatch(/2026-06-10/);
  });
  it("shows empty state when no submissions", () => {
    mocks.data = JSON.parse(JSON.stringify(EMPTY_FORM));
    renderRoute();
    expect(screen.getByText(/Ուղարկումներ դեռ չկան։/)).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("FormDetail — back link", () => {
  it("renders a 'Back to Forms' link to /app/forms with view=forms", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to Forms/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/forms");
    expect(back.getAttribute("data-search")).toContain("forms");
  });
});
