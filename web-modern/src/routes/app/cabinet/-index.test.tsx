/**
 * /app/cabinet — route-level tests for the Document Cabinet Pattern A route.
 *
 * Mirrors the healthcheck test pattern: mock the three layers
 * (Router, Query, API client), then drive the public component
 * surface. The route file exports its subcomponents (`CabinetList`,
 * `CabinetDetail`, `CabinetCreateForm`, `CabinetFiltersBar`,
 * `StatusPill`) as named exports, so we can import and render them
 * directly without instantiating the full workspace.
 *
 * Coverage targets (Phase 8.2 layer 2):
 *  - Page shell — H1 "Document Cabinet" + Armenian subtitle
 *  - Empty state renders the cabinetEmptyMessage string
 *  - Populated state shows both titles, active first
 *  - Filter by search input narrows the list
 *  - Create form submission calls postJson with the right path + body
 *  - Create error renders role="alert"
 *  - Pending create: button shows "Creating…" and is disabled
 *  - Archive click on a selected active doc calls patchJson with archived
 *  - Restore click on a selected archived doc calls patchJson with active
 *  - Back link points to /app
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  // The list query's resolved data. Tests set this before render; the
  // mocked useQuery returns it synchronously so the component can
  // render the list / detail without waiting on the real network.
  queryData: undefined as unknown,
  queryError: undefined as unknown,
  // useMutation (create) — captured for the same reason.
  createMutateImpl: vi.fn(),
  createIsPending: false,
  // useMutation (patch) — separate slot so the detail panel can
  // simulate isPending=true independently from the create form.
  patchMutateImpl: vi.fn(),
  patchIsPending: false,
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
    useQuery: () => {
      // The component reads `data` and `error` off the returned object.
      // Tests pre-set `mocks.queryData` (or `mocks.queryError`) before
      // each render so the synchronous render path exercises the
      // populated / empty / error branches without an act() roundtrip.
      return {
        data: mocks.queryData,
        error: mocks.queryError,
        isPending: false,
        refetch: vi.fn(),
      };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      // The route declares two mutations: create (calls postJson) and
      // patch (calls patchJson). The compiled mutationFn body still
      // mentions the function name in plain text, so we can route by
      // which helper it references. The body also includes a path
      // string; the create path is `/api/cabinet/documents` (no id)
      // and the patch path is `/api/cabinet/documents/${id}`.
      const fn = opts.mutationFn.toString();
      const isPatch =
        fn.includes("patchJson(") || fn.includes("/api/cabinet/documents/${");
      if (!isPatch) {
        mocks.createMutateImpl.mockImplementation((...args: unknown[]) => {
          // Forward the variables to mutationFn — TanStack Query calls
          // `mutationFn(variables)` and the route's body destructures
          // them (e.g. input.title for the create form). Then call
          // onSuccess / onError so the route's setCreateError /
          // setSelectedId handlers actually fire.
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
          mutate: (...args: unknown[]) => mocks.createMutateImpl(...args),
          isPending: mocks.createIsPending,
        };
      }
      mocks.patchMutateImpl.mockImplementation((...args: unknown[]) => {
        // Same forwarding as above: the patch route expects
        // `input.id` and `input.status` so the variables MUST be
        // passed through to mutationFn. onSuccess invalidates the
        // list query, so we still wire it up even though the test
        // doesn't assert on it.
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
        mutate: (...args: unknown[]) => mocks.patchMutateImpl(...args),
        isPending: mocks.patchIsPending,
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  postJson: mocks.postJson,
  patchJson: mocks.patchJson,
  postVoid: vi.fn().mockResolvedValue(undefined),
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

import { Route, CabinetList, CabinetDetail, CabinetCreateForm, CabinetFiltersBar, StatusPill } from "./index";
import { CabinetListResponseSchema, type CabinetDocument } from "../../../lib/api/schemas";

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

const ACTIVE_DOC: CabinetDocument = {
  id: "cab-active",
  title: "Active Agreement",
  direction: "incoming",
  status: "active",
  docType: "contract",
  currentVersion: 1,
  linkedType: "customer",
  linkedId: "cust-1",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
};

const ARCHIVED_DOC: CabinetDocument = {
  id: "cab-archived",
  title: "Archived NDA",
  direction: "outgoing",
  status: "archived",
  docType: "nda",
  currentVersion: 2,
  linkedType: "vendor",
  linkedId: "vendor-1",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

const LIST_RESPONSE = CabinetListResponseSchema.parse({
  documents: [ACTIVE_DOC, ARCHIVED_DOC],
});

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.postJson.mockReset();
  mocks.patchJson.mockReset();
  mocks.createMutateImpl.mockReset();
  mocks.patchMutateImpl.mockReset();
  mocks.createIsPending = false;
  mocks.patchIsPending = false;
  // Default: useQuery returns the populated list (the documents array
  // shape the route destructures off `data`). Individual tests
  // override `mocks.queryData` for empty / error cases.
  mocks.queryData = [ACTIVE_DOC, ARCHIVED_DOC];
  mocks.queryError = undefined;
  mocks.getJson.mockResolvedValue(LIST_RESPONSE);
  mocks.postJson.mockResolvedValue({
    document: ACTIVE_DOC,
    idempotencyKey: "ui-test",
  });
  mocks.patchJson.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Cabinet — page shell", () => {
  it("renders the H1 'Document Cabinet' and the Armenian subtitle", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /Document Cabinet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Փաստաթղթաշրջանառություն/),
    ).toBeInTheDocument();
  });

  it("renders a back-to-Today link that points to /app", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to Today/i });
    expect(back.getAttribute("data-href")).toBe("/app");
  });

  it("wraps the workspace in a div with data-testid='cabinet-panel'", () => {
    renderRoute();
    const panel = screen.getByTestId("cabinet-panel");
    expect(panel.tagName.toLowerCase()).toBe("div");
  });
});

/* ────────── list rendering ────────── */

