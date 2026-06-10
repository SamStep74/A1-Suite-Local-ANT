/**
 * HybridBadge — the agent/rule/resolved marker. The Salesforce Agentforce
 * hybrid pattern requires that every AI surface and every deterministic
 * surface be visibly separated. These tests pin the three roles + their
 * a11y labels so a future refactor can't silently break the contract.
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HybridBadge } from "./HybridBadge";

afterEach(() => cleanup());

describe("HybridBadge", () => {
  it('renders the "agent" label for the agent role', () => {
    render(<HybridBadge kind="agent" />);
    expect(screen.getByText("agent")).toBeInTheDocument();
  });

  it('renders the "rule" label for the deterministic role', () => {
    render(<HybridBadge kind="rule" />);
    expect(screen.getByText("rule")).toBeInTheDocument();
  });

  it('renders the "done" label for the resolved role', () => {
    render(<HybridBadge kind="resolved" />);
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("hides the label when showLabel is false but keeps the aria-label", () => {
    render(<HybridBadge kind="agent" showLabel={false} />);
    expect(screen.queryByText("agent")).not.toBeInTheDocument();
    // The wrapper span has role="img" + aria-label="AI agent".
    expect(screen.getByLabelText("AI agent")).toBeInTheDocument();
  });

  it("exposes accessible names for screen readers", () => {
    const { rerender } = render(<HybridBadge kind="agent" />);
    expect(screen.getByLabelText("AI agent")).toBeInTheDocument();

    rerender(<HybridBadge kind="rule" />);
    expect(screen.getByLabelText("Deterministic rule")).toBeInTheDocument();

    rerender(<HybridBadge kind="resolved" />);
    expect(screen.getByLabelText("Completed")).toBeInTheDocument();
  });
});
