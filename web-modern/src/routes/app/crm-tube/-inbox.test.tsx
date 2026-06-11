/**
 * /app/crm-tube/inbox — Tube unified inbox.
 *
 * Required test minimums (from the worker spec):
 *   1. Renders H1 "Inbox" + Armenian subtitle Ն
 *   2. Empty state when { items: [] }
 *   3. 3 conversations → 3 thread rows, each with a violet unread dot
 *   4. Clicking a thread shows the message pane for that thread
 *   5. Reply input is disabled (V1 read-only)
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

/* ────────── mock state, hoisted ────────── */

const mocks = vi.hoisted(() => ({
  items: null as unknown,
  loading: false,
  error: false,
  fullPath: "/app/crm-tube/inbox",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
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
      if (queryKey[0] === "tube-inbox") {
        return {
          data: mocks.items,
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
}));

/* ────────── import the route under test ────────── */

import { Route } from "./inbox";

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

const SAMPLE_ITEMS = [
  {
    kind: "conversation" as const,
    id: "msg-1",
    contact_id: "c-1",
    contact_name: "Alice",
    channel: "email",
    subject: "Quick question",
    body: "Are you free Thursday?",
    occurred_at: "2026-06-09T10:00:00.000Z",
    created_at: "2026-06-09T10:00:00.000Z",
  },
  {
    kind: "conversation" as const,
    id: "msg-2",
    contact_id: "c-2",
    contact_name: "Bob",
    channel: "linkedin",
    subject: "Following up",
    body: "Touching base on the proposal.",
    occurred_at: "2026-06-08T09:00:00.000Z",
    created_at: "2026-06-08T09:00:00.000Z",
  },
  {
    kind: "conversation" as const,
    id: "msg-3",
    contact_id: "c-3",
    contact_name: "Carol",
    channel: "sms",
    subject: null,
    body: "Got it, thanks!",
    occurred_at: "2026-06-07T14:30:00.000Z",
    created_at: "2026-06-07T14:30:00.000Z",
  },
];

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.items = { items: SAMPLE_ITEMS };
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ─────────────────────────────────────────────────────────────────────
 * 1. Header
 * ──────────────────────────────────────────────────────────────────── */

describe("Inbox — header", () => {
  it("renders the H1 'Inbox' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /^Inbox$/ }),
    ).toBeInTheDocument();
    // The Armenian subtitle is "Ն · Inbox" — the leading char is
    // the Armenian letter Ն (Capital "N"). This is the byte we check
    // for — match the exact phrase in the page.
    expect(screen.getByText(/Ն · Inbox/)).toBeInTheDocument();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 2. Empty state
 * ──────────────────────────────────────────────────────────────────── */

describe("Inbox — empty", () => {
  it("renders the empty state when items: []", () => {
    mocks.items = { items: [] };
    renderRoute();
    expect(screen.getByTestId("tube-inbox-empty")).toBeInTheDocument();
  });

  it("renders the loading state when the query is loading", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading inbox/i)).toBeInTheDocument();
  });

  it("renders an error alert when the query errors", () => {
    mocks.error = true;
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Could not load the inbox/i,
    );
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 3. Threads + unread dots
 * ──────────────────────────────────────────────────────────────────── */

describe("Inbox — thread list", () => {
  it("groups 3 conversations into 3 thread rows", () => {
    renderRoute();
    const rows = screen.getAllByTestId("tube-inbox-thread");
    expect(rows.length).toBe(3);
  });

  it("renders a violet unread dot for each conversation thread", () => {
    renderRoute();
    // Each thread has 1 conversation → 1 unread dot per thread.
    const dots = screen.getAllByTestId("tube-inbox-unread");
    expect(dots.length).toBe(3);
    // Sanity check: the dot is the violet variant.
    const dot = dots[0];
    expect(dot.className).toMatch(/violet/);
  });

  it("renders contact names on each thread (and once more in the active pane)", () => {
    renderRoute();
    // The active thread's name appears in both the thread list AND
    // the right pane — so use getAllByText and assert the count
    // matches (1 list entry + 1 pane entry for Alice, 1 each for the
    // other contacts since they're not active).
    const alice = screen.getAllByText("Alice");
    expect(alice.length).toBe(2); // thread row + active pane header
    const bob = screen.getAllByText("Bob");
    expect(bob.length).toBe(1); // thread row only
    const carol = screen.getAllByText("Carol");
    expect(carol.length).toBe(1); // thread row only
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 4. Click → message pane
 * ──────────────────────────────────────────────────────────────────── */

describe("Inbox — message pane", () => {
  it("shows the active thread's messages in the right pane", () => {
    renderRoute();
    // The first thread (newest by occurred_at) is Alice. The pane
    // should render her subject line and body.
    const pane = screen.getByTestId("tube-inbox-pane");
    expect(pane).toHaveTextContent("Alice");
    expect(pane).toHaveTextContent("Quick question");
    expect(pane).toHaveTextContent("Are you free Thursday?");
  });

  it("switches the active thread on click", () => {
    renderRoute();
    const rows = screen.getAllByTestId("tube-inbox-thread");
    // Click Carol (last row, was sorted newest-first → 3rd).
    fireEvent.click(rows[2]);
    const pane = screen.getByTestId("tube-inbox-pane");
    expect(pane).toHaveTextContent("Carol");
    expect(pane).toHaveTextContent("Got it, thanks!");
  });

  it("renders a tube-inbox-message node per item in the active thread", () => {
    renderRoute();
    // Alice's thread has exactly 1 conversation.
    const messages = screen.getAllByTestId("tube-inbox-message");
    expect(messages.length).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 5. Reply form (V1 disabled)
 * ──────────────────────────────────────────────────────────────────── */

describe("Inbox — reply form", () => {
  it("renders a reply form with a disabled textarea and a disabled send button", () => {
    renderRoute();
    const form = screen.getByTestId("tube-inbox-reply");
    expect(form).toBeInTheDocument();
    const input = screen.getByTestId("tube-inbox-reply-input");
    expect(input).toBeDisabled();
    const send = screen.getByTestId("tube-inbox-reply-send");
    expect(send).toBeDisabled();
  });
});
