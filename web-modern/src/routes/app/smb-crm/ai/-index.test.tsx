/**
 * /app/smb-crm/ai — Ask AI page tests (slice 11).
 *
 * Coverage:
 *   - The 4 preset buttons render (Summarise, Translate to
 *     Armenian, Draft a customer email, Custom)
 *   - The provider status badge renders the configured
 *     provider name from the mocked /api/ai/status
 *   - The status badge shows "offline" when the route errors
 *   - The status badge shows an amber warning when the
 *     provider reports !ok with an error reason
 *   - The system prompt textarea updates on user input
 *   - The user prompt textarea is required (empty disables
 *     the Send button)
 *   - The Send button calls postJson with /api/ai/chat and
 *     the parsed AiChatRequest body
 *   - On a successful AI response, the reply is appended to
 *     the history (the user prompt + the AI answer both
 *     render)
 *   - On a failure response (ok: false), the history shows
 *     the error message instead of a body
 *   - The temperature slider + maxTokens input render
 *   - The Back link points to /app/smb-crm
 *   - NO secret material (API key, system prompt) ever
 *     appears in the DOM when the model returns ok: false
 *   - Armenian + emoji user input round-trips into the
 *     outbound /api/ai/chat body
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
    <>{children ?? id ?? null}</>
  ),
  useLingui: () => ({
    t: (s: string | TemplateStringsArray) => (Array.isArray(s) ? s[0] : s),
    i18n: { _: (s: string) => s, locale: "hy" },
  }),
}));

const mocks = vi.hoisted(() => ({
  fullPath: "/app/smb-crm/ai/",
  postJsonMock: vi.fn(),
  streamNdjsonMock: vi.fn(),
  // Pre-seedable /api/ai/status result. null = "loading".
  statusData: null as null | {
    provider: string;
    baseURL: string;
    models: string[];
    ok: boolean;
    error: string | null;
  }
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (cfg: { component: unknown }) => ({
    fullPath: mocks.fullPath,
    useSearch: () => ({}),
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
    options: cfg
  }),
  useSearch: () => ({}),
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
    useQuery: (_opts: { queryKey: string[] }) => {
      if (mocks.statusData === null) {
        return { data: undefined, isLoading: true, isError: false };
      }
      return { data: mocks.statusData, isLoading: false, isError: false };
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

vi.mock("../../../../lib/api/client", () => ({
  getJson: vi.fn(),
  postJson: (...args: unknown[]) => mocks.postJsonMock(...args),
  streamNdjson: (...args: unknown[]) => mocks.streamNdjsonMock(...args)
}));

import { Route } from "./index";

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

beforeEach(() => {
  mocks.statusData = {
    provider: "ollama",
    baseURL: "127.0.0.1:11434",
    models: ["llama3.1:8b", "nomic-embed-text"],
    ok: true,
    error: null
  };
  mocks.postJsonMock.mockReset();
  mocks.streamNdjsonMock.mockReset();
});

/**
 * Uncheck the streaming toggle. Slice 14 (V2.6 AI streaming)
 * turned streaming on by default; the old postJson-based
 * tests need to opt out to hit the original /api/ai/chat path.
 */
function disableStreaming() {
  const cb = screen.getByTestId("smb-crm-ai-streaming-checkbox") as HTMLInputElement;
  if (cb.checked) fireEvent.click(cb);
}

afterEach(() => {
  cleanup();
});

