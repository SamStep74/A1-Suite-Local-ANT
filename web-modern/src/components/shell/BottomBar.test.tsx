/**
 * BottomBar — sync status, last save, online/offline pill, agent load.
 *
 * Phase 0 ships static indicators (online / idle); the real sync + agent
 * load land in Phase 1. These tests pin the visible contract:
 * - "Online" / "Offline" pill (driven by navigator + window events)
 * - "All changes saved" default vs. "Saved <time>" when lastSaved provided
 * - "Agents idle" status string
 * - Offline transitions switch the right-side text to "Queued"
 */
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BottomBar } from "./BottomBar";

afterEach(() => cleanup());

describe("BottomBar", () => {
  it("renders the online pill by default (jsdom defaults to navigator.onLine=true)", () => {
    render(<BottomBar />);
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("renders the 'All changes saved' status when no lastSaved is given", () => {
    render(<BottomBar />);
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("renders a 'Saved <time>' line when lastSaved is provided", () => {
    const when = new Date("2026-01-01T12:34:00Z");
    render(<BottomBar lastSaved={when} />);
    // The component formats via toLocaleTimeString("hy-AM"); we just assert
    // the line starts with "Saved " so we don't lock to a locale.
    expect(screen.getByText(/^Saved /)).toBeInTheDocument();
  });

  it("renders the agent idle status", () => {
    render(<BottomBar />);
    expect(screen.getByText(/Agents idle/)).toBeInTheDocument();
  });

  it("renders a <footer> element so it is announced as the page footer", () => {
    render(<BottomBar />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("switches to the offline pill and 'Queued' status on a window 'offline' event", () => {
    render(<BottomBar />);
    expect(screen.getByText("Online")).toBeInTheDocument();

    fireEvent(window, new Event("offline"));

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
  });

  it("returns to the online pill on a window 'online' event (sync state preserved)", () => {
    render(<BottomBar />);
    fireEvent(window, new Event("offline"));
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();

    fireEvent(window, new Event("online"));
    // The online pill returns ...
    expect(screen.getByText("Online")).toBeInTheDocument();
    // ... but the sync state stays at "offline" until something else resets
    // it (Phase 1 wires the real sync engine). The "Queued" line therefore
    // intentionally persists across the online transition.
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.queryByText("All changes saved")).not.toBeInTheDocument();
  });
});
