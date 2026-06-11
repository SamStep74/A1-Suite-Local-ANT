/**
 * /app/cfo/state-integrations — route-level tests for the Pattern A route.
 *
 * Mirrors the cabinet/healthcheck test pattern: mock the three layers
 * (Router, Query, API client), then drive the public component
 * surface. The route file exports its subcomponents (`DispatchForm`,
 * `ResultCard`, `AuditPanel`) as named exports, so we can import and
 * render them directly without instantiating the full workspace.
 *
 * Additionally we mock `isStateIntAuditorLike` (a single helper from
 * `web-modern/src/lib/state-int/status`) so tests 9/10 can flip the
 * audit panel's visibility without touching any other helper.
 *
 * Coverage targets (Phase 8.8 layer 2):
 *  1. Page shell — H1 contains "Կառավարության ինտեգրացիաներ"
 *  2. MODE badge renders "MODE: test"
 *  3. 6 adapters listed
 *  4. Adapter change resets operation + payload
 *  5. JSON parse error blocks dispatch (data-testid="state-int-error")
 *  6. Dispatch POST: form → postJson called with idempotencyKey
 *  7. Last result renders Armenian status
 *  8. Signature preview truncated at 40 chars
 *  9. Audit block hidden for non-auditor
 * 10. Audit block shown for auditor
 * 11. Audit row renders Armenian status
 * 12. Audit refresh button calls API
 * 13. 403 redirect: no cfo access → 403 card
 * 14. Back link points to /app/cfo
 * 15. tryParseStateIntPayload: valid → ok; invalid → error
 * 16. isStateIntAuditorLike("Auditor") returns true
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  // The audit query's resolved data; tests pre-set this before render.
  auditData: undefined as unknown,
  auditError: undefined as unknown,
  // The flag controls whether useQuery returns the audit data
  // (auditor path) or undefined (non-auditor / no access).
  auditIsFetching: false,
  // The flag controls whether useUserAccess returns true / false.
  cfoAccess: true as boolean,
  // useMutation (dispatch) — same pattern as cabinet.
  dispatchMutateImpl: vi.fn(),
  dispatchIsPending: false,
  // isStateIntAuditorLike — toggled per test to flip the audit panel.
  isStateIntAuditorLikeReturn: true as boolean,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg,
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
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: (opts: { queryKey: unknown[]; enabled?: boolean; queryFn?: () => unknown }) => {
      // The audit query is the only useQuery in the route. Tests
      // pre-set mocks.auditData so the synchronous render path
      // exercises the populated / empty / error branches without an
      // act() roundtrip. `enabled=false` (non-auditor) returns no
      // data, mirroring the TanStack Query contract.
      const isAudit = Array.isArray(opts?.queryKey) && opts.queryKey[0] === "state-int";
      if (!isAudit) {
        return { data: undefined, error: undefined, isFetching: false, refetch: vi.fn() };
      }
      if (opts?.enabled === false) {
        return { data: undefined, error: undefined, isFetching: false, refetch: vi.fn() };
      }
      // Fire the queryFn on mount (and on refetch) so the real
      // fetch path is exercised — the test asserts getJson was
      // called. We don't await the promise; the route's UI uses
      // mocks.auditData for the synchronous data path.
      const fire = () => {
        if (typeof opts.queryFn === "function") {
          try {
            return opts.queryFn();
          } catch {
            /* surface in auditError below */
          }
        }
        return undefined;
      };
      fire();
      return {
        data: mocks.auditData,
        error: mocks.auditError,
        isFetching: mocks.auditIsFetching,
        refetch: vi.fn(() => {
          fire();
        }),
      };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      // Dispatch mutation — same forwarding pattern as cabinet.
      mocks.dispatchMutateImpl.mockImplementation((...args: unknown[]) => {
        opts
          .mutationFn(...args)
          .then((res: unknown) => {
            if (opts.onSuccess) opts.onSuccess(res, ...args);
          })
          .catch((err: unknown) => {
            if (opts.onError) opts.onError(err, ...args);
          });
      });
      return {
        mutate: (...args: unknown[]) => mocks.dispatchMutateImpl(...args),
        isPending: mocks.dispatchIsPending,
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
  postVoid: vi.fn().mockResolvedValue(undefined),
  patchJson: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../../lib/rbac/access", () => ({
  // The gate hook — single boolean the test toggles via mocks.cfoAccess.
  useUserAccess: (appId: string) => {
    if (appId === "cfo") return mocks.cfoAccess;
    return true;
  },
}));

vi.mock("../../../../lib/state-int/status", async (importOriginal) => {
  // Spread the real module so every helper (STATE_INT_ADAPTERS, label
  // maps, format functions, idempotency key, payload parser) is
  // preserved verbatim — we only stub isStateIntAuditorLike to flip
  // the audit panel's visibility per test.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isStateIntAuditorLike: vi.fn(() => mocks.isStateIntAuditorLikeReturn),
  };
});

