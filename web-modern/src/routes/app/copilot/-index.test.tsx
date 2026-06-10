/**
 * /app/copilot/ — route-level tests for the Copilot chat workspace.
 *
 * Mirrors cfo/index pattern. Coverage:
 *
 *  - page shell (title, Armenian subtitle, monogram)
 *  - validateSearch (default view, fallback for unknown values)
 *  - ViewSwitcher (3 tabs, role=tablist, current selection)
 *  - each view:
 *      - loading state
 *      - error state
 *      - empty state
 *      - data render (table, KPIs, entity markers, sort order)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  search: { view: "chats" as string },
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
      if (String(queryKey[0] ?? "") === "copilot") {
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

const CHATS_DATA = {
  chats: [
    {
      id: "c1",
      title: "VAT Q2",
      lastMessageAt: "2026-06-15T10:00:00Z",
      messageCount: 4,
      intent: "vat",
    },
    {
      id: "c2",
      title: "Payroll June",
      lastMessageAt: "2026-06-10T10:00:00Z",
      messageCount: 2,
      intent: "payroll",
    },
    {
      id: "c3",
      title: "Old",
      lastMessageAt: "2026-05-01T10:00:00Z",
      messageCount: 1,
      intent: "general",
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "chats" };
  mocks.data = CHATS_DATA;
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Copilot — page shell", () => {
  it("renders the page title", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Copilot", level: 1 })).toBeInTheDocument();
  });
  it("renders the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByText(/Խոսակցություններ · Վերջին ակտիվություն · Գործակալներ/),
    ).toBeInTheDocument();
  });
  it("renders the Copilot monogram badge", () => {
    renderRoute();
    const badge = screen.getByText("Copilot", { selector: "span" });
    expect(badge).toBeInTheDocument();
  });
});

/* ────────── validateSearch ────────── */

describe("Copilot — validateSearch", () => {
  const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
  it("defaults to chats", () => {
    expect(fn({})).toEqual({ view: "chats" });
  });
  it("accepts each known view", () => {
    expect(fn({ view: "chats" })).toEqual({ view: "chats" });
    expect(fn({ view: "recent" })).toEqual({ view: "recent" });
    expect(fn({ view: "agents" })).toEqual({ view: "agents" });
  });
  it("falls back to chats for unknown values", () => {
    expect(fn({ view: "monitor" })).toEqual({ view: "chats" });
    expect(fn({ view: 42 })).toEqual({ view: "chats" });
  });
});

/* ────────── ViewSwitcher ────────── */

describe("Copilot — ViewSwitcher", () => {
  it("renders 3 tabs with role=tablist", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: "View" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
  });
  it("renders the 3 expected tab labels", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Chats" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Agents" })).toBeInTheDocument();
  });
  it("marks chats as the default selected tab", () => {
    renderRoute();
    expect(screen.getByRole("tab", { name: "Chats" })).toHaveAttribute("aria-selected", "true");
  });
  it("marks the URL view as the selected tab", () => {
    mocks.search = { view: "agents" };
    renderRoute();
    expect(screen.getByRole("tab", { name: "Agents" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Chats" })).toHaveAttribute("aria-selected", "false");
  });
});

/* ────────── Chats view ────────── */

describe("Copilot — Chats view", () => {
  it("shows the loading state", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading chats/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error = true;
    renderRoute();
    expect(screen.getByText(/Failed to load chats/i)).toBeInTheDocument();
  });
  it("shows the empty state when no chats", () => {
    mocks.data = { chats: [] };
    renderRoute();
    expect(screen.getByText(/Խոսակցություններ դեռ չկան։/)).toBeInTheDocument();
  });
  it("renders 3 KPI cards + a 3-row chat table for populated data", () => {
    renderRoute();
    expect(screen.getAllByText("Chats").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Messages").length).toBeGreaterThan(0);
    expect(screen.getByText("Top intent")).toBeInTheDocument();
    // Chat titles
    expect(screen.getByText("VAT Q2")).toBeInTheDocument();
    expect(screen.getByText("Payroll June")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
  });
  it("renders a hidden copilot-chat entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="copilot-chat"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("sorts chats by lastMessageAt desc (VAT Q2 → Payroll June → Old)", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="copilot-chat"]');
    const table = marker?.querySelector("table");
    const rows = within(table as HTMLElement).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/VAT Q2/);
    expect(rows[1].textContent).toMatch(/Payroll June/);
    expect(rows[2].textContent).toMatch(/Old/);
  });
  it("links each title to /app/copilot/$chatId", () => {
    renderRoute();
    const link = screen.getByRole("link", { name: "VAT Q2" });
    expect(link.getAttribute("data-href")).toBe("/app/copilot/c1");
  });
});

/* ────────── Recent view ────────── */

describe("Copilot — Recent view", () => {
  beforeEach(() => {
    mocks.search = { view: "recent" };
  });
  it("shows the loading state", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading recent/i)).toBeInTheDocument();
  });
  it("shows the error state", () => {
    mocks.error = true;
    renderRoute();
    expect(screen.getByText(/Failed to load recent/i)).toBeInTheDocument();
  });
  it("renders 3 KPI cards when data is present", () => {
    renderRoute();
    expect(screen.getByText("Last 24h")).toBeInTheDocument();
    expect(screen.getByText("Total chats")).toBeInTheDocument();
    expect(screen.getByText("Most recent")).toBeInTheDocument();
  });
  it("shows empty state when there are no chats", () => {
    mocks.data = { chats: [] };
    renderRoute();
    expect(screen.getByText(/Վերջին ակտիվություն դեռ չկա։/)).toBeInTheDocument();
  });
  it("renders a copilot-recent-chat entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="copilot-recent-chat"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
});

/* ────────── Agents view (constant) ────────── */

describe("Copilot — Agents view", () => {
  beforeEach(() => {
    mocks.search = { view: "agents" };
  });
  it("renders the 6 built-in agents", () => {
    renderRoute();
    expect(screen.getByText("VAT advisor")).toBeInTheDocument();
    expect(screen.getByText("Payroll advisor")).toBeInTheDocument();
    expect(screen.getByText("Personal data guide")).toBeInTheDocument();
    expect(screen.getByText("e-Sign guide")).toBeInTheDocument();
    expect(screen.getByText("Month close")).toBeInTheDocument();
    expect(screen.getByText("General assistant")).toBeInTheDocument();
  });
  it("renders a copilot-agent entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="copilot-agent"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("6");
  });
  it("renders Armenian descriptions and intent labels", () => {
    renderRoute();
    expect(screen.getByText(/Հասցեավորված գործակալներ/)).toBeInTheDocument();
    expect(screen.getAllByText("ԱԱՀ").length).toBeGreaterThan(0);
  });
});

/* ────────── back link ────────── */

describe("Copilot — back link", () => {
  it("renders a 'Mission Control' link to /app/copilot", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Mission Control/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/copilot");
  });
});