describe("Cabinet — list", () => {
  it("renders the empty state when the query returns no documents", () => {
    mocks.queryData = [];
    renderRoute();
    const empty = screen.getByTestId("cabinet-empty");
    expect(empty).toBeInTheDocument();
    // The Armenian default from cabinetEmptyMessage is "Փաստաթղթեր դեռ չկան"
    expect(empty.textContent).toMatch(/Փաստաթղթեր դեռ չկան/);
  });

  it("renders both titles in the populated list, active first", () => {
    renderRoute();
    const list = screen.getByTestId("cabinet-list");
    const rows = within(list).getAllByTestId("cabinet-list-row");
    expect(rows).toHaveLength(2);
    // sortCabinetDocumentsByActivity buckets active=0, archived=1
    expect(rows[0].textContent).toMatch(/Active Agreement/);
    expect(rows[1].textContent).toMatch(/Archived NDA/);
  });

  it("narrows the list when typing into the search input", () => {
    renderRoute();
    const list = screen.getByTestId("cabinet-list");
    expect(within(list).getAllByTestId("cabinet-list-row")).toHaveLength(2);

    const search = screen.getByLabelText(/Search cabinet documents/i);
    fireEvent.change(search, { target: { value: "NDA" } });

    // After filter, only the archived NDA matches "NDA"
    const rows = within(list).getAllByTestId("cabinet-list-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/Archived NDA/);
  });
});

/* ────────── create form ────────── */

describe("Cabinet — create form", () => {
  it("calls postJson with the right path + body + CabinetCreateResponseSchema target", () => {
    renderRoute();
    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: "New Vendor MSA" } });
    fireEvent.click(screen.getByTestId("cabinet-create-submit"));

    expect(mocks.postJson).toHaveBeenCalledTimes(1);
    const [path, body, schema] = mocks.postJson.mock.calls[0];
    expect(path).toBe("/api/cabinet/documents");
    expect(body).toMatchObject({
      title: "New Vendor MSA",
      direction: "incoming",
      docType: "agreement",
    });
    // The route stamps a unique idempotencyKey on each call.
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^cab-ui-/);
    // The third arg is the parse schema; it should be the same
    // CabinetCreateResponseSchema export (parse against a known
    // envelope confirms it).
    const parsed = (schema as { parse: (x: unknown) => unknown }).parse({
      document: ACTIVE_DOC,
      idempotencyKey: "ui-test",
    });
    expect(parsed).toEqual({ document: ACTIVE_DOC, idempotencyKey: "ui-test" });
  });

  it("renders a role='alert' error when postJson rejects", async () => {
    mocks.postJson.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    renderRoute();
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: "Title Long Enough" } });
    fireEvent.click(screen.getByTestId("cabinet-create-submit"));

    // The onError handler sets createError asynchronously after the
    // mutation's promise rejects; flush microtasks before asserting.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/boom/);
  });

  it("shows 'Creating…' and disables the submit button while the create mutation is pending", () => {
    mocks.createIsPending = true;
    renderRoute();
    const btn = screen.getByTestId("cabinet-create-submit");
    expect(btn.textContent).toMatch(/Creating/);
    expect(btn).toBeDisabled();
  });
});