/* ────────── import the route under test (mocks are in place by now) ─ */

import { Route } from "./index";
import {
  STATE_INT_ADAPTERS,
  formatStateIntSignaturePreview,
  isStateIntAuditorLike,
  stateIntDefaultPayloadFor,
  stateIntStatusLabelAm,
  tryParseStateIntPayload,
} from "../../../../lib/state-int/status";
import type { StateIntDispatchResponse } from "../../../../lib/api/schemas";

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

const DISPATCH_RESPONSE: StateIntDispatchResponse = {
  requestId: "req-abc-123",
  status: "ok",
  providerRef: "SRC-2026-Q1-001",
  // > 40 chars so the preview truncates with an ellipsis.
  signatureB64: "a".repeat(60),
  certificateThumbprint: "thumb-001",
  advisoryOnly: true,
};

const AUDIT_ROW = {
  id: "audit-1",
  adapter: "src" as const,
  operation: "submitVat" as const,
  request_id: "req-abc-123",
  status: "ok" as const,
  latency_ms: 142,
  called_at: "2026-06-11T12:00:00.000Z",
};

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  mocks.dispatchMutateImpl.mockReset();
  mocks.auditData = undefined;
  mocks.auditError = undefined;
  mocks.auditIsFetching = false;
  mocks.cfoAccess = true;
  mocks.dispatchIsPending = false;
  mocks.isStateIntAuditorLikeReturn = true;
  // Default: postJson resolves to a valid dispatch envelope.
  mocks.postJson.mockResolvedValue(DISPATCH_RESPONSE);
  // Default: getJson resolves to the audit envelope.
  mocks.getJson.mockResolvedValue({ audit: [AUDIT_ROW] });
  // Reset the spied helper's return value.
  vi.mocked(isStateIntAuditorLike).mockImplementation(
    () => mocks.isStateIntAuditorLikeReturn,
  );
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("State Integrations — page shell", () => {
  it("renders the H1 with the Armenian title 'Կառավարության ինտեգրացիաներ'", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Կառավարության ինտեգրացիաներ/,
      }),
    ).toBeInTheDocument();
  });

  it("renders the English subtitle 'State integrations hub'", () => {
    renderRoute();
    expect(screen.getByText(/State integrations hub/)).toBeInTheDocument();
  });

  it("renders the MODE badge with text 'MODE: test'", () => {
    renderRoute();
    expect(screen.getByTestId("state-int-mode-badge")).toHaveTextContent("MODE: test");
  });

  it("wraps the page in a panel with data-testid='state-int-panel' and data-entity='state-int'", () => {
    renderRoute();
    const panel = screen.getByTestId("state-int-panel");
    expect(panel.tagName.toLowerCase()).toBe("div");
    expect(panel.getAttribute("data-entity")).toBe("state-int");
  });
});

/* ────────── adapter catalog ────────── */

describe("State Integrations — adapter catalog", () => {
  it("lists all 6 adapters in the select", () => {
    renderRoute();
    const select = screen.getByTestId(
      "state-int-adapter-select",
    ) as HTMLSelectElement;
    expect(select.options).toHaveLength(STATE_INT_ADAPTERS.length);
    expect(STATE_INT_ADAPTERS).toHaveLength(6);
  });

  it("preselects the first adapter (src) and pre-fills the textarea with its default payload", () => {
    renderRoute();
    const select = screen.getByTestId(
      "state-int-adapter-select",
    ) as HTMLSelectElement;
    const textarea = screen.getByTestId(
      "state-int-payload-textarea",
    ) as HTMLTextAreaElement;
    expect(select.value).toBe(STATE_INT_ADAPTERS[0].id);
    expect(textarea.value).toBe(stateIntDefaultPayloadFor(STATE_INT_ADAPTERS[0].id));
  });

  it("changing the adapter resets the payload to the new adapter's default", () => {
    renderRoute();
    const select = screen.getByTestId(
      "state-int-adapter-select",
    ) as HTMLSelectElement;
    const textarea = screen.getByTestId(
      "state-int-payload-textarea",
    ) as HTMLTextAreaElement;
    // Switch to the third adapter (egov).
    fireEvent.change(select, { target: { value: "egov" } });
    expect(textarea.value).toBe(stateIntDefaultPayloadFor("egov"));
  });
});

/* ────────── dispatch flow ────────── */

