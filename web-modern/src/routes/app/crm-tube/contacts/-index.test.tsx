/**
 * /app/crm-tube/contacts — first route-level test.
 *
 * Same mocking pattern as `inventory/-index.test.tsx`. Drives the
 * route through its public `Route` export.
 *
 * Required test minimums (from the worker spec):
 *   1. H1 "Contacts" + Armenian subtitle contains Կոնdelays
 *   2. Empty state: { contacts: [] } → empty message
 *   3. Populated: 3 contacts → 3 rows
 *   4. Search filter: type "john" → only matching rows
 *   5. Status chip toggle: click "enriched" → only enriched
 *   6. Bulk enrich button: select 2 + click → postJson called with the
 *      right path + 2 contactIds
 *   7. Bulk enrich disabled when 0 selected
 *   8. Bulk enrich error: postJson rejects → role="alert"
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories can see it ────────── */

const mocks = vi.hoisted(() => ({
  contacts: null as unknown,
  loading: false,
  error: false,
  fullPath: "/app/crm-tube/contacts/",
  postJson: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown; validateSearch?: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => ({}),
    options: cfg,
    update: (u: unknown) => u,
  }),
  Link: ({
    children,
    to,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} {...rest}>
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
      if (queryKey[0] === "tube-contacts") {
        return {
          data: mocks.contacts,
          isLoading: mocks.loading,
          isError: mocks.error,
        };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    /* useMutation is real — our page wires onSuccess/onError and we
     * want them to fire so the test can assert on the resulting UI
     * (cleared selection on success, error alert on failure). */
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: vi.fn().mockResolvedValue({}),
  postJson: (...args: unknown[]) => mocks.postJson(...args),
}));

/* ────────── import the route under test (mocks are in place by now) ───── */

import { Route } from "./index";

/* ────────── helpers ────────── */

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

const SAMPLE_CONTACTS = [
  {
    id: "c-1",
    organization_id: "org-1",
    full_name: "John Doe",
    first_name: "John",
    last_name: "Doe",
    email: "john@example.com",
    phone: "+37411111111",
    title: "CTO",
    linkedin_url: null,
    lead_score: 80,
    status: "new",
    organization_name: "Acme",
    created_at: "2026-05-01T08:00:00.000Z",
    updated_at: "2026-06-09T08:00:00.000Z",
  },
  {
    id: "c-2",
    organization_id: "org-2",
    full_name: "Jane Smith",
    first_name: "Jane",
    last_name: "Smith",
    email: "jane@example.com",
    phone: null,
    title: "VP Sales",
    linkedin_url: null,
    lead_score: 65,
    status: "enriched",
    organization_name: "Globex",
    created_at: "2026-05-02T08:00:00.000Z",
    updated_at: "2026-06-08T08:00:00.000Z",
  },
  {
    id: "c-3",
    organization_id: null,
    full_name: "Bob Johnson",
    first_name: "Bob",
    last_name: "Johnson",
    email: "bob@example.com",
    phone: null,
    title: null,
    linkedin_url: null,
    lead_score: null,
    status: "contacted",
    organization_name: null,
    created_at: "2026-05-03T08:00:00.000Z",
    updated_at: "2026-06-07T08:00:00.000Z",
  },
];

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.contacts = { contacts: SAMPLE_CONTACTS };
  mocks.loading = false;
  mocks.error = false;
  mocks.postJson = vi.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

/* ─────────────────────────────────────────────────────────────────────
 * 1. Header
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactsWorkspace — header", () => {
  it("renders the H1 'Contacts' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /^Contacts$/ }),
    ).toBeInTheDocument();
    // Armenian subtitle contains Կdelays. The page renders
    // "Կondelays · Tube" — we just check the lead word.
    expect(screen.getByText(/Կ/)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 2. Empty + populated table
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactsWorkspace — table states", () => {
  it("renders the empty state when contacts: []", () => {
    mocks.contacts = { contacts: [] };
    renderRoute();
    expect(screen.getByTestId("tube-contacts-empty")).toBeInTheDocument();
  });

  it("renders one row per contact when populated", () => {
    renderRoute();
    const rows = screen.getAllByTestId("tube-contact-row");
    expect(rows.length).toBe(3);
  });

  it("shows the loading state when the query is loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading contacts/i)).toBeInTheDocument();
  });

  it("shows the error alert when the query errors", () => {
    mocks.error = true;
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Could not load contacts/i,
    );
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 3. Search filter (client-side)
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactsWorkspace — search filter", () => {
  it("filters rows client-side by name", () => {
    renderRoute();
    const search = screen.getByTestId("tube-contacts-search");
    fireEvent.change(search, { target: { value: "john" } });
    const rows = screen.getAllByTestId("tube-contact-row");
    // 2 contacts contain "john": "John Doe" and "Bob Johnson"
    expect(rows.length).toBe(2);
  });

  it("filters rows client-side by email", () => {
    renderRoute();
    const search = screen.getByTestId("tube-contacts-search");
    fireEvent.change(search, { target: { value: "jane@" } });
    const rows = screen.getAllByTestId("tube-contact-row");
    expect(rows.length).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 4. Status chip toggle (multi-select)
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactsWorkspace — status chips", () => {
  it("clicking 'enriched' filters to enriched contacts only", () => {
    renderRoute();
    const enriched = screen.getByTestId("tube-status-chip-enriched");
    fireEvent.click(enriched);
    const rows = screen.getAllByTestId("tube-contact-row");
    expect(rows.length).toBe(1);
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 5. Bulk enrich
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactsWorkspace — bulk enrich", () => {
  it("is disabled when 0 rows are selected", () => {
    renderRoute();
    const btn = screen.getByTestId("tube-contacts-enrich");
    expect(btn).toBeDisabled();
  });

  it("is enabled after at least one row is checked and posts the right payload", async () => {
    renderRoute();
    const checkboxes = screen.getAllByTestId("tube-contact-checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const btn = screen.getByTestId("tube-contacts-enrich");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent("Enrich selected (2)");

    fireEvent.click(btn);

    // The mutation runs async; wait for postJson to be invoked.
    await vi.waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/crm/tube/contacts/enrich");
    expect(body.contactIds).toEqual(["c-1", "c-2"]);
    expect(typeof body.idempotencyKey).toBe("string");
    expect(body.idempotencyKey.startsWith("tube-enrich-")).toBe(true);
  });

  it("renders an error alert when postJson rejects", async () => {
    mocks.postJson = vi.fn().mockRejectedValue(new Error("server 500"));
    renderRoute();
    const checkboxes = screen.getAllByTestId("tube-contact-checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByTestId("tube-contacts-enrich"));
    // Wait for the alert to surface
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/server 500/);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 6. Back link
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactsWorkspace — back link", () => {
  it("renders a back link to /app", () => {
    renderRoute();
    const back = screen.getByText(/Back to today/i);
    expect(back.closest("a")).toHaveAttribute("href", "/app");
  });
});
