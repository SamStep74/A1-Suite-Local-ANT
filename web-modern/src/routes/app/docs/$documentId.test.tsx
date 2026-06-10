/**
 * /app/docs/$documentId (detail route) — route-level test for the
 * per-document detail surface.
 *
 * Mirrors finance/$invoiceId / purchase/$orderId pattern: mock the
 * three layers (Router, Query, API client), then drive the public
 * component surface.
 *
 * Coverage targets:
 *  - Loading state ("Loading document…")
 *  - notFound() (data-error path) and inline "not found" copy
 *  - Header: title, docType, status pill, sealed pill
 *  - Body: pre block (truncation at >1200 chars)
 *  - Signers: empty state, sorted by signOrder
 *  - Action panel: derives actions from status + signer state
 *  - Metadata: id, created/updated/sealed timestamps, checksum
 *  - Back-link to /app/docs
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
  params: { documentId: "doc-1" as string },
  document: null as unknown,
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
    params,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
    params?: Record<string, string>;
  } & Record<string, unknown>) => (
    <a
      data-href={to}
      href={to}
      data-search={JSON.stringify(search ?? {})}
      data-params={JSON.stringify(params ?? {})}
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
      if (queryKey[0] === "docs-document") {
        return {
          data: mocks.document,
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

import { Route } from "./$documentId";

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

const DRAFT_DOCUMENT = {
  id: "doc-1",
  title: "MSA — Acme Corp",
  docType: "agreement",
  status: "draft",
  customerId: "cust-1",
  body: "This is a long master service agreement between Acme Corp and the provider.",
  sealedAt: null,
  sealedChecksum: null,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-05T00:00:00Z",
  signers: [
    { id: "s-1", signerName: "Anna", signerEmail: "anna@acme.am", signOrder: 2, status: "pending" },
    { id: "s-2", signerName: "Mariam", signerEmail: "mariam@acme.am", signOrder: 1, status: "pending" },
  ],
};

const SIGNED_DOCUMENT = {
  ...DRAFT_DOCUMENT,
  id: "doc-2",
  title: "Offer — Gamma",
  docType: "offer",
  status: "signed",
  customerId: "cust-3",
  body: "We are pleased to offer…",
  sealedAt: "2026-05-20T00:00:00Z",
  sealedChecksum: "abc123",
  signers: [
    { id: "s-3", signerName: "Zara", signerEmail: "zara@gamma.am", signOrder: 1, status: "signed", signedAt: "2026-05-20T00:00:00Z" },
  ],
};

const OUT_FOR_SIG_DOCUMENT = {
  ...DRAFT_DOCUMENT,
  id: "doc-3",
  title: "NDA — Beta",
  docType: "nda",
  status: "out-for-signature",
  customerId: "cust-2",
  signers: [
    { id: "s-1", signerName: "Anna", signerEmail: "anna@beta.am", signOrder: 1, status: "pending" },
    { id: "s-2", signerName: "Mariam", signerEmail: "mariam@beta.am", signOrder: 2, status: "declined" },
  ],
};

const VOIDED_DOCUMENT = {
  ...DRAFT_DOCUMENT,
  id: "doc-4",
  title: "Offer — Voided",
  docType: "offer",
  status: "voided",
  signers: [],
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { documentId: "doc-1" };
  mocks.document = { document: DRAFT_DOCUMENT };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found ────────── */

describe("DocumentDetail — loading + not-found", () => {
  it("shows the loading message while the document is loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading document/i)).toBeInTheDocument();
  });
  it("renders the 'not found' inline copy when the query errors and data is missing", () => {
    mocks.error = true;
    mocks.document = null;
    renderRoute();
    expect(screen.getByText(/Document not found/i)).toBeInTheDocument();
  });
  it("renders the 'not found' copy when the data envelope is missing", () => {
    mocks.document = null;
    renderRoute();
    expect(screen.getByText(/Document not found/i)).toBeInTheDocument();
  });
});

/* ────────── header ────────── */

describe("DocumentDetail — header", () => {
  it("renders the title as a level-1 heading", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "MSA — Acme Corp", level: 1 }),
    ).toBeInTheDocument();
  });
  it("renders the docType label", () => {
    renderRoute();
    expect(screen.getByText(/^agreement$/)).toBeInTheDocument();
  });
  it("renders the 'Draft' status pill", () => {
    renderRoute();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });
  it("renders the customer id", () => {
    renderRoute();
    expect(screen.getByText(/cust-1/)).toBeInTheDocument();
  });
  it("renders a hidden docs-document entity marker with the document id", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="docs-document"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-id")).toBe("doc-1");
  });
  it("renders the 'Sealed' pill when sealedAt and sealedChecksum are set", () => {
    mocks.document = { document: SIGNED_DOCUMENT };
    mocks.params = { documentId: "doc-2" };
    renderRoute();
    expect(screen.getAllByText("Sealed").length).toBeGreaterThan(0);
  });
  it("renders the 'Unsealed' pill when sealedAt and sealedChecksum are empty", () => {
    renderRoute();
    expect(screen.getAllByText("Unsealed").length).toBeGreaterThan(0);
  });
});

/* ────────── body ────────── */

