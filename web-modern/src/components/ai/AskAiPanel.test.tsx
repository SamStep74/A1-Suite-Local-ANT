/**
 * AskAiPanel — in-app AI assistant sidebar (Phase 10.5 ask-ai).
 *
 * These tests pin the *interactive contract* of the panel:
 *   1. Submitting a question streams text into the answer area.
 *   2. Clicking a citation chip fires the onCitationClick callback
 *      with the right citation shape.
 *   3. Escape closes the panel (calls onOpenChange(false)).
 *
 * We mock `streamAsk` from `lib/ai/client` so the tests don't hit
 * the real network stub (which sleeps 800ms on the first chunk).
 * The mock is synchronous — it yields the whole answer in one tick
 * so `waitFor` resolves immediately.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  streamAsk: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/app/finance/invoices", search: "", hash: "" }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  Outlet: () => null,
  createFileRoute: () => () => ({}),
  redirect: vi.fn(),
}));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (s: { message: string } | string) =>
      typeof s === "string" ? s : s.message,
    i18n: { _: (s: string) => s },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// We mock the client to skip the 800ms stub latency. The mock
// resolves synchronously and yields the full answer in one chunk
// so the panel renders `ask-ai-answer` without any timers.
vi.mock("../../lib/ai/client", () => ({
  streamAsk: mocks.streamAsk,
}));

import { AskAiPanel } from "./AskAiPanel";

afterEach(() => {
  cleanup();
  mocks.streamAsk.mockReset();
});

/** Default mock impl: a stub answer + one route citation. */
function stubStreamOnce() {
  mocks.streamAsk.mockResolvedValue({
    chunks: ["This is a stub answer from the unit test."],
    response: {
      answer: "This is a stub answer from the unit test.",
      citations: [
        {
          kind: "route" as const,
          id: "finance:invoices:inv_abc",
          app: "finance",
          label: "Invoices",
          href: "/app/finance/invoices/inv_abc",
        },
      ],
      tokensUsed: 0,
      idempotencyKey: "test-key",
    },
  });
}

describe("AskAiPanel", () => {
  it("renders nothing when open is false (the parent unmounts it)", () => {
    render(<AskAiPanel open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByTestId("ask-ai-panel")).not.toBeInTheDocument();
  });

  it("renders the panel chrome (data-testid=ask-ai-panel, data-state=open) when open is true", () => {
    render(<AskAiPanel open onOpenChange={vi.fn()} />);
    const panel = screen.getByTestId("ask-ai-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("data-state", "open");
    // Header is the most reliable visible text — we look for the
    // heading rendered via <Trans>Ask AI</Trans>.
    expect(screen.getByRole("heading", { name: "Ask AI" })).toBeInTheDocument();
  });

  it("streams the answer into ask-ai-answer when the user submits a question", async () => {
    stubStreamOnce();
    const onOpenChange = vi.fn();
    render(<AskAiPanel open onOpenChange={onOpenChange} />);
    const textarea = screen.getByTestId("ask-ai-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test question" } });
    expect(textarea.value).toBe("test question");
    // Click the submit button — the form's onSubmit also calls
    // submit on Enter, but a click is more deterministic.
    fireEvent.click(screen.getByTestId("ask-ai-submit"));
    // The mock resolves immediately; wait for the streamed text
    // to land in the DOM.
    await waitFor(() => {
      expect(screen.getByTestId("ask-ai-answer")).toHaveTextContent(
        /stub answer/,
      );
    });
    expect(mocks.streamAsk).toHaveBeenCalledTimes(1);
    const [req, signal] = mocks.streamAsk.mock.calls[0]!;
    expect(req.question).toBe("test question");
    // The mock also receives the current route context so the
    // panel knows which app/entity the user is on.
    expect(req.context).toMatchObject({ app: "finance", entity: "invoices" });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("fires onCitationClick with the right citation shape when a chip is clicked", async () => {
    stubStreamOnce();
    const onCitationClick = vi.fn();
    render(
      <AskAiPanel open onOpenChange={vi.fn()} onCitationClick={onCitationClick} />,
    );
    fireEvent.change(screen.getByTestId("ask-ai-input"), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByTestId("ask-ai-submit"));
    // Wait for the answer (and therefore the citation strip) to render.
    const chip = await screen.findByTestId("ask-ai-citation-chip");
    fireEvent.click(chip);
    expect(onCitationClick).toHaveBeenCalledTimes(1);
    expect(onCitationClick).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "route",
        app: "finance",
        label: "Invoices",
        href: "/app/finance/invoices/inv_abc",
      }),
    );
  });

  it("calls onOpenChange(false) when Escape is pressed", async () => {
    const onOpenChange = vi.fn();
    render(<AskAiPanel open onOpenChange={onOpenChange} />);
    // The Escape handler is bound to window — fire a keydown
    // event so it reaches the handler.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("does not submit when the question is empty (the submit button is disabled)", () => {
    const onOpenChange = vi.fn();
    render(<AskAiPanel open onOpenChange={onOpenChange} />);
    const submit = screen.getByTestId("ask-ai-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mocks.streamAsk).not.toHaveBeenCalled();
  });
});
