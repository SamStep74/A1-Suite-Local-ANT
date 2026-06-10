/**
 * /app/docs (index route) — route-level test for the Docs & Sign
 * workspace.
 *
 * Mirrors the finance/ people/ purchase/ pattern: mock the three
 * layers (Router, Query, API client) and drive the public component
 * surface.
 *
 * Coverage targets:
 *  - validateSearch (defaulting + view coercion)
 *  - Page header (Docs & Sign title, Armenian subtitle)
 *  - ViewSwitcher tabs (Documents | Signature packets | Templates)
 *  - Documents view: table rows, status pills, sidebar counts
 *  - Packets view: table rows, status pills
 *  - Templates view: template cards with variable counts
 *  - Empty states
 *  - Back-link to /app
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

/* ────────── mock state, hoisted ────────── */

type View = "documents" | "packets" | "templates";

const mocks = vi.hoisted(() => ({
  search: { view: "documents" as View },
  documents: null as unknown,
  packets: null as unknown,
  templates: null as unknown,
  documentsLoading: false,
  packetsLoading: false,
  templatesLoading: false,
  documentsError: false,
  packetsError: false,
  templatesError: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: {
    component: unknown;
    validateSearch: unknown;
  }) => ({
    useSearch: () => mocks.search,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
    update: (u: unknown) => u,
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
  } & Record<string, unknown>) => (
    <a data-href={to} href={to} data-params={JSON.stringify(params ?? {})} {...rest}>
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
      const key = queryKey[0];
      if (key === "docs-documents") {
        return {
          data: mocks.documents,
          isLoading: mocks.documentsLoading,
          isError: mocks.documentsError,
        };
      }
      if (key === "docs-packets") {
        return {
          data: mocks.packets,
          isLoading: mocks.packetsLoading,
          isError: mocks.packetsError,
        };
      }
      if (key === "docs-templates") {
        return {
          data: mocks.templates,
          isLoading: mocks.templatesLoading,
          isError: mocks.templatesError,
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

const VALID_DOCUMENTS = {
  documents: [
    {
      id: "doc-1",
      title: "MSA — Acme Corp",
      docType: "agreement",
      status: "draft",
      customerId: "cust-1",
      sealedAt: null,
      sealedChecksum: null,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-05T00:00:00Z",
      signers: [],
    },
    {
      id: "doc-2",
      title: "NDA — Beta Inc",
      docType: "nda",
      status: "out-for-signature",
      customerId: "cust-2",
      sealedAt: null,
      sealedChecksum: null,
      createdAt: "2026-05-25T00:00:00Z",
      updatedAt: "2026-06-04T00:00:00Z",
      signers: [
        { id: "s-1", signerName: "Anna", signerEmail: "anna@beta.am", signOrder: 1, status: "pending" },
        { id: "s-2", signerName: "Mariam", signerEmail: "mariam@beta.am", signOrder: 2, status: "pending" },
      ],
    },
    {
      id: "doc-3",
      title: "Offer — Gamma",
      docType: "offer",
      status: "signed",
      customerId: "cust-3",
      sealedAt: "2026-05-20T00:00:00Z",
      sealedChecksum: "abc123",
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-20T00:00:00Z",
      signers: [
        { id: "s-3", signerName: "Zara", signerEmail: "zara@gamma.am", signOrder: 1, status: "signed", signedAt: "2026-05-20T00:00:00Z" },
      ],
    },
  ],
};

const VALID_PACKETS = {
  packets: [
    {
      id: "pkt-1",
      customerId: "cust-1",
      customerName: "Acme Corp",
      quoteId: "q-1",
      quoteNumber: "Q-0001",
      status: "sent",
      createdAt: "2026-06-01T00:00:00Z",
      createdByName: "Sam S.",
    },
    {
      id: "pkt-2",
      customerId: "cust-2",
      customerName: "Beta Inc",
      quoteId: "q-2",
      quoteNumber: "Q-0002",
      status: "signed",
      createdAt: "2026-05-15T00:00:00Z",
      createdByName: "Sam S.",
    },
  ],
};

const VALID_TEMPLATES = {
  templates: [
    {
      id: "tpl-1",
      key: "msa",
      name: "Master Service Agreement",
      docType: "agreement",
      bodyTemplate: "This MSA is made on {{date}} between {{customer}} and Provider…",
      variables: [
        { key: "date", required: true },
        { key: "customer", required: true },
      ],
    },
    {
      id: "tpl-2",
      key: "nda",
      name: "Non-Disclosure Agreement",
      docType: "nda",
      bodyTemplate: "The parties agree to keep {{topic}} confidential…",
      variables: [
        { key: "topic", required: true },
        { key: "duration", required: false },
      ],
    },
  ],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.search = { view: "documents" };
  mocks.documents = VALID_DOCUMENTS;
  mocks.packets = VALID_PACKETS;
  mocks.templates = VALID_TEMPLATES;
  mocks.documentsLoading = false;
  mocks.packetsLoading = false;
  mocks.templatesLoading = false;
  mocks.documentsError = false;
  mocks.packetsError = false;
  mocks.templatesError = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── validateSearch ────────── */

describe("Route.options.validateSearch", () => {
  it("defaults view to 'documents' on empty input", () => {
    const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
    expect(fn({})).toEqual({ view: "documents" });
  });
  it("accepts 'packets' and 'templates'", () => {
    const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
    expect(fn({ view: "packets" })).toMatchObject({ view: "packets" });
    expect(fn({ view: "templates" })).toMatchObject({ view: "templates" });
  });
  it("falls back to 'documents' for unknown views", () => {
    const fn = Route.options.validateSearch as (raw: Record<string, unknown>) => unknown;
    expect(fn({ view: "garbage" })).toMatchObject({ view: "documents" });
  });
});

/* ────────── page shell ────────── */

describe("DocsWorkspace — page shell", () => {
  it("shows the loading message when documents are loading", () => {
    mocks.documentsLoading = true;
    renderRoute();
    expect(screen.getByText(/Loading documents/i)).toBeInTheDocument();
  });
  it("renders the header with title 'Docs & Sign' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Docs & Sign", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Փաստաթղթեր · Ստորագրություններ · Կաղապարներ/),
    ).toBeInTheDocument();
  });
  it("renders the 'Today' back-link to /app", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const todayLink = backLinks.find((l) => l.textContent === "Today");
    expect(todayLink).toBeDefined();
    expect(todayLink?.getAttribute("data-href")).toBe("/app");
  });
  it("renders the ViewSwitcher with three tabs", () => {
    renderRoute();
    const tablist = screen.getByRole("tablist", { name: /View/ });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toMatch(/Documents/);
    expect(tabs[1].textContent).toMatch(/Signature packets/);
    expect(tabs[2].textContent).toMatch(/Templates/);
  });
});

/* ────────── Documents view ────────── */

describe("DocsWorkspace — documents view", () => {
  it("renders one row per document in the table", () => {
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // 1 header + 3 data
  });
  it("renders a hidden docs-document entity marker", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="docs-document"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("3");
  });
  it("renders the documents sidebar with total + drafts + signed counts", () => {
    renderRoute();
    const aside = screen.getByLabelText("Documents overview");
    expect(within(aside).getByText(/Document library/)).toBeInTheDocument();
    // Total is "3" (the first sidebar value)
    expect(within(aside).getByText("3")).toBeInTheDocument();
    expect(within(aside).getByText(/Drafts/)).toBeInTheDocument();
    expect(within(aside).getByText(/Out for sig/)).toBeInTheDocument();
    expect(within(aside).getByText(/Signed/)).toBeInTheDocument();
  });
  it("shows the empty-state copy when there are no documents", () => {
    mocks.documents = { documents: [] };
    renderRoute();
    expect(screen.getByText(/No documents yet/i)).toBeInTheDocument();
  });
  it("shows an error message when documents fail to load", () => {
    mocks.documentsError = true;
    renderRoute();
    expect(screen.getByText(/Failed to load documents/i)).toBeInTheDocument();
  });
  it("renders each document title as a link to /app/docs/$documentId", () => {
    renderRoute();
    const links = screen.getAllByRole("link");
    const doc1 = links.find((l) => l.getAttribute("data-href") === "/app/docs/$documentId");
    expect(doc1).toBeDefined();
    expect(doc1?.getAttribute("data-params")).toContain("doc-1");
  });
  it("renders seal state (Sealed / Unsealed) per document", () => {
    renderRoute();
    expect(screen.getAllByText(/Unsealed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sealed/).length).toBeGreaterThan(0);
  });
});

/* ────────── Packets view ────────── */

describe("DocsWorkspace — packets view", () => {
  it("renders the packets view when search.view=packets", () => {
    mocks.search = { view: "packets" };
    renderRoute();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // 1 header + 2 data
  });
  it("renders a hidden docs-signature-packet entity marker", () => {
    mocks.search = { view: "packets" };
    renderRoute();
    const marker = document.querySelector('[data-entity="docs-signature-packet"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("renders the packets sidebar with total + sent + signed counts", () => {
    mocks.search = { view: "packets" };
    renderRoute();
    const aside = screen.getByLabelText("Signature packets overview");
    expect(within(aside).getByText(/Signature packets/)).toBeInTheDocument();
    expect(within(aside).getByText("2")).toBeInTheDocument();
    expect(within(aside).getByText(/Sent/)).toBeInTheDocument();
    expect(within(aside).getByText(/Signed/)).toBeInTheDocument();
  });
  it("shows the empty-state copy when there are no packets", () => {
    mocks.search = { view: "packets" };
    mocks.packets = { packets: [] };
    renderRoute();
    expect(screen.getByText(/No signature packets yet/i)).toBeInTheDocument();
  });
  it("shows an error message when packets fail to load", () => {
    mocks.search = { view: "packets" };
    mocks.packetsError = true;
    renderRoute();
    expect(screen.getByText(/Failed to load signature packets/i)).toBeInTheDocument();
  });
});

/* ────────── Templates view ────────── */

describe("DocsWorkspace — templates view", () => {
  it("renders one card per template", () => {
    mocks.search = { view: "templates" };
    renderRoute();
    expect(screen.getByText("Master Service Agreement")).toBeInTheDocument();
    expect(screen.getByText("Non-Disclosure Agreement")).toBeInTheDocument();
  });
  it("renders variable counts per template", () => {
    mocks.search = { view: "templates" };
    renderRoute();
    // Both test templates have 2 variables, so expect 2 matches.
    expect(screen.getAllByText("2 variables")).toHaveLength(2);
  });
  it("shows the empty-state copy when there are no templates", () => {
    mocks.search = { view: "templates" };
    mocks.templates = { templates: [] };
    renderRoute();
    expect(screen.getByText(/No document templates/i)).toBeInTheDocument();
  });
  it("shows an error message when templates fail to load", () => {
    mocks.search = { view: "templates" };
    mocks.templatesError = true;
    renderRoute();
    expect(screen.getByText(/Failed to load templates/i)).toBeInTheDocument();
  });
});