/* ────────── archive / restore ────────── */

describe("Cabinet — archive / restore", () => {
  it("calls patchJson with { status: 'archived', idempotencyKey } when archiving an active doc", () => {
    renderRoute();
    // The detail panel should be showing the first (active) doc.
    const detail = screen.getByTestId("cabinet-detail");
    const archiveBtn = within(detail).getByTestId("cabinet-archive");
    fireEvent.click(archiveBtn);

    expect(mocks.patchJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.patchJson.mock.calls[0];
    expect(path).toBe("/api/cabinet/documents/cab-active");
    expect(body).toMatchObject({ status: "archived" });
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^cab-ui-patch-/);
  });

  it("calls patchJson with { status: 'active', idempotencyKey } when restoring an archived doc", () => {
    renderRoute();
    // Filter the list down to just the archived doc, then click restore.
    fireEvent.change(screen.getByLabelText(/Filter by status/i), {
      target: { value: "archived" },
    });
    const detail = screen.getByTestId("cabinet-detail");
    const restoreBtn = within(detail).getByTestId("cabinet-restore");
    fireEvent.click(restoreBtn);

    expect(mocks.patchJson).toHaveBeenCalledTimes(1);
    const [path, body] = mocks.patchJson.mock.calls[0];
    expect(path).toBe("/api/cabinet/documents/cab-archived");
    expect(body).toMatchObject({ status: "active" });
    expect((body as { idempotencyKey: string }).idempotencyKey).toMatch(/^cab-ui-patch-/);
  });
});

/* ────────── subcomponent sanity (proves the named exports work) ─ */

describe("Cabinet — subcomponents", () => {
  it("CabinetList renders one row per doc with the testid", () => {
    render(
      <CabinetList
        docs={[ACTIVE_DOC, ARCHIVED_DOC]}
        selectedId={null}
        onSelect={() => {}}
        filters={{}}
      />,
    );
    const list = screen.getByTestId("cabinet-list");
    expect(within(list).getAllByTestId("cabinet-list-row")).toHaveLength(2);
  });

  it("CabinetDetail shows the Archive button for an active doc and Restore for an archived one", () => {
    const { rerender } = render(
      <CabinetDetail
        doc={ACTIVE_DOC}
        onArchive={() => {}}
        onRestore={() => {}}
        isPatching={false}
      />,
    );
    expect(screen.getByTestId("cabinet-archive")).toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-restore")).toBeNull();

    rerender(
      <CabinetDetail
        doc={ARCHIVED_DOC}
        onArchive={() => {}}
        onRestore={() => {}}
        isPatching={false}
      />,
    );
    expect(screen.getByTestId("cabinet-restore")).toBeInTheDocument();
    expect(screen.queryByTestId("cabinet-archive")).toBeNull();
  });

  it("CabinetFiltersBar renders the 3 controls with Armenian placeholder", () => {
    render(
      <CabinetFiltersBar
        filters={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/Filter by direction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Filter by status/i)).toBeInTheDocument();
    const search = screen.getByLabelText(/Search cabinet documents/i) as HTMLInputElement;
    expect(search.placeholder).toBe("Փնտրել (search title)");
  });

  it("CabinetCreateForm keeps the submit button disabled until title has ≥3 chars", () => {
    render(
      <CabinetCreateForm onSubmit={() => {}} isPending={false} error="" />,
    );
    const submit = screen.getByTestId("cabinet-create-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: "abc" } });
    expect(submit).not.toBeDisabled();
  });

  it("StatusPill carries the status as a data attribute for CSS hooks", () => {
    const { container } = render(
      <>
        <StatusPill status="active" />
        <StatusPill status="archived" />
      </>,
    );
    // The status lives on the outer span; the text node is a child.
    // Query directly via attribute so we're not reliant on parent
    // traversal (which is brittle in jsdom).
    const activePill = container.querySelector('[data-status="active"]');
    const archivedPill = container.querySelector('[data-status="archived"]');
    expect(activePill).not.toBeNull();
    expect(archivedPill).not.toBeNull();
    expect(activePill!.textContent).toMatch(/Ակտիվ/);
    expect(archivedPill!.textContent).toMatch(/Արխիվացված/);
  });
});
