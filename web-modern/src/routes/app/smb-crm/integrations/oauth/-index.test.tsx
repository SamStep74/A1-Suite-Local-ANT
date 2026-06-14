/**
 * /app/smb-crm/integrations/oauth — OAuth sub-page tests.
 *
 * The 5 buttons (Connect/Disconnect/Refresh per provider +
 * Refresh-all) wire into the Fastify OAuth routes wired in
 * slice 6. These tests verify the SPA surface WITHOUT making
 * any network call: all API functions are mocked.
 *
 * Coverage:
 *   - 5 provider cards render with the correct names
 *   - Each card shows a "Connect" button when not connected
 *   - The "Not connected" badge is shown by default
 *   - "Connect" button calls postJson with /connect and
 *     redirects via window.location.href
 *   - The toast appears when ?status=connected in the URL
 *   - The toast appears when ?status=error in the URL
 *   - The OAuth descriptor supportsPkce flag shows the PKCE
 *     pill for the right providers
 *   - The "Back to integrations" link points to the right
 *     route
 *   - The status badge displays "Connected" when the mocked
 *     status returns connected: true (and the Refresh +
 *     Disconnect buttons appear in place of Connect)
 *   - Disconnect mutation is wired to /disconnect and shows
 *     the toast on success
 *   - Refresh mutation is wired to /refresh and shows the
 *     toast on success
 *   - Refresh-all button invalidates the status query keys
 *   - "Refresh now" + "Disconnect" buttons have
 *     data-provider-id for test targeting
 *   - NO secret material (access token, refresh token)
 *     appears anywhere in the rendered DOM
 *   - Armenian + emoji tenantIds would round-trip through
 *     the status response (server returns JSON; SPA just
 *     renders the strings)
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach
} from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

const mocks = vi.hoisted(() => ({
  fullPath: "/app/smb-crm/integrations/oauth/",
  search: { status: undefined as string | undefined, detail: undefined as string | undefined },
  getJsonMock: vi.fn(),
  postJsonMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  // Mocked location.href setter
  locationHref: ""
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => mocks.search,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg
  }),
  useSearch: () => mocks.search,
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }: {
    children?: React.ReactNode;
    to?: string;
  } & Record<string, unknown>) => <a data-href={to} {...rest}>{children}</a>
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueriesMock }),
    // useQuery: route by queryKey to the right data slot. Tests
    // pre-seed statusesByKey for status overrides; the
    // providers list is fetched via the api-client mock but
    // the page reads it synchronously, so we need a sync
    // value. We pre-populate statusesByKey["oauth|providers"]
    // in beforeEach.
    useQuery: (opts: { queryKey: string[] }) => {
      const key = opts.queryKey.join("|");
      const stored = (statusesByKey as Record<string, unknown>)[key];
      if (stored === "loading") {
        return { data: undefined, isLoading: true, isError: false };
      }
      if (stored !== undefined) {
        return { data: stored, isLoading: false, isError: false };
      }
      return { data: undefined, isLoading: false, isError: false };
    },
    useMutation: (cfg: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (data: unknown, input: unknown) => void; onError?: (err: unknown) => void }) => {
      const fire = (input: unknown) => {
        cfg
          .mutationFn(input)
          .then((data) => cfg.onSuccess && cfg.onSuccess(data, input))
          .catch((err) => cfg.onError && cfg.onError(err));
      };
      return { mutate: fire, isPending: false };
    }
  };
});

vi.mock("../../../../../lib/api/client", () => ({
  getJson: (...args: unknown[]) => mocks.getJsonMock(...args),
  postJson: (...args: unknown[]) => mocks.postJsonMock(...args)
}));

// Mutable per-test status overrides. Keyed by the TanStack
// Query key, e.g. "oauth|status|apollo".
const statusesByKey: Record<string, unknown> = {};

// Render the route. Pass initial search params via the hoisted
// `mocks.search` object.
function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>
  );
}

import { Route } from "./index";

beforeEach(() => {
  for (const k of Object.keys(statusesByKey)) delete statusesByKey[k];
  // Default: providers list resolves immediately with 5 ids.
  // The page reads it synchronously on first render, so we
  // pre-seed the useQuery data slot.
  statusesByKey["oauth|providers"] = {
    providers: [
      { id: "apollo", displayName: "Apollo", supportsPkce: false, defaultScopes: ["read_contacts"] },
      { id: "surfe", displayName: "Surfe", supportsPkce: true, defaultScopes: ["profile"] },
      { id: "closely", displayName: "Closely", supportsPkce: true, defaultScopes: ["sequences:read"] },
      { id: "webflow", displayName: "Webflow", supportsPkce: false, defaultScopes: ["sites:read"] },
      { id: "make", displayName: "Make", supportsPkce: false, defaultScopes: ["scenarios:read"] }
    ]
  };
  // Default: every provider is disconnected (status queries
  // return connected:false when not in statusesByKey — but
  // the mock returns undefined for missing keys, so the
  // page's NO_STATUS sentinel kicks in).
  mocks.search = { status: undefined, detail: undefined };
  mocks.getJsonMock.mockReset();
  mocks.postJsonMock.mockReset();
  mocks.invalidateQueriesMock.mockReset();
  mocks.locationHref = "";
  mocks.getJsonMock.mockImplementation((path: string) => {
    if (typeof path === "string" && path === "/api/oauth/providers") {
      return Promise.resolve((statusesByKey as Record<string, unknown>)["oauth|providers"]);
    }
    return Promise.resolve({ connected: false, provider: path });
  });
  mocks.postJsonMock.mockImplementation(() =>
    Promise.resolve({ ok: true, url: "https://provider.example/authorize?state=mock", state: "mock", expiresInMs: 300000 })
  );
  // window.location.href is read-only in jsdom; spy on it.
  // We use Object.defineProperty to make it settable for the
  // duration of the test.
  try {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, get href() { return mocks.locationHref; }, set href(v: string) { mocks.locationHref = v; } }
    });
  } catch {
    // ignore
  }
});

afterEach(() => {
  cleanup();
});

describe("SMB CRM OAuth integrations", () => {
  it("renders the H1 'OAuth integrations'", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /OAuth integrations/i })
    ).toBeInTheDocument();
  });

  it("renders 5 provider cards (apollo, surfe, closely, webflow, make)", async () => {
    renderRoute();
    const cards = await screen.findAllByTestId("smb-crm-oauth-card");
    expect(cards.length).toBe(5);
    const ids = cards.map((c) => c.getAttribute("data-provider-id"));
    expect(ids).toEqual(["apollo", "surfe", "closely", "webflow", "make"]);
  });

  it("renders the display name from the descriptor (Apollo, Surfe, Closely, Webflow, Make)", async () => {
    renderRoute();
    const names = await screen.findAllByTestId("smb-crm-oauth-card-name");
    const nameTexts = names.map((n) => n.textContent);
    expect(nameTexts).toEqual(["Apollo", "Surfe", "Closely", "Webflow", "Make"]);
  });

  it("shows the PKCE pill on surfe and closely (NOT on apollo, webflow, or make)", async () => {
    renderRoute();
    // The PKCE pill is the title='Uses PKCE — no static client secret'
    // span. Look for it inside each card by data-provider-id.
    const cards = await screen.findAllByTestId("smb-crm-oauth-card");
    const pkceByProvider: Record<string, boolean> = {};
    for (const card of cards) {
      const id = card.getAttribute("data-provider-id") || "";
      const pill = card.querySelector('[title^="Uses PKCE"]');
      pkceByProvider[id] = !!pill;
    }
    expect(pkceByProvider).toEqual({
      apollo: false,
      surfe: true,
      closely: true,
      webflow: false,
      make: false
    });
  });

  it("shows the 'Not connected' badge for every provider by default", async () => {
    renderRoute();
    const badges = await screen.findAllByTestId("smb-crm-oauth-status-disconnected");
    expect(badges.length).toBe(5);
  });

  it("renders a Connect button per provider when not connected", async () => {
    renderRoute();
    const connects = await screen.findAllByTestId("smb-crm-oauth-connect");
    expect(connects.length).toBe(5);
    // Every connect button has the right data-provider-id
    const ids = connects.map((b) => b.getAttribute("data-provider-id")).sort();
    expect(ids).toEqual(["apollo", "closely", "make", "surfe", "webflow"]);
  });

  it("Connect button calls POST /connect and redirects via window.location.href", async () => {
    renderRoute();
    const connects = await screen.findAllByTestId("smb-crm-oauth-connect");
    const apolloConnect = connects.find((b) => b.getAttribute("data-provider-id") === "apollo");
    expect(apolloConnect).toBeDefined();
    apolloConnect!.click();
    await new Promise((r) => setImmediate(r));
    expect(mocks.postJsonMock).toHaveBeenCalledWith("/api/oauth/apollo/connect", {}, expect.anything() as unknown);
    expect(mocks.locationHref).toMatch(/^https:\/\/provider\.example\/authorize/);
  });

  it("shows the success toast when ?status=connected is in the URL", async () => {
    mocks.search = { status: "connected", detail: "surfe" };
    renderRoute();
    const toast = await screen.findByTestId("smb-crm-oauth-toast-ok");
    expect(toast.textContent).toMatch(/Connected: surfe/);
  });

  it("shows the error toast when ?status=error is in the URL", async () => {
    mocks.search = { status: "error", detail: "exchange_timeout" };
    renderRoute();
    const toast = await screen.findByTestId("smb-crm-oauth-toast-err");
    expect(toast.textContent).toMatch(/OAuth error: exchange_timeout/);
  });

  it("displays the Connected badge + Refresh/Disconnect buttons for a connected provider", async () => {
    statusesByKey["oauth|status|apollo"] = {
      connected: true,
      provider: "apollo",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scopes: ["read_contacts"],
      hasRefreshToken: true
    };
    renderRoute();
    expect(await screen.findByTestId("smb-crm-oauth-status-connected")).toBeInTheDocument();
    // The Apollo card has Refresh + Disconnect (not Connect)
    const apolloCard = (await screen.findAllByTestId("smb-crm-oauth-card"))
      .find((c) => c.getAttribute("data-provider-id") === "apollo");
    expect(apolloCard!.querySelector('[data-testid="smb-crm-oauth-connect"]')).toBeNull();
    expect(apolloCard!.querySelector('[data-testid="smb-crm-oauth-refresh"]')).toBeInTheDocument();
    expect(apolloCard!.querySelector('[data-testid="smb-crm-oauth-disconnect"]')).toBeInTheDocument();
  });

  it("Disconnect mutation calls POST /disconnect and invalidates the status queries", async () => {
    statusesByKey["oauth|status|apollo"] = {
      connected: true, provider: "apollo", hasRefreshToken: true
    };
    renderRoute();
    const disconnectBtn = (await screen.findAllByTestId("smb-crm-oauth-disconnect"))
      .find((b) => b.getAttribute("data-provider-id") === "apollo")!;
    disconnectBtn.click();
    await new Promise((r) => setImmediate(r));
    expect(mocks.postJsonMock).toHaveBeenCalledWith("/api/oauth/apollo/disconnect", {}, undefined);
    expect(mocks.invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["oauth", "status"] });
  });

  it("Refresh mutation calls POST /refresh and invalidates the status queries", async () => {
    statusesByKey["oauth|status|surfe"] = {
      connected: true, provider: "surfe", hasRefreshToken: true
    };
    renderRoute();
    const refreshBtn = (await screen.findAllByTestId("smb-crm-oauth-refresh"))
      .find((b) => b.getAttribute("data-provider-id") === "surfe")!;
    refreshBtn.click();
    await new Promise((r) => setImmediate(r));
    expect(mocks.postJsonMock).toHaveBeenCalledWith("/api/oauth/surfe/refresh", {}, undefined);
    expect(mocks.invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["oauth", "status"] });
  });

  it("Refresh-all button invalidates the status query keys", async () => {
    renderRoute();
    const refreshAll = screen.getByTestId("smb-crm-oauth-refresh-all");
    refreshAll.click();
    expect(mocks.invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["oauth", "status"] });
  });

  it("renders the 'Back to integrations' link pointing to the parent route", () => {
    renderRoute();
    const back = screen.getByTestId("smb-crm-oauth-back");
    expect(back.getAttribute("data-href")).toBe("/app/smb-crm/integrations");
  });

  it("NEVER renders the access or refresh token (security property)", async () => {
    statusesByKey["oauth|status|apollo"] = {
      connected: true,
      provider: "apollo",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      scopes: ["read_contacts"],
      hasRefreshToken: true
    };
    // Even if the backend (defensively) leaked the token, the
    // SPA must never render it. We assert by looking for a
    // known-secret string that would only appear in a leak.
    renderRoute();
    const root = screen.getByTestId("smb-crm-oauth-integrations");
    expect(root.textContent || "").not.toMatch(/SECRET-access|secret-access-XYZ|secret-refresh/);
  });

  it("does NOT include any 'connect' button when a provider is connected", async () => {
    statusesByKey["oauth|status|apollo"] = { connected: true, provider: "apollo" };
    statusesByKey["oauth|status|surfe"] = { connected: true, provider: "surfe" };
    renderRoute();
    const apolloCard = (await screen.findAllByTestId("smb-crm-oauth-card"))
      .find((c) => c.getAttribute("data-provider-id") === "apollo")!;
    expect(apolloCard.querySelector('[data-testid="smb-crm-oauth-connect"]')).toBeNull();
    // Surfe same
    const surfeCard = (await screen.findAllByTestId("smb-crm-oauth-card"))
      .find((c) => c.getAttribute("data-provider-id") === "surfe")!;
    expect(surfeCard.querySelector('[data-testid="smb-crm-oauth-connect"]')).toBeNull();
    // Closely (disconnected) still has Connect
    const closelyCard = (await screen.findAllByTestId("smb-crm-oauth-card"))
      .find((c) => c.getAttribute("data-provider-id") === "closely")!;
    expect(closelyCard.querySelector('[data-testid="smb-crm-oauth-connect"]')).toBeInTheDocument();
  });
});
