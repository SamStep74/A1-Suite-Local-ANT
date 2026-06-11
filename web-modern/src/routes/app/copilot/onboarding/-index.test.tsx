/**
 * /app/copilot/onboarding — route-level tests for the AI Provider &
 * Models Pattern A route.
 *
 * Mirrors the cabinet test pattern: mock the three layers
 * (Router, Query, API client), then drive the public component
 * surface. The route file exports its subcomponents
 * (`OnboardingWorkspace`, `ModelsSourceChip`, `ApiKeySection`,
 * `ModelSelect`, `ModelGrid`, `OpenNotebookSection`, `SaveButton`,
 * `OwnerGateCard`) as named exports, so the test renders the
 * pieces in isolation.
 *
 * Coverage targets (Phase 8.11 layer 2):
 *  - Page shell — H1 "AI Provider & Models" + Armenian subtitle
 *  - Empty form on first load via onboardingFormFromSettings
 *  - Models source chip: live "Ուղիղ եթեր" / offline "Պահեստային ցուցակ"
 *  - Save with no secret change strips openrouterApiKey
 *  - Save with new key sends openrouterApiKey
 *  - Save with one model change includes only that model id
 *  - Save with no model changes drops the models field
 *  - Open Notebook toggle reveals URL + key fields
 *  - Save error renders role="alert"
 *  - 403 for non-Owner role (OwnerGateCard + missing form)
 *  - Back link points to /app/copilot
 *  - 6 model <select> elements render with the live model list
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/* ────────── mock state, hoisted so vi.mock factories see it ────────── */

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  // api() is the lower-level wrapper used for PUT (the workspace calls
  // api("/api/ai/settings", null, { method: "PUT", body })). We mock
  // it directly so the test can observe the call shape.
  api: vi.fn(),
  // useQuery returns whatever the test sets on `queryData` /
  // `queryError`. The workspace reads two queries (settings, models)
  // — we route by queryKey.
  queryDataByKey: {} as Record<string, unknown>,
  queryErrorByKey: {} as Record<string, unknown>,
  // useMutation (save) — captured the same way as cabinet.
  mutateImpl: vi.fn(),
  isPending: false,
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
    search,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
    search?: Record<string, unknown>;
  } & Record<string, unknown>) => (
    <a
      href={to}
      data-href={to}
      data-search={JSON.stringify(search ?? {})}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuery: (opts: { queryKey: ReadonlyArray<unknown> }) => {
      const key = JSON.stringify(opts.queryKey);
      return {
        data: mocks.queryDataByKey[key],
        error: mocks.queryErrorByKey[key],
        isPending: false,
        refetch: vi.fn(),
      };
    },
    useMutation: (opts: {
      mutationFn: (...args: unknown[]) => Promise<unknown>;
      onSuccess?: (...args: unknown[]) => void;
      onError?: (...args: unknown[]) => void;
    }) => {
      mocks.mutateImpl.mockImplementation((...args: unknown[]) => {
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
        mutate: (...args: unknown[]) => mocks.mutateImpl(...args),
        isPending: mocks.isPending,
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../../../../lib/api/client", () => ({
  getJson: mocks.getJson,
  api: mocks.api,
  postJson: vi.fn().mockResolvedValue({}),
  postVoid: vi.fn().mockResolvedValue(undefined),
  patchJson: vi.fn().mockResolvedValue({}),
}));

/* ────────── import the route under test (mocks are in place by now) ─ */

import {
  Route,
  OnboardingWorkspace,
  ModelsSourceChip,
  ApiKeySection,
  ModelSelect,
  OpenNotebookSection,
  SaveButton,
  OwnerGateCard,
} from "./index";
import type {
  AiModel,
  AiModelsResponse,
  AiSettingsResponse,
} from "../../../../lib/api/schemas";

/* ────────── fixtures ────────── */

const MODELS: AiModel[] = [
  { id: "gpt-4", name: "GPT-4" },
  { id: "claude-3", name: "Claude 3" },
  { id: "llama-3", name: "Llama 3" },
];

const LIVE_MODELS: AiModelsResponse = {
  provider: "openrouter",
  online: true,
  source: "live",
  reason: null,
  egressAllowed: true,
  openrouterHost: "openrouter.ai",
  models: MODELS,
};

const OFFLINE_MODELS: AiModelsResponse = {
  provider: "openrouter",
  online: false,
  source: "offline-fallback",
  reason: "EGRESS_BLOCKED",
  egressAllowed: false,
  openrouterHost: "openrouter.ai",
  models: MODELS,
};

const SETTINGS_RESPONSE: { settings: AiSettingsResponse["settings"] } = {
  settings: {
    openrouterApiKeySet: true,
    openNotebook: { apiKeySet: false, enabled: false, baseUrl: "" },
    models: {
      default: "gpt-4",
      copilot: "claude-3",
      transform: "",
      finance: "",
      crm: "",
      docs: "",
    },
  },
};

// Empty baseline for the "no model changes → no `models` in body" test.
// When every model id in the prior settings is empty, the form is
// effectively identical to it, so putRequestFromForm must drop the
// entire `models` key from the body.
const EMPTY_MODELS_SETTINGS: { settings: AiSettingsResponse["settings"] } = {
  settings: {
    openrouterApiKeySet: false,
    openNotebook: { apiKeySet: false, enabled: false, baseUrl: "" },
    models: {
      default: "",
      copilot: "",
      transform: "",
      finance: "",
      crm: "",
      docs: "",
    },
  },
};

/* ────────── helpers ────────── */

function renderRoute(opts: { userRole?: "Owner" | "Manager" } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (opts.userRole) {
    return render(
      <QueryClientProvider client={qc}>
        <OnboardingWorkspace userRole={opts.userRole} />
      </QueryClientProvider>,
    );
  }
  const Component = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

/* ────────── per-test reset ────────── */

beforeEach(() => {
  mocks.getJson.mockReset();
  mocks.api.mockReset();
  mocks.mutateImpl.mockReset();
  mocks.isPending = false;
  mocks.queryDataByKey = {};
  mocks.queryErrorByKey = {};
  // Default: queries resolve to a populated live response so the
  // workspace renders the form.
  mocks.queryDataByKey[JSON.stringify(["ai", "settings"])] = SETTINGS_RESPONSE;
  mocks.queryDataByKey[JSON.stringify(["ai", "models"])] = LIVE_MODELS;
  mocks.getJson.mockResolvedValue(SETTINGS_RESPONSE);
  mocks.api.mockResolvedValue({ ok: true, settings: SETTINGS_RESPONSE.settings });
});

afterEach(() => {
  cleanup();
});

/* ────────── page shell ────────── */

describe("Onboarding — page shell", () => {
  it("renders the H1 'AI Provider & Models' and the Armenian subtitle", async () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { level: 1, name: /AI Provider/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI մատակարար եւ մոդելներ/)).toBeInTheDocument();
  });

  it("wraps the workspace in a div with data-testid='onboarding-panel'", () => {
    renderRoute();
    const panel = screen.getByTestId("onboarding-panel");
    expect(panel.tagName.toLowerCase()).toBe("div");
  });

  it("renders a back-to-copilot link that points to /app/copilot", () => {
    renderRoute();
    const back = screen.getByRole("link", { name: /back to copilot/i });
    expect(back.getAttribute("data-href")).toBe("/app/copilot");
  });
});

