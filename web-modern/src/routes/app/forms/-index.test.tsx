/**
 * /app/forms — route-level tests for the Forms workspace (index).
 *
 * Pattern A: mock the three layers (Router, Query, API client), then
 * drive the public component surface. We assert:
 *
 *  - page shell (title, Armenian subtitle, monogram)
 *  - validateSearch (default view, fallback for unknown values)
 *  - ViewSwitcher (3 tabs, role=tablist, current selection)
 *  - each view:
 *      - loading state
 *      - error state
 *      - empty state (no forms)
 *      - data render (table, KPIs, entity markers, sort order)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "forms" as string },
  data: undefined as unknown,
  loading: false,
  error: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useParams: () => ({}),
    useSearch: () => mocks.search,
    useNavigate: () => vi.fn(),
    options: cfg,
  }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
  } & Record<string, unknown>) => {
    let href = to ?? "";
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        href = href.replace(`$${k}`, v);
      }
    }
    return (
      <a data-href={href} href={href} {...rest}>
        {children}
      </a>
    );
  },
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

import { Route } from "./index";

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

const FORMS_DATA = {
  forms: [
    { id: "f1", title: "Contact", status: "published", submissionCount: 12, updatedAt: "2026-06-15T10:00:00Z" },
    { id: "f2", title: "Beta", status: "draft", submissionCount: 0, updatedAt: "2026-06-10T10:00:00Z" },
    { id: "f3", title: "Old", status: "archived", submissionCount: 99, updatedAt: "2026-01-01T10:00:00Z" },
    { id: "f4", title: "Closed promo", status: "closed", submissionCount: 3, updatedAt: "2026-06-01T10:00:00Z" },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "forms" };
  mocks.data = FORMS_DATA;
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Forms — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Forms", level: 1 })).toBeInTheDocument();
  });
  it("renders the Armenian subtitle", () => {
    renderRoute();
    expect(screen.getByText(/Ձևեր · Ուղարկումներ · Կաղապարներ/)).toBeInTheDocument();
  });
  it("renders the Forms monogram badge", () => {
    renderRoute();
    const badge = document.querySelector('[class*="uppercase"][class*="tracking-wider"]');
    expect(badge?.textContent).toMatch(/Forms/);
  });
});

/* ────────── validateSearch ────────── */

describe("Forms — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to forms", () => {
    expect(fn({})).toEqual({ view: "forms" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "forms" })).toEqual({ view: "forms" });
    expect(fn({ view: "submissions" })).toEqual({ view: "submissions" });
    expect(fn({ view: "templates" })).toEqual({ view: "templates" });
  });
  it("falls back to forms for unknown values", () => {
    expect(fn({ view: "audit" })).toEqual({ view: "forms" });
    expect(fn({ view: 42 })).toEqual({ view: "forms" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Forms — ViewSwitcher", () => {
  it("renders 3 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
  });
  it("renders the 3 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Forms" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Submissions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Templates" })).toBeInTheDocument();
  });
  it("marks forms as the default selected tab", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Forms" })).toHaveAttribute("aria-selected", "true");
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "submissions" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Submissions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Forms" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

/* ────────── Forms view ────────── */

describe("Forms — Forms view", () => {
  it("shows the loading state", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading forms/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error = true;
    renderRoute();
    expect(screen.getByText(/Failed to load forms/i)).toBeInTheDocument();
  });
  it("shows the empty state when there are no forms", () => {
    mocks.data = { forms: [] };
    renderRoute();
    expect(screen.getByText(/Ձևեր դեռ չկան։/)).toBeInTheDocument();
  });
  it("renders 4 KPI cards + a 4-row form table for populated data", () => {
    renderRoute();
    // KPI labels
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText(/^Draft$/)).toBeInTheDocument();
    expect(screen.getAllByText("Submissions").length).toBeGreaterThan(0);
    // Form titles
    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("Closed promo")).toBeInTheDocument();
  });
  it("renders a hidden forms-form entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-form"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("4");
  });
  it("sorts forms by updatedAt descending (Contact → Beta → Closed promo → Old)", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-form"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Contact/);
    expect(rows[1].textContent).toMatch(/Beta/);
    expect(rows[2].textContent).toMatch(/Closed promo/);
    expect(rows[3].textContent).toMatch(/Old/);
  });
  it("renders a status pill for each form", () => {
    renderRoute();
    expect(screen.getAllByText("published").length).toBeGreaterThan(0);
    expect(screen.getAllByText("draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("archived").length).toBeGreaterThan(0);
    expect(screen.getAllByText("closed").length).toBeGreaterThan(0);
  });
  it("links each title to /app/forms/$formId", () => {
    renderRoute();
    const link = screen.getByRole("link", { name: "Contact" });
    expect(link.getAttribute("data-href")).toBe("/app/forms/f1");
  });
});

/* ────────── Submissions view ────────── */

describe("Forms — Submissions view", () => {
  beforeEach(() => {
    mocks.search = { view: "submissions" };
  });
  it("shows the loading state", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading submissions/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error = true;
    renderRoute();
    expect(screen.getByText(/Failed to load submissions/i)).toBeInTheDocument();
  });
  it("renders 3 KPI cards (Total / Active / Forms) when data is present", () => {
    renderRoute();
    expect(screen.getByText(/Total submissions/)).toBeInTheDocument();
    expect(screen.getByText("Active forms")).toBeInTheDocument();
    expect(screen.getAllByText(/^Forms$/).length).toBeGreaterThan(0);
  });
  it("shows empty state when there are no forms", () => {
    mocks.data = { forms: [] };
    renderRoute();
    expect(screen.getByText(/Ուղարկումներ դեռ չկան։/)).toBeInTheDocument();
  });
  it("sorts by submissionCount desc (Old → Contact → Closed promo → Beta)", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-submission-summary"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Old/);
    expect(rows[1].textContent).toMatch(/Contact/);
    expect(rows[2].textContent).toMatch(/Closed promo/);
    expect(rows[3].textContent).toMatch(/Beta/);
  });
});

/* ────────── Templates view ────────── */

describe("Forms — Templates view", () => {
  beforeEach(() => {
    mocks.search = { view: "templates" };
  });
  it("renders the 3 built-in templates", () => {
    renderRoute();
    expect(screen.getByText("Contact form")).toBeInTheDocument();
    expect(screen.getByText("Lead capture")).toBeInTheDocument();
    expect(screen.getByText("Support request")).toBeInTheDocument();
  });
  it("renders a forms-template entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="forms-template"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("renders Armenian descriptions and labels", () => {
    renderRoute();
    expect(screen.getByText(/Հիմնական կոնտակտային ձև/)).toBeInTheDocument();
    expect(screen.getByText(/Պատրաստի կաղապարներ/)).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("Forms — back link", () => {
  it("renders a 'Today' link to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Today/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app");
  });
});
