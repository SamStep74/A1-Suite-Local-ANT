/**
 * /app/copilot/$chatId — route-level tests for the chat detail.
 *
 * Mirrors cfo/$loanId pattern. Coverage:
 *
 *  - Loading state ("Loading chat…")
 *  - Not-found (no data envelope)
 *  - Error state
 *  - Header (title, chatId monogram, monogram badge)
 *  - KPIs: messages, confidence, citations, calculations
 *  - Last packet status pill + risk pill
 *  - Message bubbles (user / assistant) + entity marker
 *  - Back-link to /app/copilot
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state ────────── */

const mocks = vi.hoisted(() => ({
  params: { chatId: "chat-1" as string },
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

import { Route } from "./$chatId";

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

const CHAT = {
  chat: {
    id: "chat-1",
    title: "VAT Q2",
    createdAt: "2026-06-15T10:00:00Z",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "What is the VAT rate?",
        createdAt: "2026-06-15T10:00:00Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "The rate is 20%.",
        createdAt: "2026-06-15T10:01:00Z",
        packet: {
          id: "p1",
          intent: "vat",
          status: "draft",
          answer: "The rate is 20%.",
          confidence: 82,
          riskLevel: "legal",
          reviewRequired: true,
          advisoryOnly: true,
          citations: [{ id: "law-1" }, { id: "law-2" }],
          calculations: [{ kind: "vat-report" }],
          proposedActions: [],
          createdAt: "2026-06-15T10:01:00Z",
        },
      },
    ],
  },
};

const BLOCKED_CHAT = {
  chat: {
    id: "chat-2",
    title: "Blocked",
    createdAt: "2026-06-15T10:00:00Z",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "What about customs?",
        createdAt: "2026-06-15T10:00:00Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "Cannot answer without citation.",
        createdAt: "2026-06-15T10:01:00Z",
        packet: {
          id: "p2",
          intent: "vat",
          status: "blocked-missing-citation",
          answer: "Cannot answer without citation.",
          confidence: 50,
          riskLevel: "financial",
          reviewRequired: true,
          advisoryOnly: true,
          citations: [],
          calculations: [],
          proposedActions: [],
          createdAt: "2026-06-15T10:01:00Z",
        },
      },
    ],
  },
};

const EMPTY_CHAT = {
  chat: {
    id: "chat-3",
    title: "Empty",
    createdAt: "2026-06-15T10:00:00Z",
    messages: [],
  },
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { chatId: "chat-1" };
  mocks.data = JSON.parse(JSON.stringify(CHAT));
  mocks.loading = false;
  mocks.error = false;
});

afterEach(() => {
  cleanup();
});

/* ────────── loading / not-found / error ────────── */

describe("ChatDetail — loading / not-found / error", () => {
  it("shows the loading message while the query is in-flight", () => {
    mocks.loading = true;
    renderRoute();
    expect(screen.getByText(/Loading chat/i)).toBeInTheDocument();
  });
  it("shows 'Chat not found' when data envelope is missing", () => {
    mocks.data = null;
    renderRoute();
    expect(screen.getByText(/Chat not found/i)).toBeInTheDocument();
  });
  it("shows 'Chat not found' when chat field is missing", () => {
    mocks.data = { chat: null };
    renderRoute();
    expect(screen.getByText(/Chat not found/i)).toBeInTheDocument();
  });
  it("shows the 'failed' message when the query errors", () => {
    mocks.error = true;
    mocks.data = null;
    renderRoute();
    expect(screen.getByText(/Failed to load chat/i)).toBeInTheDocument();
  });
});

/* ────────── header ────────── */

describe("ChatDetail — header", () => {
  it("renders the chat title as a level-1 heading", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "VAT Q2", level: 1 })).toBeInTheDocument();
  });
  it("renders the chatId in the subtitle", () => {
    renderRoute();
    expect(screen.getByText(/chat-1/)).toBeInTheDocument();
  });
  it("renders the Copilot · Chat monogram badge", () => {
    renderRoute();
    expect(screen.getByText(/Copilot · Chat/)).toBeInTheDocument();
  });
});

/* ────────── KPIs ────────── */

describe("ChatDetail — KPIs", () => {
  it("renders messages, confidence, citations, calculations", () => {
    renderRoute();
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Confidence")).toBeInTheDocument();
    expect(screen.getByText("Citations")).toBeInTheDocument();
    expect(screen.getByText("Calculations")).toBeInTheDocument();
  });
  it("shows 2 messages and 82% confidence for the standard fixture", () => {
    renderRoute();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(screen.getByText("82%")).toBeInTheDocument();
  });
  it("shows 2 citations and 1 calculation for the standard fixture", () => {
    renderRoute();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });
});

/* ────────── packet status / risk ────────── */

describe("ChatDetail — packet status", () => {
  it("renders the status pill for the last packet (draft → 'Սևագիր')", () => {
    renderRoute();
    expect(screen.getByText("Սևագիր")).toBeInTheDocument();
  });
  it("renders the risk pill for the last packet (legal → 'Իրավական')", () => {
    renderRoute();
    expect(screen.getByText("Իրավական")).toBeInTheDocument();
  });
  it("renders the 'review required' callout", () => {
    renderRoute();
    expect(screen.getByText(/Պահանջվում է վերանայում/)).toBeInTheDocument();
  });
  it("renders a 'blocked' status for a blocked packet", () => {
    mocks.data = JSON.parse(JSON.stringify(BLOCKED_CHAT));
    renderRoute();
    expect(screen.getByText("Փակված")).toBeInTheDocument();
    expect(screen.getByText("Ֆինանսական")).toBeInTheDocument();
  });
});

/* ────────── messages ────────── */

describe("ChatDetail — messages", () => {
  it("renders a hidden copilot-message entity marker with the count", () => {
    renderRoute();
    const marker = document.querySelector('[data-entity="copilot-message"]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute("data-count")).toBe("2");
  });
  it("renders user and assistant bubbles", () => {
    renderRoute();
    expect(screen.getByText(/Դուք/)).toBeInTheDocument();
    expect(screen.getByText(/^Copilot$/)).toBeInTheDocument();
  });
  it("renders the message content", () => {
    renderRoute();
    expect(screen.getByText(/What is the VAT rate/i)).toBeInTheDocument();
    expect(screen.getByText(/The rate is 20%/i)).toBeInTheDocument();
  });
  it("shows the empty state when there are no messages", () => {
    mocks.data = JSON.parse(JSON.stringify(EMPTY_CHAT));
    renderRoute();
    expect(screen.getByText(/Այս խոսակցությունը դատարկ է։/)).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("ChatDetail — back link", () => {
  it("renders a 'Back to Copilot' link to /app/copilot with view=chats", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /Back to Copilot/ });
    expect(back).toBeInTheDocument();
    expect(back.getAttribute("data-href")).toBe("/app/copilot");
    expect(back.getAttribute("data-search")).toContain("chats");
  });
});