describe("State Integrations — dispatch flow", () => {
  it("blocks dispatch and shows the parse error when JSON is invalid", async () => {
    renderRoute();
    const textarea = screen.getByTestId("state-int-payload-textarea");
    fireEvent.change(textarea, { target: { value: "not json" } });

    fireEvent.click(screen.getByTestId("state-int-dispatch-button"));

    const err = await screen.findByTestId("state-int-error");
    expect(err).toHaveTextContent(/invalid JSON/);
    expect(mocks.postJson).not.toHaveBeenCalled();
  });

  it("calls postJson with the right path and an idempotencyKey on a valid dispatch", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("state-int-dispatch-button"));

    await waitFor(() => {
      expect(mocks.postJson).toHaveBeenCalledTimes(1);
    });
    const [path, body] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/state-int/src/submitVat");
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(
      /^ui-state-int-src-submitVat-\d+$/,
    );
  });

  it("renders the last result with the Armenian status label", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("state-int-dispatch-button"));

    await waitFor(() => {
      expect(screen.getByTestId("state-int-result")).toBeInTheDocument();
    });
    expect(
      screen.getByText(stateIntStatusLabelAm(DISPATCH_RESPONSE.status)),
    ).toBeInTheDocument();
  });

  it("truncates the signature preview to 40 chars + ellipsis when the value is long", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("state-int-dispatch-button"));

    await waitFor(() => {
      expect(screen.getByTestId("state-int-result")).toBeInTheDocument();
    });
    const preview = formatStateIntSignaturePreview(DISPATCH_RESPONSE.signatureB64!);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBe(41);
  });
});

/* ────────── audit panel (auditor-only) ────────── */

describe("State Integrations — audit panel", () => {
  it("hides the audit block when isStateIntAuditorLike returns false", () => {
    mocks.isStateIntAuditorLikeReturn = false;
    mocks.auditData = [AUDIT_ROW];
    renderRoute();
    expect(screen.queryByTestId("state-int-audit")).not.toBeInTheDocument();
  });

  it("shows the audit block when isStateIntAuditorLike returns true", () => {
    mocks.isStateIntAuditorLikeReturn = true;
    mocks.auditData = [AUDIT_ROW];
    renderRoute();
    expect(screen.getByTestId("state-int-audit")).toBeInTheDocument();
  });

  it("renders an audit row with the Armenian status label", () => {
    mocks.auditData = [AUDIT_ROW];
    renderRoute();
    const row = screen.getByTestId("state-int-audit-row");
    expect(row).toHaveTextContent(stateIntStatusLabelAm(AUDIT_ROW.status));
  });

  it("refresh button calls getJson on /api/state-int/audit", async () => {
    mocks.auditData = [];
    renderRoute();
    mocks.getJson.mockClear();
    fireEvent.click(screen.getByTestId("state-int-audit-refresh"));
    // The query auto-fires on mount (TanStack Query), and the refresh
    // button calls refetch() — both go through getJson. We assert at
    // least one call hit the audit endpoint.
    await waitFor(() => {
      expect(mocks.getJson).toHaveBeenCalled();
    });
    const auditCalls = mocks.getJson.mock.calls.filter(
      ([path]) => path === "/api/state-int/audit",
    );
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
  });
});

/* ────────── 403 access gate ────────── */

describe("State Integrations — access gate", () => {
  it("renders the 403 panel when the user does not have cfo access", () => {
    mocks.cfoAccess = false;
    renderRoute();
    expect(screen.getByTestId("state-int-forbidden")).toBeInTheDocument();
    expect(screen.getByTestId("state-int-forbidden")).toHaveTextContent(/403/);
    // The dispatch form should NOT render in the 403 branch.
    expect(screen.queryByTestId("state-int-dispatch-form")).not.toBeInTheDocument();
  });

  it("still shows the Armenian title above the 403 card so the user knows what they tried to open", () => {
    mocks.cfoAccess = false;
    renderRoute();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Կառավարության ինտեգրացիաներ/,
      }),
    ).toBeInTheDocument();
  });
});

/* ────────── back link ────────── */

describe("State Integrations — back link", () => {
  it("renders a back-to-CFO link that points to /app/cfo", () => {
    renderRoute();
    const back = screen.getByTestId("state-int-back");
    expect(back.getAttribute("data-href")).toBe("/app/cfo");
  });
});

/* ────────── pure helper sanity checks ────────── */

describe("State Integrations — pure helpers", () => {
  it("tryParseStateIntPayload returns ok for valid JSON and error for invalid JSON", () => {
    const ok = tryParseStateIntPayload('{"a": 1}');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.parsed).toEqual({ a: 1 });

    const bad = tryParseStateIntPayload("{not json");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/invalid JSON/);

    const empty = tryParseStateIntPayload("   ");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toMatch(/empty/);
  });

  it("isStateIntAuditorLike('Auditor') returns true", async () => {
    // Bypass the per-test mock override and call the real helper
    // directly to verify the underlying logic (Owner/Admin/Auditor).
    // We use vi.importActual to get the original (unmocked) module
    // exports — `require()` does not work for mocked ESM modules.
    const actual =
      await vi.importActual<
        typeof import("../../../../lib/state-int/status")
      >("../../../../lib/state-int/status");
    const realFn = actual.isStateIntAuditorLike;
    expect(realFn("Auditor")).toBe(true);
    expect(realFn("Owner")).toBe(true);
    expect(realFn("Admin")).toBe(true);
    expect(realFn("Member")).toBe(false);
    expect(realFn(null)).toBe(false);
  });
});