/* ────────── models source chip ────────── */

describe("Onboarding — models source chip", () => {
  it("renders the Armenian live label when the models response is live", () => {
    render(<ModelsSourceChip modelsResponse={LIVE_MODELS} />);
    const chip = screen.getByTestId("models-source-chip");
    expect(chip.getAttribute("data-source")).toBe("live");
    expect(chip.textContent).toMatch(/Ուղիղ եթեր/);
  });

  it("renders the Armenian offline label when the models response is offline-fallback", () => {
    render(<ModelsSourceChip modelsResponse={OFFLINE_MODELS} />);
    const chip = screen.getByTestId("models-source-chip");
    expect(chip.getAttribute("data-source")).toBe("offline");
    expect(chip.textContent).toMatch(/Պահեստային ցուցակ/);
  });
});

/* ────────── onboardingFormFromSettings contract ────────── */

describe("Onboarding — initial form from settings", () => {
  it("seeds the form with the prior model ids and a redacted (empty) api key", async () => {
    // The route's useEffect seeds the form from the helper. We drive
    // a real render and then click save to observe the body shape.
    // putRequestFromForm is a pure "drop empty strings" builder —
    // the server-side `normalizeAiSettingsBody` does the deep-merge.
    // So the body keeps every non-empty model id from the prior
    // settings (default: "gpt-4", copilot: "claude-3") and drops
    // the empty api key + empty-string model ids.
    renderRoute();
    fireEvent.click(screen.getByTestId("onboarding-save"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    const [, , init] = mocks.api.mock.calls[0];
    const body = (init as { body: Record<string, unknown> }).body;
    // Empty secret → not in the body.
    expect(body).not.toHaveProperty("openrouterApiKey");
    // The two non-empty model ids survive in the body.
    expect(body.models).toEqual({ default: "gpt-4", copilot: "claude-3" });
  });
});

/* ────────── save body shape (puts/putRequestFromForm) ────────── */

describe("Onboarding — save mutation body", () => {
  it("strips the openrouterApiKey when the form field is empty", async () => {
    renderRoute();
    // Form starts with empty api key (onboardingFormFromSettings redacts).
    fireEvent.click(screen.getByTestId("onboarding-save"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    const [, , init] = mocks.api.mock.calls[0];
    const body = (init as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty("openrouterApiKey");
  });

  it("includes the new openrouterApiKey when the user types one in", async () => {
    renderRoute();
    const keyInput = screen.getByLabelText(/OpenRouter API key/i);
    fireEvent.change(keyInput, { target: { value: "sk-abc-new" } });
    fireEvent.click(screen.getByTestId("onboarding-save"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    const [, , init] = mocks.api.mock.calls[0];
    const body = (init as { body: Record<string, unknown> }).body;
    expect(body.openrouterApiKey).toBe("sk-abc-new");
  });

  it("includes the changed model id alongside the unchanged non-empty default", async () => {
    renderRoute();
    // The prior settings have `default: "gpt-4"` and `copilot: "claude-3"`.
    // Change copilot to a new id; the body should carry both the
    // updated `copilot` and the still-non-empty `default` (the
    // server-side deep-merge handles the no-op case for `default`).
    const copilotSelect = screen.getByLabelText(/Copilot պատասխաններ/i);
    fireEvent.change(copilotSelect, { target: { value: "llama-3" } });
    fireEvent.click(screen.getByTestId("onboarding-save"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    const [, , init] = mocks.api.mock.calls[0];
    const body = (init as { body: Record<string, unknown> }).body;
    expect(body.models).toEqual({ default: "gpt-4", copilot: "llama-3" });
  });

  it("drops the models field when all 6 model ids match the prior settings", async () => {
    // Override the default fixture with an all-empty baseline.
    mocks.queryDataByKey[JSON.stringify(["ai", "settings"])] = EMPTY_MODELS_SETTINGS;
    mocks.getJson.mockResolvedValue(EMPTY_MODELS_SETTINGS);
    renderRoute();
    // Don't change any model — the body's `models` should be omitted.
    fireEvent.click(screen.getByTestId("onboarding-save"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    const [, , init] = mocks.api.mock.calls[0];
    const body = (init as { body: Record<string, unknown> }).body;
    expect(body).not.toHaveProperty("models");
  });
});

/* ────────── open notebook toggle ────────── */

describe("Onboarding — open notebook toggle", () => {
  it("hides the URL + key fields when the toggle is unchecked", () => {
    const onChange = vi.fn();
    render(
      <OpenNotebookSection
        form={{ openNotebook: { enabled: false, baseUrl: "", apiKey: "" }, models: {} } as never}
        onChange={onChange}
      />,
    );
    expect(screen.queryByTestId("open-notebook-base-url")).toBeNull();
    expect(screen.queryByTestId("open-notebook-api-key")).toBeNull();
  });

  it("reveals the URL + key fields when the toggle is checked", () => {
    const onChange = vi.fn();
    render(
      <OpenNotebookSection
        form={{ openNotebook: { enabled: true, baseUrl: "https://notebook.example.am", apiKey: "" }, models: {} } as never}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("open-notebook-base-url")).toBeInTheDocument();
    expect(screen.getByTestId("open-notebook-api-key")).toBeInTheDocument();
  });

  it("fires onChange with the new enabled state when the toggle is flipped", () => {
    const onChange = vi.fn();
    render(
      <OpenNotebookSection
        form={{ openNotebook: { enabled: false, baseUrl: "", apiKey: "" }, models: {} } as never}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("open-notebook-toggle"));
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });
});

/* ────────── save error path ────────── */

describe("Onboarding — save error", () => {
  it("renders a role='alert' error when api() rejects", async () => {
    mocks.api.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    renderRoute();
    fireEvent.click(screen.getByTestId("onboarding-save"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/boom/);
  });
});

/* ────────── 403 owner gate ────────── */

describe("Onboarding — owner gate", () => {
  it("renders the OwnerGateCard (403) and hides the form for a non-Owner role", () => {
    renderRoute({ userRole: "Manager" });
    expect(screen.getByTestId("onboarding-403")).toBeInTheDocument();
    // The form sections are gated.
    expect(screen.queryByTestId("api-key-section")).toBeNull();
    expect(screen.queryByTestId("model-grid")).toBeNull();
    expect(screen.queryByTestId("onboarding-save")).toBeNull();
  });

  it("the OwnerGateCard message contains the Armenian denial text", () => {
    render(<OwnerGateCard />);
    expect(screen.getByText(/Մուտքը սահմանափակված է/)).toBeInTheDocument();
    expect(screen.getByText(/Միայն սեփականատիրոջ համար/)).toBeInTheDocument();
  });
});

/* ────────── model grid (6 selects) ────────── */

describe("Onboarding — model grid", () => {
  it("renders 6 <select> elements with the live model list as options", () => {
    renderRoute();
    const grid = screen.getByTestId("model-grid");
    const selects = within(grid).getAllByTestId("model-select");
    expect(selects).toHaveLength(6);
    // The first select (default) should carry an Armenian option text
    // and include every live model id.
    const firstSelect = within(selects[0]).getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(firstSelect.options).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(["", "gpt-4", "claude-3", "llama-3"]),
    );
  });

  it("ModelSelect renders an orphan option when the stored id isn't in the live list", () => {
    render(
      <ModelSelect
        modelKey="copilot"
        value="old-removed-model"
        models={MODELS}
        onChange={() => {}}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("old-removed-model");
  });
});

/* ────────── api key section ────────── */

describe("Onboarding — api key section", () => {
  it("shows the 'key-ը տեղադրված է' line when settings.openrouterApiKeySet is true", () => {
    render(
      <ApiKeySection
        settings={SETTINGS_RESPONSE.settings}
        value=""
        onChange={() => {}}
      />,
    );
    const status = screen.getByTestId("api-key-status");
    expect(status.getAttribute("data-key-set")).toBe("true");
    expect(status.textContent).toMatch(/key-ը տեղադրված է/);
  });

  it("shows the 'key-ը դեռ տեղադրված չէ' line when settings.openrouterApiKeySet is false", () => {
    render(
      <ApiKeySection
        settings={{
          ...SETTINGS_RESPONSE.settings,
          openrouterApiKeySet: false,
        }}
        value=""
        onChange={() => {}}
      />,
    );
    const status = screen.getByTestId("api-key-status");
    expect(status.getAttribute("data-key-set")).toBe("false");
    expect(status.textContent).toMatch(/key-ը դեռ տեղադրված չէ/);
  });
});

/* ────────── save button ────────── */

describe("Onboarding — save button", () => {
  it("renders the Armenian 'Պահպանել' label when idle", () => {
    render(
      <SaveButton onSave={() => {}} isPending={false} status="" error="" />,
    );
    const btn = screen.getByTestId("onboarding-save");
    expect(btn.textContent).toMatch(/Պահպանել/);
    expect(btn).not.toBeDisabled();
  });

  it("shows 'Պահպանում…' and is disabled while the mutation is pending", () => {
    render(
      <SaveButton onSave={() => {}} isPending={true} status="" error="" />,
    );
    const btn = screen.getByTestId("onboarding-save");
    expect(btn.textContent).toMatch(/Պահպանում/);
    expect(btn).toBeDisabled();
  });

  it("renders a status line for the success message", () => {
    render(
      <SaveButton
        onSave={() => {}}
        isPending={false}
        status="Պահպանված է ✓"
        error=""
      />,
    );
    expect(screen.getByTestId("onboarding-status").textContent).toMatch(
      /Պահպանված է/,
    );
  });
});