describe("DocumentDetail — body", () => {
  it("renders the body text in a <pre> block", () => {
    renderRoute();
    const body = screen.getByText(/long master service agreement/i).closest("pre");
    expect(body).not.toBeNull();
  });
  it("renders '—' when the body is empty", () => {
    mocks.document = { document: { ...DRAFT_DOCUMENT, body: null } };
    renderRoute();
    // The em-dash also appears in signer cells (email / signed-at); assert
    // presence with getAllByText and verify the <pre> body element is among them.
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
    expect(dashes.some((el) => el.tagName === "PRE")).toBe(true);
  });
  it("truncates bodies longer than 1200 chars with a marker", () => {
    const long = "a".repeat(1500);
    mocks.document = { document: { ...DRAFT_DOCUMENT, body: long } };
    renderRoute();
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });
});

/* ────────── signers ────────── */

describe("DocumentDetail — signers", () => {
  it("renders signers sorted by signOrder ascending", () => {
    // DRAFT_DOCUMENT has Anna (order 2) and Mariam (order 1).
    // Expected order in the table: Mariam then Anna.
    renderRoute();
    const tables = screen.getAllByRole("table");
    const signersTable = tables[tables.length - 1];
    const rows = within(signersTable).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/Mariam/);
    expect(rows[1].textContent).toMatch(/Anna/);
  });
  it("renders the progress summary line", () => {
    renderRoute();
    expect(screen.getByText(/0% signed/i)).toBeInTheDocument();
  });
  it("renders the empty state when there are no signers", () => {
    mocks.document = { document: { ...DRAFT_DOCUMENT, signers: [] } };
    renderRoute();
    expect(screen.getByText(/No signers/i)).toBeInTheDocument();
  });
  it("renders a 'has declined' indicator when a signer declined", () => {
    mocks.document = { document: OUT_FOR_SIG_DOCUMENT };
    mocks.params = { documentId: "doc-3" };
    renderRoute();
    expect(screen.getByText(/has declined/i)).toBeInTheDocument();
  });
});

/* ────────── right rail ────────── */

describe("DocumentDetail — right rail", () => {
  it("renders the actions panel header with Armenian subtitle", () => {
    renderRoute();
    expect(screen.getByText(/^Actions$/)).toBeInTheDocument();
    expect(screen.getByText(/Գործողություններ/)).toBeInTheDocument();
  });
  it("renders the 'Send for signature' action for a draft document", () => {
    renderRoute();
    expect(screen.getByText(/Send for signature/i)).toBeInTheDocument();
  });
  it("renders a hidden docs-action-panel entity marker", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="docs-action-panel"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("1");
  });
  it("renders the 'Remind pending signers' action for out-for-signature", () => {
    mocks.document = { document: { ...OUT_FOR_SIG_DOCUMENT, signers: [
      { id: "s-1", signerName: "Anna", signerEmail: "anna@beta.am", signOrder: 1, status: "pending" },
      { id: "s-2", signerName: "Mariam", signerEmail: "mariam@beta.am", signOrder: 2, status: "pending" },
    ] } };
    mocks.params = { documentId: "doc-3" };
    renderRoute();
    expect(screen.getByText(/Remind pending signers/i)).toBeInTheDocument();
  });
  it("renders the 'Void document' action when a signer declined", () => {
    mocks.document = { document: OUT_FOR_SIG_DOCUMENT };
    mocks.params = { documentId: "doc-3" };
    renderRoute();
    expect(screen.getByText(/Void document/i)).toBeInTheDocument();
  });
  it("renders the 'Reopen as draft' action for a voided document", () => {
    mocks.document = { document: VOIDED_DOCUMENT };
    mocks.params = { documentId: "doc-4" };
    renderRoute();
    expect(screen.getByText(/Reopen as draft/i)).toBeInTheDocument();
  });
  it("renders the metadata block with id, created, updated timestamps", () => {
    renderRoute();
    // The metadata <section> uses aria-labelledby pointing to its
    // h2 "Metadata" heading. Scope to that section.
    const heading = screen.getByRole("heading", { name: "Metadata", level: 2 });
    const block = heading.closest("section") ?? document.body;
    expect(within(block as HTMLElement).getByText("doc-1")).toBeInTheDocument();
    expect(within(block as HTMLElement).getByText("2026-06-01")).toBeInTheDocument();
    expect(within(block as HTMLElement).getByText("2026-06-05")).toBeInTheDocument();
  });
  it("renders the sealed-at timestamp + checksum when the document is sealed", () => {
    mocks.document = { document: SIGNED_DOCUMENT };
    mocks.params = { documentId: "doc-2" };
    renderRoute();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("DocumentDetail — back link", () => {
  it("renders a 'Back to docs' link to /app/docs with view=documents", () => {
    renderRoute();
    const backLinks = screen.getAllByRole("link");
    const docsLink = backLinks.find(
      (l) => (l.textContent ?? "").trim() === "Back to docs",
    );
    expect(docsLink).toBeDefined();
    expect(docsLink?.getAttribute("data-href")).toBe("/app/docs");
    expect(docsLink?.getAttribute("data-search")).toContain("documents");
  });
});