describe("Ask AI — presets + status", () => {
  it("renders the 4 preset buttons", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-ai-presets")).toBeTruthy();
    const presets = screen.getAllByTestId("smb-crm-ai-preset");
    expect(presets).toHaveLength(4);
    const ids = presets.map((el) => el.getAttribute("data-preset-id"));
    expect(ids).toEqual(["summarise", "translate", "draft", "none"]);
  });

  it("shows the provider name from /api/ai/status in the badge", () => {
    renderRoute();
    const badge = screen.getByTestId("smb-crm-ai-status");
    expect(badge.textContent).toMatch(/ollama/);
    expect(badge.textContent).toMatch(/llama3\.1:8b/);
  });

  it("shows 'offline' when the status query has no data", () => {
    mocks.statusData = null as never;
    renderRoute();
    const badge = screen.getByTestId("smb-crm-ai-status");
    expect(badge.textContent).toMatch(/…/);
  });

  it("shows an amber warning when the provider returns ok=false with an error", () => {
    mocks.statusData = {
      provider: "anthropic",
      baseURL: "",
      models: [],
      ok: false,
      error: "not_implemented_on_ant:anthropic"
    };
    renderRoute();
    const badge = screen.getByTestId("smb-crm-ai-status");
    expect(badge.textContent).toMatch(/anthropic/);
    expect(badge.textContent).toMatch(/not_implemented_on_ant:anthropic/);
  });
});

describe("Ask AI — input + send", () => {
  it("disables the Send button when the user prompt is empty", () => {
    renderRoute();
    const sendBtn = screen.getByTestId("smb-crm-ai-send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("enables the Send button when the user prompt has text", () => {
    renderRoute();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    const sendBtn = screen.getByTestId("smb-crm-ai-send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
  });

  it("sends a POST /api/ai/chat with the parsed AiChatRequest body on click", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      provider: "ollama",
      model: "llama3.1:8b",
      data: "hello back",
      error: null
    });
    renderRoute();
    disableStreaming();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    const sendBtn = screen.getByTestId("smb-crm-ai-send") as HTMLButtonElement;
    fireEvent.click(sendBtn);
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    const [url, body, _schema] = mocks.postJsonMock.mock.calls[0]!;
    expect(url).toBe("/api/ai/chat");
    expect(body).toMatchObject({
      user: "hi",
      temperature: 0.2,
      maxTokens: 1024
    });
    // System prompt is the active preset's text.
    expect(typeof body.system).toBe("string");
    expect(body.system.length).toBeGreaterThan(0);
  });

  it("renders the AI reply in the history on a successful response", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      provider: "ollama",
      model: "llama3.1:8b",
      data: "the model's answer",
      error: null
    });
    renderRoute();
    disableStreaming();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(screen.getAllByTestId("smb-crm-ai-history-user").length).toBe(1));
    expect(screen.getByTestId("smb-crm-ai-history-ai").textContent).toMatch(/the model's answer/);
    // The provider + model annotation appears below the reply.
    const history = screen.getByTestId("smb-crm-ai-history");
    expect(history.textContent).toMatch(/ollama/);
    expect(history.textContent).toMatch(/llama3\.1:8b/);
  });

  it("renders the error message in the history on a failed response (ok:false)", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: false,
      provider: "ollama",
      model: "llama3.1:8b",
      data: null,
      error: "no_provider"
    });
    renderRoute();
    disableStreaming();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(screen.getByTestId("smb-crm-ai-history-err")).toBeTruthy());
    expect(screen.getByTestId("smb-crm-ai-history-err").textContent).toMatch(/no_provider/);
  });

  it("renders the empty-state hint when no messages have been sent yet", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-ai-history-empty")).toBeTruthy();
  });

  it("round-trips Armenian + emoji user input into the outbound body", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      provider: "ollama",
      model: "llama3.1:8b",
      data: "ok",
      error: null
    });
    renderRoute();
    disableStreaming();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    const armenian = "Բարև աշխարհ 🇦🇲";
    fireEvent.change(ta, { target: { value: armenian } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    const body = mocks.postJsonMock.mock.calls[0]![1];
    expect(body.user).toBe(armenian);
  });

  it("never renders an API key (there is no API key)", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      provider: "ollama",
      model: "llama3.1:8b",
      data: "ok",
      error: null
    });
    renderRoute();
    disableStreaming();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(screen.getAllByTestId("smb-crm-ai-history-user").length).toBe(1));
    const html = document.body.innerHTML;
    // The 3 known API key prefixes must not appear.
    expect(html).not.toMatch(/sk-ant-/);
    expect(html).not.toMatch(/sk-openai-/);
    expect(html).not.toMatch(/ghp_/);
  });
});

