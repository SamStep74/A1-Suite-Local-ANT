/**
 * /app/crm-tube/contacts/$contactId — Tube contact detail.
 *
 * Required test minimums (from the worker spec):
 *   1. Renders name / email / phone
 *   2. Renders deals list
 *   3. AI Action Panel renders DecisionCard(s) for the
 *      enrich-opportunity agent when contact.status === "new"
 *      AND primary deal.value >= 100000
 *   4. Back link to /app/crm-tube/contacts
 *
 * The Tube agent panel iterates `tubeAgents` directly, so we mock
 * the registry with a single controllable agent whose `evaluate`
 * returns a canned suggestion. The page then renders it via
 * DecisionCard.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted ────────── */

const mocks = vi.hoisted(() => ({
  params: { contactId: "c-1" },
  contacts: null as unknown,
  deals: null as unknown,
  activities: null as unknown,
  contactsLoading: false,
  dealsLoading: false,
  activitiesLoading: false,
  contactsError: false,
  dealsError: false,
  fullPath: "/app/crm-tube/contacts/$contactId",
  /* The fake tube agent. We replace its evaluate per test. */
  fakeAgent: {
    id: "enrich-opportunity",
    label: "Enrich opportunity",
    triggers: ["tube.deal", "tube.contact"],
    evaluate: vi.fn(),
  } as unknown as {
    id: string;
    label: string;
    triggers: string[];
    evaluate: ReturnType<typeof vi.fn>;
  },
  apiMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useParams: () => mocks.params,
    useSearch: () => ({}),
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
      const key = queryKey[0];
      if (key === "tube-contacts") {
        return {
          data: mocks.contacts,
          isLoading: mocks.contactsLoading,
          isError: mocks.contactsError,
        };
      }
      if (key === "tube-deals") {
        return {
          data: mocks.deals,
          isLoading: mocks.dealsLoading,
          isError: mocks.dealsError,
        };
      }
      if (key === "tube-activities-all") {
        return {
          data: mocks.activities,
          isLoading: mocks.activitiesLoading,
          isError: false,
        };
      }
      return { data: null, isLoading: false, isError: false };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  api: (...args: unknown[]) => mocks.apiMock(...args),
  getJson: vi.fn().mockResolvedValue({}),
  postJson: vi.fn().mockResolvedValue({}),
}));

/* Mock the tube agent registry. The page calls
 *   tubeAgents.filter((a) => a.triggers.includes(ctx.type))
 * and then `agent.evaluate(ctx)`. We expose a single fake agent that
 * the test can drive via `mocks.fakeAgent.evaluate`. */
vi.mock("../../../../lib/agents/tube/registry", () => ({
  tubeAgents: [mocks.fakeAgent],
}));

/* ────────── import the route under test ────────── */

import { Route } from "./$contactId";

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

const CONTACT_NEW = {
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
};

const DEAL_OPEN = {
  id: "d-1",
  contact_id: "c-1",
  title: "Acme — annual",
  stage_name: "Discovery",
  status: "open",
  value: 250_000,
  currency: "AMD",
  created_at: "2026-05-01T08:00:00.000Z",
  updated_at: "2026-06-09T08:00:00.000Z",
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.params = { contactId: "c-1" };
  mocks.contacts = { contacts: [CONTACT_NEW] };
  mocks.deals = { deals: [DEAL_OPEN] };
  mocks.activities = { activities: [] };
  mocks.contactsLoading = false;
  mocks.dealsLoading = false;
  mocks.activitiesLoading = false;
  mocks.contactsError = false;
  mocks.dealsError = false;
  /* By default the fake agent returns one suggestion. */
  mocks.fakeAgent.evaluate.mockResolvedValue([
    {
      id: "sug-1",
      kind: "agent",
      title: "Enrich this opportunity",
      rationale: "New contact, high-value deal",
      sourceRecords: ["c-1", "d-1"],
      sourceCitations: [],
      confidence: 0.9,
      risk: "low",
      riskReason: "Read-only enrichment",
      previewDiff: {},
      proposedAction: {
        method: "POST",
        path: "/api/crm/tube/contacts/enrich",
        body: { contactIds: ["c-1"] },
      },
    },
  ]);
  mocks.apiMock = vi.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ─────────────────────────────────────────────────────────────────────
 * 1. Contact identity
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactDetail — identity", () => {
  it("renders the contact name, email, and phone", async () => {
    renderRoute();
    expect(await screen.findByTestId("tube-contact-name")).toHaveTextContent(
      "John Doe",
    );
    // The info card has data-testid="tube-contact-info"; check the
    // email + phone labels inside it.
    const info = screen.getByTestId("tube-contact-info");
    expect(info).toHaveTextContent("john@example.com");
    expect(info).toHaveTextContent("+37411111111");
  });

  it("renders the lead score badge", async () => {
    renderRoute();
    expect(await screen.findByTestId("tube-contact-lead-score")).toHaveTextContent(
      "80 / 100",
    );
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 2. Deals list
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactDetail — deals", () => {
  it("renders a row per deal for this contact", async () => {
    renderRoute();
    const panel = await screen.findByTestId("tube-contact-deals");
    expect(panel).toHaveTextContent("Acme — annual");
    expect(panel).toHaveTextContent("250,000");
  });

  it("renders the empty state when there are no deals", async () => {
    mocks.deals = { deals: [] };
    renderRoute();
    const panel = await screen.findByTestId("tube-contact-deals");
    expect(panel).toHaveTextContent(/No deals attached/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 3. AI Action Panel
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactDetail — AI panel", () => {
  it("renders a DecisionCard when the agent suggests something", async () => {
    renderRoute();
    const panel = await screen.findByTestId("tube-contact-ai-panel");
    await waitFor(() => {
      // The fake agent's title is "Enrich this opportunity".
      expect(panel).toHaveTextContent("Enrich this opportunity");
    });
    // The agent must have been invoked with the right context shape.
    expect(mocks.fakeAgent.evaluate).toHaveBeenCalledTimes(1);
    const ctx = mocks.fakeAgent.evaluate.mock.calls[0][0];
    expect(ctx.type).toBe("tube.contact");
    expect(ctx.data.contact.status).toBe("new");
    expect(ctx.data.deal.value).toBe(250_000);
  });

  it("renders the 'No new suggestions.' state when the agent returns []", async () => {
    mocks.fakeAgent.evaluate.mockResolvedValueOnce([]);
    renderRoute();
    const panel = await screen.findByTestId("tube-contact-ai-panel");
    await waitFor(() => {
      expect(panel).toHaveTextContent(/No new suggestions/i);
    });
  });

  it("does NOT render the panel while queries are loading", () => {
    mocks.contactsLoading = true;
    renderRoute();
    expect(screen.getByTestId("tube-contact-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("tube-contact-ai-panel")).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * 4. Back link + 404
 * ──────────────────────────────────────────────────────────────────── */

describe("ContactDetail — navigation", () => {
  it("renders a back link to /app/crm-tube/contacts", async () => {
    renderRoute();
    const back = await screen.findByTestId("tube-contact-back");
    expect(back).toHaveAttribute("href", "/app/crm-tube/contacts");
    expect(back).toHaveTextContent("Contacts");
  });

  it("calls notFound() when no contact matches the param", () => {
    /* notFound() throws — wrap render to swallow */
    mocks.contacts = { contacts: [] };
    expect(() => renderRoute()).toThrow(/notFound/);
  });
});