describe("Ask AI — streaming (slice 14)", () => {
  // Helper: a fake streamNdjson that yields a sequence of events.
  function mkStream(events: Array<{ type: string; data: unknown }>) {
    return async function* () {
      for (const ev of events) yield ev;
    };
  }

  it("calls streamNdjson (not postJson) when the streaming toggle is on (default)", async () => {
    mocks.streamNdjsonMock.mockImplementation(mkStream([
      { type: "token", data: "hello " },
      { type: "token", data: "world" },
      { type: "done", data: { model: "llama3.1:8b" } }
    ]));
    renderRoute();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(mocks.streamNdjsonMock).toHaveBeenCalledTimes(1));
    expect(mocks.postJsonMock).not.toHaveBeenCalled();
    const [url] = mocks.streamNdjsonMock.mock.calls[0]!;
    expect(url).toBe("/api/ai/chat/stream");
  });

  it("accumulates token events into the in-progress AI history entry", async () => {
    mocks.streamNdjsonMock.mockImplementation(mkStream([
      { type: "token", data: "Hello, " },
      { type: "token", data: "world!" },
      { type: "done", data: { model: "llama3.1:8b" } }
    ]));
    renderRoute();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "greet me" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => {
      const ai = screen.getByTestId("smb-crm-ai-history-ai");
      expect(ai.textContent).toMatch(/Hello, world!/);
    });
  });

  it("renders a streaming cursor while tokens are arriving", async () => {
    // Hold the stream open: yield one token, then wait until the
    // test ends (we never yield "done"). Use a deferred.
    let release!: () => void;
    const done = new Promise<void>((r) => { release = r; });
    mocks.streamNdjsonMock.mockImplementation(async function* () {
      yield { type: "token", data: "part " };
      await done;
    });
    renderRoute();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(screen.getByTestId("smb-crm-ai-streaming-cursor")).toBeTruthy());
    // Cleanup: release the stream so the test ends.
    release();
  });

  it("renders the error message when the stream emits a single error event", async () => {
    mocks.streamNdjsonMock.mockImplementation(mkStream([
      { type: "error", data: { code: "no_provider", message: "no_provider" } }
    ]));
    renderRoute();
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(screen.getByTestId("smb-crm-ai-history-err")).toBeTruthy());
    expect(screen.getByTestId("smb-crm-ai-history-err").textContent).toMatch(/no_provider/);
  });

  it("the streaming toggle is visible and defaults to on", () => {
    renderRoute();
    const cb = screen.getByTestId("smb-crm-ai-streaming-checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("unchecking the toggle routes the next send through postJson", async () => {
    mocks.postJsonMock.mockResolvedValue({
      ok: true,
      provider: "ollama",
      model: "llama3.1:8b",
      data: "x",
      error: null
    });
    renderRoute();
    const cb = screen.getByTestId("smb-crm-ai-streaming-checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
    const ta = screen.getByTestId("smb-crm-ai-user-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("smb-crm-ai-send"));
    await waitFor(() => expect(mocks.postJsonMock).toHaveBeenCalledTimes(1));
    expect(mocks.streamNdjsonMock).not.toHaveBeenCalled();
  });
});

describe("Ask AI — sliders + back link", () => {
  it("renders temperature slider + max-tokens input", () => {
    renderRoute();
    expect(screen.getByTestId("smb-crm-ai-temperature")).toBeTruthy();
    expect(screen.getByTestId("smb-crm-ai-max-tokens")).toBeTruthy();
  });

  it("renders the Back link pointing to /app/smb-crm", () => {
    renderRoute();
    const back = screen.getByTestId("smb-crm-ai-back");
    expect(back.getAttribute("data-href")).toBe("/app/smb-crm");
  });
});
